import assert from "node:assert/strict";

const RES=["wood","brick","sheep","wheat","ore"];
function stealOneRandom(hand, rng){
  const held=RES.filter(r=>(hand[r]||0)>0);
  assert(held.length>0,"victim should hold at least one resource");
  const stolen=held[Math.floor(rng()*held.length)];
  return {stolen,hand:{...hand,[stolen]:hand[stolen]-1}};
}

// Physical robber behavior: steal exactly ONE card of ONE resource type chosen at random.
const source={wood:3,brick:2,sheep:1,wheat:4,ore:2};
const seen=new Set();
for(let i=0;i<500;i++){
  const before=RES.reduce((n,r)=>n+source[r],0);
  const {stolen,hand}=stealOneRandom(source,()=>Math.random());
  const after=RES.reduce((n,r)=>n+hand[r],0);
  assert.equal(before-after,1,"robber must steal exactly one card");
  assert.equal(hand[stolen],source[stolen]-1,"robber removes one card from the selected resource type");
  for(const r of RES){
    if(r!==stolen)assert.equal(hand[r],source[r],`robber should not remove other resources (${r})`);
  }
  seen.add(stolen);
}
assert.ok(seen.size>=3,"random resource selection should be able to produce different resource types");
console.log("ROBBER TEST PASSED — exactly one random resource card is stolen");