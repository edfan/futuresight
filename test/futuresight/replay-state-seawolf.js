'use strict';

/**
 * Replay State Test: SeaWolfMikes vs Puerto Madryn
 *
 * Tests full replay import + stateByTurn validation for:
 * https://replay.pokemonshowdown.com/gen9vgc2026regfbo3-2536407025-iyiew1khxu6877gvj50djycg4qil12ipw
 *
 * Game 1 of a Bo3, 8 turns (forfeit at turn 8).
 *
 * Key features tested:
 *   - Multiple forced switches (turns 5, 6, 7)
 *   - Terastallize (p1b Gholdengo turn 1, p2b Flutter Mane turn 6)
 *   - Parting Shot mid-turn forced switch (turn 6)
 *   - Weather changes (Drought → clear → Drought)
 *   - Item removal via Knock Off
 *   - Forfeit at turn 8
 *   - stateByTurn deserialization via fromJSON at every turn
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
// Replay log
// ---------------------------------------------------------------------------
const REPLAY_LOG = `|j|\u2605SeaWolfMikes
|j|\u2605Puerto Madryn
|gametype|doubles
|player|p1|SeaWolfMikes|ryuki|1641
|player|p2|Puerto Madryn|lucas|1732
|gen|9
|tier|[Gen 9] VGC 2026 Reg F (Bo3)
|rule|Species Clause: Limit one of each Pok\u00e9mon
|rule|Item Clause: Limit 1 of each item
|clearpoke
|poke|p1|Whimsicott, L50, M|
|poke|p1|Urshifu-*, L50, F|
|poke|p1|Gholdengo, L50|
|poke|p1|Ogerpon-Wellspring, L50, F|
|poke|p1|Incineroar, L50, M|
|poke|p1|Farigiraf, L50, M|
|poke|p2|Torkoal, L50, M|
|poke|p2|Incineroar, L50, F|
|poke|p2|Flutter Mane, L50|
|poke|p2|Farigiraf, L50, M|
|poke|p2|Chien-Pao, L50|
|poke|p2|Ogerpon-Wellspring, L50, F|
|teampreview|4
|showteam|p1|Whimsicott||CovertCloak|Prankster|Moonblast,Tailwind,Encore,LightScreen|||M|||50|,,,,,Fire]Urshifu||LifeOrb|UnseenFist|WickedBlow,CloseCombat,SuckerPunch,Detect|||F|||50|,,,,,Dark]Gholdengo||MetalCoat|GoodasGold|MakeItRain,ShadowBall,NastyPlot,Protect||||||50|,,,,,Water]Ogerpon-Wellspring||WellspringMask|WaterAbsorb|IvyCudgel,HornLeech,FollowMe,SpikyShield|||F|||50|,,,,,Water]Incineroar||AssaultVest|Intimidate|FlareBlitz,KnockOff,FakeOut,Uturn|||M|||50|,,,,,Grass]Farigiraf||ThroatSpray|ArmorTail|HyperVoice,Psychic,TrickRoom,Protect|||M|||50|,,,,,Dragon
|showteam|p2|Torkoal||Charcoal|Drought|Protect,Eruption,HelpingHand,WeatherBall|||M|||50|,,,,,Fire]Incineroar||SafetyGoggles|Intimidate|FakeOut,FlareBlitz,PartingShot,KnockOff|||F|||50|,,,,,Flying]Flutter Mane||ChoiceSpecs|Protosynthesis|Moonblast,ShadowBall,DazzlingGleam,MysticalFire||||||50|,,,,,Fairy]Farigiraf||ThroatSpray|ArmorTail|Protect,Psychic,HyperVoice,TrickRoom|||M|||50|,,,,,Fairy]Chien-Pao||ClearAmulet|SwordofRuin|SuckerPunch,Protect,SacredSword,IcicleCrash||||||50|,,,,,Fire]Ogerpon-Wellspring||WellspringMask|WaterAbsorb|SpikyShield,FollowMe,IvyCudgel,HornLeech|||F|||50|,,,,,Water
|
|t:|1770684281
|teamsize|p1|4
|teamsize|p2|4
|start
|switch|p1a: Incineroar|Incineroar, L50, M|100/100
|switch|p1b: Gholdengo|Gholdengo, L50|100/100
|switch|p2a: Incineroar|Incineroar, L50, F|100/100
|switch|p2b: Torkoal|Torkoal, L50, M|100/100
|-ability|p2a: Incineroar|Intimidate|boost
|-unboost|p1a: Incineroar|atk|1
|-unboost|p1b: Gholdengo|atk|1
|-ability|p1a: Incineroar|Intimidate|boost
|-unboost|p2a: Incineroar|atk|1
|-unboost|p2b: Torkoal|atk|1
|-weather|SunnyDay|[from] ability: Drought|[of] p2b: Torkoal
|turn|1
|
|t:|1770684312
|-terastallize|p1b: Gholdengo|Water
|move|p2a: Incineroar|Fake Out|p1a: Incineroar
|-damage|p1a: Incineroar|95/100
|cant|p1a: Incineroar|flinch
|move|p1b: Gholdengo|Nasty Plot|p1b: Gholdengo
|-boost|p1b: Gholdengo|spa|2
|move|p2b: Torkoal|Weather Ball|p1b: Gholdengo
|-resisted|p1b: Gholdengo
|-damage|p1b: Gholdengo|64/100
|
|-weather|SunnyDay|[upkeep]
|upkeep
|turn|2
|
|t:|1770684324
|move|p1b: Gholdengo|Make It Rain|p2a: Incineroar|[spread] p2a,p2b
|-resisted|p2a: Incineroar
|-resisted|p2b: Torkoal
|-damage|p2a: Incineroar|57/100
|-damage|p2b: Torkoal|23/100
|-unboost|p1b: Gholdengo|spa|1
|move|p2a: Incineroar|Knock Off|p1a: Incineroar
|-resisted|p1a: Incineroar
|-damage|p1a: Incineroar|83/100
|-enditem|p1a: Incineroar|Assault Vest|[from] move: Knock Off|[of] p2a: Incineroar
|move|p1a: Incineroar|Knock Off|p2a: Incineroar
|-resisted|p2a: Incineroar
|-crit|p2a: Incineroar
|-damage|p2a: Incineroar|30/100
|-enditem|p2a: Incineroar|Safety Goggles|[from] move: Knock Off|[of] p1a: Incineroar
|move|p2b: Torkoal|Eruption|p1b: Gholdengo|[spread] p1a,p1b
|-resisted|p1a: Incineroar
|-resisted|p1b: Gholdengo
|-damage|p1a: Incineroar|73/100
|-damage|p1b: Gholdengo|54/100
|
|-weather|SunnyDay|[upkeep]
|upkeep
|turn|3
|
|t:|1770684341
|switch|p2a: Ogerpon|Ogerpon-Wellspring, L50, F|100/100
|switch|p1a: Farigiraf|Farigiraf, L50, M|100/100
|move|p2b: Torkoal|Protect|p2b: Torkoal
|-singleturn|p2b: Torkoal|Protect
|move|p1b: Gholdengo|Make It Rain|p2b: Torkoal|[spread] p2a
|-activate|p2b: Torkoal|move: Protect
|-resisted|p2a: Ogerpon
|-damage|p2a: Ogerpon|59/100
|-unboost|p1b: Gholdengo|spa|1
|
|-weather|SunnyDay|[upkeep]
|upkeep
|turn|4
|
|t:|1770684350
|switch|p1b: Incineroar|Incineroar, L50, M|73/100
|-ability|p1b: Incineroar|Intimidate|boost
|-unboost|p2a: Ogerpon|atk|1
|-unboost|p2b: Torkoal|atk|1
|switch|p2b: Flutter Mane|Flutter Mane, L50|100/100
|-activate|p2b: Flutter Mane|ability: Protosynthesis
|-start|p2b: Flutter Mane|protosynthesisspa
|move|p2a: Ogerpon|Horn Leech|p1a: Farigiraf
|-damage|p1a: Farigiraf|77/100
|-heal|p2a: Ogerpon|72/100|[from] drain|[of] p1a: Farigiraf
|move|p1a: Farigiraf|Hyper Voice|p2b: Flutter Mane|[spread] p2a
|-immune|p2b: Flutter Mane
|-damage|p2a: Ogerpon|43/100
|-enditem|p1a: Farigiraf|Throat Spray
|-boost|p1a: Farigiraf|spa|1
|
|-weather|SunnyDay|[upkeep]
|upkeep
|turn|5
|
|t:|1770684390
|move|p1a: Farigiraf|Protect|p1a: Farigiraf
|-singleturn|p1a: Farigiraf|Protect
|move|p2a: Ogerpon|Follow Me|p2a: Ogerpon
|-singleturn|p2a: Ogerpon|move: Follow Me
|move|p2b: Flutter Mane|Moonblast|p1a: Farigiraf
|-activate|p1a: Farigiraf|move: Protect
|move|p1b: Incineroar|Flare Blitz|p2a: Ogerpon
|-damage|p2a: Ogerpon|0 fnt
|faint|p2a: Ogerpon
|-damage|p1b: Incineroar|60/100|[from] Recoil
|
|-weather|none
|-end|p2b: Flutter Mane|Protosynthesis
|upkeep
|
|t:|1770684393
|switch|p2a: Incineroar|Incineroar, L50, F|30/100
|-ability|p2a: Incineroar|Intimidate|boost
|-unboost|p1a: Farigiraf|atk|1
|-unboost|p1b: Incineroar|atk|1
|turn|6
|
|t:|1770684406
|-terastallize|p2b: Flutter Mane|Fairy
|move|p2b: Flutter Mane|Moonblast|p1a: Farigiraf
|-damage|p1a: Farigiraf|0 fnt
|faint|p1a: Farigiraf
|move|p2a: Incineroar|Parting Shot|p1b: Incineroar
|-unboost|p1b: Incineroar|atk|1
|-unboost|p1b: Incineroar|spa|1
|
|t:|1770684408
|switch|p2a: Torkoal|Torkoal, L50, M|23/100|[from] Parting Shot
|-weather|SunnyDay|[from] ability: Drought|[of] p2a: Torkoal
|-activate|p2b: Flutter Mane|ability: Protosynthesis
|-start|p2b: Flutter Mane|protosynthesisspa
|move|p1b: Incineroar|Knock Off|p2b: Flutter Mane
|-resisted|p2b: Flutter Mane
|-damage|p2b: Flutter Mane|79/100
|-enditem|p2b: Flutter Mane|Choice Specs|[from] move: Knock Off|[of] p1b: Incineroar
|
|-weather|SunnyDay|[upkeep]
|upkeep
|
|t:|1770684421
|switch|p1a: Ogerpon|Ogerpon-Wellspring, L50, F|100/100
|turn|7
|
|t:|1770684432
|move|p2a: Torkoal|Helping Hand|p2b: Flutter Mane
|-singleturn|p2b: Flutter Mane|Helping Hand|[of] p2a: Torkoal
|move|p2b: Flutter Mane|Dazzling Gleam|p1a: Ogerpon|[spread] p1a,p1b
|-damage|p1a: Ogerpon|16/100
|-damage|p1b: Incineroar|0 fnt
|faint|p1b: Incineroar
|move|p1a: Ogerpon|Horn Leech|p2b: Flutter Mane
|-damage|p2b: Flutter Mane|5/100
|-heal|p1a: Ogerpon|44/100|[from] drain|[of] p2b: Flutter Mane
|
|-weather|SunnyDay|[upkeep]
|upkeep
|
|t:|1770684437
|switch|p1b: Gholdengo|Gholdengo, L50, tera:Water|54/100
|turn|8
|-message|SeaWolfMikes forfeited.
|
|win|Puerto Madryn`;

// ---------------------------------------------------------------------------
// Expected state at the START of each turn (after forced switches resolve)
// This is what stateByTurn[N] should reflect when you jump to turn N.
// ---------------------------------------------------------------------------
const EXPECTED = {
	// Turn 0: team preview (no active Pokemon to check)

	// Turn 1: leads are out, weather is Sun
	1: {
		p1a: {species: 'incineroar', hp: 100, fainted: false},
		p1b: {species: 'gholdengo', hp: 100, fainted: false},
		p2a: {species: 'incineroar', hp: 100, fainted: false},
		p2b: {species: 'torkoal', hp: 100, fainted: false},
	},
	// After turn 1 resolves: Gholdengo tera'd Water, Fake Out flinch, Nasty Plot, Weather Ball
	2: {
		p1a: {species: 'incineroar', hp: 95, fainted: false},
		p1b: {species: 'gholdengo', hp: 64, fainted: false},
		p2a: {species: 'incineroar', hp: 100, fainted: false},
		p2b: {species: 'torkoal', hp: 100, fainted: false},
	},
	// After turn 2: Make It Rain, Knock Off x2, Eruption
	3: {
		p1a: {species: 'incineroar', hp: 73, fainted: false},
		p1b: {species: 'gholdengo', hp: 54, fainted: false},
		p2a: {species: 'incineroar', hp: 30, fainted: false},
		p2b: {species: 'torkoal', hp: 23, fainted: false},
	},
	// After turn 3: double switch (p1a→Farigiraf, p2a→Ogerpon), Make It Rain hits Ogerpon
	4: {
		p1a: {species: 'farigiraf', hp: 100, fainted: false},
		p1b: {species: 'gholdengo', hp: 54, fainted: false},
		p2a: {species: 'ogerponwellspring', hp: 59, fainted: false},
		p2b: {species: 'torkoal', hp: 23, fainted: false},
	},
	// After turn 4: double switch (p1b→Incineroar, p2b→Flutter Mane), Horn Leech, Hyper Voice
	5: {
		p1a: {species: 'farigiraf', hp: 77, fainted: false},
		p1b: {species: 'incineroar', hp: 73, fainted: false},
		p2a: {species: 'ogerponwellspring', hp: 43, fainted: false},
		p2b: {species: 'fluttermane', hp: 100, fainted: false},
	},
	// After turn 5: Protect, Follow Me, Moonblast blocked, Flare Blitz KOs Ogerpon
	// Forced switch: p2a → Incineroar at 30%
	6: {
		p1a: {species: 'farigiraf', hp: 77, fainted: false},
		p1b: {species: 'incineroar', hp: 60, fainted: false},
		p2a: {species: 'incineroar', hp: 30, fainted: false},
		p2b: {species: 'fluttermane', hp: 100, fainted: false},
	},
	// After turn 6: Moonblast KOs Farigiraf, Parting Shot → Torkoal in, Knock Off
	// Forced switch: p1a → Ogerpon at 100%
	7: {
		p1a: {species: 'ogerponwellspring', hp: 100, fainted: false},
		p1b: {species: 'incineroar', hp: 60, fainted: false},
		p2a: {species: 'torkoal', hp: 23, fainted: false},
		p2b: {species: 'fluttermane', hp: 79, fainted: false},
	},
	// After turn 7: Helping Hand + Dazzling Gleam KOs Incineroar, Horn Leech
	// Forced switch: p1b → Gholdengo at 54%
	8: {
		p1a: {species: 'ogerponwellspring', hp: 44, fainted: false},
		p1b: {species: 'gholdengo', hp: 54, fainted: false},
		p2a: {species: 'torkoal', hp: 23, fainted: false},
		p2b: {species: 'fluttermane', hp: 5, fainted: false},
	},
};

// ---------------------------------------------------------------------------
// Packed teams (from showteam lines)
// ---------------------------------------------------------------------------
const P1_PACKED = 'Whimsicott||CovertCloak|Prankster|Moonblast,Tailwind,Encore,LightScreen|||M|||50|,,,,,Fire]Urshifu||LifeOrb|UnseenFist|WickedBlow,CloseCombat,SuckerPunch,Detect|||F|||50|,,,,,Dark]Gholdengo||MetalCoat|GoodasGold|MakeItRain,ShadowBall,NastyPlot,Protect||||||50|,,,,,Water]Ogerpon-Wellspring||WellspringMask|WaterAbsorb|IvyCudgel,HornLeech,FollowMe,SpikyShield|||F|||50|,,,,,Water]Incineroar||AssaultVest|Intimidate|FlareBlitz,KnockOff,FakeOut,Uturn|||M|||50|,,,,,Grass]Farigiraf||ThroatSpray|ArmorTail|HyperVoice,Psychic,TrickRoom,Protect|||M|||50|,,,,,Dragon';
const P2_PACKED = 'Torkoal||Charcoal|Drought|Protect,Eruption,HelpingHand,WeatherBall|||M|||50|,,,,,Fire]Incineroar||SafetyGoggles|Intimidate|FakeOut,FlareBlitz,PartingShot,KnockOff|||F|||50|,,,,,Flying]Flutter Mane||ChoiceSpecs|Protosynthesis|Moonblast,ShadowBall,DazzlingGleam,MysticalFire||||||50|,,,,,Fairy]Farigiraf||ThroatSpray|ArmorTail|Protect,Psychic,HyperVoice,TrickRoom|||M|||50|,,,,,Fairy]Chien-Pao||ClearAmulet|SwordofRuin|SuckerPunch,Protect,SacredSword,IcicleCrash||||||50|,,,,,Fire]Ogerpon-Wellspring||WellspringMask|WaterAbsorb|SpikyShield,FollowMe,IvyCudgel,HornLeech|||F|||50|,,,,,Water';
const FORMAT = 'gen9vgc2026regf';


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getStateFromSerialized(serialized) {
	const battle = Sim.Battle.fromJSON(serialized);
	const result = {};
	for (const slotStr of ['p1a', 'p1b', 'p2a', 'p2b']) {
		const sideIdx = slotStr.charAt(1) === '1' ? 0 : 1;
		const posIdx = slotStr.charAt(2) === 'a' ? 0 : 1;
		const side = battle.sides[sideIdx];
		const pokemon = side.active[posIdx];
		if (!pokemon) {
			result[slotStr] = {species: '(empty)', hp: 0, fainted: true};
			continue;
		}
		result[slotStr] = {
			species: pokemon.species.id,
			hp: pokemon.maxhp > 0 ? Math.round(pokemon.hp / pokemon.maxhp * 100) : 0,
			fainted: pokemon.fainted || pokemon.hp <= 0,
		};
	}
	return result;
}

function formatState(state) {
	const lines = [];
	for (const slot of ['p1a', 'p1b', 'p2a', 'p2b']) {
		const s = state[slot];
		if (!s) continue;
		const faintStr = s.fainted ? ' FAINTED' : '';
		lines.push(`    ${slot}: ${s.species} ${s.hp}%${faintStr}`);
	}
	return lines.join('\n');
}


// ===================================================================
// Test suite
// ===================================================================
describe('Replay state: SeaWolfMikes vs Puerto Madryn (gen9vgc2026regfbo3-2536407025)', function () {
	this.timeout(30000);

	let showteams, choices, totalTurns, turnPatches;
	let stream, battle;

	before(function () {
		showteams = parseShowteams(REPLAY_LOG);
		choices = parseReplayChoices(REPLAY_LOG, showteams.p1, showteams.p2);
		totalTurns = countTurns(REPLAY_LOG);
		turnPatches = parseAllTurnPatches(REPLAY_LOG, totalTurns);

		// Create battle and simulate all turns
		stream = new BattleStream({debug: true, noCatch: true, keepAlive: true});
		void stream.write(
			`>start {"formatid":"${FORMAT}","seed":[1,2,3,4]}\n` +
			`>player p1 {"name":"p1","team":"${P1_PACKED}"}\n` +
			`>player p2 {"name":"p2","team":"${P2_PACKED}"}\n`
		);
		void stream.write(
			`>p1 ${choices.teamPreview.p1}\n` +
			`>p2 ${choices.teamPreview.p2}\n`
		);
		battle = stream.battle;

		// Feed all turns
		for (let t = 1; t <= totalTurns; t++) {
			const turnData = {
				p1: choices.turns[t - 1]?.p1 || '',
				p2: choices.turns[t - 1]?.p2 || '',
				patch: turnPatches[t] || null,
				forcedP1: choices.forcedSwitches[t - 1]?.p1 || '',
				forcedP2: choices.forcedSwitches[t - 1]?.p2 || '',
			};
			void stream.write(`>replayturn ${JSON.stringify(turnData)}\n`);
		}
	});

	after(function () {
		if (stream) stream.destroy();
	});

	// -- Basic parsing --
	it('should parse 8 turns', function () {
		assert.equal(totalTurns, 8, `Expected 8 turns, got ${totalTurns}`);
	});

	it('should parse correct team preview choices', function () {
		// p1 leads: Incineroar (5), Gholdengo (3); also brought Farigiraf (6), Ogerpon (4)
		assert(choices.teamPreview.p1.startsWith('team '), `p1 preview: ${choices.teamPreview.p1}`);
		assert(choices.teamPreview.p2.startsWith('team '), `p2 preview: ${choices.teamPreview.p2}`);
	});

	it('should have choices for all 8 turns', function () {
		assert(choices.turns.length >= 8, `Expected >= 8 turns of choices, got ${choices.turns.length}`);
	});

	// -- Turn advancement --
	it('battle should advance through all turns', function () {
		// After all 8 replayturns, battle.turn should be >= 8
		// (could be 9 if the forfeit turn counts)
		assert(battle.turn >= 8,
			`battle.turn should be >= 8 after all replayturns, got ${battle.turn}`);
	});

	it('stateByTurn should have entries for turns 0-8', function () {
		for (let t = 0; t <= 8; t++) {
			assert(battle.stateByTurn[t],
				`stateByTurn[${t}] should exist`);
			assert(battle.stateByTurn[t].formatid || battle.stateByTurn[t].sides,
				`stateByTurn[${t}] should be a valid serialized battle`);
		}
	});

	// -- Per-turn stateByTurn validation --
	for (let turn = 1; turn <= 8; turn++) {
		describe(`turn ${turn}`, function () {
			it(`stateByTurn[${turn}] should deserialize via fromJSON`, function () {
				const serialized = battle.stateByTurn[turn];
				assert(serialized, `stateByTurn[${turn}] should exist`);
				// This will throw if deserialization fails
				const restored = Sim.Battle.fromJSON(serialized);
				assert(restored, `fromJSON should return a Battle for turn ${turn}`);
			});

			it(`active Pokemon should match replay at turn ${turn}`, function () {
				const exp = EXPECTED[turn];
				if (!exp) return; // skip if no expected data

				const state = getStateFromSerialized(battle.stateByTurn[turn]);

				for (const slot of ['p1a', 'p1b', 'p2a', 'p2b']) {
					const actual = state[slot];
					const expected = exp[slot];

					// Species check (allow tera suffix variation)
					const actualBase = actual.species.replace(/tera$/, '');
					const expectedBase = expected.species.replace(/tera$/, '');
					assert(
						actualBase === expectedBase ||
						actualBase.startsWith(expectedBase) ||
						expectedBase.startsWith(actualBase),
						`Turn ${turn} ${slot} species: expected ${expected.species}, got ${actual.species}`
					);

					// Fainted check
					assert.equal(actual.fainted, expected.fainted,
						`Turn ${turn} ${slot} fainted: expected ${expected.fainted}, got ${actual.fainted}`);
				}
			});

			it(`HP values should be within ±5% of replay at turn ${turn}`, function () {
				const exp = EXPECTED[turn];
				if (!exp) return;

				const state = getStateFromSerialized(battle.stateByTurn[turn]);

				for (const slot of ['p1a', 'p1b', 'p2a', 'p2b']) {
					const actual = state[slot];
					const expected = exp[slot];

					if (expected.fainted) continue; // don't check HP for fainted

					const diff = Math.abs(actual.hp - expected.hp);
					assert(diff <= 5,
						`Turn ${turn} ${slot} HP: expected ${expected.hp}%, got ${actual.hp}% (diff ${diff})`);
				}
			});
		});
	}

	// -- Specific scenario checks --
	describe('forced switches', function () {
		it('turn 5 should have p2 forced switch (Ogerpon fainted)', function () {
			const forced = choices.forcedSwitches[4]; // index 4 = turn 5
			assert(forced, 'Should have forced switch data for turn 5');
			assert(forced.p2, `p2 should have forced switch: ${JSON.stringify(forced)}`);
		});

		it('turn 6 should have p1 forced switch (Farigiraf fainted)', function () {
			const forced = choices.forcedSwitches[5]; // index 5 = turn 6
			assert(forced, 'Should have forced switch data for turn 6');
			assert(forced.p1, `p1 should have forced switch: ${JSON.stringify(forced)}`);
		});

		it('turn 7 should have p1 forced switch (Incineroar fainted)', function () {
			const forced = choices.forcedSwitches[6]; // index 6 = turn 7
			assert(forced, 'Should have forced switch data for turn 7');
			assert(forced.p1, `p1 should have forced switch: ${JSON.stringify(forced)}`);
		});
	});

	// -- Summary output --
	describe('state summary', function () {
		it('should log all turns for visual inspection', function () {
			for (let t = 1; t <= 8; t++) {
				if (!battle.stateByTurn[t]) {
					console.log(`    Turn ${t}: MISSING`);
					continue;
				}
				try {
					const state = getStateFromSerialized(battle.stateByTurn[t]);
					console.log(`    Turn ${t}:`);
					console.log(formatState(state));
				} catch (e) {
					console.log(`    Turn ${t}: DESERIALIZATION ERROR: ${e.message}`);
				}
			}
		});
	});
});
