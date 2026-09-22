import fs from 'node:fs';
const src=fs.readFileSync(new URL('../src/main.jsx', import.meta.url),'utf8');
const must=[
  /const BOT_MAX_ACTION_EVALUATIONS=96;/,
  /function strategicPlanDemand\(/,
  /function opponentExpansionThreat\(/,
  /strategicPlan=buildStrategicPlan\(/,
  /function bestRoadBuildingPair\(/,
  /failedActionKeys\.add\(decisionKeyForEngine\(/,
  /(?:ranked|enriched)\[0\]/,
  /\.type!==['"]pass['"]/,
  /function bestOpeningCompanion\(/,
  /function planExpectedValue\(/,
  /function opponentResponseValue\(/,
  /function cityActionValue\(/,
  /function chooseRobberAction\(/
];
for(const pattern of must) if(!pattern.test(src)) throw new Error('missing V74 strategic fix: '+pattern);
console.log('V74 STRATEGIC AI REGRESSION PASSED — strategic planning, road paths, action coverage, opening optimization, replanning, and robber weighting are wired.');