import assert from "node:assert/strict";
import fs from "node:fs";
import {
  makeGeometry,makeBoard,emptyBank,newPlayer,gameInvariantReport,
  BOT_DIFFICULTY_CONFIG,botDifficultyProfile,aiPlan,devDeck,
  canPay,legalSettlement,legalRoad,settlementConnected,canBuyDevelopmentCard,canPlayDevelopmentCard
} from "./logic-core.mjs";

const geo=makeGeometry();
const profiles=["Easy","Medium","Hard","Impossible"].map(botDifficultyProfile);
assert.deepEqual(profiles.map(x=>x.lookaheadTop),[2,3,4,6]);
assert.ok(profiles[0].noise>profiles[3].noise);
assert.ok(profiles[0].responseWeight<profiles[3].responseWeight);
assert.equal(BOT_DIFFICULTY_CONFIG.Impossible.noise,0);

for(let i=0;i<80;i++){
  const board=makeBoard(geo,{highPipsTouch:false});
  const players=[
    newPlayer(0,"You",false,"Human"),
    newPlayer(1,"Bot",true,"Impossible"),
    newPlayer(2,"Bot2",true,"Medium"),
    newPlayer(3,"Bot3",true,"Easy")
  ];
  const fresh=gameInvariantReport(players,board,emptyBank(),devDeck(),geo);
  assert.equal(fresh.ok,true,fresh.errors.join("; "));
  players[0].hand.wood=2;
  const bank={...emptyBank(),wood:17};
  assert.equal(gameInvariantReport(players,board,bank,devDeck(),geo).ok,true);
  assert.equal(gameInvariantReport(players,board,{...bank,wood:18},devDeck(),geo).ok,false);
}

const src=fs.readFileSync(new URL("../src/main.jsx",import.meta.url),"utf8");
const css=fs.readFileSync(new URL("../src/style.css",import.meta.url),"utf8");
for(const term of [
  "BOT_DIFFICULTY_CONFIG","botDifficultyProfile","difficultyScore",
  "ENGINE INTEGRITY WARNING","engineActionBreakdown","engineMoveCard",
  "engineAnalysisHero","colonistTradeHub","YOUR RATES","colonistTradeTabs"
]) assert.ok(src.includes(term),term);
for(const term of [
  ".hxIntegrityBanner",".engineAnalysisHero",".engineMoveCard",".engineBreakdown",
  ".colonistTradeHub",".colonistTradeTabs",".tradeArrow"
]) assert.ok(css.includes(term),term);

function checkPlan(plan,p,players,board){
  assert.ok(plan&&plan.type,"planner returned no action");
  if(plan.type==="settlement"){
    assert.ok(legalSettlement(plan.spot,players,geo),"planner proposed illegal settlement");
    assert.ok(settlementConnected(plan.spot,p,geo),"planner proposed disconnected settlement");
    assert.ok(canPay(p.hand,{wood:1,brick:1,sheep:1,wheat:1}),"settlement was unaffordable");
  }else if(plan.type==="road"){
    assert.ok(legalRoad(plan.spot,p,players,geo),"planner proposed illegal road");
    assert.ok(canPay(p.hand,{wood:1,brick:1}),"road was unaffordable");
  }else if(plan.type==="city"){
    assert.ok(p.settlements.includes(plan.spot),"planner proposed city on non-settlement");
    assert.ok(canPay(p.hand,{wheat:2,ore:3}),"city was unaffordable");
  }else if(plan.type==="buyDev"){
    assert.ok(canBuyDevelopmentCard(p,[],{} )||canPay(p.hand,{sheep:1,wheat:1,ore:1}),"dev action affordability mismatch");
  }else if(plan.type==="play"){
    assert.ok(canPlayDevelopmentCard(plan.card,p,{devPlayed:false,boughtCards:{}}),"planner proposed unplayable dev card");
  }
}

let totalMs1v1=0,totalMs4p=0;
for(let i=0;i<30;i++){
  const board=makeBoard(geo,{highPipsTouch:false});
  const ps=[newPlayer(0,"A",true,i%2?"Hard":"Impossible"),newPlayer(1,"B",true,"Medium")];
  ps[0].settlements=[0];ps[1].settlements=[25];
  ps.forEach(p=>p.hand={wood:3,brick:3,sheep:3,wheat:3,ore:3});
  const t=Date.now();
  const plan=aiPlan(ps[0],ps,board,geo,devDeck(),[],15,emptyBank(),{roadOwner:null,armyOwner:null},{botAutoplay:true,deadline:Infinity,failedActionKeys:new Set(),strategicPlan:null});
  totalMs1v1+=Date.now()-t;
  checkPlan(plan,ps[0],ps,board);
}
for(let i=0;i<30;i++){
  const board=makeBoard(geo,{highPipsTouch:false});
  const ps=[
    newPlayer(0,"A",true,"Impossible"),newPlayer(1,"B",true,"Hard"),
    newPlayer(2,"C",true,"Medium"),newPlayer(3,"D",true,"Easy")
  ];
  ps[0].settlements=[0];ps[1].settlements=[25];ps[2].settlements=[5];ps[3].settlements=[45];
  ps.forEach(p=>p.hand={wood:3,brick:3,sheep:3,wheat:3,ore:3});
  const t=Date.now();
  const plan=aiPlan(ps[0],ps,board,geo,devDeck(),[],10,emptyBank(),{roadOwner:null,armyOwner:null},{botAutoplay:true,deadline:Infinity,failedActionKeys:new Set(),strategicPlan:null});
  totalMs4p+=Date.now()-t;
  checkPlan(plan,ps[0],ps,board);
}
assert.ok(totalMs1v1<12000,"1v1 planner too slow: "+totalMs1v1+"ms");
assert.ok(totalMs4p<12000,"4-player planner too slow: "+totalMs4p+"ms");
console.log("PHASE 1-3 REGRESSION PASSED — invariants, difficulty tiers, legal bot actions, trade/analysis hooks, 30x 1v1 + 30x 4-player planner positions.");
