/**
 * Battle Stream
 * Pokemon Showdown - http://pokemonshowdown.com/
 *
 * Supports interacting with a PS battle in Stream format.
 *
 * This format is VERY NOT FINALIZED, please do not use it directly yet.
 *
 * @license MIT
 */

import { Streams, Utils } from '../lib';
import { Teams } from './teams';
import { Battle, extractChannelMessages } from './battle';
import type { ChoiceRequest } from './side';
import type { EffectState } from './pokemon';

/**
 * Like string.split(delimiter), but only recognizes the first `limit`
 * delimiters (default 1).
 *
 * `"1 2 3 4".split(" ", 2) => ["1", "2"]`
 *
 * `Utils.splitFirst("1 2 3 4", " ", 1) => ["1", "2 3 4"]`
 *
 * Returns an array of length exactly limit + 1.
 */
function splitFirst(str: string, delimiter: string, limit = 1) {
	const splitStr: string[] = [];
	while (splitStr.length < limit) {
		const delimiterIndex = str.indexOf(delimiter);
		if (delimiterIndex >= 0) {
			splitStr.push(str.slice(0, delimiterIndex));
			str = str.slice(delimiterIndex + delimiter.length);
		} else {
			splitStr.push(str);
			str = '';
		}
	}
	splitStr.push(str);
	return splitStr;
}

export class BattleStream extends Streams.ObjectReadWriteStream<string> {
	debug: boolean;
	noCatch: boolean;
	replay: boolean | 'spectator';
	keepAlive: boolean;
	battle: Battle | null;

	constructor(options: {
		debug?: boolean, noCatch?: boolean, keepAlive?: boolean, replay?: boolean | 'spectator',
	} = {}) {
		super();
		this.debug = !!options.debug;
		this.noCatch = !!options.noCatch;
		this.replay = options.replay || false;
		this.keepAlive = !!options.keepAlive;
		this.battle = null;
	}

	override _write(chunk: string) {
		if (this.noCatch) {
			this._writeLines(chunk);
		} else {
			try {
				this._writeLines(chunk);
			} catch (err: any) {
				this.pushError(err, true);
				return;
			}
		}
		if (this.battle) this.battle.sendUpdates();
	}

	_writeLines(chunk: string) {
		for (const line of chunk.split('\n')) {
			if (line.startsWith('>')) {
				const [type, message] = splitFirst(line.slice(1), ' ');
				this._writeLine(type, message);
			}
		}
	}

	pushMessage(type: string, data: string) {
		if (this.replay) {
			if (type === 'update') {
				if (this.replay === 'spectator') {
					const channelMessages = extractChannelMessages(data, [0]);
					this.push(channelMessages[0].join('\n'));
				} else {
					const channelMessages = extractChannelMessages(data, [-1]);
					this.push(channelMessages[-1].join('\n'));
				}
			}
			return;
		}
		this.push(`${type}\n${data}`);
	}

	_writeLine(type: string, message: string) {
		switch (type) {
		case 'start':
			const options = JSON.parse(message);
			options.send = (t: string, data: any) => {
				if (Array.isArray(data)) data = data.join("\n");
				this.pushMessage(t, data);
				if (t === 'end' && !this.keepAlive) this.pushEnd();
			};
			if (this.debug) options.debug = true;
			this.battle = new Battle(options);
			break;
		case 'player':
			const [slot, optionsText] = splitFirst(message, ' ');
			this.battle!.setPlayer(slot as SideID, JSON.parse(optionsText));
			break;
		case 'p1':
		case 'p2':
		case 'p3':
		case 'p4':
			if (message === 'undo') {
				this.battle!.undoChoice(type);
			} else {
				this.battle!.choose(type, message);
			}
			break;
		case 'forcewin':
		case 'forcetie':
			this.battle!.win(type === 'forcewin' ? message as SideID : null);
			if (message) {
				this.battle!.inputLog.push(`>forcewin ${message}`);
			} else {
				this.battle!.inputLog.push(`>forcetie`);
			}
			break;
		case 'forcelose':
			this.battle!.lose(message as SideID);
			this.battle!.inputLog.push(`>forcelose ${message}`);
			break;
		case 'reseed':
			this.battle!.resetRNG(message as PRNGSeed);
			// could go inside resetRNG, but this makes using it in `eval` slightly less buggy
			this.battle!.inputLog.push(`>reseed ${this.battle!.prng.getSeed()}`);
			break;
		case 'tiebreak':
			this.battle!.tiebreak();
			break;
		case 'chat-inputlogonly':
			this.battle!.inputLog.push(`>chat ${message}`);
			break;
		case 'chat':
			this.battle!.inputLog.push(`>chat ${message}`);
			this.battle!.add('chat', `${message}`);
			break;
		case 'eval':
			const battle = this.battle!;

			// n.b. this will usually but not always work - if you eval code that also affects the inputLog,
			// replaying the inputlog would double-play the change.
			battle.inputLog.push(`>${type} ${message}`);

			message = message.replace(/\f/g, '\n');
			battle.add('', '>>> ' + message.replace(/\n/g, '\n||'));
			try {
				/* eslint-disable no-eval, @typescript-eslint/no-unused-vars */
				const p1 = battle.sides[0];
				const p2 = battle.sides[1];
				const p3 = battle.sides[2];
				const p4 = battle.sides[3];
				const p1active = p1?.active[0];
				const p2active = p2?.active[0];
				const p3active = p3?.active[0];
				const p4active = p4?.active[0];
				const toID = battle.toID;
				const player = (input: string) => {
					input = toID(input);
					if (/^p[1-9]$/.test(input)) return battle.sides[parseInt(input.slice(1)) - 1];
					if (/^[1-9]$/.test(input)) return battle.sides[parseInt(input) - 1];
					for (const side of battle.sides) {
						if (toID(side.name) === input) return side;
					}
					return null;
				};
				const pokemon = (side: string | Side, input: string) => {
					if (typeof side === 'string') side = player(side)!;

					input = toID(input);
					if (/^[1-9]$/.test(input)) return side.pokemon[parseInt(input) - 1];
					return side.pokemon.find(p => p.baseSpecies.id === input || p.species.id === input);
				};
				let result = eval(message);
				/* eslint-enable no-eval, @typescript-eslint/no-unused-vars */

				if (result?.then) {
					result.then((unwrappedResult: any) => {
						unwrappedResult = Utils.visualize(unwrappedResult);
						battle.add('', 'Promise -> ' + unwrappedResult);
						battle.sendUpdates();
					}, (error: Error) => {
						battle.add('', '<<< error: ' + error.message);
						battle.sendUpdates();
					});
				} else {
					result = Utils.visualize(result);
					result = result.replace(/\n/g, '\n||');
					battle.add('', '<<< ' + result);
				}
			} catch (e: any) {
				battle.add('', '<<< error: ' + e.message);
			}
			break;
		case 'requestlog':
			this.push(`requesteddata\n${this.battle!.inputLog.join('\n')}`);
			break;
		case 'requestexport':
			this.push(`requesteddata\n${this.battle!.prngSeed}\n${this.battle!.inputLog.join('\n')}`);
			break;
		case 'requestteam':
			message = message.trim();
			const slotNum = parseInt(message.slice(1)) - 1;
			if (isNaN(slotNum) || slotNum < 0) {
				throw new Error(`Team requested for slot ${message}, but that slot does not exist.`);
			}
			const side = this.battle!.sides[slotNum];
			const team = Teams.pack(side.team);
			this.push(`requesteddata\n${team}`);
			break;
		case 'show-openteamsheets':
			this.battle!.showOpenTeamSheets();
			break;
		case 'jumptoturn': {
			let jumpTurn = parseInt(message);
			const savedStateByTurn = this.battle!.stateByTurn;
			let jumpJSON: AnyObject | null = savedStateByTurn[jumpTurn] ?? null;
			// Validate state: must have formatid and sides (indicates full serialization)
			const isValidState = (s: any) => s && s.formatid && s.sides;
			if (!isValidState(jumpJSON)) {
				// No valid state for this turn; try the nearest earlier turn
				jumpJSON = null;
				for (let t = jumpTurn - 1; t >= 0; t--) {
					if (isValidState(savedStateByTurn[t])) {
						jumpJSON = savedStateByTurn[t];
						jumpTurn = t;
						break;
					}
				}
				if (!jumpJSON) break;
			}
			try {
				const jumpSend = this.battle!.send;
				const jumpBattle = Battle.fromJSON(jumpJSON);
				this.battle = jumpBattle;
				this.battle.resetRNG(null);
				this.battle.restart(jumpSend);
				if (jumpTurn === 0) {
					this.battle.makeRequest('teampreview');
					this.battle.midTurn = true;
				} else {
					this.battle.makeRequest('move');
					this.battle.midTurn = false;
					this.battle.queue.clear();
				}
				this.battle.stateByTurn = savedStateByTurn;
			} catch (e: any) {
				// fromJSON or restart failed — log and keep current battle state
				this.push(`update\n|error|[Jump to turn ${jumpTurn}] ${e.message}`);
			}
			break;
		}
		case 'exportstate': {
			const battle = this.battle!;
			const exportData = {
				formatid: battle.format.id,
				turn: battle.turn,
				state: battle.toJSON(),
				stateByTurn: battle.stateByTurn,
				log: battle.log,
			};
			this.push(`requesteddata\n${JSON.stringify(exportData)}`);
			break;
		}
		case 'replaydone': {
			// Signal that all replay turns have been processed.
			// Pushes requesteddata so the caller can await completion.
			this.push(`requesteddata\ndone`);
			break;
		}
		case 'patchturn': {
		// Apply HP/status/faint corrections from replay data to current battle state.
		// Used during replay import to correct RNG divergence after each simulated turn.
		const patchData = JSON.parse(message);
		this.applyPatch(patchData);
		break;
	}
	case 'replayturn': {
		// Atomically process one replay turn: submit choices, handle forced switches,
		// apply patch to correct RNG divergence. This handles the case where the sim's
		// RNG produces different outcomes (e.g., a Pokemon faints in sim but not in replay),
		// which would cause forced-switch desync if handled separately.
		const turnData = JSON.parse(message);
		const battle = this.battle!;
		const {p1: p1Choice, p2: p2Choice, patch, forcedP1, forcedP2} = turnData;
		const {forcedP1Species, forcedP2Species} = turnData;
		const turnBefore = battle.turn;

		try {
			// Submit choices for both sides.
			// choose() returns false (doesn't throw) when choices are invalid
			// (e.g., Fake Out after turn 1, invalid targets, wrong switch indices).
			if (p1Choice) battle.choose('p1', p1Choice);
			if (p2Choice) battle.choose('p2', p2Choice);

			// After choices resolve, the sim may need forced switches (faints).
			// Use the REPLAY's forced switch data first (if available), then auto-resolve
			// any remaining. This ensures the correct Pokemon get switched in rather
			// than whatever `default` picks.
			//
			// IMPORTANT: The parser's forced switch choices use team indices from the
			// initial team order, but the sim's internal team array may have been
			// reordered by earlier switches/autoResolveForced. We use the species
			// info to resolve the correct index at runtime.
			const hadForcedSwitches = forcedP1 || forcedP2 ||
				battle.sides[0].requestState === 'switch' ||
				battle.sides[1].requestState === 'switch';

			if (forcedP1) {
				const resolved = this.resolveForcedSwitch(battle, 0, forcedP1, forcedP1Species);
				try { battle.choose('p1', resolved); } catch { /* ignore */ }
			}
			if (forcedP2) {
				const resolved = this.resolveForcedSwitch(battle, 1, forcedP2, forcedP2Species);
				try { battle.choose('p2', resolved); } catch { /* ignore */ }
			}
			// Auto-resolve any remaining forced switches not covered by the replay
			// (e.g., sim-only faints from RNG divergence).
			this.autoResolveForced(battle);

		} catch { /* ignore */ }

		// If the turn didn't advance (choices failed or were incomplete),
		// force-advance so we can apply the patch and move on.
		const wasForced = battle.turn === turnBefore && !battle.ended;
		if (wasForced) {
			this.forceAdvanceTurn(battle);
		}

		// Apply the patch to correct HP/status/faint to match the actual replay
		if (patch) {
			this.applyPatch(patch);
		}

		// Re-save stateByTurn after patching. nextTurn() saves state BEFORE
		// forced switches and patches run, so the saved state has wrong Pokemon
		// in active slots and incorrect HP/status.
		// Always patch the serialized state using patchStateByTurnActives, which
		// fixes active slots, HP, status, and team encoding without the OOM risk
		// of a full toJSON() re-serialization.
		if (wasForced) {
			// For force-advanced turns, nextTurn never ran so stateByTurn has an
			// empty {}. We need a toJSON() here, but it may OOM with Commander.
			// Fallback: copy the previous turn's state and patch it.
			const prevTurn = battle.turn - 1;
			if (prevTurn >= 0 && battle.stateByTurn[prevTurn]?.sides) {
				battle.stateByTurn[battle.turn] = JSON.parse(JSON.stringify(battle.stateByTurn[prevTurn]));
			}
			this.patchStateByTurnActives(battle, battle.turn);
		} else if (battle.turn > turnBefore) {
			this.patchStateByTurnActives(battle, battle.turn);
		}

		// Ensure the battle is ready for the next turn's choices.
		// If requestState isn't 'move', force it so the next replayturn can submit choices.
		if (!battle.ended && battle.requestState !== 'move') {
			try {
				battle.makeRequest('move');
			} catch {
				// If makeRequest fails, manually set up the request state
				battle.requestState = 'move';
				for (const side of battle.sides) {
					side.clearChoice();
				}
			}
			battle.midTurn = false;
		}

		break;
	}
	case 'loadstate': {
			const loadData = JSON.parse(message);
			const loadSend = this.battle!.send;
			this.battle = Battle.fromJSON(loadData.state);
			this.battle.resetRNG(null);
			this.battle.restart(loadSend);

			if (loadData.turn === 0) {
				this.battle.makeRequest('teampreview');
				this.battle.midTurn = true;
			} else {
				this.battle.makeRequest('move');
				this.battle.midTurn = false;
				this.battle.queue.clear();
			}
			this.battle.stateByTurn = loadData.stateByTurn || [];

			// Emit saved log for client to populate battle log and scene.
			// Must happen here (in the stream) rather than via room.add() so it
			// arrives AFTER the loadstate update/request messages.
			// Filter through extractChannelMessages to resolve |split| blocks —
			// the raw log contains both SECRET and PUBLIC versions of each event,
			// and the client would process both, causing duplicate damage/switches.
			if (loadData.log?.length) {
				const channelMessages = extractChannelMessages(loadData.log.join('\n'), [-1]);
				this.pushMessage('update', `|initlog|${JSON.stringify(channelMessages[-1])}`);
			}
			break;
		}
		case 'version':
		case 'version-origin':
			break;
		default:
			throw new Error(`Unrecognized command ">${type} ${message}"`);
		}
	}

	/**
	 * Force the battle to advance to the next turn when choices fail due to sim divergence.
	 * Clears any pending requests and re-makes a move request.
	 */
	forceAdvanceTurn(battle: Battle) {
		// Clear any pending choices and requests
		for (const side of battle.sides) {
			side.clearChoice();
			side.activeRequest = null;
		}
		battle.requestState = '';
		battle.midTurn = false;
		battle.turn++;
		// Ensure stateByTurn array is large enough (state will be saved after patching)
		while (battle.stateByTurn.length <= battle.turn) {
			battle.stateByTurn.push({});
		}
	}

	/**
	 * Patch the stateByTurn entry so the serialized pokemon arrays match the
	 * live battle's active slots. Called AFTER applyPatch() has already corrected
	 * the live battle, so we use the live state as the source of truth.
	 *
	 * nextTurn() saves stateByTurn BEFORE forced switches and patches run, so
	 * the serialized state may have wrong Pokemon in active slots. This method
	 * swaps entries in the serialized pokemon arrays to match reality.
	 */
	patchStateByTurnActives(battle: Battle, turn: number) {
		const saved = battle.stateByTurn[turn];
		if (!saved || !saved.sides) return;

		try {
			for (let sideIdx = 0; sideIdx < 2; sideIdx++) {
				const liveSide = battle.sides[sideIdx];
				const savedSide = saved.sides[sideIdx];
				if (!savedSide?.pokemon) continue;
				const pokemon = savedSide.pokemon as any[];

				// Step 1: Ensure active slots have the correct Pokemon
				for (let posIdx = 0; posIdx < liveSide.active.length; posIdx++) {
					const livePokemon = liveSide.active[posIdx];
					if (!livePokemon) continue;

					const targetSpecies = livePokemon.species.id;
					const targetBase = livePokemon.baseSpecies?.id || targetSpecies;
					const currentSpecies = pokemon[posIdx]?.speciesState?.id || '';

					// Already correct
					if (currentSpecies === targetSpecies || currentSpecies === targetBase) continue;

					// Find the target Pokemon elsewhere in the serialized array
					let targetIdx = -1;
					for (let j = 0; j < pokemon.length; j++) {
						if (j === posIdx) continue;
						const sp = pokemon[j]?.speciesState?.id || '';
						if (sp === targetSpecies || sp === targetBase ||
							sp.startsWith(targetSpecies) || targetSpecies.startsWith(sp)) {
							targetIdx = j;
							break;
						}
					}

					if (targetIdx >= 0) {
						// Swap entries and fix position fields
						const temp = pokemon[posIdx];
						pokemon[posIdx] = pokemon[targetIdx];
						pokemon[targetIdx] = temp;
						pokemon[posIdx].position = posIdx;
						pokemon[targetIdx].position = targetIdx;
					} else {
						// Species not found in serialized array (e.g., Commander
						// mechanics removed it). Try to find it in a previous turn's
						// stateByTurn and copy the serialized data from there.
						const donor = this.findSerializedPokemon(
							battle, turn, sideIdx, targetSpecies, targetBase
						);
						if (donor) {
							// Replace the wrong Pokemon at posIdx with the donor.
							// Move the current one to a duplicate/unused slot if needed.
							// Find a slot with a duplicate species to replace.
							let replaceIdx = -1;
							const speciesSeen = new Map<string, number>();
							for (let j = 0; j < pokemon.length; j++) {
								const sp = pokemon[j]?.speciesState?.id || '';
								if (speciesSeen.has(sp)) {
									replaceIdx = j;
									break;
								}
								speciesSeen.set(sp, j);
							}
							if (replaceIdx >= 0 && replaceIdx !== posIdx) {
								// Replace the duplicate with current posIdx pokemon
								pokemon[replaceIdx] = pokemon[posIdx];
								pokemon[replaceIdx].position = replaceIdx;
								pokemon[posIdx] = JSON.parse(JSON.stringify(donor));
								pokemon[posIdx].position = posIdx;
							} else {
								// No duplicate found; just overwrite posIdx
								pokemon[posIdx] = JSON.parse(JSON.stringify(donor));
								pokemon[posIdx].position = posIdx;
							}
						}
					}
				}

				// Step 2: Patch HP/status/fainted for ALL Pokemon using live data.
				// Active slots are patched by position; bench Pokemon are matched
				// by species ID to handle reordering from switches/swaps.
				for (let posIdx = 0; posIdx < liveSide.active.length; posIdx++) {
					const livePokemon = liveSide.active[posIdx];
					const savedMon = pokemon[posIdx];
					if (!livePokemon || !savedMon) continue;
					savedMon.hp = livePokemon.hp;
					savedMon.fainted = livePokemon.fainted;
					savedMon.status = livePokemon.status || '';
				}

				// Patch bench Pokemon (indices beyond active slots)
				for (let idx = liveSide.active.length; idx < pokemon.length; idx++) {
					const savedMon = pokemon[idx];
					if (!savedMon?.speciesState?.id) continue;
					const savedSpecies = savedMon.speciesState.id;

					// Find matching live Pokemon by species (skip active ones)
					const livePokemon = liveSide.pokemon.find(p =>
						!p.isActive && (
							p.species.id === savedSpecies ||
							p.baseSpecies.id === savedSpecies
						)
					);
					if (!livePokemon) continue;
					savedMon.hp = livePokemon.hp;
					savedMon.fainted = livePokemon.fainted;
					savedMon.status = livePokemon.status || '';
				}

				// Step 2b: Fix isActive flags in serialized data to match live state.
				// Active slots use the live active Pokemon's isActive flag (fainted
				// Pokemon in active slots have isActive=false). Bench is always false.
				for (let idx = 0; idx < pokemon.length; idx++) {
					if (!pokemon[idx]) continue;
					if (idx < liveSide.active.length) {
						const livePokemon = liveSide.active[idx];
						pokemon[idx].isActive = livePokemon ? livePokemon.isActive : false;
					} else {
						pokemon[idx].isActive = false;
					}
				}

				// Step 3: Rebuild the `team` encoding to match the current pokemon array.
				// Commander mechanics can corrupt the original `team` string by making the
				// serialized pokemon count mismatch the team mapping. Rebuild as an identity
				// mapping based on each pokemon's set matching the side's original team.
				this.rebuildTeamEncoding(savedSide, pokemon);
			}
		} catch { /* ignore */ }
	}

	/**
	 * Rebuild the serialized side's `team` encoding so it correctly maps
	 * all pokemon in the array. The `team` string format is: for each position
	 * in the original team, the 1-based index in the current pokemon array.
	 * e.g. "3142" means original[0]→pokemon[2], original[1]→pokemon[0], etc.
	 *
	 * When Commander mechanics corrupt the pokemon array (duplicates/missing),
	 * the team string may have wrong count. This rebuilds it as an identity
	 * mapping: "1234" for 4 pokemon. This is safe because fromJSON uses the
	 * team encoding to reconstruct the initial ordering, and for jump-to-turn
	 * we immediately overwrite with the correct state anyway.
	 */
	rebuildTeamEncoding(savedSide: any, pokemon: any[]) {
		// Build identity mapping: each array position maps to itself
		const team: string[] = [];
		for (let i = 0; i < pokemon.length; i++) {
			team.push(String(i + 1));
		}
		savedSide.team = team.join(team.length > 9 ? ',' : '');
	}

	/**
	 * Find a Pokemon's serialized data from a previous turn's stateByTurn.
	 * Used when Commander mechanics remove a Pokemon from side.pokemon,
	 * making it impossible to find in the current turn's serialized state.
	 */
	findSerializedPokemon(
		battle: Battle, currentTurn: number, sideIdx: number,
		targetSpecies: string, targetBase: string
	): any | null {
		// Search backwards through previous turns
		for (let t = currentTurn - 1; t >= 0; t--) {
			const prevState = battle.stateByTurn[t];
			if (!prevState?.sides?.[sideIdx]?.pokemon) continue;
			const prevPokemon = prevState.sides[sideIdx].pokemon as any[];
			for (const mon of prevPokemon) {
				const sp = mon?.speciesState?.id || '';
				if (sp === targetSpecies || sp === targetBase ||
					sp.startsWith(targetSpecies) || targetSpecies.startsWith(sp)) {
					return mon;
				}
			}
		}
		return null;
	}

	/**
	 * Resolve a forced switch choice by translating species-based slot references
	 * to the correct team indices in the sim's current team array.
	 *
	 * The parser generates choices like "switch 3, pass" based on the initial team
	 * ordering, but the sim's internal team array may have been reordered by earlier
	 * switches. This method uses species info to find the correct Pokemon.
	 */
	resolveForcedSwitch(
		battle: Battle, sideIdx: number, choice: string,
		speciesMap?: Record<string, string>
	): string {
		if (!speciesMap) return choice; // no species info, use as-is

		const side = battle.sides[sideIdx];
		const parts = choice.split(',').map(s => s.trim());

		for (let i = 0; i < parts.length; i++) {
			const match = parts[i].match(/^switch\s+(\d+)$/);
			if (!match) continue;

			// Determine which slot this is for (a, b, c, d...)
			const slotChar = String.fromCharCode(97 + i); // 0='a', 1='b'
			const slotId = `p${sideIdx + 1}${slotChar}`;
			const targetSpecies = speciesMap[slotId];
			if (!targetSpecies) continue;

			// Find the Pokemon by species in the sim's current team array
			// (1-based index, skipping active Pokemon)
			for (let j = 0; j < side.pokemon.length; j++) {
				const p = side.pokemon[j];
				if (p.isActive) continue; // can't switch to active Pokemon
				if (p.fainted) continue; // can't switch to fainted Pokemon
				const speciesId = p.species.id;
				const baseId = p.baseSpecies?.id || speciesId;
				if (speciesId === targetSpecies || baseId === targetSpecies ||
					speciesId.startsWith(targetSpecies) || targetSpecies.startsWith(speciesId)) {
					parts[i] = `switch ${j + 1}`; // 1-based
					break;
				}
			}
		}

		return parts.join(', ');
	}

	/**
	 * Auto-resolve forced switch requests that arise from RNG divergence during replay import.
	 * Uses battle.choose() with 'default' which calls commitDecisions() to actually process
	 * the switch and continue the turn. Uses try-catch because the sim state may be
	 * inconsistent (e.g., all Pokemon fainted on one side due to damage divergence).
	 */
	autoResolveForced(battle: Battle) {
		for (let i = 0; i < 10; i++) {
			const p1NeedsSwitch = battle.sides[0].requestState === 'switch';
			const p2NeedsSwitch = battle.sides[1].requestState === 'switch';
			if (!p1NeedsSwitch && !p2NeedsSwitch) break;

			try {
				if (p1NeedsSwitch) battle.choose('p1', 'default');
				if (p2NeedsSwitch) battle.choose('p2', 'default');
			} catch {
				// Sim state is too divergent to auto-resolve (e.g., no valid switch targets).
				// Force the request to 'move' so the replay can continue; the patch will fix state.
				for (const side of battle.sides) {
					if (side.requestState === 'switch') {
						side.clearChoice();
						side.activeRequest = null;
					}
				}
				battle.makeRequest('move');
				break;
			}
		}
	}

	/**
	 * Apply HP/status/faint/active corrections from replay patch data to current battle state.
	 * Corrects RNG divergence between simulated battle and actual replay outcomes.
	 */
	applyPatch(patchData: any) {
		const battle = this.battle!;

		// First, correct which Pokemon are in active slots (swap if needed)
		for (const activePatch of (patchData.active || [])) {
			const sideIdx = activePatch.slot.charAt(1) === '1' ? 0 : 1;
			const posIdx = activePatch.slot.charAt(2) === 'a' ? 0 : 1;
			const side = battle.sides[sideIdx];
			const currentPokemon = side.active[posIdx];

			if (!currentPokemon || currentPokemon.species.id === activePatch.speciesId) continue;

			// Find the correct Pokemon on the bench
			const correctIdx = side.pokemon.findIndex(p =>
				p.species.id === activePatch.speciesId || p.baseSpecies.id === activePatch.speciesId
			);
			if (correctIdx < 0) continue;

			// Swap the Pokemon
			const benchPokemon = side.pokemon[correctIdx];
			const activeIdx = side.pokemon.indexOf(currentPokemon);
			if (activeIdx < 0) continue;

			// Swap in pokemon array
			side.pokemon[activeIdx] = benchPokemon;
			side.pokemon[correctIdx] = currentPokemon;

			// Update active slot reference
			side.active[posIdx] = benchPokemon;
			benchPokemon.isActive = true;
			currentPokemon.isActive = false;
		}

		// Apply HP corrections
		for (const hpPatch of (patchData.hp || [])) {
			const sideIdx = hpPatch.slot.charAt(1) === '1' ? 0 : 1;
			const posIdx = hpPatch.slot.charAt(2) === 'a' ? 0 : 1;
			const side = battle.sides[sideIdx];
			const pokemon = side.active[posIdx];
			if (!pokemon) continue;

			if (hpPatch.fainted) {
				pokemon.hp = 0;
				pokemon.fainted = true;
				pokemon.faintQueued = false;
			} else {
				const newHP = Math.round(hpPatch.hpPercent * pokemon.maxhp / 100);
				pokemon.hp = Math.max(1, Math.min(newHP, pokemon.maxhp));
				if (pokemon.fainted) {
					pokemon.fainted = false;
					pokemon.faintQueued = false;
				}
			}
		}

		// Apply status corrections
		for (const statusPatch of (patchData.status || [])) {
			const sideIdx = statusPatch.slot.charAt(1) === '1' ? 0 : 1;
			const posIdx = statusPatch.slot.charAt(2) === 'a' ? 0 : 1;
			const side = battle.sides[sideIdx];
			const pokemon = side.active[posIdx];
			if (!pokemon) continue;

			pokemon.status = (statusPatch.status || '') as ID;
			if (!statusPatch.status) {
				pokemon.statusState = {} as EffectState;
			}
		}

		// Apply bench Pokemon corrections (species-addressed, not slot-addressed)
		for (const benchPatch of (patchData.bench || [])) {
			const sideIdx = benchPatch.side === 'p1' ? 0 : 1;
			const side = battle.sides[sideIdx];

			// Find the Pokemon by species ID (skip active Pokemon — already patched above)
			const pokemon = side.pokemon.find(p =>
				!p.isActive && (
					p.species.id === benchPatch.speciesId ||
					p.baseSpecies.id === benchPatch.speciesId
				)
			);
			if (!pokemon) continue;

			if (benchPatch.fainted) {
				pokemon.hp = 0;
				pokemon.fainted = true;
				pokemon.faintQueued = false;
			} else {
				const newHP = Math.round(benchPatch.hpPercent * pokemon.maxhp / 100);
				pokemon.hp = Math.max(1, Math.min(newHP, pokemon.maxhp));
				if (pokemon.fainted) {
					pokemon.fainted = false;
					pokemon.faintQueued = false;
				}
			}

			pokemon.status = (benchPatch.status || '') as ID;
			if (!benchPatch.status) {
				pokemon.statusState = {} as EffectState;
			}
		}

	}

	override _writeEnd() {
		// if battle already ended, we don't need to pushEnd.
		if (!this.atEOF) this.pushEnd();
		this._destroy();
	}

	override _destroy() {
		if (this.battle) this.battle.destroy();
	}
}

/**
 * Splits a BattleStream into omniscient, spectator, p1, p2, p3 and p4
 * streams, for ease of consumption.
 */
export function getPlayerStreams(stream: BattleStream) {
	const streams = {
		omniscient: new Streams.ObjectReadWriteStream({
			write(data: string) {
				void stream.write(data);
			},
			writeEnd() {
				return stream.writeEnd();
			},
		}),
		spectator: new Streams.ObjectReadStream<string>({
			read() {},
		}),
		p1: new Streams.ObjectReadWriteStream({
			write(data: string) {
				void stream.write(data.replace(/(^|\n)/g, `$1>p1 `));
			},
		}),
		p2: new Streams.ObjectReadWriteStream({
			write(data: string) {
				void stream.write(data.replace(/(^|\n)/g, `$1>p2 `));
			},
		}),
		p3: new Streams.ObjectReadWriteStream({
			write(data: string) {
				void stream.write(data.replace(/(^|\n)/g, `$1>p3 `));
			},
		}),
		p4: new Streams.ObjectReadWriteStream({
			write(data: string) {
				void stream.write(data.replace(/(^|\n)/g, `$1>p4 `));
			},
		}),
	};
	(async () => {
		for await (const chunk of stream) {
			const [type, data] = splitFirst(chunk, `\n`);
			switch (type) {
			case 'update':
				const channelMessages = extractChannelMessages(data, [-1, 0, 1, 2, 3, 4]);
				streams.omniscient.push(channelMessages[-1].join('\n'));
				streams.spectator.push(channelMessages[0].join('\n'));
				streams.p1.push(channelMessages[1].join('\n'));
				streams.p2.push(channelMessages[2].join('\n'));
				streams.p3.push(channelMessages[3].join('\n'));
				streams.p4.push(channelMessages[4].join('\n'));
				break;
			case 'sideupdate':
				const [side, sideData] = splitFirst(data, `\n`);
				streams[side as SideID].push(sideData);
				break;
			case 'end':
				// ignore
				break;
			}
		}
		for (const s of Object.values(streams)) {
			s.pushEnd();
		}
	})().catch(err => {
		for (const s of Object.values(streams)) {
			s.pushError(err, true);
		}
	});
	return streams;
}

export abstract class BattlePlayer {
	readonly stream: Streams.ObjectReadWriteStream<string>;
	readonly log: string[];
	readonly debug: boolean;

	constructor(playerStream: Streams.ObjectReadWriteStream<string>, debug = false) {
		this.stream = playerStream;
		this.log = [];
		this.debug = debug;
	}

	async start() {
		for await (const chunk of this.stream) {
			this.receive(chunk);
		}
	}

	receive(chunk: string) {
		for (const line of chunk.split('\n')) {
			this.receiveLine(line);
		}
	}

	receiveLine(line: string) {
		if (this.debug) console.log(line);
		if (!line.startsWith('|')) return;
		const [cmd, rest] = splitFirst(line.slice(1), '|');
		if (cmd === 'request') return this.receiveRequest(JSON.parse(rest));
		if (cmd === 'error') return this.receiveError(new Error(rest));
		this.log.push(line);
	}

	abstract receiveRequest(request: ChoiceRequest): void;

	receiveError(error: Error) {
		throw error;
	}

	choose(choice: string) {
		void this.stream.write(choice);
	}
}

export class BattleTextStream extends Streams.ReadWriteStream {
	readonly battleStream: BattleStream;
	currentMessage: string;

	constructor(options: { debug?: boolean }) {
		super();
		this.battleStream = new BattleStream(options);
		this.currentMessage = '';
		void this._listen();
	}

	async _listen() {
		for await (let message of this.battleStream) {
			if (!message.endsWith('\n')) message += '\n';
			this.push(message + '\n');
		}
		this.pushEnd();
	}

	override _write(message: string | Buffer) {
		this.currentMessage += `${message}`;
		const index = this.currentMessage.lastIndexOf('\n');
		if (index >= 0) {
			void this.battleStream.write(this.currentMessage.slice(0, index));
			this.currentMessage = this.currentMessage.slice(index + 1);
		}
	}

	override _writeEnd() {
		return this.battleStream.writeEnd();
	}
}
