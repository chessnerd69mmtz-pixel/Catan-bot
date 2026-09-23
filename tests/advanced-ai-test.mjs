import assert from "node:assert/strict";
import {
  ADVANCED_AI_VERSION,
  BOT_PERSONALITIES,
  defaultEloStore,
  applyEloGame,
  eloRows,
  personalityActionBias,
  rankMonteCarloPlacements,
  monteCarloPlacement
} from "../src/advanced-ai.mjs";
import {makeGeometry, makeBoard, newPlayer} from "./logic-core.mjs";

assert.equal(ADVANCED_AI_VERSION, "advanced-catan-ai-v1");
assert.equal(Object.keys(BOT_PERSONALITIES).length, 5, "Advanced AI should expose five personalities");

const geo=makeGeometry();
const board=makeBoard(geo,{highPipsTouch:false});
const maya=newPlayer(1,"Maya",true,"Hard");
maya.personality="balanced";
const rook=newPlayer(2,"Rook",true,"Hard");
rook.personality="expansionist";
const players=[maya,rook];

const biasA=personalityActionBias("balanced",{type:"road"},maya,{board,geo,players});
const biasB=personalityActionBias("expansionist",{type:"road"},rook,{board,geo,players});
assert.notEqual(biasA,biasB,"Personalities must alter action evaluation");

const legal=rankMonteCarloPlacements({
  board,
  player:maya,
  players,
  geo,
  targetCount:5,
  turns:6,
  samples:12,
  personalityId:"balanced",
  ports:[]
});
assert(legal.length>0,"Monte Carlo placement ranking returned no legal placements");
assert(legal.every(x=>Number.isFinite(x.mean)&&Number.isFinite(x.p10)&&Number.isFinite(x.p90)),"Monte Carlo scores must be finite");
const single=monteCarloPlacement({
  vertex:legal[0].vertex,
  board,
  player:maya,
  geo,
  turns:4,
  samples:8,
  personalityId:"balanced",
  seed:1234
});
assert(single.samples===8&&Number.isFinite(single.mean),"Single placement rollout failed");

const game={
  gameId:"advanced-ai-test-1",
  result:"win",
  winnerId:0,
  players:[
    {id:0,name:"You",bot:false},
    {id:1,name:"Maya",bot:true,personality:"balanced"},
    {id:2,name:"Rook",bot:true,personality:"expansionist"},
    {id:3,name:"Nova",bot:true,personality:"trader"}
  ]
};
const store=defaultEloStore();
const applied=applyEloGame(game,store);
assert(applied.applied,"ELO game was not applied");
assert(applied.changes.human>0,"Winning human should gain ELO");
assert(applied.changes.balanced<0,"Losing balanced bot should lose ELO");
const again=applyEloGame(game,applied.store);
assert.equal(again.applied,false,"Same game must not alter ELO twice");
const rows=eloRows(applied.store);
assert(rows.some(x=>x.key==="human"&&x.rating!==1200),"Human ELO row missing");
assert(rows.some(x=>x.key==="balanced"&&x.games===1),"Bot ELO row missing");

console.log("ADVANCED AI TESTS PASSED");
