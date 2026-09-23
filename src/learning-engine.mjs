/* Safe self-learning layer for Catan Bot.
 * User feedback is treated as a hypothesis, never as an instruction to override the engine.
 * A lesson enters bot knowledge only after the analysis engine shows a statistically
 * significant improvement over the current best move in the same position.
 */

import { benchmarkCandidateAgainstBest, actionDecisionKey } from "./analysis-engine.mjs";

export const LEARNING_ENGINE_VERSION = "catan-safe-learning-v1";
export const LEARNING_STORAGE_KEY = "catan.safeLearning.v1";
const ACTION_TYPES = ["settlement","city","road","trade","buyDev","play"];

function safeClone(value){
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
function safeRead(storage,key,fallback){
  try{
    const raw=storage?.getItem(key);
    if(!raw)return fallback;
    const parsed=JSON.parse(raw);
    return parsed ?? fallback;
  }catch{return fallback}
}
function safeWrite(storage,key,value){
  try{
    storage?.setItem(key,JSON.stringify(value));
    return true;
  }catch{return false}
}
function clamp(value,min,max){return Math.max(min,Math.min(max,value));}

function hashString(input){
  let h=2166136261;
  for(let i=0;i<input.length;i++){
    h^=input.charCodeAt(i);
    h=Math.imul(h,16777619);
  }
  return (h>>>0).toString(16).padStart(8,"0");
}

function publicPlayer(p,focusId){
  return {
    id:p?.id,
    vp:Number(p?.vp||0),
    settlements:[...(p?.settlements||[])],
    cities:[...(p?.cities||[])],
    roads:[...(p?.roads||[])],
    hand:String(p?.id)===String(focusId)?{...(p?.hand||{})}:undefined,
    development:String(p?.id)===String(focusId)?{...(p?.development||{})}:undefined,
    bot:!!p?.bot,
    personality:p?.personality||null
  };
}

export function learningStateFingerprint(state,playerId){
  const payload={
    targetVP:Number(state?.targetVP||10),
    activePlayerId:playerId,
    board:(state?.board||[]).map(t=>[t?.resource||null,t?.number??null,!!t?.robber]),
    ports:(state?.ports||[]).map(p=>[p?.edge,p?.type,p?.a,p?.b]),
    players:(state?.players||[]).map(p=>publicPlayer(p,playerId))
  };
  return hashString(JSON.stringify(payload));
}

function productionForVertex(state,vertex){
  let score=0;
  const pip={2:1,3:2,4:3,5:4,6:5,8:5,9:4,10:3,11:2,12:1};
  for(const tid of state?.geo?.vertexTiles?.[vertex]||[]){
    const tile=state?.board?.[tid];
    if(tile&&tile.resource!=="desert"&&!tile.robber)score+=pip[tile.number]||0;
  }
  return score;
}
function playerProduction(state,p){
  let score=0;
  for(const v of p?.settlements||[])score+=productionForVertex(state,v);
  for(const v of p?.cities||[])score+=productionForVertex(state,v)*2;
  return score;
}
function diversityAtVertex(state,vertex){
  const found=new Set();
  for(const tid of state?.geo?.vertexTiles?.[vertex]||[]){
    const tile=state?.board?.[tid];
    if(tile&&tile.resource!=="desert")found.add(tile.resource);
  }
  return found.size;
}
function actionIndex(type){const index=ACTION_TYPES.indexOf(type);return index<0?ACTION_TYPES.length:index;}

export function learningFeatures(state,playerId,action={}){
  const players=state?.players||[];
  const p=players.find(x=>String(x.id)===String(playerId))||{};
  const target=Math.max(1,Number(state?.targetVP||10));
  const hand=Object.values(p.hand||{}).reduce((a,b)=>a+Number(b||0),0);
  const prod=playerProduction(state,p);
  const visibleVP=Number(p.vp||0);
  const maxOpp=Math.max(0,...players.filter(x=>String(x.id)!==String(playerId)).map(x=>Number(x.vp||0)));
  const ownPieces=(p.settlements?.length||0)+(p.cities?.length||0);
  const maxRoad=Math.max(0,...players.map(x=>(x.roads||[]).length));
  const maxCity=Math.max(0,...players.map(x=>(x.cities||[]).length));
  const spot=Number.isInteger(action.spot)?action.spot:null;
  const spotProd=spot==null?0:productionForVertex(state,spot);
  const spotDiv=spot==null?0:diversityAtVertex(state,spot);
  const ownedPorts=(state?.ports||[]).filter(port=>(p.settlements||[]).concat(p.cities||[]).some(v=>v===port.a||v===port.b)).length;
  const type=String(action.type||"");
  return [
    1,
    type==="settlement"?1:0,
    type==="city"?1:0,
    type==="road"?1:0,
    type==="trade"?1:0,
    type==="buyDev"?1:0,
    type==="play"?1:0,
    clamp(prod/30,0,2),
    clamp(hand/15,0,2),
    clamp(visibleVP/target,0,1.5),
    clamp((visibleVP-maxOpp)/target,-1,1),
    clamp(ownPieces/8,0,1.5),
    clamp((p.roads?.length||0)/15,0,1),
    clamp(maxRoad/15,0,1),
    clamp((p.cities?.length||0)/4,0,1),
    clamp(maxCity/4,0,1),
    clamp(ownedPorts/3,0,1),
    clamp(spotProd/25,0,1.5),
    clamp(spotDiv/5,0,1),
    clamp(actionIndex(type)/ACTION_TYPES.length,0,1)
  ];
}

function subtract(a,b){return a.map((x,i)=>x-(b[i]||0));}
function dot(a,b){let total=0;for(let i=0;i<Math.min(a.length,b.length);i++)total+=a[i]*b[i];return total;}

export function defaultLearningStore(){
  return {
    version:1,
    engineVersion:LEARNING_ENGINE_VERSION,
    lessons:[],
    model:{weights:Array(20).fill(0),bias:0,learningRate:.08,steps:0},
    stats:{accepted:0,rejected:0,lastAcceptedAt:null,lastImprovement:0}
  };
}

export function loadLearningStore(storage=typeof localStorage!=="undefined"?localStorage:null){
  const base=defaultLearningStore();
  const stored=safeRead(storage,LEARNING_STORAGE_KEY,null);
  if(!stored||typeof stored!=="object")return base;
  return {
    ...base,
    ...stored,
    lessons:Array.isArray(stored.lessons)?stored.lessons.slice(-200):[],
    stats:{...base.stats,...(stored.stats||{})},
    model:{...base.model,...(stored.model||{}),weights:Array.isArray(stored.model?.weights)?stored.model.weights.slice(0,20):base.model.weights}
  };
}
export function saveLearningStore(store,storage=typeof localStorage!=="undefined"?localStorage:null){
  return safeWrite(storage,LEARNING_STORAGE_KEY,store);
}
export function clearLearningStore(storage=typeof localStorage!=="undefined"?localStorage:null){
  try{storage?.removeItem(LEARNING_STORAGE_KEY);return true}catch{return false}
}

export function trainLearningModel(store){
  const next=safeClone(store||defaultLearningStore());
  const lessons=Array.isArray(next.lessons)?next.lessons:[];
  const weights=Array.isArray(next.model?.weights)&&next.model.weights.length===20?[...next.model.weights]:Array(20).fill(0);
  const learningRate=Number(next.model?.learningRate)||.08;
  const epochs=Math.min(80,Math.max(8,lessons.length*2));
  for(let epoch=0;epoch<epochs;epoch++){
    for(const lesson of lessons){
      const diff=lesson.featureDelta||[];
      const target=Number(lesson.meanImprovement||0);
      if(!diff.length||!Number.isFinite(target))continue;
      const prediction=dot(diff,weights);
      const error=target-prediction;
      for(let i=0;i<weights.length;i++)weights[i]+=learningRate*error*(diff[i]||0);
      const norm=weights.reduce((a,v)=>a+v*v,0);
      if(norm>100){const scale=Math.sqrt(100/norm);for(let i=0;i<weights.length;i++)weights[i]*=scale;}
    }
  }
  next.model={...next.model,weights,steps:Number(next.model?.steps||0)+lessons.length*epochs};
  return next;
}

export function parseFeedbackSuggestion(text,state,playerId){
  const raw=String(text||"").trim();
  const lower=raw.toLowerCase();
  if(!raw)return{ok:false,reason:"Enter a concrete suggested move."};
  const num=(pattern)=>{
    const m=lower.match(pattern);
    return m?Number(m[1]):null;
  };
  let spot=num(/(?:settlement|city)(?:\s+(?:at|on|intersection))?\s+#?\s*(\d+)/i);
  if(/\bsettlement\b/i.test(raw)&&Number.isInteger(spot))return{ok:true,action:{type:"settlement",spot,playerId},confidence:.98,interpretation:`Settlement at intersection ${spot}`};
  spot=num(/\bcity\b(?:\s+(?:at|on|intersection))?\s+#?\s*(\d+)/i);
  if(/\bcity\b/i.test(raw)&&Number.isInteger(spot))return{ok:true,action:{type:"city",spot,playerId},confidence:.98,interpretation:`City at intersection ${spot}`};
  spot=num(/\broad\b(?:\s+(?:at|on|edge))?\s*#?\s*(\d+)/i);
  if(/\broad\b/i.test(raw)&&Number.isInteger(spot))return{ok:true,action:{type:"road",spot,playerId},confidence:.98,interpretation:`Road on edge ${spot}`};
  if(/\b(?:buy|purchase)\b.*\b(?:development|dev)\b|\bbuy\s+(?:a\s+)?card\b/i.test(raw))return{ok:true,action:{type:"buyDev",playerId},confidence:.96,interpretation:"Buy a development card"};
  const cards=["Knight","Road Building","Year of Plenty","Monopoly","Victory Point"];
  const card=cards.find(name=>lower.includes(name.toLowerCase()));
  if(/\bplay\b/i.test(raw)&&card)return{ok:true,action:{type:"play",card,playerId},confidence:.96,interpretation:`Play ${card}`};
  const resources=["wood","brick","sheep","wheat","ore"];
  const trade=lower.match(/(?:trade|give|exchange)\s+(?:\d+\s+)?(wood|brick|sheep|wheat|ore)\s+(?:for|to|get|->)\s+(wood|brick|sheep|wheat|ore)/i);
  if(trade){
    return{ok:true,action:{type:"trade",give:trade[1],get:trade[2],playerId},confidence:.9,interpretation:`Trade ${trade[1]} for ${trade[2]} at the legal bank rate`};
  }
  return{ok:false,reason:"I could not convert the feedback into a concrete legal move. Use a form such as “settlement at 17”, “road 42”, “city at 9”, “buy development”, “play Knight”, or “trade wood for wheat”."};
}

export function reviewFeedback(text,{state,playerId,samples=64,horizon=6,seed=20260923}={}){
  const parsed=parseFeedbackSuggestion(text,state,playerId);
  if(!parsed.ok)return{accepted:false,parsed,reason:parsed.reason};
  const benchmark=benchmarkCandidateAgainstBest(state,parsed.action,{samples,horizon,seed,minImprovement:.01});
  return {
    ...parsed,
    benchmark,
    accepted:!!benchmark.accepted,
    reason:benchmark.reason,
    currentBest:benchmark.bestMove||null,
    improvementPct:Number(benchmark.improvementPct||0),
    confidenceLowerPct:Number(benchmark.confidenceLower||0)*100,
    confidenceUpperPct:Number(benchmark.confidenceUpper||0)*100
  };
}

export function acceptFeedbackLesson(text,{state,playerId,review,source="user-feedback",storage=typeof localStorage!=="undefined"?localStorage:null}={}){
  if(!review?.accepted||!review.benchmark?.accepted)return{accepted:false,store:loadLearningStore(storage)};
  const store=loadLearningStore(storage);
  const candidate=review.benchmark.candidate;
  const baseline=review.benchmark.bestMove;
  const candidateFeatures=learningFeatures(state,playerId,candidate);
  const baselineFeatures=learningFeatures(state,playerId,baseline);
  const lesson={
    id:`lesson-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
    stateKey:learningStateFingerprint(state,playerId),
    playerId,
    action:safeClone(candidate),
    baseline:safeClone(baseline),
    featureDelta:subtract(candidateFeatures,baselineFeatures),
    meanImprovement:Number(review.benchmark.meanImprovement||0),
    confidenceLower:Number(review.benchmark.confidenceLower||0),
    samples:Number(review.benchmark.samples||0),
    feedback:String(text||"").trim().slice(0,1000),
    source,
    acceptedAt:Date.now()
  };
  const next={...store,lessons:[...(store.lessons||[]),lesson].slice(-200)};
  next.stats={...next.stats,accepted:Number(next.stats?.accepted||0)+1,lastAcceptedAt:lesson.acceptedAt,lastImprovement:lesson.meanImprovement};
  const trained=trainLearningModel(next);
  saveLearningStore(trained,storage);
  return{accepted:true,store:trained,lesson};
}

export function verifyLearnedCandidate(state,playerId,action,options={}){
  const benchmark=benchmarkCandidateAgainstBest(state,{...(action||{}),playerId},{...options,minImprovement:options.minImprovement??.01});
  return benchmark;
}

export function predictLearnedAdvantage(state,playerId,action,store=defaultLearningStore()){
  const features=learningFeatures(state,playerId,action);
  const weights=store?.model?.weights||[];
  return dot(features,weights);
}

export function chooseLearnedCandidate(state,playerId,candidates,store=defaultLearningStore()){
  if(!Array.isArray(candidates)||!candidates.length||!store?.lessons?.length)return null;
  const ranked=candidates.map(action=>({action,score:predictLearnedAdvantage(state,playerId,action,store)})).sort((a,b)=>b.score-a.score);
  const best=ranked[0];
  if(!best||best.score<=0)return null;
  return {...best,source:"learned-model"};
}

export function summarizeLearning(store=defaultLearningStore()){
  return {
    lessons:store?.lessons?.length||0,
    accepted:store?.stats?.accepted||0,
    modelSteps:store?.model?.steps||0,
    lastImprovementPct:Number(store?.stats?.lastImprovement||0)*100,
    version:LEARNING_ENGINE_VERSION
  };
}
