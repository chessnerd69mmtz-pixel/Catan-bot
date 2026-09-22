import assert from "node:assert/strict";
import {randomHeldResourceByCard} from "./logic-core.mjs";
const source={wood:4,brick:0,sheep:0,wheat:1,ore:0};
const seq=Array.from({length:1000},(_,i)=>(i+.5)/1000);
const counts={wood:0,wheat:0};
for(const x of seq){const stolen=randomHeldResourceByCard(source,()=>x);assert(stolen==="wood"||stolen==="wheat");counts[stolen]++;}
assert.equal(counts.wood,800);
assert.equal(counts.wheat,200);
assert.equal(randomHeldResourceByCard({wood:0,brick:0,sheep:0,wheat:0,ore:0},()=>.5),null);
console.log("ROBBER TEST PASSED — weighted random physical-card theft.");
