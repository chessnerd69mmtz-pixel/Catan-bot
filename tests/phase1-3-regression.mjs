import assert from "node:assert/strict";
import fs from "node:fs";
import {makeGeometry,makeBoard,emptyBank,newPlayer,gameInvariantReport,BOT_DIFFICULTY_CONFIG,botDifficultyProfile,aiPlan,devDeck} from "./logic-core.mjs";
const geo=makeGeometry();
const profiles=["Easy","Medium","Hard","Impossible"].map(botDifficultyProfile);
assert.deepEqual(profiles.map(x=>x.lookaheadTop),[2,3,4,6]);
assert.ok(profiles[0].noise>profiles[3].noise);
assert.ok(profiles[0].responseWeight<profiles[3].responseWeight);
assert.equal(BOT_DIFFICULTY_CONFIG.Impossible.noise,0);
for(let i=0;i<80;i++){
  const board=makeBoard(geo,{highPipsTouch:false});
  const players=[newPlayer(0,"You",false,"Human"),newPlayer(1,"Bot",true,"Impossible"),newPlayer(2,"Bot2",true,"Medium"),newPlayer(3,"Bot3",true,"Easy")];
  const fresh=gameInvariantReport(players,board,emptyBank(),devDeck(),geo);
  assert.equal(fresh.ok,true,fresh.errors.join("; "));
  players[0].hand.wood=2;
  const bank={...emptyBank(),wood:17};
  assert.equal(gameInvariantReport(players,board,bank,devDeck(),geo).ok,true);
  assert.equal(gameInvariantReport(players,board,{...bank,wood:18},devDeck(),geo).ok,false);
}
const src=fs.readFileSync(new URL("../src/main.jsx",import.meta.url),"utf8");
const css=fs.readFileSync(new URL("../src/style.css",import.meta.url),"utf8");
for(const term of ["BOT_DIFFICULTY_CONFIG","botDifficultyProfile","difficultyScore","ENGINE INTEGRITY WARNING","engineActionBreakdown","engineMoveCard","engineAnalysisHero","colonistTradeHub"])
  assert.ok(src.includes(term),term);
for(const term of [".hxIntegrityBanner",".engineAnalysisHero",".engineMoveCard",".engineBreakdown",".colonistTradeHub",".colonistTradeTabs"])
  assert.ok(css.includes(term),term);
let totalMs=0;
for(let i=0;i<30;i++){
  const board=makeBoard(geo,{highPipsTouch:false});
  const ps=[newPlayer(0,"A",true,i%2?"Hard":"Impossible"),newPlayer(1,"B",true,"Medium")];
  ps[0].settlements=[0];ps[1].settlements=[25];
  ps.forEach(p=>p.hand={wood:2,brick:2,sheep:2,wheat:2,ore:2});
  const t=Date.now();
  const plan=aiPlan(ps[0],ps,board,geo,devDeck(),[],15,emptyBank(),{roadOwner:null,armyOwner:null},{botAutoplay:true,deadline:Infinity,failedActionKeys:new Set(),strategicPlan:null});
  totalMs+=Date.now()-t;
  assert.ok(plan&&plan.type);
}
assert.ok(totalMs<12000,"planner too slow: "+totalMs+"ms");
console.log("PHASE 1-3 REGRESSION PASSED — "+totalMs+"ms for 30 planner positions.");
