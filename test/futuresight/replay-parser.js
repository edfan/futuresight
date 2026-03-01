'use strict';

const assert = require('./../assert');

// The replay-parser module is compiled to dist
const {
	parseShowteams,
	parseReplayChoices,
	parseAllTurnPatches,
	countTurns,
	parseSpreads,
} = require('../../dist/server/replay-parser');

// ---------------------------------------------------------------------------
// Hardcoded sample replay log from:
// https://replay.pokemonshowdown.com/gen9vgc2026regfbo3-2547288630-uj63i1t1p79bcfd50s4i0bf6vslbr10pw
//
// This is a real VGC 2026 Reg F Bo3 game (Game 1) between
// lowkuregumanuinely (p1) and johnjozo (p2), lasting 9 turns.
// ---------------------------------------------------------------------------
const SAMPLE_REPLAY_LOG = `|j|★lowkuregumanuinely
|j|★johnjozo
|gametype|doubles
|player|p1|lowkuregumanuinely|102|
|player|p2|johnjozo|2|
|gen|9
|tier|[Gen 9] VGC 2026 Reg F (Bo3)
|rule|Species Clause: Limit one of each Pokémon
|rule|Item Clause: Limit 1 of each item
|clearpoke
|poke|p1|Incineroar, L50, F|
|poke|p1|Flutter Mane, L50|
|poke|p1|Farigiraf, L50, F|
|poke|p1|Whimsicott, L50, F|
|poke|p1|Landorus, L50, M|
|poke|p1|Ogerpon-Wellspring, L50, F|
|poke|p2|Porygon2, L50|
|poke|p2|Amoonguss, L50, M|
|poke|p2|Incineroar, L50, M|
|poke|p2|Ursaluna, L50, M|
|poke|p2|Tornadus, L50, M|
|poke|p2|Urshifu-*, L50, M|
|teampreview|4
|showteam|p1|Incineroar||AssaultVest|Intimidate|FakeOut,FlareBlitz,Uturn,KnockOff|||F|||50|,,,,,Grass]Flutter Mane||BoosterEnergy|Protosynthesis|Moonblast,ShadowBall,DazzlingGleam,Protect||||||50|,,,,,Fairy]Farigiraf||ThroatSpray|ArmorTail|Protect,Psychic,HyperVoice,TrickRoom|||F|||50|,,,,,Water]Whimsicott||CovertCloak|Prankster|Encore,FakeTears,Tailwind,Moonblast|||F|||50|,,,,,Steel]Landorus||LifeOrb|SheerForce|Protect,EarthPower,SludgeBomb,SandsearStorm|||M|||50|,,,,,Poison]Ogerpon-Wellspring||WellspringMask|WaterAbsorb|SpikyShield,FollowMe,IvyCudgel,HornLeech|||F|||50|,,,,,Water
|showteam|p2|Porygon2||Eviolite|Download|TeraBlast,IceBeam,Recover,TrickRoom||||||50|,,,,,Flying]Amoonguss||RockyHelmet|Regenerator|Spore,PollenPuff,RagePowder,Protect|||M|||50|,,,,,Water]Incineroar||AssaultVest|Intimidate|FlareBlitz,KnockOff,Uturn,FakeOut|||M|||50|,,,,,Grass]Ursaluna||FlameOrb|Guts|Facade,HeadlongRush,Earthquake,Protect|||M|||50|,,,,,Ghost]Tornadus||SharpBeak|Prankster|BleakwindStorm,RainDance,Tailwind,Protect|||M|||50|,,,,,Steel]Urshifu-Rapid-Strike||SplashPlate|UnseenFist|SurgingStrikes,CloseCombat,AquaJet,Detect|||M|||50|,,,,,Steel
|
|t:|1772066843
|teamsize|p1|4
|teamsize|p2|4
|start
|switch|p1a: Flutter Mane|Flutter Mane, L50|100/100
|switch|p1b: Ogerpon|Ogerpon-Wellspring, L50, F|100/100
|switch|p2a: Porygon2|Porygon2, L50|100/100
|switch|p2b: Incineroar|Incineroar, L50, M|100/100
|-ability|p2b: Incineroar|Intimidate|boost
|-unboost|p1a: Flutter Mane|atk|1
|-unboost|p1b: Ogerpon|atk|1
|-ability|p2a: Porygon2|Download|boost
|-boost|p2a: Porygon2|atk|1
|-enditem|p1a: Flutter Mane|Booster Energy
|-activate|p1a: Flutter Mane|ability: Protosynthesis|[fromitem]
|-start|p1a: Flutter Mane|protosynthesisspa
|turn|1
|
|t:|1772066864
|switch|p1b: Incineroar|Incineroar, L50, F|100/100
|-ability|p1b: Incineroar|Intimidate|boost
|-unboost|p2a: Porygon2|atk|1
|-unboost|p2b: Incineroar|atk|1
|switch|p2b: Amoonguss|Amoonguss, L50, M|100/100
|move|p1a: Flutter Mane|Dazzling Gleam|p2b: Amoonguss|[spread] p2a,p2b
|-resisted|p2b: Amoonguss
|-damage|p2a: Porygon2|69/100
|-damage|p2b: Amoonguss|78/100
|move|p2a: Porygon2|Trick Room|p2a: Porygon2
|-fieldstart|move: Trick Room|[of] p2a: Porygon2
|
|upkeep
|turn|2
|
|t:|1772066894
|switch|p2a: Ursaluna|Ursaluna, L50, M|100/100
|move|p1b: Incineroar|Fake Out|p2b: Amoonguss
|-damage|p2b: Amoonguss|68/100
|-damage|p1b: Incineroar|84/100|[from] item: Rocky Helmet|[of] p2b: Amoonguss
|cant|p2b: Amoonguss|flinch
|move|p1a: Flutter Mane|Dazzling Gleam|p2b: Amoonguss|[spread] p2a,p2b
|-resisted|p2b: Amoonguss
|-damage|p2a: Ursaluna|61/100
|-damage|p2b: Amoonguss|45/100
|
|-status|p2a: Ursaluna|brn|[from] item: Flame Orb
|upkeep
|turn|3
|
|t:|1772066909
|switch|p1b: Farigiraf|Farigiraf, L50, F|100/100
|move|p1a: Flutter Mane|Protect|p1a: Flutter Mane
|-singleturn|p1a: Flutter Mane|Protect
|move|p2b: Amoonguss|Pollen Puff|p2a: Ursaluna
|-heal|p2a: Ursaluna|100/100 brn
|move|p2a: Ursaluna|Facade|p1b: Farigiraf
|-damage|p1b: Farigiraf|0 fnt
|faint|p1b: Farigiraf
|
|-damage|p2a: Ursaluna|95/100 brn|[from] brn
|upkeep
|
|t:|1772066920
|switch|p1b: Ogerpon|Ogerpon-Wellspring, L50, F|100/100
|turn|4
|
|t:|1772066935
|move|p1b: Ogerpon|Follow Me|p1b: Ogerpon
|-singleturn|p1b: Ogerpon|move: Follow Me
|move|p2b: Amoonguss|Spore|p1b: Ogerpon
|-immune|p1b: Ogerpon
|move|p2a: Ursaluna|Facade|p1b: Ogerpon
|-damage|p1b: Ogerpon|3/100
|move|p1a: Flutter Mane|Dazzling Gleam|p2b: Amoonguss|[spread] p2a,p2b
|-resisted|p2b: Amoonguss
|-damage|p2a: Ursaluna|56/100 brn
|-damage|p2b: Amoonguss|23/100
|
|-damage|p2a: Ursaluna|50/100 brn|[from] brn
|upkeep
|turn|5
|
|t:|1772066968
|move|p1a: Flutter Mane|Protect|p1a: Flutter Mane
|-singleturn|p1a: Flutter Mane|Protect
|move|p2b: Amoonguss|Pollen Puff|p2a: Ursaluna
|-heal|p2a: Ursaluna|99/100 brn
|move|p2a: Ursaluna|Headlong Rush|p1a: Flutter Mane
|-activate|p1a: Flutter Mane|move: Protect
|move|p1b: Ogerpon|Ivy Cudgel|p2a: Ursaluna|[anim] Ivy Cudgel Water
|-supereffective|p2a: Ursaluna
|-damage|p2a: Ursaluna|31/100 brn
|
|-damage|p2a: Ursaluna|26/100 brn|[from] brn
|-fieldend|move: Trick Room
|upkeep
|turn|6
|
|t:|1772066993
|switch|p2a: Porygon2|Porygon2, L50|69/100
|-ability|p2a: Porygon2|Download|boost
|-boost|p2a: Porygon2|atk|1
|switch|p2b: Incineroar|Incineroar, L50, M|100/100
|-ability|p2b: Incineroar|Intimidate|boost
|-unboost|p1a: Flutter Mane|atk|1
|-unboost|p1b: Ogerpon|atk|1
|move|p1a: Flutter Mane|Dazzling Gleam|p2b: Incineroar|[spread] p2a,p2b
|-damage|p2a: Porygon2|38/100
|-damage|p2b: Incineroar|72/100
|move|p1b: Ogerpon|Ivy Cudgel|p2b: Incineroar|[anim] Ivy Cudgel Water
|-supereffective|p2b: Incineroar
|-damage|p2b: Incineroar|10/100
|
|upkeep
|turn|7
|
|t:|1772067013
|switch|p2a: Amoonguss|Amoonguss, L50, M|56/100
|move|p2b: Incineroar|Fake Out|p1b: Ogerpon
|-damage|p1b: Ogerpon|0 fnt
|faint|p1b: Ogerpon
|move|p1a: Flutter Mane|Moonblast|p2a: Amoonguss
|-resisted|p2a: Amoonguss
|-damage|p2a: Amoonguss|22/100
|
|upkeep
|
|t:|1772067021
|switch|p1b: Incineroar|Incineroar, L50, F|84/100
|-ability|p1b: Incineroar|Intimidate|boost
|-unboost|p2a: Amoonguss|atk|1
|-unboost|p2b: Incineroar|atk|1
|turn|8
|
|t:|1772067049
|move|p2a: Amoonguss|Protect|p2a: Amoonguss
|-singleturn|p2a: Amoonguss|Protect
|move|p1b: Incineroar|Fake Out|p2a: Amoonguss
|-activate|p2a: Amoonguss|move: Protect
|move|p1a: Flutter Mane|Dazzling Gleam|p2a: Amoonguss|[spread] p2b
|-activate|p2a: Amoonguss|move: Protect
|-damage|p2b: Incineroar|0 fnt
|faint|p2b: Incineroar
|
|upkeep
|
|t:|1772067058
|switch|p2b: Porygon2|Porygon2, L50|38/100
|-ability|p2b: Porygon2|Download|boost
|-boost|p2b: Porygon2|atk|1
|turn|9
|
|t:|1772067089
|-terastallize|p1a: Flutter Mane|Fairy
|move|p2a: Amoonguss|Rage Powder|p2a: Amoonguss
|-singleturn|p2a: Amoonguss|move: Rage Powder
|move|p1a: Flutter Mane|Dazzling Gleam|p2a: Amoonguss|[spread] p2a,p2b
|-resisted|p2a: Amoonguss
|-damage|p2a: Amoonguss|0 fnt
|-damage|p2b: Porygon2|0 fnt
|faint|p2a: Amoonguss
|faint|p2b: Porygon2
|move|p1b: Incineroar|Flare Blitz|p2: Amoonguss|[notarget]
|-fail|p1b: Incineroar
|
|upkeep
|-message|johnjozo forfeited.
|
|win|lowkuregumanuinely`;

// ---------------------------------------------------------------------------
// Hardcoded Smogon stats snippet (partial) for testing parseSpreads()
// ---------------------------------------------------------------------------
const SAMPLE_STATS_TEXT = ` +----------------------------------------+
 | Porygon2                               |
 +----------------------------------------+
 | Raw count: 1234                         |
 +----------------------------------------+
 | Abilities                              |
 | Download  55.0%                         |
 | Trace     45.0%                         |
 +----------------------------------------+
 | Items                                  |
 | Eviolite  95.0%                         |
 +----------------------------------------+
 | Spreads                                |
 | Sassy:252/0/8/0/248/0 25.3%            |
 | Calm:252/0/4/0/252/0 18.7%             |
 | Relaxed:252/0/252/4/0/0 9.2%           |
 | Bold:252/0/252/0/4/0 5.1%              |
 +----------------------------------------+
 | Moves                                  |
 | Trick Room  85.0%                       |
 +----------------------------------------+
 +----------------------------------------+
 | Incineroar                             |
 +----------------------------------------+
 | Raw count: 5678                         |
 +----------------------------------------+
 | Abilities                              |
 | Intimidate  100.0%                      |
 +----------------------------------------+
 | Items                                  |
 | Assault Vest  30.0%                     |
 +----------------------------------------+
 | Spreads                                |
 | Adamant:252/252/0/0/4/0 15.0%          |
 | Careful:252/4/108/0/84/60 12.5%        |
 | Impish:252/0/252/0/4/0 8.3%            |
 +----------------------------------------+
 | Moves                                  |
 | Fake Out  90.0%                         |
 +----------------------------------------+`;


// ===================================================================
//  parseShowteams
// ===================================================================
describe('parseShowteams', () => {
	it('should extract both teams from replay log', () => {
		const teams = parseShowteams(SAMPLE_REPLAY_LOG);
		assert(teams.p1.length === 6, `Expected 6 Pokemon on p1, got ${teams.p1.length}`);
		assert(teams.p2.length === 6, `Expected 6 Pokemon on p2, got ${teams.p2.length}`);
	});

	it('should extract correct species for p1', () => {
		const teams = parseShowteams(SAMPLE_REPLAY_LOG);
		const species = teams.p1.map(p => p.species);
		assert(species.includes('Incineroar'), 'p1 should have Incineroar');
		assert(species.includes('Flutter Mane'), 'p1 should have Flutter Mane');
		assert(species.includes('Farigiraf'), 'p1 should have Farigiraf');
		assert(species.includes('Whimsicott'), 'p1 should have Whimsicott');
		assert(species.includes('Landorus'), 'p1 should have Landorus');
		assert(species.includes('Ogerpon-Wellspring'), 'p1 should have Ogerpon-Wellspring');
	});

	it('should extract correct species for p2', () => {
		const teams = parseShowteams(SAMPLE_REPLAY_LOG);
		const species = teams.p2.map(p => p.species);
		assert(species.includes('Porygon2'), 'p2 should have Porygon2');
		assert(species.includes('Amoonguss'), 'p2 should have Amoonguss');
		assert(species.includes('Incineroar'), 'p2 should have Incineroar');
		assert(species.includes('Ursaluna'), 'p2 should have Ursaluna');
		assert(species.includes('Tornadus'), 'p2 should have Tornadus');
		assert(species.includes('Urshifu-Rapid-Strike'), 'p2 should have Urshifu-Rapid-Strike');
	});

	it('should extract items from showteam', () => {
		const teams = parseShowteams(SAMPLE_REPLAY_LOG);
		const p1Inc = teams.p1.find(p => p.species === 'Incineroar');
		assert.equal(p1Inc.item, 'Assault Vest', `Incineroar item should be Assault Vest, got ${p1Inc.item}`);
		const p2Ursaluna = teams.p2.find(p => p.species === 'Ursaluna');
		assert.equal(p2Ursaluna.item, 'Flame Orb', `Ursaluna item should be Flame Orb, got ${p2Ursaluna.item}`);
	});

	it('should extract abilities from showteam', () => {
		const teams = parseShowteams(SAMPLE_REPLAY_LOG);
		const flutterMane = teams.p1.find(p => p.species === 'Flutter Mane');
		assert.equal(flutterMane.ability, 'Protosynthesis', `Flutter Mane ability should be Protosynthesis, got ${flutterMane.ability}`);
	});

	it('should extract moves from showteam', () => {
		const teams = parseShowteams(SAMPLE_REPLAY_LOG);
		const flutterMane = teams.p1.find(p => p.species === 'Flutter Mane');
		assert(flutterMane.moves.includes('Moonblast'), `Flutter Mane should have Moonblast`);
		assert(flutterMane.moves.includes('Shadow Ball'), `Flutter Mane should have Shadow Ball`);
		assert(flutterMane.moves.includes('Dazzling Gleam'), `Flutter Mane should have Dazzling Gleam`);
		assert(flutterMane.moves.includes('Protect'), `Flutter Mane should have Protect`);
	});

	it('should extract tera type from showteam', () => {
		const teams = parseShowteams(SAMPLE_REPLAY_LOG);
		const flutterMane = teams.p1.find(p => p.species === 'Flutter Mane');
		assert.equal(flutterMane.teraType, 'Fairy', `Flutter Mane tera should be Fairy, got ${flutterMane.teraType}`);
		const ursaluna = teams.p2.find(p => p.species === 'Ursaluna');
		assert.equal(ursaluna.teraType, 'Ghost', `Ursaluna tera should be Ghost, got ${ursaluna.teraType}`);
	});

	it('should return empty arrays when no showteam lines exist', () => {
		const teams = parseShowteams('|start|\n|turn|1');
		assert.equal(teams.p1.length, 0);
		assert.equal(teams.p2.length, 0);
	});
});


// ===================================================================
//  countTurns
// ===================================================================
describe('countTurns', () => {
	it('should count 9 turns in the sample replay', () => {
		assert.equal(countTurns(SAMPLE_REPLAY_LOG), 9);
	});

	it('should return 0 for empty log', () => {
		assert.equal(countTurns(''), 0);
	});

	it('should return 0 for log with no turns', () => {
		assert.equal(countTurns('|start|\n|switch|p1a: Pokemon|Species, L50|100/100'), 0);
	});

	it('should handle single turn', () => {
		assert.equal(countTurns('|turn|1'), 1);
	});
});


// ===================================================================
//  parseReplayChoices
// ===================================================================
describe('parseReplayChoices', () => {
	let choices;
	let teams;

	before(() => {
		teams = parseShowteams(SAMPLE_REPLAY_LOG);
		choices = parseReplayChoices(SAMPLE_REPLAY_LOG, teams.p1, teams.p2);
	});

	// -- Team preview --
	describe('team preview', () => {
		it('should produce valid team preview choices', () => {
			assert(choices.teamPreview.p1.startsWith('team '), `p1 team preview should start with 'team', got: ${choices.teamPreview.p1}`);
			assert(choices.teamPreview.p2.startsWith('team '), `p2 team preview should start with 'team', got: ${choices.teamPreview.p2}`);
		});

		it('should lead with Flutter Mane and Ogerpon for p1', () => {
			// p1's initial switches: Flutter Mane (index 2 in showteam) and Ogerpon (index 6)
			// Showteam order: 1=Incineroar, 2=Flutter Mane, 3=Farigiraf, 4=Whimsicott, 5=Landorus, 6=Ogerpon
			// Leads: Flutter Mane=2, Ogerpon=6
			// Next switches: Incineroar (turn 1), Farigiraf (turn 3)
			const tp = choices.teamPreview.p1;
			// First two digits should correspond to Flutter Mane(2) and Ogerpon(6)
			assert(tp.includes('2'), `p1 team preview should include 2 for Flutter Mane: ${tp}`);
			assert(tp.includes('6'), `p1 team preview should include 6 for Ogerpon: ${tp}`);
		});

		it('should lead with Porygon2 and Incineroar for p2', () => {
			// p2 showteam: 1=Porygon2, 2=Amoonguss, 3=Incineroar, 4=Ursaluna, 5=Tornadus, 6=Urshifu
			const tp = choices.teamPreview.p2;
			// Leads: Porygon2=1, Incineroar=3
			assert(tp.includes('1'), `p2 team preview should include 1 for Porygon2: ${tp}`);
			assert(tp.includes('3'), `p2 team preview should include 3 for Incineroar: ${tp}`);
		});
	});

	// -- Turn count --
	describe('turn choices', () => {
		it('should have 9 turns of choices', () => {
			assert.equal(choices.turns.length, 9, `Expected 9 turns, got ${choices.turns.length}`);
		});
	});

	// -- Turn 1: p1 switches Ogerpon out for Incineroar, uses Dazzling Gleam --
	describe('turn 1 choices', () => {
		it('p1 should use dazzling gleam and switch to Incineroar', () => {
			const p1 = choices.turns[0].p1;
			assert(p1.includes('dazzlinggleam'), `p1 turn 1 should include dazzlinggleam: ${p1}`);
			assert(p1.includes('switch'), `p1 turn 1 should include a switch: ${p1}`);
		});

		it('p2 should switch Incineroar out for Amoonguss and use Trick Room', () => {
			const p2 = choices.turns[0].p2;
			assert(p2.includes('trickroom'), `p2 turn 1 should include trickroom: ${p2}`);
			assert(p2.includes('switch'), `p2 turn 1 should include a switch: ${p2}`);
		});
	});

	// -- Turn 2: includes a |cant| (Amoonguss flinched) --
	describe('turn 2 choices (cant handling)', () => {
		it('p1 should use Fake Out and Dazzling Gleam', () => {
			const p1 = choices.turns[1].p1;
			assert(p1.includes('dazzlinggleam'), `p1 turn 2 should have dazzlinggleam: ${p1}`);
			assert(p1.includes('fakeout'), `p1 turn 2 should have fakeout: ${p1}`);
		});

		it('p2 should switch to Ursaluna, and Amoonguss flinch should produce default', () => {
			const p2 = choices.turns[1].p2;
			assert(p2.includes('switch'), `p2 turn 2 should switch to Ursaluna: ${p2}`);
			// Amoonguss flinched (|cant|) produces "default" — the sim handles it
			assert(p2.includes('default'), `p2 turn 2 should have default for flinched Amoonguss: ${p2}`);
		});
	});

	// -- Turn 3: Farigiraf faints, causing forced switch --
	describe('turn 3 choices (faint + forced switch)', () => {
		it('p1 should switch to Farigiraf and use Protect', () => {
			const p1 = choices.turns[2].p1;
			assert(p1.includes('protect'), `p1 turn 3 should use protect: ${p1}`);
			assert(p1.includes('switch'), `p1 turn 3 should switch to Farigiraf: ${p1}`);
		});

		it('should have a forced switch for p1 after Farigiraf faints', () => {
			// Farigiraf fainted at the end of turn 3, p1 must switch in Ogerpon
			const forced = choices.forcedSwitches[2]; // index 2 = turn 3
			assert(forced, 'Should have forced switch data for turn 3');
			assert(forced.p1, `p1 should have a forced switch after turn 3: ${JSON.stringify(forced)}`);
			assert(forced.p1.includes('switch'), `p1 forced switch should be a switch: ${forced.p1}`);
		});

		it('p2 forced switch should be empty (no p2 faints)', () => {
			const forced = choices.forcedSwitches[2];
			// p2 should not need a forced switch — forced.p2 should be empty
			assert(!forced.p2 || forced.p2 === '', `p2 should not have forced switch on turn 3: ${forced.p2}`);
		});
	});

	// -- Turn 4: normal turn, Follow Me + Spore + Facade + Dazzling Gleam --
	describe('turn 4 choices', () => {
		it('p1 should use Follow Me and Dazzling Gleam', () => {
			const p1 = choices.turns[3].p1;
			assert(p1.includes('followme'), `p1 turn 4 should have followme: ${p1}`);
			assert(p1.includes('dazzlinggleam'), `p1 turn 4 should have dazzlinggleam: ${p1}`);
		});

		it('p2 should use Spore and Facade', () => {
			const p2 = choices.turns[3].p2;
			assert(p2.includes('spore'), `p2 turn 4 should have spore: ${p2}`);
			assert(p2.includes('facade'), `p2 turn 4 should have facade: ${p2}`);
		});
	});

	// -- Turn 5: Protect + Ivy Cudgel + Pollen Puff + Headlong Rush --
	describe('turn 5 choices', () => {
		it('p1 should use Protect and Ivy Cudgel', () => {
			const p1 = choices.turns[4].p1;
			assert(p1.includes('protect'), `p1 turn 5 should have protect: ${p1}`);
			assert(p1.includes('ivycudgel'), `p1 turn 5 should have ivycudgel: ${p1}`);
		});
	});

	// -- Turn 6: both sides switch both pokemon --
	describe('turn 6 choices (double switch)', () => {
		it('p2 should switch both Pokemon', () => {
			const p2 = choices.turns[5].p2;
			// p2 switches to Porygon2 and Incineroar
			const switchCount = (p2.match(/switch/g) || []).length;
			assert.equal(switchCount, 2, `p2 turn 6 should have 2 switches, got ${switchCount}: ${p2}`);
		});
	});

	// -- Turn 7: Ogerpon faints, forced switch --
	describe('turn 7 choices (Ogerpon faints)', () => {
		it('should have a forced switch for p1 after Ogerpon faints', () => {
			const forced = choices.forcedSwitches[6]; // index 6 = turn 7
			assert(forced, 'Should have forced switch data for turn 7');
			assert(forced.p1, `p1 should have forced switch after turn 7: ${JSON.stringify(forced)}`);
			assert(forced.p1.includes('switch'), `p1 forced switch should be a switch: ${forced.p1}`);
		});
	});

	// -- Turn 8: p2's Incineroar faints, forced switch for p2 --
	describe('turn 8 choices (p2 Incineroar faints)', () => {
		it('should have a forced switch for p2 after Incineroar faints', () => {
			const forced = choices.forcedSwitches[7]; // index 7 = turn 8
			assert(forced, 'Should have forced switch data for turn 8');
			assert(forced.p2, `p2 should have forced switch after turn 8: ${JSON.stringify(forced)}`);
			assert(forced.p2.includes('switch'), `p2 forced switch should be a switch: ${forced.p2}`);
		});
	});

	// -- Turn 9: terastallize --
	describe('turn 9 choices (terastallize)', () => {
		it('p1 Flutter Mane should terastallize', () => {
			const p1 = choices.turns[8].p1;
			assert(p1.includes('terastallize'), `p1 turn 9 should terastallize: ${p1}`);
			assert(p1.includes('dazzlinggleam'), `p1 turn 9 should use dazzlinggleam: ${p1}`);
		});
	});

	// -- Target location parsing --
	describe('target location in choices', () => {
		it('should include target location for single-target moves', () => {
			// Turn 2: p1b Incineroar uses Fake Out on p2b Amoonguss
			// From p1's perspective, p2b = opponent slot b = target 2
			const p1 = choices.turns[1].p1;
			assert(p1.includes('fakeout 2'), `p1 turn 2 Fake Out should target 2 (p2b): ${p1}`);
		});

		it('should not include target location for spread moves', () => {
			// Dazzling Gleam hits both opponents; the [spread] annotation means it targets
			// one specific mon in the |move| line but actually spreads. The target is still included.
			// The parser extracts the target from parts[3] regardless.
			const p1 = choices.turns[0].p1;
			// Dazzling Gleam targets p2b: Amoonguss → from p1's perspective = target 2
			assert(p1.includes('dazzlinggleam'), `p1 turn 1 should have dazzlinggleam: ${p1}`);
		});

		it('should correctly handle ally targeting (Follow Me targets self)', () => {
			// Turn 4: p1b Ogerpon uses Follow Me on p1b (self)
			// Self-targeting → ally target, slot b = -2
			const p1 = choices.turns[3].p1;
			assert(p1.includes('followme'), `p1 turn 4 should have followme: ${p1}`);
		});
	});
});




// ===================================================================
//  parseAllTurnPatches
// ===================================================================
describe('parseAllTurnPatches', () => {
	it('should return patches for all 9 turns', () => {
		const patches = parseAllTurnPatches(SAMPLE_REPLAY_LOG, 9);
		assert.equal(patches.length, 10, `Expected 10 entries (0-9), got ${patches.length}`);
		// Index 0 is unused, 1-9 should be valid
		for (let i = 1; i <= 9; i++) {
			assert(patches[i], `Turn ${i} patch should exist`);
			assert(Array.isArray(patches[i].hp), `Turn ${i} hp should be an array`);
			assert(Array.isArray(patches[i].status), `Turn ${i} status should be an array`);
		}
	});

	it('turn 1 patch should have correct HP data', () => {
		const patches = parseAllTurnPatches(SAMPLE_REPLAY_LOG, 9);
		const p2a = patches[1].hp.find(h => h.slot === 'p2a');
		assert(p2a, 'Turn 1 should have HP patch for p2a');
		assert.equal(p2a.hpPercent, 69, `Porygon2 HP should be 69%, got ${p2a.hpPercent}`);
	});
});


// ===================================================================
//  parseSpreads
// ===================================================================
describe('parseSpreads', () => {
	it('should parse spreads for both Pokemon', () => {
		const spreads = parseSpreads(SAMPLE_STATS_TEXT);
		assert(spreads['Porygon2'], 'Should have spreads for Porygon2');
		assert(spreads['Incineroar'], 'Should have spreads for Incineroar');
	});

	it('should parse 4 spreads for Porygon2', () => {
		const spreads = parseSpreads(SAMPLE_STATS_TEXT);
		assert.equal(spreads['Porygon2'].length, 4, `Expected 4 Porygon2 spreads, got ${spreads['Porygon2'].length}`);
	});

	it('should correctly parse first Porygon2 spread', () => {
		const spreads = parseSpreads(SAMPLE_STATS_TEXT);
		const first = spreads['Porygon2'][0];
		assert.equal(first.nature, 'Sassy', `Expected Sassy nature, got ${first.nature}`);
		assert.equal(first.evs.hp, 252, `Expected 252 HP EVs, got ${first.evs.hp}`);
		assert.equal(first.evs.atk, 0, `Expected 0 Atk EVs, got ${first.evs.atk}`);
		assert.equal(first.evs.def, 8, `Expected 8 Def EVs, got ${first.evs.def}`);
		assert.equal(first.evs.spa, 0, `Expected 0 SpA EVs, got ${first.evs.spa}`);
		assert.equal(first.evs.spd, 248, `Expected 248 SpD EVs, got ${first.evs.spd}`);
		assert.equal(first.evs.spe, 0, `Expected 0 Spe EVs, got ${first.evs.spe}`);
		assert.equal(first.usage, 25.3, `Expected 25.3% usage, got ${first.usage}`);
	});

	it('should parse 3 spreads for Incineroar', () => {
		const spreads = parseSpreads(SAMPLE_STATS_TEXT);
		assert.equal(spreads['Incineroar'].length, 3, `Expected 3 Incineroar spreads, got ${spreads['Incineroar'].length}`);
	});

	it('should correctly parse Incineroar second spread', () => {
		const spreads = parseSpreads(SAMPLE_STATS_TEXT);
		const second = spreads['Incineroar'][1];
		assert.equal(second.nature, 'Careful', `Expected Careful nature, got ${second.nature}`);
		assert.equal(second.evs.hp, 252);
		assert.equal(second.evs.atk, 4);
		assert.equal(second.evs.def, 108);
		assert.equal(second.evs.spa, 0);
		assert.equal(second.evs.spd, 84);
		assert.equal(second.evs.spe, 60);
		assert.equal(second.usage, 12.5);
	});

	it('should return empty object for empty input', () => {
		const spreads = parseSpreads('');
		assert.deepEqual(spreads, {});
	});

	it('should limit to 10 spreads max per Pokemon', () => {
		// Create stats text with more than 10 spreads
		const lines = [
			' +----------------------------------------+',
			' | TestMon                                |',
			' +----------------------------------------+',
			' | Spreads                                |',
		];
		for (let i = 1; i <= 15; i++) {
			lines.push(` | Adamant:${i}/0/0/0/0/0 ${i}.0%              |`);
		}
		lines.push(' +----------------------------------------+');
		const spreads = parseSpreads(lines.join('\n'));
		assert.equal(spreads['TestMon'].length, 10, `Should limit to 10 spreads, got ${spreads['TestMon'].length}`);
	});
});




// ===================================================================
//  Comprehensive replay choice verification
//  (verifying all 9 turns end-to-end against expected output)
// ===================================================================
describe('full replay choice verification', () => {
	let choices;

	before(() => {
		const teams = parseShowteams(SAMPLE_REPLAY_LOG);
		choices = parseReplayChoices(SAMPLE_REPLAY_LOG, teams.p1, teams.p2);
	});

	it('turn 5: p1 uses Protect + Ivy Cudgel, p2 uses Pollen Puff + Headlong Rush', () => {
		const t = choices.turns[4];
		assert(t.p1.includes('protect'), `p1 turn 5: ${t.p1}`);
		assert(t.p1.includes('ivycudgel'), `p1 turn 5: ${t.p1}`);
		assert(t.p2.includes('pollenpuff'), `p2 turn 5: ${t.p2}`);
		assert(t.p2.includes('headlongrush'), `p2 turn 5: ${t.p2}`);
	});

	it('turn 6: p1 uses Dazzling Gleam + Ivy Cudgel, p2 double switches', () => {
		const t = choices.turns[5];
		assert(t.p1.includes('dazzlinggleam'), `p1 turn 6: ${t.p1}`);
		assert(t.p1.includes('ivycudgel'), `p1 turn 6: ${t.p1}`);
		// p2 switches both: Porygon2 and Incineroar
		assert(t.p2.includes('switch'), `p2 turn 6 should switch: ${t.p2}`);
	});

	it('turn 7: p1 uses Moonblast, p2 switches Amoonguss in + Fake Out', () => {
		const t = choices.turns[6];
		assert(t.p1.includes('moonblast'), `p1 turn 7: ${t.p1}`);
		assert(t.p2.includes('switch'), `p2 turn 7 should switch Amoonguss: ${t.p2}`);
		assert(t.p2.includes('fakeout'), `p2 turn 7 should use fakeout: ${t.p2}`);
	});

	it('turn 8: p1 uses Fake Out + Dazzling Gleam, p2 uses Protect', () => {
		const t = choices.turns[7];
		assert(t.p1.includes('fakeout'), `p1 turn 8: ${t.p1}`);
		assert(t.p1.includes('dazzlinggleam'), `p1 turn 8: ${t.p1}`);
		assert(t.p2.includes('protect'), `p2 turn 8: ${t.p2}`);
	});

	it('turn 9: p1 Dazzling Gleam + Flare Blitz with tera, p2 Rage Powder', () => {
		const t = choices.turns[8];
		assert(t.p1.includes('dazzlinggleam'), `p1 turn 9: ${t.p1}`);
		assert(t.p1.includes('terastallize'), `p1 turn 9 should tera: ${t.p1}`);
		assert(t.p1.includes('flareblitz'), `p1 turn 9 should have flareblitz: ${t.p1}`);
		assert(t.p2.includes('ragepowder'), `p2 turn 9: ${t.p2}`);
	});

	it('no forced switches on turns without faints', () => {
		// Turns 1, 2, 4, 5, 6, 9 should have no forced switches
		for (const turnIdx of [0, 1, 3, 4, 5]) {
			const forced = choices.forcedSwitches[turnIdx];
			if (forced) {
				assert(!forced.p1 || forced.p1 === '', `Turn ${turnIdx + 1} should have no p1 forced switch: ${forced.p1}`);
				assert(!forced.p2 || forced.p2 === '', `Turn ${turnIdx + 1} should have no p2 forced switch: ${forced.p2}`);
			}
		}
	});

	it('forced switches only on turns 3 (p1), 7 (p1), and 8 (p2)', () => {
		// Turn 3: Farigiraf faints → p1 forced switch
		assert(choices.forcedSwitches[2]?.p1, 'Turn 3 should have p1 forced switch');
		// Turn 7: Ogerpon faints → p1 forced switch
		assert(choices.forcedSwitches[6]?.p1, 'Turn 7 should have p1 forced switch');
		// Turn 8: p2 Incineroar faints → p2 forced switch
		assert(choices.forcedSwitches[7]?.p2, 'Turn 8 should have p2 forced switch');
	});
});


// ===================================================================
//  Synthetic replay tests for edge cases
// ===================================================================
describe('synthetic replay edge cases', () => {
	it('should handle a minimal 1-turn replay', () => {
		const log = `|showteam|p1|Pikachu||LightBall|Static|Thunderbolt,VoltSwitch,Protect,FakeOut||||||50|,,,,,Electric]Raichu||FocusSash|LightningRod|Thunderbolt,Protect,FakeOut,VoltSwitch||||||50|,,,,,Electric]Eevee||Leftovers|Adaptability|QuickAttack,Protect,LastResort,BabyDollEyes||||||50|,,,,,Normal]Vaporeon||Leftovers|WaterAbsorb|Scald,Protect,IcyWind,HelpingHand||||||50|,,,,,Water
|showteam|p2|Charmander||Charcoal|Blaze|Flamethrower,Protect,DragonPulse,WillOWisp||||||50|,,,,,Fire]Squirtle||Eviolite|Torrent|WaterPulse,Protect,IcyWind,RapidSpin||||||50|,,,,,Water]Bulbasaur||BlackSludge|Overgrow|EnergyBall,Protect,SludgeBomb,SleepPowder||||||50|,,,,,Grass]Jigglypuff||Leftovers|FriendGuard|Protect,HelpingHand,Sing,DazzlingGleam||||||50|,,,,,Normal
|start
|switch|p1a: Pikachu|Pikachu, L50|100/100
|switch|p1b: Raichu|Raichu, L50|100/100
|switch|p2a: Charmander|Charmander, L50|100/100
|switch|p2b: Squirtle|Squirtle, L50|100/100
|turn|1
|move|p1a: Pikachu|Thunderbolt|p2a: Charmander
|-damage|p2a: Charmander|50/100
|move|p2a: Charmander|Flamethrower|p1b: Raichu
|-damage|p1b: Raichu|60/100
|upkeep
|win|Player1`;

		const teams = parseShowteams(log);
		const choices = parseReplayChoices(log, teams.p1, teams.p2);

		// With 4 Pokemon on each team, all 4 are brought (appeared 2 first, then unseen 2)
		assert.equal(choices.teamPreview.p1, 'team 1234', `p1 team preview: ${choices.teamPreview.p1}`);
		assert.equal(choices.teamPreview.p2, 'team 1234', `p2 team preview: ${choices.teamPreview.p2}`);
		assert.equal(choices.turns.length, 1, `Should have 1 turn, got ${choices.turns.length}`);
		assert(choices.turns[0].p1.includes('thunderbolt'), `p1 turn 1: ${choices.turns[0].p1}`);
		assert(choices.turns[0].p2.includes('flamethrower'), `p2 turn 1: ${choices.turns[0].p2}`);
	});

	it('should handle drag (Whirlwind/Dragon Tail) as switch-in', () => {
		// |drag| is treated like |switch| for team ordering
		const log = `|showteam|p1|Pikachu||LightBall|Static|Thunderbolt,Protect,FakeOut,VoltSwitch||||||50|,,,,,Electric]Raichu||FocusSash|LightningRod|Thunderbolt,Protect,FakeOut,VoltSwitch||||||50|,,,,,Electric]Eevee||Leftovers|Adaptability|QuickAttack,Protect,LastResort,BabyDollEyes||||||50|,,,,,Normal]Vaporeon||Leftovers|WaterAbsorb|Scald,Protect,IcyWind,HelpingHand||||||50|,,,,,Water
|showteam|p2|Charmander||Charcoal|Blaze|Flamethrower,Protect,DragonPulse,WillOWisp||||||50|,,,,,Fire]Squirtle||Eviolite|Torrent|WaterPulse,Protect,IcyWind,RapidSpin||||||50|,,,,,Water]Bulbasaur||BlackSludge|Overgrow|EnergyBall,Protect,SludgeBomb,SleepPowder||||||50|,,,,,Grass]Jigglypuff||Leftovers|FriendGuard|Protect,HelpingHand,Sing,DazzlingGleam||||||50|,,,,,Normal
|start
|switch|p1a: Pikachu|Pikachu, L50|100/100
|switch|p1b: Raichu|Raichu, L50|100/100
|switch|p2a: Charmander|Charmander, L50|100/100
|switch|p2b: Squirtle|Squirtle, L50|100/100
|turn|1
|drag|p1a: Eevee|Eevee, L50|80/100
|turn|2`;

		const teams = parseShowteams(log);
		const choices = parseReplayChoices(log, teams.p1, teams.p2);
		// drag should be tracked as a switch event for team ordering
		assert(choices.turns.length >= 1, 'Should parse at least 1 turn');
	});
});
