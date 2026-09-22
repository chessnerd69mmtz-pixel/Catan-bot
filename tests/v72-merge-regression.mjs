import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {pipelineComboBonus,comboHitProbability,comboCompletionValue,BuildingDemand,makeGeometry,makeBoard,empty,emptyBank,newPlayer,chooseRobberAction} from "./logic-core.mjs";

const main=readFileSync(new URL("../src/main.jsx",import.meta.url),"utf8");
assert(main.includes("strategicPlansRef"),"V71 persistent strategic planner missing");
assert(main.includes("failedActionKeys.add(decisionKeyForEngine(best))"),"action blacklist/replanning missing");
assert(main.includes("pipelineComboBonus"),"combo planner not merged");
assert(main.includes("comboCompletionValue"),"trade combo completion not merged");
assert(main.includes('className="monopolyGrindBox"'),"Monopoly training box missing");
assert(!main.includes("<h1>HEXBOUND</h1>"),"old visible HEXBOUND brand remains");
assert(main.includes("<h1>MONOPOLY</h1>"),"Monopoly home brand missing");

const both=pipelineComboBonus({wood:.12,brick:.12,wheat:.08,ore:.08,sheep:.08},{wood:.10,brick:.10,wheat:.10,ore:.10,sheep:.10},true);
const weak=pipelineComboBonus({wheat:.12},{wheat:.10},true);
assert(both>weak,"combo pipeline should value complete resource coverage");

const p=newPlayer(0,"Bot",true,"Hard");
p.settlements=[0]; p.cities=[]; p.hand={wood:0,brick:0,wheat:1,ore:2,sheep:0};
const players=[p,newPlayer(1,"Opponent",true,"Hard"),newPlayer(2,"Opponent2",true,"Hard"),newPlayer(3,"Opponent3",true,"Hard")];
const demand=BuildingDemand(p,{key:"standard4p10"});
assert(demand.wood>0&&demand.brick>0&&demand.wheat>0&&demand.ore>0&&demand.sheep>0,"mode-aware building demand malformed");

const geo=makeGeometry(); const board=makeBoard(geo,{highPipsTouch:false});
const verts=[0]; const hit=comboHitProbability(verts,board,geo); assert(hit>=0&&hit<=1,"hit probability invalid");
const comboValue=comboCompletionValue({ore:2,wheat:1,wood:0,brick:0,sheep:0},{ore:3,wheat:2,wood:0,brick:0,sheep:0},p,players); assert(comboValue>0,"resource-to-build completion value missing");

const robber=chooseRobberAction(p,players,board,geo,[],emptyBank(),10,{roadOwner:null,armyOwner:null});
assert(robber===null || Number.isFinite(robber.score),"robber scorer malformed");
console.log("V72 MERGE REGRESSION PASSED");