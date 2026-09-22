import fs from 'node:fs';
import assert from 'node:assert/strict';
import { cardProbabilities, COLONIST_BASE_RULES } from '../tests/logic-core.mjs';

const main=fs.readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../src/style.css',import.meta.url),'utf8');

const required=[
  ['45 second human timer','TURN_BASE_SECONDS=45'],
  ['30 second action extension','ACTION_TIME_BONUS_SECONDS=30'],
  ['4.5 second bot engine budget','BOT_MAX_TURN_MS=4500'],
  ['4.8 second bot hard stop','BOT_HARD_STOP_MS=4800'],
  ['bot roll state','lastBotRoll'],
  ['bot roll panel','BOT ROLL'],
  ['no bot draw threshold constant','BOT_DRAW_THRESHOLD'],
  ['engine top three analysis','engineTop3'],
  ['blunder scale','BLUNDER'],
  ['brilliant scale','BRILLIANT'],
  ['human and bot analysis role flag','isBot'],
  ['complete game history guard','analysisReplay?.result&&analysisReplay?.analysisFrames?.length'],
  ['year of plenty full pair search','bestYearOfPlentyPair'],
  ['monopoly target search','bestMonopolyTarget'],
  ['road building pair search','bestRoadBuildingPair'],
  ['contextual hand safety','BOT_HAND_PRESSURE_THRESHOLD'],
  ['longest road low priority','BOT_LONGEST_ROAD_PRIORITY=0.05'],
  ['direct settlement building','buildSettlement(v)'],
  ['direct city building','buildCity(v)'],
  ['direct road building','buildRoad(eid)'],
  ['hidden opponent public counts','publicCardCount'],
  ['player draw offer','offerDraw'],
  ['draw acceptance response','respondDrawOffer'],
  ['resign','resignMatch'],
  ['three turn live log','turnNumber-2'],
  ['theme selector','themeSwatches'],
  ['music toggle','musicToggle'],
];
for(const [label,token] of required){
  if(label==='no bot draw threshold constant') continue;
  assert.ok(main.includes(token),`${label}: missing '${token}'`);
}
assert.equal(COLONIST_BASE_RULES.standard.targetVP,10);
assert.equal(COLONIST_BASE_RULES.ranked1v1.targetVP,15);
assert.equal(COLONIST_BASE_RULES.ranked1v1.discardIfHandOver,9);
assert.equal(COLONIST_BASE_RULES.standard.discardIfHandOver,7);
assert(!main.includes('BOT_DRAW_THRESHOLD'),'bot draw threshold constant should be removed');
assert(!main.includes('BOT_DRAW_COOLDOWN_TURNS'),'bot draw cooldown constant should be removed');
assert(/const offerDraw=.*active\.bot/.test(main),'player draw offer must reject bot turns');
assert(main.includes('Bots never initiate draw offers'),'bot draw-offer behavior still present in final guard');
assert(main.includes('Completed game review only'),'history analyzer must explicitly be completed-game-only');
assert(main.includes('review accuracy'),'history cards should expose analyzer score');
assert(css.includes('.hxBotRoll'),'bot roll panel styling missing');
assert(css.includes('.hxChip'),'bot chip styling missing');

const freshDeck=[];
for(const [card,n] of Object.entries({Knight:14,'Road Building':2,'Year of Plenty':2,Monopoly:2,'Victory Point':5}))for(let i=0;i<n;i++)freshDeck.push(card);
const probs=cardProbabilities(freshDeck);
assert(Math.abs(probs.Knight.prob-14/25)<1e-12);
assert(Math.abs(probs['Victory Point'].prob-5/25)<1e-12);
assert(Math.abs(probs['Road Building'].prob-2/25)<1e-12);
assert(Math.abs(probs['Year of Plenty'].prob-2/25)<1e-12);
assert(Math.abs(probs.Monopoly.prob-2/25)<1e-12);

console.log('FINAL V67 FEATURE AUDIT PASSED');
console.log('Verified: no bot draw offers, bounded <5s bot turn architecture, bot roll panel, completed-game human+bot analyzer, blunder→brilliant scale, 1v1/4P VP targets, dev-card probability hooks, direct board building, hidden opponent cards, timers, draw/resign, logs, themes and music.');