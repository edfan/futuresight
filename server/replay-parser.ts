/**
 * Replay Parser
 *
 * Parses Pokemon Showdown replay logs to extract team preview choices,
 * per-turn move/switch choices, and provides state patching to correct
 * RNG divergence when simulating from replay data.
 */

import {Teams} from '../sim/teams';
import type {PokemonSet} from '../sim/teams';

type SideID = 'p1' | 'p2';

/** toID: lowercases and strips non-alphanumeric */
function toID(text: string): string {
	return text.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export interface ParsedChoices {
	teamPreview: {p1: string; p2: string};
	/** Per-turn choices indexed from 0 (turn 1 = index 0) */
	turns: Array<{p1: string; p2: string}>;
	/** Forced switch choices after each turn (indexed same as turns).
	 * If turn N causes faints requiring switches, forcedSwitches[N] has the switch choices. */
	forcedSwitches: Array<{p1: string; p2: string}>;
	/** Species IDs for each forced switch slot, so the handler can resolve
	 * the correct team index at runtime (the sim's internal team order may
	 * diverge from the parser's team order due to autoResolveForced). */
	forcedSwitchSpecies: Array<{p1: Record<string, string>; p2: Record<string, string>}>;
}

interface ReplayPokemon {
	/** Species name as shown in replay */
	species: string;
	/** Index in the showteam (0-based) */
	showteamIndex: number;
}

/**
 * Parse |showteam| lines from a replay log.
 * Returns unpacked PokemonSet arrays for p1 and p2.
 */
export function parseShowteams(log: string): {p1: PokemonSet[]; p2: PokemonSet[]} {
	const result: {p1: PokemonSet[]; p2: PokemonSet[]} = {p1: [], p2: []};
	for (const line of log.split('\n')) {
		const match = line.match(/^\|showteam\|(p[12])\|(.+)$/);
		if (match) {
			const side = match[1] as SideID;
			const team = Teams.unpack(match[2]);
			if (team) result[side] = team;
		}
	}
	return result;
}

/**
 * Map a Pokemon identifier from replay (e.g. "p1a: Flutter Mane") to
 * the species ID. Handles nicknames by looking at the |switch| line
 * that introduced that Pokemon.
 */
function pokemonIdentToSpeciesId(
	ident: string,
	switchMap: Map<string, string>
): string {
	// ident is like "p1a: Flutter Mane" or "p2b: Incineroar"
	// switchMap maps "p1a: Flutter Mane" -> species from |switch| details
	const species = switchMap.get(ident);
	if (species) return toID(species);
	// Fallback: use the name part
	const colonIdx = ident.indexOf(': ');
	if (colonIdx >= 0) return toID(ident.slice(colonIdx + 2));
	return toID(ident);
}

/**
 * Find a Pokemon's 1-based slot index in the given ordering.
 * Used to find the right switch index in the post-team-preview team order.
 */
function findSlotInOrder(speciesId: string, order: string[]): number {
	for (let i = 0; i < order.length; i++) {
		if (order[i] === speciesId) return i + 1; // 1-based
	}
	// Handle forme differences (e.g. "Urshifu-Rapid-Strike" vs "Urshifu")
	for (let i = 0; i < order.length; i++) {
		const baseId = order[i].split('-')[0];
		if (baseId === speciesId || speciesId.startsWith(baseId) || baseId.startsWith(speciesId)) {
			return i + 1;
		}
	}
	return 1; // fallback
}

/**
 * Pre-scan the replay log to find all Pokemon that appeared for each side.
 * Returns the species IDs of all Pokemon that switched in, in order of first appearance.
 */
function scanAppearingPokemon(lines: string[]): {p1: string[]; p2: string[]} {
	const appeared: {p1: string[]; p2: string[]} = {p1: [], p2: []};
	const seen: {p1: Set<string>; p2: Set<string>} = {p1: new Set(), p2: new Set()};

	for (const line of lines) {
		if (!line.startsWith('|switch|') && !line.startsWith('|drag|')) continue;
		const parts = line.slice(1).split('|');
		const ident = parts[1]?.trim() || '';
		const slotMatch = ident.match(/^(p[12])/);
		if (!slotMatch) continue;
		const side = slotMatch[1] as SideID;
		const details = parts[2] || '';
		const species = details.split(',')[0].trim();
		const speciesId = toID(species);
		if (!seen[side].has(speciesId)) {
			seen[side].add(speciesId);
			appeared[side].push(speciesId);
		}
	}
	return appeared;
}

/**
 * Parse the target location from a |move| line's target Pokemon.
 * In VGC doubles:
 *   For p1's perspective: p2a=-1, p2b=-2, p1a=1, p1b=2
 *   For p2's perspective: p1a=-1, p1b=-2, p2a=1, p2b=2
 * Ally targeting: same-side targets use positive numbers.
 */
function parseTargetLoc(
	attackerSlotId: string, // "p1a", "p1b", "p2a", "p2b"
	targetIdent: string // "p2a: Porygon2"
): string {
	const attackerSide = attackerSlotId.slice(0, 2); // "p1" or "p2"
	const targetSlotMatch = targetIdent.match(/^(p[12])([a-d])/);
	if (!targetSlotMatch) return '';

	const targetSide = targetSlotMatch[1];
	const targetPos = targetSlotMatch[2]; // 'a' or 'b'

	if (attackerSide === targetSide) {
		// Ally target: negative numbers (-1 = ally slot a, -2 = ally slot b)
		return targetPos === 'a' ? ' -1' : ' -2';
	} else {
		// Opponent target: positive numbers (1 = foe slot a, 2 = foe slot b)
		return targetPos === 'a' ? ' 1' : ' 2';
	}
}

interface TurnAction {
	slot: string; // "p1a", "p1b", etc.
	action: string; // "move dazzlinggleam -2", "switch 3", etc.
	terastallize?: boolean;
}

/**
 * Parse all choices from a replay log for simulation replay.
 *
 * Extracts:
 * - Team preview choices (which 4 Pokemon to bring and in what lead order)
 * - Per-turn move/switch choices for both sides
 * - Forced switch choices between turns (after faints)
 */
export function parseReplayChoices(
	log: string,
	p1Showteam: PokemonSet[],
	p2Showteam: PokemonSet[]
): ParsedChoices {
	const lines = log.split('\n');

	// Pre-scan all appearing Pokemon for team preview construction
	const allAppeared = scanAppearingPokemon(lines);

	// Track which Pokemon identity maps to which species (from |switch| lines)
	const switchMap = new Map<string, string>();

	// Track current active Pokemon identities per slot
	const activeSlots: Record<string, string> = {}; // "p1a" -> "p1a: Flutter Mane"

	// Results
	const teamPreview = {p1: '', p2: ''};
	const turns: Array<{p1: string; p2: string}> = [];
	const forcedSwitches: Array<{p1: string; p2: string}> = [];
	const forcedSwitchSpecies: Array<{p1: Record<string, string>; p2: Record<string, string>}> = [];

	// Post-preview team ordering for switch index lookups
	let teamOrder: {p1: string[]; p2: string[]} = {p1: [], p2: []};

	// State machine
	let phase: 'pre-battle' | 'teampreview' | 'battle' = 'pre-battle';
	let currentTurn = 0;

	let startSeen = false;
	let firstTurnSeen = false;

	// For each turn, collect per-side actions
	let currentTurnActions: {p1: TurnAction[]; p2: TurnAction[]} = {p1: [], p2: []};

	// Track which slots have acted this turn (to detect switches as first action vs after moves)
	// and detect forced switches (between |upkeep| and |turn|)
	let inUpkeep = false;
	let forcedSwitchActions: {p1: TurnAction[]; p2: TurnAction[]} = {p1: [], p2: []};
	// Map from slot -> speciesId for forced switches (so handler can resolve correct index)
	let forcedSwitchSpeciesMap: {p1: Record<string, string>; p2: Record<string, string>} = {p1: {}, p2: {}};
	// Track slots that terastallized this turn (|-terastallize| can appear before |move|)
	let teraSlots = new Set<string>();
	// Track which slots had a faint this turn — used to know which slots need forced switch
	let faintedSlots = new Set<string>();

	// Track between-turn switches (for forced switches after faints)
	let betweenTurns = false;

	// Track which slots have a commanding Pokemon (Commander ability — Tatsugiri inside Dondozo).
	// Commanding Pokemon don't need choices — the sim auto-passes them.
	const commandingSlots = new Set<string>();

	// Snapshot of active slots at the START of each turn (before any actions happen).
	// Used by saveTurnActions to know which slots need choices.
	let turnStartActiveSlots: Record<string, string> = {};
	// Snapshot of commanding slots at the START of each turn.
	let turnStartCommandingSlots = new Set<string>();

	for (const line of lines) {
		if (!line.startsWith('|')) continue;
		const parts = line.slice(1).split('|');
		const cmd = parts[0];

		switch (cmd) {
		case 'start':
			startSeen = true;
			phase = 'teampreview';
			break;

		case 'teampreview':
			phase = 'teampreview';
			break;

		case 'turn': {
			const turnNum = parseInt(parts[1]);
			if (!firstTurnSeen) {
				firstTurnSeen = true;
				// Build team preview choices from all appearing Pokemon
				const p1Preview = buildTeamPreviewChoice(allAppeared.p1, p1Showteam);
				const p2Preview = buildTeamPreviewChoice(allAppeared.p2, p2Showteam);
				teamPreview.p1 = p1Preview.choice;
				teamPreview.p2 = p2Preview.choice;
				teamOrder.p1 = p1Preview.teamOrder;
				teamOrder.p2 = p2Preview.teamOrder;
				phase = 'battle';
			}
			// Save previous turn's actions (if any)
			if (currentTurn > 0) {
				saveTurnActions(currentTurn);
			}
			// Snapshot active slots and commanding slots at the start of this turn.
			// At this point, activeSlots reflects post-forced-switch state from previous turn.
			turnStartActiveSlots = {...activeSlots};
			turnStartCommandingSlots = new Set(commandingSlots);
			currentTurn = turnNum;
			currentTurnActions = {p1: [], p2: []};
			forcedSwitchActions = {p1: [], p2: []};
			forcedSwitchSpeciesMap = {p1: {}, p2: {}};
			faintedSlots = new Set();
			teraSlots = new Set();
			inUpkeep = false;
			betweenTurns = false;
			break;
		}

		case 'switch':
		case 'drag': {
			// |switch|p1a: Flutter Mane|Flutter Mane, L50|100/100
			const ident = parts[1].trim(); // "p1a: Flutter Mane"
			const details = parts[2]; // "Flutter Mane, L50"
			const slotId = ident.match(/^(p[12][a-d])/)?.[1] || '';
			const side = slotId.slice(0, 2) as SideID;

			// Extract species from details (before first comma)
			const species = details.split(',')[0].trim();
			switchMap.set(ident, species);
			activeSlots[slotId] = ident;

			if (betweenTurns && faintedSlots.has(slotId)) {
				// Forced switch after a faint
				const speciesId = toID(species);
				const slot = findSlotInOrder(speciesId, teamOrder[side]);
				forcedSwitchActions[side].push({
					slot: slotId,
					action: `switch ${slot}`,
				});
				forcedSwitchSpeciesMap[side][slotId] = speciesId;
			} else if (phase === 'battle' && currentTurn > 0) {
				// In-turn switch (player chose to switch)
				const speciesId = toID(species);
				const slot = findSlotInOrder(speciesId, teamOrder[side]);
				currentTurnActions[side].push({
					slot: slotId,
					action: `switch ${slot}`,
				});
			}
			break;
		}

		case 'move': {
			// |move|p1a: Flutter Mane|Dazzling Gleam|p2b: Amoonguss
			// |move|p1a: Flutter Mane|Dazzling Gleam|p2b: Amoonguss|[spread] p2a,p2b
			const attackerIdent = parts[1].trim();
			const moveName = parts[2].trim();
			const targetIdent = parts[3]?.trim() || '';
			const slotMatch = attackerIdent.match(/^(p[12][a-d])/);
			if (!slotMatch) break;
			const slotId = slotMatch[1];
			const side = slotId.slice(0, 2) as SideID;

			// Check if this slot already has an action (shouldn't double-act)
			const hasAction = currentTurnActions[side].some(a => a.slot === slotId);
			if (hasAction) break;

			const moveId = toID(moveName);

			// Determine target
			let targetLoc = '';
			if (targetIdent && !targetIdent.startsWith('[')) {
				targetLoc = parseTargetLoc(slotId, targetIdent);
			}

			currentTurnActions[side].push({
				slot: slotId,
				action: `move ${moveId}${targetLoc}`,
				terastallize: teraSlots.has(slotId) || undefined,
			});
			break;
		}

		case '-terastallize': {
			// |-terastallize|p1a: Flutter Mane|Fairy
			const ident = parts[1].trim();
			const slotMatch = ident.match(/^(p[12][a-d])/);
			if (!slotMatch) break;
			const slotId = slotMatch[1];
			const side = slotId.slice(0, 2) as SideID;

			// Mark terastallize — may appear before or after the |move| line
			teraSlots.add(slotId);
			const action = currentTurnActions[side].find(a => a.slot === slotId);
			if (action) {
				action.terastallize = true;
			}
			break;
		}

		case 'cant': {
			// |cant|p2b: Amoonguss|flinch
			// |cant|p1b: Raging Bolt|move: Taunt|Calm Mind
			// Pokemon couldn't act — we still need to submit a choice for it.
			// Use "default" which auto-chooses a valid move for one slot.
			// The sim's per-slot default handling (side.ts) ensures only one
			// slot is auto-chosen when in a multi-choice string.
			const ident = parts[1].trim();
			const slotMatch = ident.match(/^(p[12][a-d])/);
			if (!slotMatch) break;
			const slotId = slotMatch[1];
			const side = slotId.slice(0, 2) as SideID;

			const hasAction = currentTurnActions[side].some(a => a.slot === slotId);
			if (!hasAction) {
				currentTurnActions[side].push({
					slot: slotId,
					action: `default`,
				});
			}
			break;
		}

		case 'faint': {
			const ident = parts[1].trim();
			const slotMatch = ident.match(/^(p[12][a-d])/);
			if (slotMatch) {
				faintedSlots.add(slotMatch[1]);
				// If the fainted Pokemon had the 'commanded' volatile (Dondozo),
				// the commanding Pokemon (Tatsugiri) is released.
				// Clear the commanding slot for the same side.
				const faintedSide = slotMatch[1].slice(0, 2);
				for (const cs of commandingSlots) {
					if (cs.startsWith(faintedSide) && cs !== slotMatch[1]) {
						commandingSlots.delete(cs);
					}
				}
			}
			break;
		}

		case '-activate': {
			// |-activate|p2a: Tatsugiri|ability: Commander|[of] p2b: Dondozo
			// The commanding Pokemon (Tatsugiri) doesn't need choices — the sim auto-passes it.
			const activateData = parts[2]?.trim() || '';
			if (activateData === 'ability: Commander') {
				const ident = parts[1].trim();
				const slotMatch = ident.match(/^(p[12][a-d])/);
				if (slotMatch) {
					commandingSlots.add(slotMatch[1]);
				}
			}
			break;
		}

		case 'upkeep':
			inUpkeep = true;
			betweenTurns = true;
			forcedSwitchActions = {p1: [], p2: []};
			forcedSwitchSpeciesMap = {p1: {}, p2: {}};
			break;

		case 'win':
		case '-message': {
			if (cmd === '-message' && !parts[1]?.includes('forfeited')) break;
			// Save final turn
			if (currentTurn > 0) {
				saveTurnActions(currentTurn);
			}
			break;
		}

		case '':
			break;
		}
	}

	function saveTurnActions(turn: number) {
		const idx = turn - 1;
		while (turns.length <= idx) {
			turns.push({p1: '', p2: ''});
		}
		while (forcedSwitches.length <= idx) {
			forcedSwitches.push({p1: '', p2: ''});
		}
		while (forcedSwitchSpecies.length <= idx) {
			forcedSwitchSpecies.push({p1: {}, p2: {}});
		}

		// Build choice strings for each side
		for (const side of ['p1', 'p2'] as SideID[]) {
			const actions = currentTurnActions[side];
			const forced = forcedSwitchActions[side];

			// Save forced switches for this turn (these happen AFTER the turn resolves)
			if (forced.length > 0) {
				const forcedStr = buildForcedSwitchChoice(forced, side);
				if (forcedStr) {
					forcedSwitches[idx][side] = forcedStr;
					forcedSwitchSpecies[idx][side] = {...forcedSwitchSpeciesMap[side]};
				}
			}

			// Determine which active slots need choices this turn.
			// Use the snapshot from the START of the turn (before any in-turn
			// switches or faints), since the sim needs choices for all Pokemon
			// that were alive at turn start — even if they get KO'd before acting.
			// Exclude commanding slots (Commander ability) — the sim auto-passes them.
			const slotsNeeded: string[] = [];
			for (const pos of ['a', 'b']) {
				const slot = `${side}${pos}`;
				if (turnStartActiveSlots[slot] && !turnStartCommandingSlots.has(slot)) {
					slotsNeeded.push(slot);
				}
			}

			// Fill in 'default' for any active slot that has no action.
			// This happens when a Pokemon gets KO'd by a faster opponent
			// before it can act — it has no |move| or |cant| line, but
			// the sim still needs a choice submitted for that slot.
			for (const slot of slotsNeeded) {
				const hasAction = actions.some(a => a.slot === slot);
				if (!hasAction) {
					actions.push({slot, action: 'default'});
				}
			}

			if (actions.length === 0) {
				turns[idx] = turns[idx] || {p1: '', p2: ''};
				continue;
			}

			// Sort actions by slot (a before b)
			actions.sort((a, b) => a.slot.localeCompare(b.slot));

			// Build comma-separated choice string
			const parts: string[] = [];
			for (const action of actions) {
				let choice = action.action;
				if (action.terastallize) {
					choice += ' terastallize';
				}
				parts.push(choice);
			}

			turns[idx][side] = parts.join(', ');
		}
	}

	return {teamPreview, turns, forcedSwitches, forcedSwitchSpecies};
}

/**
 * Build "team ABCD" string from all appearing Pokemon in the replay.
 * Leads come first (from initial switches), then bench Pokemon
 * (from later switches throughout the replay).
 *
 * Also returns the post-preview team order (species IDs) for switch index lookups.
 */
function buildTeamPreviewChoice(
	allAppeared: string[], // all species IDs that appeared, in order of first appearance
	showteam: PokemonSet[]
): {choice: string; teamOrder: string[]} {
	if (allAppeared.length === 0) return {choice: 'default', teamOrder: showteam.map(p => toID(p.species))};

	// Map each appearing species to its showteam index (1-based)
	const chosen: number[] = [];
	const used = new Set<number>();

	function findInShowteam(speciesId: string): number {
		// Exact match
		for (let i = 0; i < showteam.length; i++) {
			if (used.has(i)) continue;
			if (toID(showteam[i].species) === speciesId || toID(showteam[i].name) === speciesId) {
				return i;
			}
		}
		// Base species match (e.g. "weezing" matches "Weezing-Galar")
		for (let i = 0; i < showteam.length; i++) {
			if (used.has(i)) continue;
			const baseId = toID(showteam[i].species.split('-')[0]);
			if (baseId === speciesId || speciesId.startsWith(baseId) || baseId.startsWith(speciesId)) {
				return i;
			}
		}
		return -1;
	}

	for (const speciesId of allAppeared) {
		const idx = findInShowteam(speciesId);
		if (idx >= 0) {
			chosen.push(idx + 1); // 1-based
			used.add(idx);
		}
	}

	// Fill remaining bring-4 slots with unseen Pokemon (in original showteam order)
	// In VGC, team preview choice needs exactly 4 indices
	for (let i = 0; i < showteam.length && chosen.length < 4; i++) {
		if (!used.has(i)) {
			chosen.push(i + 1);
			used.add(i);
		}
	}

	// Build post-preview team order (species IDs in the order the sim will use)
	// This mirrors what chooseTeam() does: chosen Pokemon first, then remaining in original order
	const teamOrder: string[] = [];
	for (const idx1 of chosen) {
		teamOrder.push(toID(showteam[idx1 - 1].species));
	}
	// Add remaining unchosen Pokemon (not brought to battle)
	for (let i = 0; i < showteam.length; i++) {
		if (!used.has(i)) {
			teamOrder.push(toID(showteam[i].species));
		}
	}

	return {choice: `team ${chosen.join('')}`, teamOrder};
}

/**
 * Build forced switch choice string.
 * For VGC doubles, if slot 'a' fainted, we need "switch X" for slot a
 * and "pass" for slot b (if slot b is still alive).
 */
function buildForcedSwitchChoice(
	actions: TurnAction[],
	side: SideID
): string {
	// In doubles, forced switch choice is just the switch for the fainted slot(s)
	// If both slots fainted, both need switches
	const slotA = actions.find(a => a.slot.endsWith('a'));
	const slotB = actions.find(a => a.slot.endsWith('b'));

	const parts: string[] = [];
	if (slotA) {
		parts.push(slotA.action);
	} else {
		parts.push('pass');
	}
	if (slotB) {
		parts.push(slotB.action);
	} else {
		parts.push('pass');
	}

	// Don't return "pass, pass"
	if (parts.every(p => p === 'pass')) return '';
	return parts.join(', ');
}

// ---- State Patching ----

interface HPPatch {
	/** Slot like "p1a", "p2b" */
	slot: string;
	/** HP value as shown in replay (0-100 percentage, or exact if maxhp known) */
	hpPercent: number;
	/** Whether the Pokemon fainted */
	fainted: boolean;
}

interface StatusPatch {
	slot: string;
	status: string; // 'brn', 'par', 'slp', 'frz', 'psn', 'tox', or ''
}

interface ActivePatch {
	/** Slot like "p1a", "p2b" */
	slot: string;
	/** Species ID of the Pokemon that should be in this slot at end of turn */
	speciesId: string;
}

/** Patch for a bench Pokemon, addressed by species instead of slot */
interface BenchPatch {
	side: 'p1' | 'p2';
	speciesId: string;
	hpPercent: number;
	fainted: boolean;
	status: string;
}

export interface TurnPatch {
	hp: HPPatch[];
	status: StatusPatch[];
	/** Which Pokemon should be active at end of turn (from last switch/drag events) */
	active: ActivePatch[];
	/** Corrections for bench Pokemon (addressed by species, not slot) */
	bench: BenchPatch[];
}

/**
 * Parse HP string from replay like "69/100", "0 fnt", "100/100 brn"
 */
function parseHPString(hpStr: string): {percent: number; status?: string} {
	if (!hpStr || hpStr === '0 fnt') {
		return {percent: 0};
	}

	// Format: "X/Y" or "X/Y status" or "0 fnt"
	const match = hpStr.match(/^(\d+)\/(\d+)\s*(.*)$/);
	if (match) {
		const current = parseInt(match[1]);
		const max = parseInt(match[2]);
		const status = match[3]?.trim() || undefined;
		const percent = max > 0 ? (current / max) * 100 : 0;
		return {percent, status: status || undefined};
	}

	// Edge case: just "0 fnt"
	if (hpStr.includes('fnt')) {
		return {percent: 0};
	}

	return {percent: 100};
}

/** Cumulative state for one Pokemon tracked across the entire replay */
interface PokemonTracker {
	speciesId: string;
	hpPercent: number;
	fainted: boolean;
	status: string;
}

/**
 * Parse all turn patches from a complete replay log using cumulative tracking.
 * Tracks every Pokemon's last-known HP/status across the entire replay so that
 * bench Pokemon also get corrected (not just active slots).
 *
 * Returns an array indexed by turn number (1-based, index 0 is unused).
 */
export function parseAllTurnPatches(log: string, maxTurn: number): TurnPatch[] {
	const lines = log.split('\n');
	const patches: TurnPatch[] = [];

	// Cumulative state per Pokemon, keyed by "p1:speciesId" or "p2:speciesId"
	const pokemonState = new Map<string, PokemonTracker>();

	// Track which species is in each active slot, keyed by slot ("p1a", "p2b")
	const activeInSlot: Record<string, string> = {}; // slot -> speciesId

	// Map from ident (e.g. "p1a: Flutter Mane") to speciesId (from |switch| details)
	const identToSpecies = new Map<string, string>();

	// Helper to get the species for a slot ident
	function getSpeciesForIdent(ident: string): string | undefined {
		const species = identToSpecies.get(ident);
		if (species) return species;
		const colonIdx = ident.indexOf(': ');
		if (colonIdx >= 0) return toID(ident.slice(colonIdx + 2));
		return undefined;
	}

	// Helper to get or create tracker for a Pokemon
	function getTracker(side: string, speciesId: string): PokemonTracker {
		const key = `${side}:${speciesId}`;
		let tracker = pokemonState.get(key);
		if (!tracker) {
			tracker = {speciesId, hpPercent: 100, fainted: false, status: ''};
			pokemonState.set(key, tracker);
		}
		return tracker;
	}

	let currentTurn = 0;

	// Per-turn active slot data (from events within the turn)
	let turnActiveSlots: Map<string, ActivePatch> = new Map();
	let turnHP: Map<string, HPPatch> = new Map();
	let turnStatus: Map<string, StatusPatch> = new Map();

	function savePatchForTurn(turn: number) {
		if (turn < 1) return;

		// Build bench patches: for each side, find Pokemon NOT in active slots
		// and include their cumulative state
		const bench: BenchPatch[] = [];
		const activeSideSpecies: Record<string, Set<string>> = {p1: new Set(), p2: new Set()};

		// Determine what's active at end of turn
		for (const slot of ['p1a', 'p1b', 'p2a', 'p2b']) {
			const speciesId = activeInSlot[slot];
			if (speciesId) {
				const side = slot.slice(0, 2);
				activeSideSpecies[side].add(speciesId);
			}
		}

		// For each tracked Pokemon, if it's not active, add a bench patch
		for (const [key, tracker] of pokemonState) {
			const side = key.split(':')[0] as 'p1' | 'p2';
			if (!activeSideSpecies[side].has(tracker.speciesId)) {
				bench.push({
					side,
					speciesId: tracker.speciesId,
					hpPercent: tracker.hpPercent,
					fainted: tracker.fainted,
					status: tracker.status,
				});
			}
		}

		while (patches.length <= turn) {
			patches.push({hp: [], status: [], active: [], bench: []});
		}
		patches[turn] = {
			hp: Array.from(turnHP.values()),
			status: Array.from(turnStatus.values()),
			active: Array.from(turnActiveSlots.values()),
			bench,
		};
	}

	for (const line of lines) {
		if (!line.startsWith('|')) continue;
		const parts = line.slice(1).split('|');
		const cmd = parts[0];

		if (cmd === 'turn') {
			// Save patch for previous turn before moving to next
			if (currentTurn > 0) {
				savePatchForTurn(currentTurn);
			}
			currentTurn = parseInt(parts[1]);
			turnActiveSlots = new Map();
			turnHP = new Map();
			turnStatus = new Map();
			continue;
		}

		// Only process events during battle turns
		if (currentTurn < 1) {
			// Before turn 1, still track switches for initial active Pokemon
			if (cmd === 'switch' || cmd === 'drag') {
				const ident = parts[1].trim();
				const details = parts[2] || '';
				const slotMatch = ident.match(/^(p[12][a-d])/);
				if (slotMatch) {
					const slot = slotMatch[1];
					const species = details.split(',')[0].trim();
					const speciesId = toID(species);
					identToSpecies.set(ident, speciesId);
					activeInSlot[slot] = speciesId;
					getTracker(slot.slice(0, 2), speciesId);
				}
			}
			continue;
		}

		switch (cmd) {
		case 'switch':
		case 'drag': {
			const ident = parts[1].trim();
			const details = parts[2] || '';
			const hpStr = parts[3]?.trim() || '100/100';
			const slotMatch = ident.match(/^(p[12][a-d])/);
			if (slotMatch) {
				const slot = slotMatch[1];
				const side = slot.slice(0, 2);
				const species = details.split(',')[0].trim();
				const speciesId = toID(species);

				identToSpecies.set(ident, speciesId);
				activeInSlot[slot] = speciesId;

				const hpParsed = parseHPString(hpStr);
				turnHP.set(slot, {slot, hpPercent: hpParsed.percent, fainted: false});
				turnActiveSlots.set(slot, {slot, speciesId});

				// Update cumulative tracker
				const tracker = getTracker(side, speciesId);
				tracker.hpPercent = hpParsed.percent;
				tracker.fainted = false;
				if (hpParsed.status !== undefined) {
					tracker.status = hpParsed.status;
					turnStatus.set(slot, {slot, status: hpParsed.status});
				} else {
					// Switching in with no status shown means no status
					tracker.status = '';
				}
			}
			break;
		}

		case '-damage':
		case '-heal': {
			const ident = parts[1].trim();
			const hpStr = parts[2]?.trim() || '';
			const slotMatch = ident.match(/^(p[12][a-d])/);
			if (slotMatch) {
				const slot = slotMatch[1];
				const side = slot.slice(0, 2);
				const hpParsed = parseHPString(hpStr);
				turnHP.set(slot, {slot, hpPercent: hpParsed.percent, fainted: hpParsed.percent === 0});

				// Update cumulative tracker
				const speciesId = getSpeciesForIdent(ident) || activeInSlot[slot];
				if (speciesId) {
					const tracker = getTracker(side, speciesId);
					tracker.hpPercent = hpParsed.percent;
					tracker.fainted = hpParsed.percent === 0;
					if (hpParsed.status !== undefined) {
						tracker.status = hpParsed.status;
						turnStatus.set(slot, {slot, status: hpParsed.status});
					}
				}
			}
			break;
		}

		case 'faint': {
			const ident = parts[1].trim();
			const slotMatch = ident.match(/^(p[12][a-d])/);
			if (slotMatch) {
				const slot = slotMatch[1];
				const side = slot.slice(0, 2);
				turnHP.set(slot, {slot, hpPercent: 0, fainted: true});

				const speciesId = getSpeciesForIdent(ident) || activeInSlot[slot];
				if (speciesId) {
					const tracker = getTracker(side, speciesId);
					tracker.hpPercent = 0;
					tracker.fainted = true;
				}
			}
			break;
		}

		case '-status': {
			const ident = parts[1].trim();
			const statusStr = parts[2]?.trim() || '';
			const slotMatch = ident.match(/^(p[12][a-d])/);
			if (slotMatch) {
				const slot = slotMatch[1];
				const side = slot.slice(0, 2);
				turnStatus.set(slot, {slot, status: statusStr});

				const speciesId = getSpeciesForIdent(ident) || activeInSlot[slot];
				if (speciesId) {
					getTracker(side, speciesId).status = statusStr;
				}
			}
			break;
		}

		case '-curestatus': {
			const ident = parts[1].trim();
			const slotMatch = ident.match(/^(p[12][a-d])/);
			if (slotMatch) {
				const slot = slotMatch[1];
				const side = slot.slice(0, 2);
				turnStatus.set(slot, {slot, status: ''});

				const speciesId = getSpeciesForIdent(ident) || activeInSlot[slot];
				if (speciesId) {
					getTracker(side, speciesId).status = '';
				}
			}
			break;
		}
		}
	}

	// Save final turn's patch
	if (currentTurn > 0) {
		savePatchForTurn(currentTurn);
	}

	return patches;
}

/**
 * Count the number of turns in a replay log.
 */
export function countTurns(log: string): number {
	let maxTurn = 0;
	for (const line of log.split('\n')) {
		const match = line.match(/^\|turn\|(\d+)$/);
		if (match) {
			maxTurn = Math.max(maxTurn, parseInt(match[1]));
		}
	}
	return maxTurn;
}

// ---- Smogon Stats Parser ----

export interface SpreadData {
	nature: string;
	evs: {hp: number; atk: number; def: number; spa: number; spd: number; spe: number};
	usage: number;
}

const MAX_SPREADS = 10;

/**
 * Parse Smogon usage stats text to extract top spreads per Pokemon.
 * Ported from ~/multicalc/fetch-stats.js
 */
export function parseSpreads(text: string): Record<string, SpreadData[]> {
	const result: Record<string, SpreadData[]> = {};
	const lines = text.split('\n');

	let currentName: string | null = null;
	let inSpreads = false;
	let spreads: SpreadData[] = [];

	for (const rawLine of lines) {
		const line = rawLine.trimEnd();
		const trimmed = line.trim();

		// Separator line
		if (/^\s*\+[-+]+\+\s*$/.test(trimmed)) {
			if (inSpreads && currentName && spreads.length > 0) {
				result[currentName] = spreads.slice(0, MAX_SPREADS);
				spreads = [];
			}
			inSpreads = false;
			continue;
		}

		// Pokemon name line
		const nameMatch = trimmed.match(/^\|\s*([A-Za-z][A-Za-z0-9\s.'-]+?)\s*\|$/);
		if (nameMatch) {
			const candidate = nameMatch[1].trim();
			const sections = ['Abilities', 'Items', 'Spreads', 'Moves', 'Tera Types', 'Teammates', 'Checks and Counters'];
			if (!sections.includes(candidate) && !candidate.match(/^\d/) && !candidate.includes('%')) {
				if (currentName && spreads.length > 0) {
					result[currentName] = spreads.slice(0, MAX_SPREADS);
				}
				currentName = candidate;
				spreads = [];
				inSpreads = false;
				continue;
			}
		}

		// Spreads section header
		if (/^\s*\|\s*Spreads\s*\|/.test(trimmed)) {
			inSpreads = true;
			continue;
		}

		// Parse spread lines
		if (inSpreads) {
			const content = trimmed.replace(/^\|/, '').replace(/\|\s*$/, '').trim();
			const match = content.match(/([A-Za-z]+):(\d+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)\s+([\d.]+)%/);
			if (match) {
				spreads.push({
					nature: match[1],
					evs: {
						hp: parseInt(match[2]),
						atk: parseInt(match[3]),
						def: parseInt(match[4]),
						spa: parseInt(match[5]),
						spd: parseInt(match[6]),
						spe: parseInt(match[7]),
					},
					usage: parseFloat(match[8]),
				});
			}
		}
	}

	// Save last Pokemon
	if (currentName && spreads.length > 0) {
		result[currentName] = spreads.slice(0, MAX_SPREADS);
	}

	return result;
}
