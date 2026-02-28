import { test, expect, type Page, type Locator } from '@playwright/test';
import { TEAM_1, TEAM_2, FORMAT } from '../fixtures/teams';
import * as fs from 'fs';
import * as path from 'path';

const CLIENT_URL = `file:///Users/efan/futuresight-client/play.pokemonshowdown.com/testclient.html?~~localhost:8000`;

async function login(page: Page, _name?: string) {
	await page.goto(CLIENT_URL);
	// Auto-naming assigns a username on connect; wait for the chat textbox
	// which appears once the user is named and connected
	await page.waitForSelector('textarea.textbox', { timeout: 15_000 });
}

async function sendCommand(page: Page, command: string) {
	await page.evaluate((cmd) => {
		(window as any).app.send(cmd);
	}, command);
}

/**
 * Choose a move for one pokemon on the given side.
 * Clicks the first available move, then picks a target if prompted (doubles).
 */
async function chooseOneMove(controls: Locator) {
	const moveBtn = controls.locator('button[name="chooseMove"]:not([disabled])').first();
	await expect(moveBtn).toBeVisible({ timeout: 10_000 });
	await moveBtn.click();

	// In doubles, a target selection may appear
	const targetBtn = controls.locator('button[name="chooseMoveTarget"]:not([disabled])').first();
	if (await targetBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
		await targetBtn.click();
	}
}

/**
 * Choose moves for all active pokemon on a side (handles doubles).
 */
async function chooseMoves(controls: Locator) {
	for (let i = 0; i < 4; i++) {
		const moveBtn = controls.locator('button[name="chooseMove"]:not([disabled])').first();
		const visible = await moveBtn.isVisible({ timeout: 3_000 }).catch(() => false);
		if (!visible) break;
		await chooseOneMove(controls);
	}
}

/**
 * Start a battle, complete team preview, and return the control locators.
 */
async function startBattleAndPreview(page: Page, name: string) {
	await login(page, name);
	await sendCommand(page, `/startbattle ${FORMAT};;;${TEAM_1};;;${TEAM_2}`);

	// Wait for the current room's battle controls (use last() to target the
	// newest room in case the server has stale rooms from previous tests)
	const p1 = page.locator('#battle-controls-p1').last();
	const p2 = page.locator('#battle-controls-p2').last();
	await expect(p1).toBeVisible({ timeout: 15_000 });

	// Team Preview — select 4 mons for each side (VGC doubles: bring 4 out of 6)
	for (const panel of [p1, p2]) {
		for (let i = 0; i < 4; i++) {
			const btn = panel.locator('button[name="chooseTeamPreview"]:not([disabled])').first();
			await expect(btn).toBeVisible({ timeout: 10_000 });
			await btn.click();
		}
	}

	return { p1, p2 };
}

/**
 * Choose moves for both sides with a brief settle delay beforehand.
 */
async function playTurn(page: Page, p1: Locator, p2: Locator) {
	await page.waitForTimeout(500);
	await chooseMoves(p1);
	await chooseMoves(p2);
}

test.describe('Futuresight Battle Flow', () => {
	test('create battle, team preview, make moves, and rewind', async ({ page }) => {
		const { p1, p2 } = await startBattleAndPreview(page, 'TestPlayer');

		// Turn 1 — choose moves for both sides
		await playTurn(page, p1, p2);

		// Verify turn resolved
		await expect(page.locator('.battle-log')).toContainText('Turn 1', { timeout: 15_000 });

		// Wait for Turn 2 controls
		await expect(p1.locator('button[name="chooseMove"]:not([disabled])').first())
			.toBeVisible({ timeout: 15_000 });

		// Rewind — click the Jump button
		const jumpButton = page.locator('button[name="jumpToTurn"]').first();
		await expect(jumpButton).toBeVisible({ timeout: 5_000 });
		await jumpButton.click();

		// After rewind, controls should reappear
		await expect(
			p1.locator('button[name="chooseMove"], button[name="chooseTeamPreview"]').first()
		).toBeVisible({ timeout: 15_000 });
	});

	test('jumping to turn 1 clears turn 1 moves from the log', async ({ page }) => {
		const { p1, p2 } = await startBattleAndPreview(page, 'LogTest');

		// Play Turn 1
		await playTurn(page, p1, p2);

		// Wait for Turn 2 request (move buttons reappear)
		await expect(p1.locator('button[name="chooseMove"]:not([disabled])').first())
			.toBeVisible({ timeout: 15_000 });

		// Disable jQuery animations so the stepQueue pipeline doesn't stall
		await page.evaluate(() => {
			(window as any).jQuery.fx.off = true;
		});
		await page.waitForTimeout(500);

		// Inject synthetic Turn 1 events and process them, then directly
		// invoke the |jumptoturn| handler — all inside one evaluate to avoid
		// race conditions with the animation pipeline.
		const result = await page.evaluate(() => {
			const battle = (window as any).app.curRoom?.battle;

			// Append synthetic turn 1 events to the stepQueue
			const syntheticEvents = [
				'|',
				'|move|p1a: Calyrex|Glacial Lance|p2a: Lunala',
				'|-damage|p2a: Lunala|50/100',
				'|move|p2a: Lunala|Moongeist Beam|p1a: Calyrex',
				'|-damage|p1a: Calyrex|70/100',
				'|turn|2',
			];
			for (const line of syntheticEvents) {
				battle.stepQueue.push(line);
			}

			// Process all entries with animations off so snapshots are saved
			// (seeking stays null during add() processing)
			battle.scene.animationOff();
			if (battle.atQueueEnd) {
				battle.atQueueEnd = false;
				battle.nextStep();
			}
			// Process until queue ends
			while (battle.currentStep < battle.stepQueue.length) {
				battle.nextStep();
			}
			battle.scene.animationOn();

			const turnBefore = battle.turn;
			const byTurnKeys = [...battle.stepQueueByTurn.keys()];
			const logHasTurn2 = battle.scene?.log?.innerElem?.innerText?.includes('Turn 2');
			const logHasGlacial = battle.scene?.log?.innerElem?.innerText?.includes('Glacial Lance');

			// Now invoke the |jumptoturn| handler logic directly
			const stepQueueAtTurn = battle.stepQueueByTurn.get(1);
			if (stepQueueAtTurn) {
				battle.scene.log.jumpToTurn(1);
				battle.setQueue(stepQueueAtTurn);
				battle.seekTurn(1, true);
			}

			const logAfter = battle.scene?.log?.innerElem?.innerText;
			return {
				turnBefore,
				byTurnKeys,
				logHasTurn2Before: logHasTurn2,
				logHasGlacialBefore: logHasGlacial,
				stepQueueAtTurnLen: stepQueueAtTurn?.length,
				turnAfter: battle.turn,
				stepQueueLenAfter: battle.stepQueue?.length,
				currentStepAfter: battle.currentStep,
				logAfter,
			};
		});

		console.log('DIAG:', JSON.stringify({
			turnBefore: result.turnBefore,
			byTurnKeys: result.byTurnKeys,
			logHasTurn2Before: result.logHasTurn2Before,
			logHasGlacialBefore: result.logHasGlacialBefore,
			stepQueueAtTurnLen: result.stepQueueAtTurnLen,
			turnAfter: result.turnAfter,
			stepQueueLenAfter: result.stepQueueLenAfter,
			currentStepAfter: result.currentStepAfter,
		}));

		// After jumping to Turn 1, the log should NOT contain Turn 2 or
		// Turn 1 move events — only content up to the Turn 1 header
		expect(result.logAfter).toContain('Turn 1');
		expect(result.logAfter).toContain('Battle started');
		expect(result.logAfter).not.toContain('Turn 2');
		expect(result.logAfter).not.toContain('Glacial Lance');
	});

	test('share position and resume from link creates battle at saved turn', async ({ page }) => {
		const { p1, p2 } = await startBattleAndPreview(page, 'ShareTest');

		// Play Turn 1
		await playTurn(page, p1, p2);
		await expect(p1.locator('button[name="chooseMove"]:not([disabled])').first())
			.toBeVisible({ timeout: 15_000 });

		// Play Turn 2
		await playTurn(page, p1, p2);
		await expect(p1.locator('button[name="chooseMove"]:not([disabled])').first())
			.toBeVisible({ timeout: 15_000 });

		// Share position (saves state to a file on the server)
		// Send to the battle room specifically (app.curRoom might be lobby)
		await page.evaluate(() => {
			const rooms = (window as any).app.rooms;
			for (const id of Object.keys(rooms)) {
				if (id.startsWith('battle-')) {
					rooms[id].send('/shareposition');
					return;
				}
			}
		});

		// Wait for the file to be written, then find the most recent saved position
		// by polling the server's saved-positions directory
		const savedDir = path.resolve(__dirname, '../../../config/saved-positions');
		let positionId = '';
		for (let attempt = 0; attempt < 10; attempt++) {
			await page.waitForTimeout(1_000);
			if (!fs.existsSync(savedDir)) continue;
			const files = fs.readdirSync(savedDir).filter(f => f.endsWith('.json'));
			if (files.length === 0) continue;
			const newest = files
				.map(f => ({ name: f, mtime: fs.statSync(path.join(savedDir, f)).mtimeMs }))
				.sort((a, b) => b.mtime - a.mtime)[0];
			positionId = newest.name.replace('.json', '');
			break;
		}
		expect(positionId).toBeTruthy();

		// Resume from the saved position
		await sendCommand(page, `/resume ${positionId}`);

		// Wait for the NEW battle room's controls to appear
		await page.waitForTimeout(2_000);
		const newP1 = page.locator('#battle-controls-p1').last();
		await expect(newP1.locator('button[name="chooseMove"]:not([disabled])').first())
			.toBeVisible({ timeout: 15_000 });

		// Moves should be available (not team preview) — battle resumed mid-game
		const hasMoveButtons = await newP1.locator('button[name="chooseMove"]:not([disabled])').count();
		expect(hasMoveButtons).toBeGreaterThan(0);

		// Verify jump-to-turn still works in the resumed battle (stateByTurn was preserved)
		await sendCommand(page, '/jumptoturn 1');
		await expect(newP1.locator('button[name="chooseMove"]:not([disabled])').first())
			.toBeVisible({ timeout: 15_000 });
	});

	test('jump to turn 2 then jump to turn 1 does not replay old moves', async ({ page }) => {
		const { p1, p2 } = await startBattleAndPreview(page, 'JumpTest');

		// Turn 1 — choose moves
		await playTurn(page, p1, p2);

		// Wait for turn 2 request to arrive (move buttons reappear)
		await expect(p1.locator('button[name="chooseMove"]:not([disabled])').first())
			.toBeVisible({ timeout: 15_000 });

		// Jump to turn 2 (current turn)
		await sendCommand(page, '/jumptoturn 2');
		await expect(p1.locator('button[name="chooseMove"]:not([disabled])').first())
			.toBeVisible({ timeout: 15_000 });

		// Jump to turn 1
		await sendCommand(page, '/jumptoturn 1');
		await expect(p1.locator('button[name="chooseMove"]:not([disabled])').first())
			.toBeVisible({ timeout: 15_000 });

		// Record the request ID after jumping to turn 1
		const rqidAfterJump = await page.evaluate(() => {
			const room = (window as any).app.curRoom;
			return room.requests.get('p1')?.rqid;
		});

		// Wait to make sure no spurious turn resolution happens (old moves replaying
		// would cause the server to advance and send a new request with a different rqid)
		await page.waitForTimeout(3_000);

		// The request ID should not have changed (no new request = old moves didn't replay)
		const rqidLater = await page.evaluate(() => {
			const room = (window as any).app.curRoom;
			return room.requests.get('p1')?.rqid;
		});
		expect(rqidLater).toBe(rqidAfterJump);
	});
});
