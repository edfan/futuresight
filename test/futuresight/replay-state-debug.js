'use strict';

/**
 * Replay State Debug Test
 *
 * Diagnoses WHY the sim state diverges from the replay during replay import.
 *
 * Replay: https://replay.pokemonshowdown.com/gen9vgc2026regfbo3-2537803682-icuh2me9epbrvpre3t3qlsgdgcbh1bmpw
 *
 * FINDINGS:
 * =========
 * ROOT CAUSE: parseReplayChoices() generates INCOMPLETE choices for doubles turns
 * where a Pokemon is KO'd before it gets to move. In a doubles battle, the sim
 * requires choices for ALL active Pokemon, but the parser only generates choices
 * for Pokemon that have a |move| or |cant| line. If a Pokemon was alive at the
 * start of a turn but fainted before acting (KO'd by a faster opponent), it has
 * no |move| line and the parser omits its choice.
 *
 * CONSEQUENCES:
 * - In turn 2: p2 submits "move taunt 2" (only p2a), missing p2b Weezing's choice
 * - The sim accepts partial choices in doubles, so battle.choose() succeeds but
 *   the turn doesn't resolve (still waiting for p2b's choice)
 * - battle.turn never advances past 2
 * - stateByTurn[battle.turn] keeps overwriting index 2 with the latest state
 * - After all 4 turns, stateByTurn only has indices 0-2, and stateByTurn[2]
 *   contains the LAST turn's patched state instead of turn 2's state
 * - Jumping to turn 3 is impossible because stateByTurn[3] doesn't exist
 *
 * In turn 3: Same issue -- p1 submits "switch 3" (only p1b), missing p1a Flutter
 * Mane's choice (it gets KO'd by Wave Crash before acting).
 *
 * FIX NEEDED: In parseReplayChoices(), after collecting all move/switch/cant actions
 * for a turn, check if any active slot is missing a choice. For each missing slot,
 * add a "default" or "move 1" placeholder. The sim needs the choice to resolve the
 * turn, even though the Pokemon won't get to act.
 *
 * The fix should go in replay-parser.ts in the saveTurnActions() function:
 * - Track which slots are active at the start of each turn
 * - After collecting all actions, check for missing active slots
 * - Add "default" choice for any missing slot
 */

const assert = require('./../assert');
const Sim = require('../../dist/sim');
const {BattleStream} = Sim;
const {
	parseShowteams,
	parseReplayChoices,
	parseAllTurnPatches,
	countTurns,
} = require('../../dist/server/replay-parser');

// ---------------------------------------------------------------------------
// Hardcoded replay log from:
// https://replay.pokemonshowdown.com/gen9vgc2026regfbo3-2537803682-icuh2me9epbrvpre3t3qlsgdgcbh1bmpw
//
// Game 2 of a Bo3: 13yoshi37 (p1) vs 5jo3toru (p2), 4 turns + forfeit
//
// Key events:
//   Turn 1: Both sides attack. Toxic Spikes set on p1 side.
//   Turn 2: p1b Ogerpon KOs p2b Weezing with Ivy Cudgel BEFORE Weezing acts.
//           -> Parser misses p2b's choice because no |move| line for Weezing.
//           Forced switch: p2b -> Dondozo
//   Turn 3: p2b Dondozo KOs p1a Flutter Mane with Wave Crash BEFORE Flutter Mane acts.
//           -> Parser misses p1a's choice because no |move| line for Flutter Mane.
//           Tatsugiri switches in and activates Commander with Dondozo.
//           Forced switch: p1a -> Ogerpon (gets poisoned from Toxic Spikes)
//   Turn 4: p2b Dondozo KOs p1a Ogerpon. Forfeit.
// ---------------------------------------------------------------------------
const REPLAY_LOG = `|j|\u266413yoshi37
|j|\u229d5jo3toru
|gametype|doubles
|player|p1|13yoshi37|#smogonxnpa2025draftee2|
|player|p2|5jo3toru|170|
|gen|9
|tier|[Gen 9] VGC 2026 Reg F (Bo3)
|rule|Species Clause: Limit one of each Pok\u00e9mon
|rule|Item Clause: Limit 1 of each item
|clearpoke
|poke|p1|Flutter Mane, L50|
|poke|p1|Raging Bolt, L50|
|poke|p1|Ogerpon-Hearthflame, L50, F|
|poke|p1|Rillaboom, L50, M|
|poke|p1|Incineroar, L50, F|
|poke|p1|Urshifu-*, L50, F|
|poke|p2|Flutter Mane, L50|
|poke|p2|Chi-Yu, L50|
|poke|p2|Dondozo, L50, M|
|poke|p2|Tatsugiri, L50, M|
|poke|p2|Dragonite, L50, M|
|poke|p2|Weezing-Galar, L50, M|
|teampreview|4
|showteam|p1|Flutter Mane||BoosterEnergy|Protosynthesis|Moonblast,IcyWind,Protect,ThunderWave||||||50|,,,,,Grass]Raging Bolt||Leftovers|Protosynthesis|CalmMind,DragonPulse,Thunderclap,Protect||||||50|,,,,,Fairy]Ogerpon-Hearthflame||HearthflameMask|MoldBreaker|IvyCudgel,GrassyGlide,SwordsDance,SpikyShield|||F|||50|,,,,,Fire]Rillaboom||AssaultVest|GrassySurge|FakeOut,GrassyGlide,WoodHammer,HighHorsepower|||M|||50|,,,,,Fire]Incineroar||SitrusBerry|Intimidate|FakeOut,KnockOff,PartingShot,Taunt|||F|||50|,,,,,Ghost]Urshifu-Rapid-Strike||FocusSash|UnseenFist|SurgingStrikes,CloseCombat,AquaJet,Protect|||F|||50|,,,,,Water
|showteam|p2|Flutter Mane||BoosterEnergy|Protosynthesis|Moonblast,IcyWind,Taunt,Protect||||||50|,,,,,Fairy]Chi-Yu||FocusSash|BeadsofRuin|HeatWave,Overheat,DarkPulse,Protect||||||50|,,,,,Ghost]Dondozo||RockyHelmet|Oblivious|WaveCrash,OrderUp,Earthquake,Protect|||M|||50|,,,,,Grass]Tatsugiri||SafetyGoggles|Commander|DracoMeteor,MuddyWater,HelpingHand,Protect|||M|||50|,,,,,Steel]Dragonite||ChoiceBand|InnerFocus|ExtremeSpeed,Outrage,IronHead,StompingTantrum|||M|||50|,,,,,Normal]Weezing-Galar||SitrusBerry|NeutralizingGas|SludgeBomb,PoisonGas,ToxicSpikes,Protect|||M|||50|,,,,,Grass
|
|t:|1770849784
|teamsize|p1|4
|teamsize|p2|4
|start
|switch|p1a: Flutter Mane|Flutter Mane, L50|100/100
|switch|p1b: Ogerpon|Ogerpon-Hearthflame, L50, F|100/100
|switch|p2a: Flutter Mane|Flutter Mane, L50|100/100
|switch|p2b: Weezing|Weezing-Galar, L50, M|100/100
|-ability|p2b: Weezing|Neutralizing Gas
|turn|1
|
|t:|1770849803
|-terastallize|p1b: Ogerpon|Fire
|detailschange|p1b: Ogerpon|Ogerpon-Hearthflame-Tera, L50, F, tera:Fire
|move|p1a: Flutter Mane|Icy Wind|p2b: Weezing|[spread] p2a,p2b
|-damage|p2a: Flutter Mane|90/100
|-damage|p2b: Weezing|88/100
|-unboost|p2a: Flutter Mane|spe|1
|-unboost|p2b: Weezing|spe|1
|move|p1b: Ogerpon|Swords Dance|p1b: Ogerpon
|-boost|p1b: Ogerpon|atk|2
|move|p2a: Flutter Mane|Icy Wind|p1a: Flutter Mane|[spread] p1a,p1b
|-resisted|p1b: Ogerpon
|-damage|p1a: Flutter Mane|90/100
|-damage|p1b: Ogerpon|94/100
|-unboost|p1a: Flutter Mane|spe|1
|-unboost|p1b: Ogerpon|spe|1
|move|p2b: Weezing|Toxic Spikes|p1b: Ogerpon
|-sidestart|p1: 13yoshi37|move: Toxic Spikes
|
|upkeep
|turn|2
|
|t:|1770849841
|move|p1a: Flutter Mane|Thunder Wave|p2a: Flutter Mane
|-status|p2a: Flutter Mane|par
|move|p1b: Ogerpon|Ivy Cudgel|p2b: Weezing|[anim] Ivy Cudgel Fire
|-damage|p2b: Weezing|0 fnt
|faint|p2b: Weezing
|-end|p2b: Weezing|ability: Neutralizing Gas
|-ability|p1b: Ogerpon|Embody Aspect (Hearthflame)|boost
|-boost|p1b: Ogerpon|atk|1
|-enditem|p1a: Flutter Mane|Booster Energy
|-activate|p1a: Flutter Mane|ability: Protosynthesis|[fromitem]
|-start|p1a: Flutter Mane|protosynthesisspa
|-enditem|p2a: Flutter Mane|Booster Energy
|-activate|p2a: Flutter Mane|ability: Protosynthesis|[fromitem]
|-start|p2a: Flutter Mane|protosynthesisspa
|move|p2a: Flutter Mane|Taunt|p1b: Ogerpon
|-start|p1b: Ogerpon|move: Taunt
|
|upkeep
|
|t:|1770849856
|switch|p2b: Dondozo|Dondozo, L50, M|100/100
|turn|3
|
|t:|1770849885
|switch|p1b: Rillaboom|Rillaboom, L50, M, shiny|100/100
|-status|p1b: Rillaboom|psn
|-fieldstart|move: Grassy Terrain|[from] ability: Grassy Surge|[of] p1b: Rillaboom
|-end|p2a: Flutter Mane|Protosynthesis|[silent]
|switch|p2a: Tatsugiri|Tatsugiri, L50, M|100/100
|-activate|p2a: Tatsugiri|ability: Commander|[of] p2b: Dondozo
|-boost|p2b: Dondozo|atk|2
|-boost|p2b: Dondozo|spa|2
|-boost|p2b: Dondozo|spe|2
|-boost|p2b: Dondozo|def|2
|-boost|p2b: Dondozo|spd|2
|-terastallize|p2b: Dondozo|Grass
|move|p2b: Dondozo|Wave Crash|p1a: Flutter Mane
|-damage|p1a: Flutter Mane|0 fnt
|faint|p1a: Flutter Mane
|-end|p1a: Flutter Mane|Protosynthesis|[silent]
|-damage|p2b: Dondozo|80/100|[from] Recoil
|
|-heal|p2b: Dondozo|86/100|[from] Grassy Terrain
|-damage|p1b: Rillaboom|88/100 psn|[from] psn
|upkeep
|
|t:|1770849907
|switch|p1a: Ogerpon|Ogerpon-Hearthflame-Tera, L50, F, tera:Fire|94/100
|-status|p1a: Ogerpon|psn
|-ability|p1a: Ogerpon|Embody Aspect (Hearthflame)|boost
|-boost|p1a: Ogerpon|atk|1
|turn|4
|
|t:|1770849920
|switch|p1b: Incineroar|Incineroar, L50, F, shiny|100/100
|-status|p1b: Incineroar|psn
|-ability|p1b: Incineroar|Intimidate|boost
|-unboost|p2a: Tatsugiri|atk|1
|-fail|p2b: Dondozo|unboost|Attack|[from] ability: Oblivious|[of] p2b: Dondozo
|move|p2b: Dondozo|Wave Crash|p1a: Ogerpon
|-supereffective|p1a: Ogerpon
|-damage|p1a: Ogerpon|0 fnt
|faint|p1a: Ogerpon
|detailschange|p1: Ogerpon|Ogerpon-Hearthflame, L50, F|[silent]
|-damage|p2b: Dondozo|64/100|[from] Recoil
|
|-heal|p2b: Dondozo|70/100|[from] Grassy Terrain
|-damage|p1b: Incineroar|88/100 psn|[from] psn
|upkeep
|-message|13yoshi37 forfeited.
|
|win|5jo3toru`;

// ---------------------------------------------------------------------------
// Expected state at the end of each turn (from replay log)
// ---------------------------------------------------------------------------
const EXPECTED_STATE = {
	// After turn 1: Icy Wind damage, Swords Dance, Toxic Spikes
	1: {
		p1a: {species: 'fluttermane', hp: 90, fainted: false, status: ''},
		p1b: {species: 'ogerponhearthflame', hp: 94, fainted: false, status: ''},
		p2a: {species: 'fluttermane', hp: 90, fainted: false, status: ''},
		p2b: {species: 'weezinggalar', hp: 88, fainted: false, status: ''},
	},
	// After turn 2 (including forced switch Dondozo):
	2: {
		p1a: {species: 'fluttermane', hp: 90, fainted: false, status: ''},
		p1b: {species: 'ogerponhearthflame', hp: 94, fainted: false, status: ''},
		p2a: {species: 'fluttermane', hp: 90, fainted: false, status: 'par'},
		p2b: {species: 'dondozo', hp: 100, fainted: false, status: ''},
	},
	// After turn 3 (including forced switch Ogerpon):
	3: {
		p1a: {species: 'ogerponhearthflame', hp: 94, fainted: false, status: 'psn'},
		p1b: {species: 'rillaboom', hp: 88, fainted: false, status: 'psn'},
		p2a: {species: 'tatsugiri', hp: 100, fainted: false, status: ''},
		p2b: {species: 'dondozo', hp: 86, fainted: false, status: ''},
	},
	// After turn 4 (forfeit):
	4: {
		p1a: {species: 'ogerponhearthflame', hp: 0, fainted: true, status: ''},
		p1b: {species: 'incineroar', hp: 88, fainted: false, status: 'psn'},
		p2a: {species: 'tatsugiri', hp: 100, fainted: false, status: ''},
		p2b: {species: 'dondozo', hp: 70, fainted: false, status: ''},
	},
};


// ---------------------------------------------------------------------------
// Packed teams (from showteam lines)
// ---------------------------------------------------------------------------
const P1_PACKED = 'Flutter Mane||BoosterEnergy|Protosynthesis|Moonblast,IcyWind,Protect,ThunderWave||||||50|,,,,,Grass]Raging Bolt||Leftovers|Protosynthesis|CalmMind,DragonPulse,Thunderclap,Protect||||||50|,,,,,Fairy]Ogerpon-Hearthflame||HearthflameMask|MoldBreaker|IvyCudgel,GrassyGlide,SwordsDance,SpikyShield|||F|||50|,,,,,Fire]Rillaboom||AssaultVest|GrassySurge|FakeOut,GrassyGlide,WoodHammer,HighHorsepower|||M|||50|,,,,,Fire]Incineroar||SitrusBerry|Intimidate|FakeOut,KnockOff,PartingShot,Taunt|||F|||50|,,,,,Ghost]Urshifu-Rapid-Strike||FocusSash|UnseenFist|SurgingStrikes,CloseCombat,AquaJet,Protect|||F|||50|,,,,,Water';
const P2_PACKED = 'Flutter Mane||BoosterEnergy|Protosynthesis|Moonblast,IcyWind,Taunt,Protect||||||50|,,,,,Fairy]Chi-Yu||FocusSash|BeadsofRuin|HeatWave,Overheat,DarkPulse,Protect||||||50|,,,,,Ghost]Dondozo||RockyHelmet|Oblivious|WaveCrash,OrderUp,Earthquake,Protect|||M|||50|,,,,,Grass]Tatsugiri||SafetyGoggles|Commander|DracoMeteor,MuddyWater,HelpingHand,Protect|||M|||50|,,,,,Steel]Dragonite||ChoiceBand|InnerFocus|ExtremeSpeed,Outrage,IronHead,StompingTantrum|||M|||50|,,,,,Normal]Weezing-Galar||SitrusBerry|NeutralizingGas|SludgeBomb,PoisonGas,ToxicSpikes,Protect|||M|||50|,,,,,Grass';
const FORMAT = 'gen9vgc2026regf';


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getSimSlotState(battle, slotStr) {
	const sideIdx = slotStr.charAt(1) === '1' ? 0 : 1;
	const posIdx = slotStr.charAt(2) === 'a' ? 0 : 1;
	const side = battle.sides[sideIdx];
	const pokemon = side.active[posIdx];
	if (!pokemon) return {species: '(empty)', hp: 0, fainted: true, status: ''};
	return {
		species: pokemon.species.id,
		hp: pokemon.maxhp > 0 ? Math.round(pokemon.hp / pokemon.maxhp * 100) : 0,
		fainted: pokemon.fainted || pokemon.hp <= 0,
		status: pokemon.status || '',
	};
}

function getSimState(battle) {
	return {
		turn: battle.turn,
		p1a: getSimSlotState(battle, 'p1a'),
		p1b: getSimSlotState(battle, 'p1b'),
		p2a: getSimSlotState(battle, 'p2a'),
		p2b: getSimSlotState(battle, 'p2b'),
	};
}

function formatState(state) {
	const lines = [];
	for (const slot of ['p1a', 'p1b', 'p2a', 'p2b']) {
		const s = state[slot];
		if (!s) continue;
		const statusStr = s.status ? ` [${s.status}]` : '';
		const faintStr = s.fainted ? ' FAINTED' : '';
		lines.push(`  ${slot}: ${s.species} ${s.hp}%${statusStr}${faintStr}`);
	}
	return lines.join('\n');
}

function createBattleStream(teamPreview) {
	const stream = new BattleStream({debug: true, noCatch: true, keepAlive: true});
	void stream.write(
		`>start {"formatid":"${FORMAT}","seed":[1,2,3,4]}\n` +
		`>player p1 {"name":"p1","team":"${P1_PACKED}"}\n` +
		`>player p2 {"name":"p2","team":"${P2_PACKED}"}\n`
	);
	void stream.write(
		`>p1 ${teamPreview.p1}\n` +
		`>p2 ${teamPreview.p2}\n`
	);
	return stream;
}


// ===================================================================
// Test suite: Replay state debug
// ===================================================================
describe('Replay state debug (gen9vgc2026regfbo3-2537803682)', function () {
	this.timeout(30000);

	let showteams;
	let choices;
	let totalTurns;
	let turnPatches;

	before(function () {
		showteams = parseShowteams(REPLAY_LOG);
		choices = parseReplayChoices(REPLAY_LOG, showteams.p1, showteams.p2);
		totalTurns = countTurns(REPLAY_LOG);
		turnPatches = parseAllTurnPatches(REPLAY_LOG, totalTurns);
	});


	// =================================================================
	// Fixed: choices now include default for KO'd slots, turns advance
	// =================================================================
	describe('FIXED: complete choices from parser', function () {
		it('turn 2 p2 choice includes slot b (default for KOd Weezing)', function () {
			const p2Turn2 = choices.turns[1].p2;
			console.log(`    p2 turn 2 choice: "${p2Turn2}"`);

			const parts = p2Turn2.split(',').map(s => s.trim());
			console.log(`    Number of choice parts: ${parts.length} (expected 2 for doubles)`);

			assert.equal(parts.length, 2,
				'p2 turn 2 should have 2 choice parts (slot b gets default for KOd Weezing)');
		});

		it('turn 3 p1 choice includes slot a (default for KOd Flutter Mane)', function () {
			const p1Turn3 = choices.turns[2].p1;
			console.log(`    p1 turn 3 choice: "${p1Turn3}"`);

			const parts = p1Turn3.split(',').map(s => s.trim());
			console.log(`    Number of choice parts: ${parts.length} (expected 2 for doubles)`);

			assert.equal(parts.length, 2,
				'p1 turn 3 should have 2 choice parts (slot a gets default for KOd Flutter Mane)');
		});

		it('battle.turn advances correctly with complete choices', function () {
			const stream = createBattleStream(choices.teamPreview);
			const battle = stream.battle;

			// Turn 1 works fine (all 4 Pokemon have moves)
			const turn1data = {
				p1: choices.turns[0].p1,
				p2: choices.turns[0].p2,
				patch: turnPatches[1] || null,
				forcedP1: '', forcedP2: '',
			};
			void stream.write(`>replayturn ${JSON.stringify(turn1data)}\n`);
			assert.equal(battle.turn, 2, 'After turn 1, battle.turn should be 2');

			// Turn 2: p2 choice now includes both slots
			const turn2data = {
				p1: choices.turns[1].p1,
				p2: choices.turns[1].p2,
				patch: turnPatches[2] || null,
				forcedP1: choices.forcedSwitches[1]?.p1 || '',
				forcedP2: choices.forcedSwitches[1]?.p2 || '',
			};
			void stream.write(`>replayturn ${JSON.stringify(turn2data)}\n`);

			console.log(`    battle.turn after replayturn 2: ${battle.turn}`);
			assert(battle.turn >= 3,
				'battle.turn should advance past 2 with complete choices');

			// Turn 3
			const turn3data = {
				p1: choices.turns[2].p1,
				p2: choices.turns[2].p2,
				patch: turnPatches[3] || null,
				forcedP1: choices.forcedSwitches[2]?.p1 || '',
				forcedP2: choices.forcedSwitches[2]?.p2 || '',
			};
			void stream.write(`>replayturn ${JSON.stringify(turn3data)}\n`);

			console.log(`    battle.turn after replayturn 3: ${battle.turn}`);
			assert(battle.turn >= 4,
				'battle.turn should advance past 3 with complete choices');

			// Process turn 4
			const turn4data = {
				p1: choices.turns[3].p1,
				p2: choices.turns[3].p2,
				patch: turnPatches[4] || null,
				forcedP1: choices.forcedSwitches[3]?.p1 || '',
				forcedP2: choices.forcedSwitches[3]?.p2 || '',
			};
			void stream.write(`>replayturn ${JSON.stringify(turn4data)}\n`);

			console.log(`    battle.turn after replayturn 4: ${battle.turn}`);
			assert(battle.turn >= 5,
				'battle.turn should advance past 4 with complete choices');

			// stateByTurn should have entries for all turns
			console.log(`    stateByTurn length: ${battle.stateByTurn.length}`);
			assert(battle.stateByTurn.length >= 5,
				'stateByTurn should have at least 5 entries (0-4)');

			stream.destroy();
		});
	});


	// =================================================================
	// Fix verification: manually add default choices for missing slots
	// =================================================================
	describe('FIX VERIFICATION: complete choices allow correct turn advancement', function () {
		it('adding "default" for missing slots makes all turns advance correctly', function () {
			const stream = createBattleStream(choices.teamPreview);
			const battle = stream.battle;

			// Turn 1: all slots have actions, works as-is
			const turn1data = {
				p1: choices.turns[0].p1,
				p2: choices.turns[0].p2,
				patch: turnPatches[1] || null,
				forcedP1: '', forcedP2: '',
			};
			void stream.write(`>replayturn ${JSON.stringify(turn1data)}\n`);
			assert.equal(battle.turn, 2, 'Turn 1 -> battle.turn=2');

			// Turn 2: FIX by adding "default" for p2b (Weezing that gets KO'd)
			// "move taunt 2" -> "move taunt 2, default"
			const fixedP2Turn2 = choices.turns[1].p2 + ', default';
			console.log(`    Fixed p2 turn 2 choice: "${fixedP2Turn2}"`);
			const turn2data = {
				p1: choices.turns[1].p1,
				p2: fixedP2Turn2,
				patch: turnPatches[2] || null,
				forcedP1: choices.forcedSwitches[1]?.p1 || '',
				forcedP2: choices.forcedSwitches[1]?.p2 || '',
			};
			void stream.write(`>replayturn ${JSON.stringify(turn2data)}\n`);

			console.log(`    battle.turn after fixed turn 2: ${battle.turn}`);
			assert.equal(battle.turn, 3, 'With fix, turn 2 -> battle.turn=3');

			const stateAfterTurn2 = getSimState(battle);
			console.log(`    State after turn 2 (fixed):`);
			console.log(formatState(stateAfterTurn2));

			// Turn 3: FIX by adding "default" for p1a (Flutter Mane that gets KO'd)
			// "switch 3" (p1b only) -> "default, switch 3" (p1a=default, p1b=switch)
			// Note: p1a is slot a, p1b is slot b. The parser gave "switch 3" for p1b.
			// We need "X, switch 3" where X is p1a's choice.
			const fixedP1Turn3 = 'default, ' + choices.turns[2].p1;
			console.log(`    Fixed p1 turn 3 choice: "${fixedP1Turn3}"`);
			const turn3data = {
				p1: fixedP1Turn3,
				p2: choices.turns[2].p2,
				patch: turnPatches[3] || null,
				forcedP1: choices.forcedSwitches[2]?.p1 || '',
				forcedP2: choices.forcedSwitches[2]?.p2 || '',
			};
			void stream.write(`>replayturn ${JSON.stringify(turn3data)}\n`);

			console.log(`    battle.turn after fixed turn 3: ${battle.turn}`);
			assert.equal(battle.turn, 4, 'With fix, turn 3 -> battle.turn=4');

			const stateAfterTurn3 = getSimState(battle);
			console.log(`    State after turn 3 (fixed):`);
			console.log(formatState(stateAfterTurn3));

			// Verify turn 3 state matches expected (at least species + faint status)
			const exp3 = EXPECTED_STATE[3];
			for (const slot of ['p1a', 'p1b', 'p2a', 'p2b']) {
				const sim = stateAfterTurn3[slot];
				const exp = exp3[slot];
				// Species should match (patching corrects active Pokemon identity)
				if (sim.species !== exp.species) {
					console.log(`    ${slot} species mismatch: sim=${sim.species} expected=${exp.species}`);
				}
				if (sim.fainted !== exp.fainted) {
					console.log(`    ${slot} fainted mismatch: sim=${sim.fainted} expected=${exp.fainted}`);
				}
			}

			// Turn 4: p1 has "switch 4" (only p1b switches), p1a Ogerpon needs a choice
			// But in turn 4, p1a has a switch action, and p2 has "move wavecrash 1" (only p2b)
			// p2a Tatsugiri is inside Commander so might not need a choice... let's check
			const p1Turn4 = choices.turns[3].p1;
			const p2Turn4 = choices.turns[3].p2;
			console.log(`    Turn 4 p1: "${p1Turn4}" p2: "${p2Turn4}"`);

			// p1 turn 4 is "switch 4" -- this is only p1b switching to Incineroar
			// p1a Ogerpon needs a choice too (it will be KO'd by Wave Crash)
			const fixedP1Turn4 = 'default, ' + p1Turn4;
			const turn4data = {
				p1: fixedP1Turn4,
				p2: p2Turn4,
				patch: turnPatches[4] || null,
				forcedP1: choices.forcedSwitches[3]?.p1 || '',
				forcedP2: choices.forcedSwitches[3]?.p2 || '',
			};
			void stream.write(`>replayturn ${JSON.stringify(turn4data)}\n`);

			console.log(`    battle.turn after fixed turn 4: ${battle.turn}`);

			const stateAfterTurn4 = getSimState(battle);
			console.log(`    State after turn 4 (fixed):`);
			console.log(formatState(stateAfterTurn4));

			// Check stateByTurn has proper entries
			console.log(`\n    stateByTurn length: ${battle.stateByTurn.length}`);
			for (let t = 0; t < battle.stateByTurn.length; t++) {
				const s = battle.stateByTurn[t];
				const valid = s && s.formatid && s.sides;
				console.log(`    stateByTurn[${t}]: ${valid ? 'valid' : 'INVALID'}`);
			}

			// Verify stateByTurn has more entries now
			assert(battle.stateByTurn.length > 3,
				`With fix, stateByTurn should have more than 3 entries (got ${battle.stateByTurn.length})`);

			stream.destroy();
		});

		it('stateByTurn[3] should match expected turn 3 state after fix', function () {
			const stream = createBattleStream(choices.teamPreview);
			const battle = stream.battle;

			// Turn 1
			void stream.write(`>replayturn ${JSON.stringify({
				p1: choices.turns[0].p1,
				p2: choices.turns[0].p2,
				patch: turnPatches[1] || null,
				forcedP1: '', forcedP2: '',
			})}\n`);

			// Turn 2 (fixed)
			void stream.write(`>replayturn ${JSON.stringify({
				p1: choices.turns[1].p1,
				p2: choices.turns[1].p2 + ', default',
				patch: turnPatches[2] || null,
				forcedP1: choices.forcedSwitches[1]?.p1 || '',
				forcedP2: choices.forcedSwitches[1]?.p2 || '',
			})}\n`);

			// Turn 3 (fixed)
			void stream.write(`>replayturn ${JSON.stringify({
				p1: 'default, ' + choices.turns[2].p1,
				p2: choices.turns[2].p2,
				patch: turnPatches[3] || null,
				forcedP1: choices.forcedSwitches[2]?.p1 || '',
				forcedP2: choices.forcedSwitches[2]?.p2 || '',
			})}\n`);

			// Now check stateByTurn[3] (should exist and be valid)
			const targetTurn = 3;
			assert(battle.stateByTurn[targetTurn], `stateByTurn[${targetTurn}] should exist`);
			assert(battle.stateByTurn[targetTurn].formatid,
				`stateByTurn[${targetTurn}] should be a valid serialized battle`);

			// Deserialize and verify
			const jumpedBattle = Sim.Battle.fromJSON(battle.stateByTurn[targetTurn]);
			const jumpedState = getSimState(jumpedBattle);

			console.log(`    stateByTurn[${targetTurn}] state:`);
			console.log(formatState(jumpedState));
			console.log(`    Expected:`);
			console.log(formatState(EXPECTED_STATE[3]));

			const exp = EXPECTED_STATE[3];
			let mismatches = [];
			for (const slot of ['p1a', 'p1b', 'p2a', 'p2b']) {
				const sim = jumpedState[slot];
				const e = exp[slot];
				if (sim.species !== e.species) mismatches.push(`${slot} species: ${sim.species} != ${e.species}`);
				if (Math.abs(sim.hp - e.hp) > 5) mismatches.push(`${slot} HP: ${sim.hp}% != ${e.hp}%`);
				if (sim.fainted !== e.fainted) mismatches.push(`${slot} fainted: ${sim.fainted} != ${e.fainted}`);
				if (sim.status !== e.status) mismatches.push(`${slot} status: "${sim.status}" != "${e.status}"`);
			}

			if (mismatches.length > 0) {
				console.log(`\n    Remaining mismatches (may need additional patching fixes):`);
				for (const m of mismatches) console.log(`      - ${m}`);
			} else {
				console.log(`\n    stateByTurn[${targetTurn}] matches expected!`);
			}

			// The key assertion: at minimum, stateByTurn[3] should exist and be valid
			// (the bug caused it to not exist at all)
			assert(battle.stateByTurn[targetTurn].formatid,
				'stateByTurn[3] exists and is valid (bug is fixed)');

			stream.destroy();
		});
	});


	// =================================================================
	// Parsing verification
	// =================================================================
	describe('parsing details', function () {
		it('should log all parsed choices for debugging', function () {
			console.log(`    Team preview: p1="${choices.teamPreview.p1}" p2="${choices.teamPreview.p2}"`);
			for (let i = 0; i < choices.turns.length; i++) {
				const t = choices.turns[i];
				const f = choices.forcedSwitches[i];
				console.log(`    Turn ${i + 1}: p1="${t.p1}" p2="${t.p2}"`);
				if (f && (f.p1 || f.p2)) {
					console.log(`      Forced: p1="${f.p1 || ''}" p2="${f.p2 || ''}"`);
				}
			}
		});

		it('should log all turn patches for debugging', function () {
			for (let i = 1; i <= totalTurns; i++) {
				const p = turnPatches[i];
				if (!p) { console.log(`    Turn ${i}: NO PATCH`); continue; }
				console.log(`    Turn ${i}:`);
				console.log(`      HP: ${JSON.stringify(p.hp)}`);
				console.log(`      Status: ${JSON.stringify(p.status)}`);
				console.log(`      Active: ${JSON.stringify(p.active)}`);
				if (p.bench?.length) console.log(`      Bench: ${JSON.stringify(p.bench)}`);
			}
		});

		it('turn 2 patch should include the forced switch (Dondozo at 100%)', function () {
			const patch = turnPatches[2];
			assert(patch, 'Turn 2 patch should exist');

			// The patch for turn 2 covers events between |turn|2 and |turn|3.
			// The forced switch |switch|p2b: Dondozo|...|100/100 happens between
			// |upkeep| and |turn|3, so it SHOULD be included in the turn 2 patch.
			const p2b = patch.hp.find(h => h.slot === 'p2b');
			assert(p2b, 'Should have HP patch for p2b');
			console.log(`    p2b HP: ${p2b.hpPercent}% fainted=${p2b.fainted}`);

			// The last event for p2b is the forced switch to Dondozo at 100%
			assert.equal(p2b.hpPercent, 100, 'p2b should be at 100% (Dondozo after forced switch)');
			assert.equal(p2b.fainted, false, 'p2b should not be fainted (Dondozo replaced Weezing)');

			const p2bActive = patch.active.find(a => a.slot === 'p2b');
			assert(p2bActive, 'Should have active patch for p2b');
			assert.equal(p2bActive.speciesId, 'dondozo',
				`p2b active should be dondozo, got ${p2bActive.speciesId}`);
		});

		it('turn 3 patch should include the forced switch (Ogerpon at 94% with psn)', function () {
			const patch = turnPatches[3];
			assert(patch, 'Turn 3 patch should exist');

			const p1a = patch.hp.find(h => h.slot === 'p1a');
			assert(p1a, 'Should have HP patch for p1a');
			console.log(`    p1a HP: ${p1a.hpPercent}% fainted=${p1a.fainted}`);

			// The forced switch brings Ogerpon in at 94% with psn (from Toxic Spikes)
			assert.equal(p1a.hpPercent, 94,
				`p1a should be at 94% (Ogerpon after forced switch), got ${p1a.hpPercent}%`);
			assert.equal(p1a.fainted, false, 'p1a should not be fainted');

			const p1aActive = patch.active.find(a => a.slot === 'p1a');
			assert(p1aActive, 'Should have active patch for p1a');
			console.log(`    p1a active species: ${p1aActive.speciesId}`);
			// Ogerpon-Hearthflame-Tera or similar
			assert(p1aActive.speciesId.startsWith('ogerpon'),
				`p1a active should be ogerpon*, got ${p1aActive.speciesId}`);

			const p1aStatus = patch.status.find(s => s.slot === 'p1a');
			assert(p1aStatus, 'Should have status patch for p1a');
			assert.equal(p1aStatus.status, 'psn',
				`p1a should have psn status, got "${p1aStatus.status}"`);

			// p1b Rillaboom at 88% with psn
			const p1b = patch.hp.find(h => h.slot === 'p1b');
			assert(p1b, 'Should have HP patch for p1b');
			assert.equal(p1b.hpPercent, 88, `p1b should be at 88%, got ${p1b.hpPercent}%`);

			// p2b Dondozo at 86%
			const p2b = patch.hp.find(h => h.slot === 'p2b');
			assert(p2b, 'Should have HP patch for p2b');
			assert.equal(p2b.hpPercent, 86, `p2b should be at 86%, got ${p2b.hpPercent}%`);
		});
	});
});
