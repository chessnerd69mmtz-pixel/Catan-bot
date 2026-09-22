import assert from "node:assert/strict";
import {makeGeometry,resolveRobberSteal,empty,emptyBank} from "./logic-core.mjs";

const geo=makeGeometry();
const board=Array.from({length:19},(_,i)=>({resource:"wood",number:8,robber:i===0}));
const touching=geo.vertexTiles[0][0];
const thief={id:1,name:"Thief",settlements:[],cities:[],roads:[],hand:{wood:1,brick:0,sheep:0,wheat:0,ore:0}};
const victim={id:2,name:"Victim",settlements:[touching],cities:[],roads:[],hand:{wood:2,brick:0,sheep:0,wheat:0,ore:0}};
const other={id:3,name:"Other",settlements:[],cities:[],roads:[],hand:{wood:5,brick:0,sheep:0,wheat:0,ore:0}};
const result=resolveRobberSteal([thief,victim,other],board,geo,1,0,()=>0);
assert.equal(result.valid,true);
assert.equal(result.victim.id,2);
assert.equal(result.stolen,"wood");
assert.equal(result.players.find(p=>p.id===1).hand.wood,2);
assert.equal(result.players.find(p=>p.id===2).hand.wood,1);
assert.equal(result.players.find(p=>p.id===3).hand.wood,5);
console.log("ROBBER STEAL REGRESSION PASSED — only a player touching the robber destination can lose a card");