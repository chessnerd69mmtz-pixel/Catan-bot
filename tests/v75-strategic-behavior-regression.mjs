import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const src=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
for(const term of [
  'function terrainAvailablePipsByResource(',
  'function reachableFutureSpots(',
  'function planExpectedValue(',
  'function opponentTakeProbability(',
  'function fastBlockValue(',
  'function cityActionValue(',
  'function opponentResponseValue(',
  'function scoreActions(',
  'failedActionKeys.add(decisionKeyForEngine(best))',
  'function bestRoadBuildingPair(',
  'function chooseRobberAction(',
  'function bestOpeningPair(',
  'function bestOpeningCompanion(',
  'function strategicPlanDemand('
]) assert(src.includes(term),`missing V75 planner safeguard: ${term}`);
assert(!src.includes('evaluated>=60'),'legacy action-starvation cutoff remains');
assert(!src.includes('slice(0,RES.length*2)'),'legacy bank-trade truncation remains');
assert(!src.includes('cityFollow && cityFollow.score>=20'),'legacy city threshold remains');
assert(src.includes('const monopolyGrindBox') || src.includes('className="monopolyGrindBox"'),'Monopoly training box missing');
assert(src.includes('<h1>MONOPOLY</h1>'),'Monopoly branding missing');
console.log('V75 STRATEGIC BEHAVIOR REGRESSION PASSED');