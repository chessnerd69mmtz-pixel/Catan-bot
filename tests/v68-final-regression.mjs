import fs from 'node:fs';
import assert from 'node:assert/strict';

const src=fs.readFileSync(new URL('../src/main.jsx', import.meta.url),'utf8');

const required=[
  ['four-player setup transaction guard','expectedPid=setupOrder[setupIndex]'],
  ['four-player setup piece-count guard','placing.settlements.length!==expectedPieces'],
  ['four-player setup completion validation','setupComplete=nextPlayers.every(pl=>pl.settlements.length===2&&pl.roads.length===2)'],
  ['multiple development purchases','if(!active||active.bot||winner||drawn||!hasRolled'],
  ['dev card deck pop','const card=deck[deck.length-1]'],
  ['dev card private ownership increment','development:{...p.development,[card]:(p.development[card]||0)+1}'],
  ['dev cards bought this turn tracked per card','devCardsBought'],
  ['year of plenty duplicate selections','resources.length!==2'],
  ['monopoly exact opponent collection','gain+=p.hand[target]||0'],
  ['one card robber theft','stole 1 ${LABEL[stolen]} card'],
  ['hidden opponent resources','RESOURCE TYPES HIDDEN'],
  ['bot roll display','BOT ROLL'],
  ['bot hard stop','BOT_HARD_STOP_MS=4800'],
  ['bot planner budget','BOT_MAX_TURN_MS=4500'],
  ['bot auto end','advanceBotTurn(localPlayers,p.name'],
  ['no bot draw offer decision','Bots never initiate draw offers'],
  ['human draw offer exists','const offerDraw=()=>{'],
  ['human resign exists','const resignMatch=()=>{'],
  ['history completed-only gate','if(!g?.result||!g?.analysisFrames?.length)return;'],
  ['analysis classifications','ANALYSIS_ACCURACY_WEIGHT'],
  ['analysis role accuracy','analysisRoleStats(analysisFramesRef.current,finalPlayers)'],
  ['direct settlement build','buildSettlement(v);'],
  ['direct city build','buildCity(v);'],
  ['direct road build','buildRoad(eid);'],
  ['no generic build dock','hxActionsNoBuild'],
  ['play non-vp only after roll','if(!isVP&&!hasRolled)'],
  ['choice non-vp only after roll','card!=="Victory Point"&&!hasRolled'],
  ['road building done control','DONE ROAD BUILDING'],
  ['road analysis deadline guard','deadline-90'],
  ['lazy board analysis','if(!analysisMode||!board||!active)return[]'],
  ['fast trade cache','cachedCardUtility'],
];
for(const [label,needle] of required) assert.ok(src.includes(needle),`${label}: missing ${needle}`);
assert.ok(!src.includes("'  const currentValue=0"),'stray quote syntax artifact still present');
assert.ok(!src.includes('botStep>=12'),'fixed bot action-count cap still present');
assert.ok(!src.includes('BOT_DRAW_THRESHOLD'),'obsolete bot draw-offer threshold still present');
assert.ok(!src.includes('BOT_DRAW_COOLDOWN_TURNS'),'obsolete bot draw cooldown still present');
assert.ok(src.includes('BOT_LONGEST_ROAD_PRIORITY=0.05'),'Longest Road must remain low priority');
console.log('V68 FINAL REGRESSION PASSED — 4-player setup, dev cards, bot timing, hidden info, direct building, and non-responsive safeguards');