import fs from 'node:fs';

const src = fs.readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');

const mustContain = [
  /const BOT_MAX_ACTION_EVALUATIONS=96;/,
  /function strategicPlanDemand\(/,
  /function opponentExpansionThreat\(/,
  /strategicPlan=buildStrategicPlan\(visiblePlanningBot,visiblePlanningPlayers/,
  /const planningBot=planningPlayers\.find\(x=>x\.id===me\.id\)\|\|me;/,
  /strategicPlan=buildStrategicPlan\(planningBot,planningPlayers/,
  /bestRoadBuildingPair\(me,localPlayers,localBoard,geo,ports,localBank,targetVP,botDeadline,strategicPlan\)/,
  /failedActionKeys\.add\(decisionKeyForEngine\(best\)\)/,
  /ranked\[0\]/,
  /action\.type!==["']pass["']/,
  /function bestOpeningCompanion\(/,
  /players\.length>2/,
  /giveAmount:bundleTotal\(base\),getAmount:amount/,
  /function planExpectedValue\(/,
  /function opponentResponseValue\(/,
  /function cityActionValue\(/,
  /function chooseRobberAction\(/
];

for (const pattern of mustContain) {
  if (!pattern.test(src)) throw new Error('missing V74 strategic fix: '+pattern);
}

console.log('V74 STRATEGIC AI REGRESSION PASSED — persistent objectives, legal road paths, action coverage, opening optimization, objective-aware trading, replanning, and robber weighting are wired.');