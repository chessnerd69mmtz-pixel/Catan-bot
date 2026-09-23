import assert from "node:assert/strict";
import {evaluateState,classifyMove,computePlayerAnalysis,WEIGHTS,MOVE_LABELS} from "../src/analysis-engine.mjs";

const geo={
  vertices:Array.from({length:6},(_,i)=>({x:i,y:i})),
  vertexTiles:[[0],[0],[1],[1],[2],[2]],
  neighbors:[[1],[2],[0],[4],[3],[0]],
  vertexEdges:[[0],[1],[0],[2],[2],[3]],
  edges:[{id:0,a:0,b:1},{id:1,a:0,b:2},{id:2,a:3,b:4},{id:3,a:4,b:5}]
};
const board=[
  {resource:"wood",number:6,robber:false},
  {resource:"wheat",number:8,robber:false},
  {resource:"desert",number:null,robber:false}
];
const base={players:[
  {id:0,name:"A",vp:3,settlements:[0],cities:[],roads:[0],hand:{wood:1,brick:1,sheep:1,wheat:1,ore:0},development:{Knight:0,"Road Building":0,"Year of Plenty":0,Monopoly:0,"Victory Point":0}},
  {id:1,name:"B",vp:2,settlements:[3],cities:[],roads:[2],hand:{wood:0,brick:1,sheep:1,wheat:1,ore:1},development:{Knight:1,"Road Building":0,"Year of Plenty":0,Monopoly:0,"Victory Point":0}}
],board,geo,ports:[],targetVP:10};
const odds=evaluateState(base);
const totalProb=Object.values(odds).reduce((a,b)=>a+b,0);
assert(Math.abs(totalProb-1)<1e-9,"softmax probabilities must sum to 1");
assert.deepEqual(Object.keys(WEIGHTS).sort(),["w1","w2","w3","w4","w5","w6","w7","w8","w9"].sort());

for(const label of MOVE_LABELS)assert(label,"label exists");
assert.equal(classifyMove({move:{type:"city"},before:.4,after:.4,bestAfter:.404,gameWinning:false}).label,"excellent");
assert.equal(classifyMove({move:{type:"city"},before:.4,after:.352,bestAfter:.4,gameWinning:false}).label,"inaccuracy");
assert.equal(classifyMove({move:{type:"city"},before:.4,after:.2,bestAfter:.4,gameWinning:false}).label,"blunder");
assert.equal(classifyMove({move:{type:"playerTrade"},before:.4,after:.61,bestAfter:.61,gameWinning:true}).label,"brilliant");

const evals=[
  {moveId:"1",playerId:0,equityLossPct:.2,label:"excellent"},
  {moveId:"2",playerId:0,equityLossPct:2,label:"good"},
  {moveId:"3",playerId:0,equityLossPct:10,label:"mistake"},
  {moveId:"4",playerId:1,equityLossPct:20,label:"blunder"}
];
const a=computePlayerAnalysis(0,evals);
const b=computePlayerAnalysis(1,evals);
assert(a.accuracy>=0&&a.accuracy<=100,"accuracy must be bounded");
assert(b.accuracy>=0&&b.accuracy<=100,"accuracy must be bounded");
assert(a.avgEquityLossPct>0);
assert.equal(a.moveCounts.excellent,1);
console.log("CATAN ANALYSIS ENGINE TESTS PASSED");
