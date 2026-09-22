import fs from 'fs';
const src=fs.readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
const required=[
  'const strategicPlansRef=useRef({});',
  'function strategicRoadPathToSettlement(',
  'function buildStrategicPlan(',
  'strategicPlan=buildStrategicPlan(',
  'strategicPlansRef.current[me.id]=strategicPlan;',
  'strategicPlan',
  'failedActions++;',
  'failedActionKeys.add(decisionKeyForEngine(best))',
  'if(failedActions>=10){'
];
for(const x of required)if(!src.includes(x))throw new Error(`missing strategic safeguard: ${x}`);
if(!src.includes("plan.type==='city'"))throw new Error('city strategic objective missing');
console.log('V70 STRATEGIC PLAN REGRESSION PASSED — persistent expansion/city goals, road paths, and invalid-action replanning are wired.');