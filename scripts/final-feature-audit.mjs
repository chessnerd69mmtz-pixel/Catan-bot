import fs from 'node:fs';
import assert from 'node:assert/strict';
import { cardProbabilities, COLONIST_BASE_RULES, legalSettlement, legalRoad, connectedRoadLength } from '../tests/logic-core.mjs';

const main = fs.readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

const mustContain = [
  ['turn base timer', 'TURN_BASE_SECONDS=45'],
  ['per-action timer extension', 'ACTION_TIME_BONUS_SECONDS=30'],
  ['bot hard budget', 'BOT_MAX_TURN_MS=4500'],
  ['1v1 15 VP', 'targetVP:15'],
  ['4-player 10 VP', 'targetVP:10'],
  ['1v1 discard threshold', 'discardIfHandOver:9'],
  ['4-player discard threshold', 'discardIfHandOver:7'],
  ['history analyzer blunder scale', 'BLUNDER'],
  ['history analyzer brilliant scale', 'BRILLIANT'],
  ['year of plenty pair search', 'bestYearOfPlentyPair'],
  ['monopoly target analysis', 'bestMonopolyTarget'],
  ['road-building pair search', 'bestRoadBuildingPair'],
  ['hidden opponent resources', 'RESOURCE TYPES HIDDEN'],
  ['buy development', 'Buy Dev'],
  ['direct settlement build', 'buildSettlement(v)'],
  ['direct city build', 'buildCity(v)'],
  ['direct road build', 'buildRoad(eid)'],
  ['draw offer', 'DRAW OFFER'],
  ['resign', 'resignMatch'],
  ['three-turn live log', 'turnNumber-2'],
  ['bot roll panel state', 'lastBotRoll'],
  ['theme selector', 'themeSwatches'],
  ['music setting', 'musicToggle'],
];
for (const [label, needle] of mustContain) assert.ok(main.includes(needle), `${label}: missing '${needle}'`);
assert.ok(css.includes('.hxLog') || css.includes('.history'), 'log/history styling missing');
assert.equal(COLONIST_BASE_RULES.standard.targetVP, 10);
assert.equal(COLONIST_BASE_RULES.ranked1v1.targetVP, 15);
assert.equal(COLONIST_BASE_RULES.ranked1v1.discardIfHandOver, 9);

const freshDeck = [];
for (const [card, n] of Object.entries({Knight:14,'Road Building':2,'Year of Plenty':2,Monopoly:2,'Victory Point':5})) {
  for (let i=0;i<n;i++) freshDeck.push(card);
}
const probs = cardProbabilities(freshDeck);
assert(Math.abs(probs['Year of Plenty'].prob - 2/25) < 1e-12, 'Year of Plenty probability mismatch');
assert(Math.abs(probs.Monopoly.prob - 2/25) < 1e-12, 'Monopoly probability mismatch');
assert(Math.abs(probs['Victory Point'].prob - 5/25) < 1e-12, 'Victory Point probability mismatch');


const v68Must = [
  ['4-player setup transaction guard','expectedPid=setupOrder[setupIndex]'],
  ['setup completion validation','setupComplete=nextPlayers.every(pl=>pl.settlements.length===2&&pl.roads.length===2)'],
  ['dev card direct deck draw','const card=deck[deck.length-1]'],
  ['multiple dev purchase counter','devCardsBought'],
  ['pre-roll non-vp protection','if(!isVP&&!hasRolled)'],
  ['road building done control','DONE ROAD BUILDING'],
  ['bot planner deadline road guard','deadline-90'],
  ['lazy board analysis','if(!analysisMode||!board||!active)return[]'],
  ['cached trade card utility','cachedCardUtility'],
  ['reduced autoplay trade generation','const autoplay=!!turnState.botAutoplay'],
];
for (const [label, needle] of v68Must) assert.ok(main.includes(needle), `${label}: missing '${needle}'`);
assert.ok(!main.includes('BOT_DRAW_THRESHOLD'), 'obsolete bot draw-offer logic present');
assert.ok(!main.includes('BOT_DRAW_COOLDOWN_TURNS'), 'obsolete bot draw cooldown present');
assert.ok(!main.includes("'  const currentValue=0"), 'stray syntax artifact present');

console.log('FINAL FEATURE AUDIT PASSED');
console.log('Checked: modes, timer, history analyzer, direct building, hidden opponent resources, dev-card analysis hooks, draw/resign, bot roll, logs, theme/music, and deck probabilities.');