import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
let ts;
try{ts=require('typescript');}catch{ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');}
import assert from 'node:assert/strict';

const src=fs.readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
const prefix=src.slice(0,src.indexOf('function App(){')).replace(/^import[^\n]+\n/gm,'');
const transpiled=ts.transpileModule(prefix,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const req=name=>name==='react/jsx-runtime'?{jsx(){return null},jsxs(){return null},Fragment:Symbol('fragment')}:{useState(){},useEffect(){},useMemo(){},useRef(){}};
const ctx={console,performance,Date,Math,Set,Map,Object,Array,JSON,Number,String,Infinity,exports:{},module:{exports:{}},require:req,window:{setTimeout(){},clearTimeout(){}},document:{}};
vm.createContext(ctx);
vm.runInContext(`${transpiled}\nthis.api={makeGeometry,makeBoard,makePorts,emptyBank,newPlayer,bestOpeningPair,bestOpeningCompanion,buildStrategicPlan,nearPerfectBotPlan,botModeConfig,devDeck};`,ctx,{timeout:20000});
const a=ctx.api;
const geo=a.makeGeometry();
const ms=()=>performance.now();

function makeScenario(fourPlayer=false){
  const board=a.makeBoard(geo,{highPipsTouch:false});
  const ports=a.makePorts(geo),bank=a.emptyBank();
  const bot=a.newPlayer(1,'Bot',true,'Impossible');
  const human=a.newPlayer(0,'You',false,'Human');
  bot.hand={wood:2,brick:2,sheep:2,wheat:2,ore:2};
  bot.settlements=[0];bot.roads=[geo.vertexEdges[0][0]];
  human.settlements=[25];
  if(!fourPlayer)return {board,ports,bank,bot,players:[human,bot],targetVP:15};
  const b2=a.newPlayer(2,'Bot2',true,'Hard'),b3=a.newPlayer(3,'Bot3',true,'Hard');
  b2.settlements=[20];b3.settlements=[35];
  b2.roads=[geo.vertexEdges[20]?.[0]??0];b3.roads=[geo.vertexEdges[35]?.[0]??1];
  b2.hand={wood:2,brick:2,sheep:2,wheat:2,ore:2};b3.hand={wood:2,brick:2,sheep:2,wheat:2,ore:2};
  return {board,ports,bank,bot,players:[human,bot,b2,b3],targetVP:10};
}

for(const fourPlayer of [false,true]){
  const s=makeScenario(fourPlayer);
  let t=ms();
  const pair=a.bestOpeningPair(s.bot,s.players,s.board,geo,s.ports,s.bank,s.targetVP,320);
  const opening=ms()-t;
  assert(pair&&Number.isFinite(pair.score),'opening search returned no valid result');
  t=ms();
  const plan=a.buildStrategicPlan(s.bot,s.players,s.board,geo,s.ports,s.bank,s.targetVP,null);
  const planning=ms()-t;
  assert(plan&&plan.type,'strategic planner returned no objective');
  const decisionTimes=[];
  for(let i=0;i<3;i++){
    const turn={botAutoplay:true,deadline:ms()+4500,strategicPlan:plan,botRoadsThisTurn:0,failedActionKeys:new Set(),devPlayed:false,boughtCards:{},heldAwards:{roadOwner:null,armyOwner:null},memorySnapshots:[],scoreCache:null};
    t=ms();
    const decision=a.nearPerfectBotPlan(s.bot,s.players,s.board,geo,s.ports,s.bank,a.devDeck(),s.targetVP,{},turn);
    const dt=ms()-t;
    assert(decision&&decision.type,'bot decision search returned no move');
    decisionTimes.push(dt);
  }
  const worst=Math.max(...decisionTimes),sum=decisionTimes.reduce((x,y)=>x+y,0);
  // Leave substantial headroom for React/UI updates, action execution, and yielding.
  assert(opening<750,`opening placement search exceeded 750ms: ${opening.toFixed(1)}ms`);
  assert(planning<500,`strategic planning exceeded 500ms: ${planning.toFixed(1)}ms`);
  assert(worst<1500,`single bot decision exceeded 1500ms: ${worst.toFixed(1)}ms`);
  assert(sum<4000,`three consecutive decision searches exceeded 4s: ${sum.toFixed(1)}ms`);
  console.log(`V76 PERFORMANCE PASSED — ${fourPlayer?'4-player':'1v1'} opening ${opening.toFixed(1)}ms, plan ${planning.toFixed(1)}ms, decisions max ${worst.toFixed(1)}ms, 3x total ${sum.toFixed(1)}ms`);
}