import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

const RES=["wood","brick","sheep","wheat","ore"];
const LABEL={wood:"Wood",brick:"Brick",sheep:"Sheep",wheat:"Wheat",ore:"Ore"};
const ICON={wood:"🌲",brick:"🧱",sheep:"🐑",wheat:"🌾",ore:"⛰️",desert:"🏜️"};
const COLORS={wood:"#39ff88",brick:"#ff4d5e",sheep:"#b7ff00",wheat:"#ffd43b",ore:"#8a7dff",desert:"#ff9f43"};
const COSTS={road:{wood:1,brick:1},settlement:{wood:1,brick:1,sheep:1,wheat:1},city:{wheat:2,ore:3},development:{sheep:1,wheat:1,ore:1}};
const PIECES={settlements:5,cities:4,roads:15};
const COLONIST_RULES={standard:{targetVP:10,discardIfHandOver:7,playerTrading:true,friendlyRobber:false,balancedDice:false},ranked1v1:{targetVP:15,discardIfHandOver:9,playerTrading:false,friendlyRobber:true,balancedDice:false}};
const publicCardCount=p=>Number.isFinite(p?.publicCardCount)?p.publicCardCount:total(p?.hand);
const openVictoryPoints=(p,players,geo,heldAwards)=>{const a=awards(players,geo,heldAwards||{roadOwner:null,armyOwner:null});return (p?.vp||0)+(a.roadOwner===p?.id?2:0)+(a.armyOwner===p?.id?2:0);};
const friendlyRobberProtected=(victim,players,geo,heldAwards)=>players.length===2&&openVictoryPoints(victim,players,geo,heldAwards)<=2;
const discardLimitFor=(playerCount,isPvBot=false)=>{
  // Base game: discard half only when the hand is strictly above 7 cards.
  // Ranked 1v1 / PVBot: the safe-hand threshold is strictly above 9 cards.
  return (isPvBot||playerCount===2) ? 9 : 7;
};
function canPlayDevelopmentCard(card,p,turnState={}){
  if(!p?.development?.[card])return false;
  const bought=turnState.boughtCards?.[card]||0;
  if(card==="Victory Point"){
    if(turnState.devPlayed&&!turnState.vpCanWin)return false;
    return p.development[card]>0 && ((p.development[card]-bought)>0 || turnState.vpCanWin);
  }
  if(turnState.devPlayed)return false;
  return (p.development[card]-bought)>0;
}
function canBuyDevelopmentCard(p,deck){return !!deck?.length&&canPay(p?.hand||empty(),COSTS.development);}
const TURN_BASE_SECONDS=45;
const ACTION_TIME_BONUS_SECONDS=30;
const BOT_MAX_TURN_MS=4500;
const BOT_DEEP_SEARCH_RESERVE_MS=260;
const BOT_DEEP_ACTION_LIMIT=32;
const BOT_OPENING_CANDIDATES=24;
const BOT_OPENING_PAIR_BUDGET_MS=320;
const BOT_HARD_STOP_MS=4800;

// Difficulty calibration: search breadth, response sensitivity, opening depth, and controlled noise.
const BOT_DIFFICULTY_CONFIG={
  Easy:{key:"Easy",candidateScale:.58,lookaheadTop:2,responseWeight:.045,noise:.18,openingBudgetMultiplier:.55,futureCandidates:6},
  Medium:{key:"Medium",candidateScale:.78,lookaheadTop:3,responseWeight:.075,noise:.085,openingBudgetMultiplier:.78,futureCandidates:8},
  Hard:{key:"Hard",candidateScale:1,lookaheadTop:4,responseWeight:.12,noise:.025,openingBudgetMultiplier:1,futureCandidates:12},
  Impossible:{key:"Impossible",candidateScale:1.28,lookaheadTop:6,responseWeight:.18,noise:0,openingBudgetMultiplier:1.2,futureCandidates:16}
};
function botDifficultyProfile(diff){return BOT_DIFFICULTY_CONFIG[diff]||BOT_DIFFICULTY_CONFIG.Medium;}
const BOT_HAND_PRESSURE_THRESHOLD=9;
const BOT_HAND_PRESSURE_BASE=8;
const BOT_SETTLEMENT_CANDIDATES=30;
const BOT_ROAD_CANDIDATES=28;
const BOT_TRADE_CANDIDATES=36;
const BOT_SETUP_PAIR_CANDIDATES=54;
const BOT_MAX_ACTION_EVALUATIONS=96;
const BOT_LONGEST_ROAD_PRIORITY=0.05;
const MUSIC_KEY="monopoly.backgroundMusic.v2";
const LEGACY_MUSIC_KEY="hexbound.backgroundMusic.v1";

function createViolinLoop(){
  const AudioCtx=window.AudioContext||window.webkitAudioContext;
  if(!AudioCtx)return ()=>{};
  const ctx=new AudioCtx();
  const master=ctx.createGain(); master.gain.value=0.055; master.connect(ctx.destination);
  const notes=[
    261.63,293.66,329.63,392.00,329.63,293.66,261.63,196.00,
    220.00,261.63,329.63,440.00,392.00,329.63,293.66,220.00
  ];
  const step=0.42; let index=0; let stopped=false; let timer=null;
  const schedule=()=>{
    if(stopped)return;
    const start=ctx.currentTime+0.025;
    const osc=ctx.createOscillator();
    const vibrato=ctx.createOscillator();
    const vibGain=ctx.createGain();
    const filter=ctx.createBiquadFilter();
    const gain=ctx.createGain();
    osc.type="sawtooth"; osc.frequency.value=notes[index%notes.length];
    vibrato.frequency.value=5.4; vibGain.gain.value=5.5; vibrato.connect(vibGain); vibGain.connect(osc.frequency);
    filter.type="lowpass"; filter.frequency.value=1850; filter.Q.value=0.7;
    gain.gain.setValueAtTime(0.0001,start); gain.gain.linearRampToValueAtTime(0.045,start+0.05); gain.gain.exponentialRampToValueAtTime(0.018,start+step*0.72); gain.gain.exponentialRampToValueAtTime(0.0001,start+step*0.98);
    osc.connect(filter); filter.connect(gain); gain.connect(master);
    osc.start(start); vibrato.start(start); osc.stop(start+step); vibrato.stop(start+step);
    index++; timer=window.setTimeout(schedule,step*1000);
  };
  if(ctx.state==="suspended")ctx.resume().catch(()=>{});
  schedule();
  return ()=>{stopped=true;if(timer)window.clearTimeout(timer);try{master.gain.exponentialRampToValueAtTime(0.0001,ctx.currentTime+0.08)}catch{};window.setTimeout(()=>ctx.close().catch(()=>{}),120);};
}
function rollOfficialDice(){return [1+Math.floor(Math.random()*6),1+Math.floor(Math.random()*6)];}

function piecesRemaining(p){return{settlements:Math.max(0,PIECES.settlements-(p?.settlements?.length||0)),cities:Math.max(0,PIECES.cities-(p?.cities?.length||0)),roads:Math.max(0,PIECES.roads-(p?.roads?.length||0))};}
const PROB={2:1,3:2,4:3,5:4,6:5,8:5,9:4,10:3,11:2,12:1};
const DEV={Knight:14,"Road Building":2,"Year of Plenty":2,Monopoly:2,"Victory Point":5};
const DEV_ICON={Knight:"⚔", "Road Building":"🛣️", "Year of Plenty":"🌾", Monopoly:"✦", "Victory Point":"★"};
const PLAYER_COLORS=["#00f6ff","#ff2bd6","#ff3f6f","#8b5cff"];
const HISTORY_KEY="monopoly.gameHistory.v1";
const LEGACY_MONOPOLY_HISTORY_KEY="hexbound.gameHistory.v31";
const LEGACY_HISTORY_KEYS=["hexbound.gameHistory.v29","hexbound.gameHistory.v28","hexbound.gameHistory.v27","hexbound.gameHistory.v26","hexbound.gameHistory.v25","hexbound.gameHistory.v24","hexbound.gameHistory.v23","hexbound.gameHistory.v22","hexbound.gameHistory.v21","hexbound.gameHistory.v20","hexbound.gameHistory.v19","hexbound.gameHistory.v18","hexbound.gameHistory.v17","hexbound.gameHistory.v16","hexbound.gameHistory.v15","hexbound.gameHistory.v14","hexbound.gameHistory.v13","hexbound.gameHistory.v12","hexbound.gameHistory.v9"];
const clone=x=>JSON.parse(JSON.stringify(x));
const asArray=x=>Array.isArray(x)?x:(x&&typeof x==="object"?Object.values(x):[]);
const empty=()=>Object.fromEntries(RES.map(r=>[r,0]));
const emptyBank=()=>Object.fromEntries(RES.map(r=>[r,19]));
const total=h=>RES.reduce((s,r)=>s+(h?.[r]||0),0);
const canPay=(h,c)=>Object.entries(c).every(([r,n])=>(h?.[r]||0)>=n);
const pay=(h,c)=>{const x={...h};Object.entries(c).forEach(([r,n])=>x[r]=(x[r]||0)-n);return x};
const add=(h,c)=>{const x={...h};Object.entries(c).forEach(([r,n])=>x[r]=(x[r]||0)+n);return x};
const shuffle=a=>{const x=[...a];for(let i=x.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[x[i],x[j]]=[x[j],x[i]];}return x};
const fmtDate=d=>new Date(d).toLocaleString([], {dateStyle:"medium",timeStyle:"short"});

function makeGeometry(){
  const centers=[];
  for(let q=-2;q<=2;q++) for(let r=-2;r<=2;r++) if(Math.max(Math.abs(q),Math.abs(r),Math.abs(q+r))<=2) centers.push({q,r});
  const R=76,U=Math.sqrt(3)*R/2,offsets=[[U,-R/2],[U,R/2],[0,R],[-U,R/2],[-U,-R/2],[0,-R]];
  const center=(q,r)=>[U*(2*q+r),1.5*R*r], key=(x,y)=>`${x.toFixed(3)},${y.toFixed(3)}`;
  const vMap=new Map(),vertices=[];
  const tiles=centers.map((c,i)=>{const [cx,cy]=center(c.q,c.r),vids=[];offsets.forEach(([dx,dy])=>{const x=cx+dx,y=cy+dy,k=key(x,y);if(!vMap.has(k)){vMap.set(k,vertices.length);vertices.push({x,y});}vids.push(vMap.get(k));});return{id:i,q:c.q,r:c.r,cx,cy,vertices:vids};});
  const edgeMap=new Map(),edges=[];tiles.forEach(t=>{for(let k=0;k<6;k++){const a=t.vertices[k],b=t.vertices[(k+1)%6],key2=a<b?`${a}-${b}`:`${b}-${a}`;if(!edgeMap.has(key2)){edgeMap.set(key2,edges.length);edges.push({id:edges.length,a:Math.min(a,b),b:Math.max(a,b)});}}});
  const vertexTiles=vertices.map(()=>[]),vertexEdges=vertices.map(()=>[]);tiles.forEach(t=>t.vertices.forEach(v=>vertexTiles[v].push(t.id)));edges.forEach(e=>{vertexEdges[e.a].push(e.id);vertexEdges[e.b].push(e.id)});
  const neighbors=vertices.map((_,i)=>[...new Set(vertexEdges[i].map(eid=>{const e=edges[eid];return e.a===i?e.b:e.a}))]);
  const coastal=vertices.map((_,i)=>vertexTiles[i].length<3);
  const tileNeighbors=tiles.map(()=>[]);const tEdge=new Map();tiles.forEach(t=>t.vertices.forEach(v=>(tEdge.set(`${t.id}-${v}`,1))));for(let a=0;a<tiles.length;a++)for(let b=a+1;b<tiles.length;b++){const shared=tiles[a].vertices.filter(v=>tiles[b].vertices.includes(v));if(shared.length>=2){tileNeighbors[a].push(b);tileNeighbors[b].push(a);}}
  const boundaryEdges=edges.filter(e=>vertexTiles[e.a].length<3&&vertexTiles[e.b].length<3);
  return {tiles,vertices,edges,vertexTiles,vertexEdges,neighbors,coastal,tileNeighbors,boundaryEdges};
}

function boardValid(board,geo,settings){
  if(!board||board.length!==19)return false;
  const terrainCounts=Object.fromEntries(RES.map(r=>[r,0]));terrainCounts.desert=0;
  board.forEach(t=>terrainCounts[t.resource]=(terrainCounts[t.resource]||0)+1);
  if(JSON.stringify(terrainCounts)!==JSON.stringify({wood:4,brick:3,sheep:4,wheat:4,ore:3,desert:1}))return false;
  const numbered=board.filter(t=>t.resource!=="desert").map(t=>t.number).sort((a,b)=>a-b);
  const standard=[2,3,3,4,4,5,5,6,6,8,8,9,9,10,10,11,11,12].sort((a,b)=>a-b);
  if(JSON.stringify(numbered)!==JSON.stringify(standard))return false;
  const deserts=board.filter(t=>t.resource==="desert");if(deserts.length!==1||!deserts[0].robber)return false;
  for(let i=0;i<board.length;i++)for(const j of geo.tileNeighbors[i])if(i<j){const a=board[i],b=board[j];
    if(!settings.highPipsTouch&&[6,8].includes(a.number)&&[6,8].includes(b.number))return false;
  }
  return true;
}
function makeBoard(geo,settings){
  const terrainCounts={wood:4,brick:3,sheep:4,wheat:4,ore:3,desert:1};
  const numberTokens=[2,3,3,4,4,5,5,6,6,8,8,9,9,10,10,11,11,12];
  const terrain=Array(19).fill(null),remaining={...terrainCounts};
  const tileOrder=shuffle([...Array(19).keys()]).sort((a,b)=>geo.tileNeighbors[b].length-geo.tileNeighbors[a].length+(Math.random()-.5));
  function placeTerrain(pos){
    if(pos===tileOrder.length)return true;
    const idx=tileOrder[pos];
    const choices=shuffle(RES.concat("desert")).filter(r=>remaining[r]>0);
    for(const r of choices){
      terrain[idx]={resource:r,number:null,robber:r==="desert"};remaining[r]--;
      // Forward-check: every remaining resource must still have at least one legal slot.
      let viable=true;
      if(viable&&placeTerrain(pos+1))return true;
      remaining[r]++;terrain[idx]=null;
    }
    return false;
  }
  if(!placeTerrain(0))throw new Error("Could not generate a valid terrain layout for the selected map rules.");
  const out=clone(terrain),slots=out.map((t,i)=>t.resource!=="desert"?i:null).filter(i=>i!=null);
  const numberOrder=shuffle(slots).sort((a,b)=>geo.tileNeighbors[b].length-geo.tileNeighbors[a].length+(Math.random()-.5));
  let remainingNums=shuffle(numberTokens);
  function placeNumbers(pos){
    if(pos===numberOrder.length)return true;
    const idx=numberOrder[pos];
    const choices=shuffle(remainingNums);
    for(const n of choices){
      if(!settings.highPipsTouch&&[6,8].includes(n)&&geo.tileNeighbors[idx].some(j=>[6,8].includes(out[j]?.number)))continue;
      const at=remainingNums.indexOf(n);remainingNums.splice(at,1);out[idx]={...out[idx],number:n};
      if(placeNumbers(pos+1))return true;
      remainingNums.splice(at,0,n);out[idx]={...out[idx],number:null};
    }
    return false;
  }
  if(!placeNumbers(0))throw new Error("Could not generate a valid number-token layout for the selected map rules.");
  if(!boardValid(out,geo,settings))throw new Error("Internal map validation failed.");
  return out;
}
function makePorts(geo){
  // Prefer evenly spaced coastal berths so ports are distributed around the
  // island instead of being clustered by random edge selection. This is the
  // port-placement strategy carried over from the Grok workspace.
  const candidates=(geo.boundaryEdges||geo.edges.filter(e=>geo.vertexTiles[e.a].length<3&&geo.vertexTiles[e.b].length<3)).slice();
  const scored=candidates.map(e=>{
    const ax=geo.vertices[e.a].x,ay=geo.vertices[e.a].y,bx=geo.vertices[e.b].x,by=geo.vertices[e.b].y;
    return {e,angle:Math.atan2((ay+by)/2,(ax+bx)/2)};
  }).sort((a,b)=>a.angle-b.angle);
  const chosen=[];
  const n=scored.length;
  if(n<9)throw new Error("Could not place all 9 ports on the generated coast.");
  const step=n/9;
  for(let i=0;i<9;i++){
    const start=Math.round(i*step);
    let picked=null;
    for(let k=0;k<n;k++){
      const cand=scored[(start+k)%n].e;
      if(chosen.some(x=>x.a===cand.a||x.a===cand.b||x.b===cand.a||x.b===cand.b))continue;
      picked=cand;break;
    }
    if(picked)chosen.push(picked);
  }
  if(chosen.length<9){
    for(const item of scored){
      const edge=item.e;
      if(chosen.some(x=>x.a===edge.a||x.a===edge.b||x.b===edge.a||x.b===edge.b))continue;
      chosen.push(edge);
      if(chosen.length===9)break;
    }
  }
  if(chosen.length<9)throw new Error("Could not place all 9 ports on the generated coast.");
  const types=shuffle(["3:1","3:1","3:1","3:1","2:1 wood","2:1 brick","2:1 sheep","2:1 wheat","2:1 ore"]);
  return chosen.map((e,i)=>({edge:e.id,a:e.a,b:e.b,vertices:[e.a,e.b],type:types[i]}));
}
function emptyDev(){return {...Object.fromEntries(Object.keys(DEV).map(k=>[k,0])),playedKnights:0};}
function devDeck(){return shuffle(Object.entries(DEV).flatMap(([k,n])=>Array(n).fill(k)));}
function newPlayer(id,name,bot,diff){return{id,name,bot,diff,color:PLAYER_COLORS[id],vp:0,hand:empty(),settlements:[],cities:[],roads:[],development:emptyDev()};}
function adjacentProduction(geo,board,p){const out=empty();const addV=(v,m)=>geo.vertexTiles[v].forEach(tid=>{const t=board[tid];if(t.resource!=="desert"&&!t.robber)out[t.resource]+=(PROB[t.number]||0)*m});(p?.settlements||[]).forEach(v=>addV(v,1));(p?.cities||[]).forEach(v=>addV(v,2));return out;}
const ROAD_LENGTH_CACHE=new WeakMap();
function connectedRoadLength(p,geo,players){
  const owned=new Set(p.roads||[]);if(!owned.size)return 0;
  let cache=ROAD_LENGTH_CACHE.get(geo);if(!cache){cache=new Map();ROAD_LENGTH_CACHE.set(geo,cache);}
  const blockedKey=players.filter(o=>o.id!==p.id).flatMap(o=>[...(o.settlements||[]),...(o.cities||[])]).sort((a,b)=>a-b).join(',');
  const key=`${p.id}|${[...(p.roads||[])].sort((a,b)=>a-b).join(',')}|${blockedKey}`;
  const cached=cache.get(key);if(cached!=null)return cached;
  const blocked=new Set();
  players.forEach(o=>{if(o.id!==p.id){(o.settlements||[]).forEach(v=>blocked.add(v));(o.cities||[]).forEach(v=>blocked.add(v));}});
  const adj=new Map();
  owned.forEach(eid=>{const e=geo.edges[eid];if(!e)return;if(!adj.has(e.a))adj.set(e.a,[]);if(!adj.has(e.b))adj.set(e.b,[]);adj.get(e.a).push(eid);adj.get(e.b).push(eid);});
  let best=0;
  function dfs(v,used,len){
    // Opponent housing blocks continuation. Never start a search from a blocked vertex,
    // and never expand from one after entering it.
    if(blocked.has(v)&&len>0)return;
    best=Math.max(best,len);
    for(const eid of adj.get(v)||[]){
      if(used.has(eid))continue;
      const e=geo.edges[eid],next=e.a===v?e.b:e.a;
      const u=new Set(used);u.add(eid);dfs(next,u,len+1);
    }
  }
  adj.forEach((_,v)=>{if(!blocked.has(v))dfs(v,new Set(),0);});
  if(cache.size>2500){const first=cache.keys().next().value;if(first!=null)cache.delete(first);}
  cache.set(key,best);
  return best;
}

function awards(players,geo,held={roadOwner:null,armyOwner:null}){
  const roads=players.map(p=>connectedRoadLength(p,geo,players)),armies=players.map(p=>p.development.playedKnights||0);
  const rm=Math.max(0,...roads),am=Math.max(0,...armies),roadLeaders=players.filter(p=>roads[p.id]===rm),armyLeaders=players.filter(p=>armies[p.id]===am);
  const roadOwner=rm>=5?(roadLeaders.length===1?roadLeaders[0].id:(held.roadOwner!=null&&roadLeaders.some(p=>p.id===held.roadOwner)?held.roadOwner:null)):null;
  const armyOwner=am>=3?(armyLeaders.length===1?armyLeaders[0].id:(held.armyOwner!=null&&armyLeaders.some(p=>p.id===held.armyOwner)?held.armyOwner:null)):null;
  return{roads,armies,roadOwner,armyOwner};
}
function housingDistanceValid(v,players,geo){
  if(v==null||!geo.vertices[v])return false;
  // Housing distance rule: occupied settlements/cities must be at least
  // 2 road-edges apart. In graph terms, a candidate is illegal only when
  // another occupied intersection is the same vertex (distance 0) or an
  // immediately connected vertex (distance 1).
  const occupied=new Set();
  players.forEach(p=>{
    (p.settlements||[]).forEach(x=>occupied.add(x));
    (p.cities||[]).forEach(x=>occupied.add(x));
  });
  if(occupied.has(v))return false;
  return !(geo.neighbors[v]||[]).some(n=>occupied.has(n));
}
function legalSettlement(v,players,geo){return housingDistanceValid(v,players,geo);}

function roadConnected(eid,p,players,geo){const e=geo.edges[eid];if(!e)return false;const ends=[e.a,e.b];if(ends.some(v=>p.settlements.includes(v)||p.cities.includes(v)))return true;return ends.some(v=>(geo.vertexEdges[v]||[]).some(x=>p.roads.includes(x)&&!players.some(o=>o.id!==p.id&&(o.settlements.includes(v)||o.cities.includes(v)))));}
function legalRoad(eid,p,players,geo){return !!geo.edges[eid]&&!p.roads.includes(eid)&&!players.some(o=>o.roads.includes(eid))&&roadConnected(eid,p,players,geo);}
function legalInitialRoad(eid,v,players,geo){const e=geo.edges[eid];return !!e&&e.a!==e.b&&(e.a===v||e.b===v)&&!players.some(p=>p.roads.includes(eid));}
function settlementConnected(v,p,geo){return (geo.vertexEdges[v]||[]).some(eid=>p.roads.includes(eid));}
function portAt(v,ports){return asArray(ports).find(p=>Array.isArray(p?.vertices)?p.vertices.includes(v):p?.vertex===v)||null;}
function tradeRate(p,ports,give){const owned=(p.settlements||[]).concat(p.cities||[]);const types=owned.map(v=>portAt(v,ports)?.type).filter(Boolean);if(types.includes(`2:1 ${give}`))return 2;if(types.includes("3:1"))return 3;return 4;}
function productionForRoll(players,board,geo,sum,bank){
  const demand=players.map(p=>{const g=empty();
    p.settlements.forEach(v=>geo.vertexTiles[v].forEach(tid=>{const t=board[tid];if(t.number===sum&&!t.robber&&t.resource!=="desert")g[t.resource]++;}));
    p.cities.forEach(v=>geo.vertexTiles[v].forEach(tid=>{const t=board[tid];if(t.number===sum&&!t.robber&&t.resource!=="desert")g[t.resource]+=2;}));
    return g;
  });
  const grants=demand.map(()=>empty()),nextBank={...bank};
  RES.forEach(r=>{
    const totalDemand=demand.reduce((n,g)=>n+g[r],0);
    const recipients=demand.map((g,i)=>g[r]>0?i:null).filter(i=>i!=null);
    // Standard Catan bank rule: if the bank cannot satisfy the full demand for a resource, nobody receives that resource.
    if(totalDemand<=nextBank[r]) demand.forEach((g,i)=>{grants[i][r]=g[r]});
    const paid=grants.reduce((n,g)=>n+g[r],0);nextBank[r]-=paid;
  });
  return {players:players.map((p,i)=>({...p,hand:add(p.hand,grants[i])})),bank:nextBank,demand,grants};
}
function resolveDiceRoll(players,board,geo,sum,bank){
  if(sum===7){
    return {players,bank,grants:players.map(()=>empty()),demand:players.map(()=>empty()),seven:true};
  }
  const out=productionForRoll(players,board,geo,sum,bank);
  return {...out,seven:false};
}
function cardProbabilities(deck){const counts=Object.fromEntries(Object.keys(DEV).map(c=>[c,0]));deck.forEach(c=>counts[c]++);const remaining=deck.length;return Object.fromEntries(Object.keys(DEV).map(c=>{const count=counts[c],prob=remaining?count/remaining:0,draws=Math.min(3,remaining);let miss=1;for(let i=0;i<draws;i++)miss*=Math.max(0,remaining-count-i)/Math.max(1,remaining-i);return[c,{count,prob,within3:1-miss}]}));}
const BOT_ENGINE_VERSION="v29-semi-perfect-low-latency-planner";
const BOT_MODE_CONFIGS={
  standard4p10:{
    key:"standard4p10",targetVP:10,leaderMultiplier:2.0,gameLengthFactor:1.0,beta:0.32,bankScarcity:1,
    phases:[
      {maxVP:3,wP:.36,wC:.18,wT:.12,wE:.24,wY:.10,riskWeight:.45,denialWeight:.18},
      {maxVP:6,wP:.26,wC:.12,wT:.20,wE:.24,wY:.12,riskWeight:.55,denialWeight:.32},
      {maxVP:9,wP:.16,wC:.05,wT:.18,wE:.12,wY:.08,riskWeight:.75,denialWeight:.58}
    ]
  },
  pvbot1v115:{
    key:"pvbot1v115",targetVP:15,leaderMultiplier:2.6,gameLengthFactor:.6,beta:.42,bankScarcity:1.3,
    phases:[
      {maxVP:5,wP:.34,wC:.18,wT:.24,wE:.16,wY:.08,riskWeight:.28,denialWeight:.08},
      {maxVP:10,wP:.24,wC:.08,wT:.34,wE:.20,wY:.10,riskWeight:.36,denialWeight:.16},
      {maxVP:14,wP:.16,wC:.04,wT:.24,wE:.08,wY:.06,riskWeight:.52,denialWeight:.46}
    ]
  }
};

function botModeConfig(players,targetVP){return players.length===2?BOT_MODE_CONFIGS.pvbot1v115:BOT_MODE_CONFIGS.standard4p10;}
function clamp(n,a,b){return Math.max(a,Math.min(b,n));}
let ACTIVE_BOT_CACHE=null;
function botPlanningFingerprint(p,plan=null){
  const h=RES.map(r=>p?.hand?.[r]||0).join(',');
  return `${p?.id}|${h}|${(p?.settlements||[]).join(',')}|${(p?.cities||[]).join(',')}|${(p?.roads||[]).join(',')}|${p?.vp||0}|${plan?.type||''}|${plan?.target??''}|${(plan?.path||[]).join(',')}`;
}
function createBotPlanningCache(){
  return {need:new Map(),spot:new Map(),future:new Map(),threats:new Map(),opponentRanks:new Map(),road:new Map(),placement:new Map(),city:new Map(),boardScarcity:new Map(),openedAt:(typeof performance!=="undefined"&&performance.now?performance.now():Date.now())};
}
function resetBotPlanningCache(){ACTIVE_BOT_CACHE=null;}
function expectedTurnsToCombo(hand,production,cost){
  let t=0;
  for(const [r,n] of Object.entries(cost||{})){
    const have=hand?.[r]||0;
    if(have>=n)continue;
    const rate=production?.[r]||0;
    t=Math.max(t,rate>1e-6?(n-have)/rate:80);
  }
  return t;
}
function comboHitProbability(vertices,board,geo){
  const nums=new Set();
  for(const v of vertices||[]){
    for(const tid of geo.vertexTiles[v]||[]){
      const n=board[tid]?.number;
      if(Number.isFinite(n))nums.add(n);
    }
  }
  let miss=1;
  for(const n of nums) miss*=(1-(PROB[n]||0)/36);
  return 1-miss;
}
function pipelineComboBonus(spa,spb,is1v1){
  const c=empty();
  RES.forEach(r=>c[r]=(spa?.[r]||0)+(spb?.[r]||0));
  const has=r=>c[r]>0;
  let bonus=0;
  if(has("wood")&&has("brick")) bonus+=is1v1?5.2:7.4;
  else bonus-=is1v1?3.2:5.0;
  if(has("wheat")&&has("ore")) bonus+=is1v1?9.6:6.2;
  else bonus-=is1v1?6.0:3.4;
  if(has("sheep")&&(has("wheat")||has("ore"))) bonus+=is1v1?4.2:3.1;
  else if(!has("sheep")) bonus-=1.8;
  const kinds=RES.filter(r=>c[r]>0).length;
  if(kinds>=5) bonus+=8.5;
  else if(kinds===4) bonus+=4.2;
  else if(kinds<=2) bonus-=5.5;
  bonus+=RES.reduce((s,r)=>s+c[r],0)*6;
  return bonus;
}
function comboCompletionValue(beforeHand,afterHand,p,players){
  const is1v1=players.length===2;
  let v=0;
  const checks=[["city",COSTS.city,is1v1?26:18],["settlement",COSTS.settlement,is1v1?14:20],["development",COSTS.development,is1v1?8:6],["road",COSTS.road,3]];
  for(const [name,cost,gain] of checks){
    if(name==="city"&&(!(p.settlements||[]).length||piecesRemaining(p).cities<=0))continue;
    if(name==="settlement"&&piecesRemaining(p).settlements<=0)continue;
    if(name==="road"&&piecesRemaining(p).roads<=0)continue;
    const before=canPay(beforeHand,cost), after=canPay(afterHand,cost);
    if(!before&&after)v+=gain;
    else{
      const bDef=Object.entries(cost).reduce((sum,[r,n])=>sum+Math.max(0,n-(beforeHand?.[r]||0)),0);
      const aDef=Object.entries(cost).reduce((sum,[r,n])=>sum+Math.max(0,n-(afterHand?.[r]||0)),0);
      if(aDef<bDef)v+=(bDef-aDef)*(name==="city"?4.2:name==="settlement"?3.4:2.0);
    }
  }
  return v;
}
function tileVerts(geo,tid){return geo?.tiles?.[tid]?.vertices||geo?.vertexTiles?.[tid]||[];}
function botPipValue(number){return PROB[number]||0;}
function Production(r,hexes){return (hexes||[]).reduce((sum,t)=>sum+(t?.resource===r&&!t?.robber?botPipValue(t.number)/36:0),0);}
function spotProduction(v,board,geo){
  const out=empty();
  for(const tid of geo.vertexTiles[v]||[]){
    const t=board[tid];
    if(!t||t.resource==="desert"||t.robber)continue;
    out[t.resource]+=botPipValue(t.number)/36;
  }
  return out;
}
function placementInsight(v,board,geo,player=null,players=[],ports=[],opening=false){
  const production=spotProduction(v,board,geo);
  const entries=RES.filter(r=>production[r]>0).sort((a,b)=>production[b]-production[a]);
  const actualPips=entries.reduce((sum,r)=>sum+((geo.vertexTiles[v]||[]).map(tid=>board[tid]).filter(t=>t&&t.resource===r&&!t.robber).reduce((s,t)=>s+(PROB[t.number]||0),0)),0);
  const pips=actualPips;
  const combo=entries.slice(0,2);
  const comboPips=combo.reduce((sum,r)=>sum+((geo.vertexTiles[v]||[]).map(tid=>board[tid]).filter(t=>t&&t.resource===r&&!t.robber).reduce((s,t)=>s+(PROB[t.number]||0),0)),0);
  const expected=pips/36;
  const comboExpected=comboPips/36;
  const diversity=Math.min(entries.length,3);
  const heuristic=opening&&player?openingPlacementScore(v,player,players,board,geo,ports,emptyBank(),players.length===2?15:10):placementScore(v,player||players[0]||newPlayer(0,"You",false,"Human"),players.length?players:[player||newPlayer(0,"You",false,"Human")],board,geo,ports,emptyBank(),players.length===2?15:10);
  const score=Math.round(clamp(Number.isFinite(heuristic)?heuristic:pips*5.2+diversity*7+comboExpected*8,0,100));
  return {
    production,
    entries,
    combo,
    pips,
    expected,
    comboPips,
    comboExpected,
    score,
    label:combo.length?combo.map(r=>LABEL[r].toUpperCase()).join(" + "):"LOW PRODUCTION"
  };
}
function botProduction(p,board,geo){
  const out=empty();const addV=(v,m)=>{for(const tid of geo.vertexTiles[v]||[]){const t=board[tid];if(!t||t.resource==="desert"||t.robber)continue;out[t.resource]+=botPipValue(t.number)/36*m;}};
  (p?.settlements||[]).forEach(v=>addV(v,1));(p?.cities||[]).forEach(v=>addV(v,2));return out;
}
function boardPipProfile(board){
  const totalPips=empty();board.forEach(t=>{if(t.resource!=="desert")totalPips[t.resource]+=botPipValue(t.number)/36;});return totalPips;
}
function aggregateProduction(players,board,geo){const out=empty();players.forEach(p=>{const prod=botProduction(p,board,geo);RES.forEach(r=>out[r]+=prod[r]);});return out;}
function PersonalScarcity(r,production){const avg=Object.values(production).reduce((a,b)=>a+b,0)/RES.length;return clamp(2-(production[r]||0)/Math.max(avg,.0001),.5,2);}
function BankAvailability(r,bank){return clamp((bank?.[r]||0)/19,.3,1);}
function targetReadiness(p,cost){const totalCost=Object.values(cost).reduce((a,b)=>a+b,0);const deficit=Object.entries(cost).reduce((a,[r,n])=>a+Math.max(0,n-(p.hand?.[r]||0)),0);return 1-deficit/Math.max(totalCost,1);}
function discardKeepScore(resource,p,players,board,geo,bank,targetVP){
  const cfg=botModeConfig(players,targetVP);
  const demand=BuildingDemand(p,cfg);
  const handCount=p?.hand?.[resource]||0;
  if(handCount<=0)return -Infinity;
  const prod=botProduction(p,board,geo);
  const need=NeedProfile(p,players,board,geo,bank,cfg).need[resource]||1;
  let score=need*3 + (demand[resource]||0)*2 + (prod[resource]||0)*1.25;
  // Protect cards that directly complete a realistic next build target.
  for(const [name,cost] of Object.entries(COSTS)){
    const missing=Object.entries(cost).reduce((n,[r,c])=>n+Math.max(0,c-(p.hand?.[r]||0)),0);
    const needToComplete=Math.max(0,(cost[resource]||0)-(p.hand?.[resource]||0));
    if(name==="settlement"||name==="city"||name==="development"){
      if(needToComplete>0)score+=2.5/(1+missing);
      if((p.hand?.[resource]||0)>0 && canPay(p.hand,cost))score+=1.25;
    }
  }
  // Preserve diversity: the first/only card of a resource is materially harder to replace.
  const distinct=RES.filter(r=>(p.hand?.[r]||0)>0).length;
  if(handCount===1)score+=2.4;
  else if(distinct<=2)score+=1.1;
  // A surplus resource can be converted, but that should never outweigh a direct build need.
  const ownedPorts=(p.settlements||[]).concat(p.cities||[]).map(v=>null).filter(Boolean);
  score+=0; // explicit no-port-primary rule for discard selection
  return score;
}
function chooseBotDiscards(p,players,board,geo,bank,targetVP){
  let h={...(p.hand||empty())};
  let remaining=Math.floor(total(h)/2);
  const discarded=empty();
  const scored=()=>RES.filter(r=>(h[r]||0)>0).map(r=>({r,score:discardKeepScore(r,{...p,hand:h},players,board,geo,bank,targetVP)})).sort((a,b)=>a.score-b.score);
  while(remaining>0){
    const candidates=scored();
    if(!candidates.length)break;
    const pick=candidates[0].r;
    h[pick]--;discarded[pick]++;remaining--;
  }
  return {hand:h,discarded};
}
function scarcityRankFactors(need){
  const order=RES.slice().sort((a,b)=>(need[b]||0)-(need[a]||0));
  const factors=empty();
  order.forEach((r,i)=>{
    // Rarest resource gets +18%; common resources get no more than -6%.
    factors[r]=1.18-(i/(RES.length-1))*.24;
  });
  return factors;
}
function placementResourceValue(sp,nf){
  const factors=scarcityRankFactors(nf.need);
  return RES.reduce((a,r)=>a+(sp[r]*36)*factors[r],0);
}
function coverageValue(v,sp,p,board,geo,nf){
  const counts=empty();
  (p.settlements||[]).concat(p.cities||[]).forEach(s=>{const q=spotProduction(s,board,geo);RES.forEach(r=>{if(q[r]>0)counts[r]++;});});
  // First access is valuable, second access is useful, later copies have diminishing value.
  return RES.reduce((a,r)=>{if(sp[r]<=0)return a;return a+(nf.need[r]*(.65/(1+counts[r])));},0);
}
function projectedTurns(p,targetVP){
  const vp=Math.max(0,p.vp);return clamp((targetVP-vp)*3.5+4,4,35);
}
function expectedConsumption(p,need,remainingTurns){
  const out=empty();const demand=need?.demand||BuildingDemand(p);RES.forEach(r=>{out[r]=demand[r]*Math.max(1,remainingTurns/4);});return out;
}
function surplusProfile(p,players,board,geo,bank,targetVP,modeCfg){
  const need=NeedProfile(p,players,board,geo,bank,modeCfg),turns=projectedTurns(p,targetVP),cons=expectedConsumption(p,need,turns),out=empty();RES.forEach(r=>out[r]=Math.max(0,(p.hand?.[r]||0)+need.production[r]*turns-cons[r]));return{surplus:out,turns,need};
}
function TValue(v,p,players,board,geo,ports,bank,targetVP,modeCfg){
  const port=portAt(v,ports);if(!port)return 0;
  const {surplus,need}=surplusProfile(p,players,board,geo,bank,targetVP,modeCfg);const scarce=RES.filter(r=>need.need[r]>=Math.max(...RES.map(x=>need.need[x]))*.8);const avgScarce=scarce.length?scarce.reduce((a,r)=>a+need.need[r],0)/scarce.length:1;
  if(port.type.startsWith("2:1")){
    const r=port.type.slice(4);const trades=Math.min(surplus[r]/2,Math.max(1,targetVP-p.vp+2),8);return trades*avgScarce*BankAvailability(r,bank);
  }
  const totalSurplus=RES.reduce((a,r)=>a+surplus[r],0);return Math.min(totalSurplus/3,8)*avgScarce;
}
function pathRoadBonus(v,p,players,geo){return (geo.vertexEdges[v]||[]).filter(eid=>legalRoad(eid,p,players,geo)).length>=2?0.35:0;}
function numberVarietyScore(v,board,geo){
  const nums=(geo.vertexTiles[v]||[]).map(tid=>board[tid]?.number).filter(n=>Number.isFinite(n));
  if(!nums.length)return 0;
  const unique=[...new Set(nums)];
  const spread=(Math.max(...nums)-Math.min(...nums))/12;
  const probabilityValues=unique.map(n=>PROB[n]||0);
  const probabilitySpread=probabilityValues.length>1?(Math.max(...probabilityValues)-Math.min(...probabilityValues)):0;
  // Deliberately small: this is a tie-breaker, never a primary settlement value.
  return unique.length + spread*.18 + probabilitySpread*.08;
}
function openingNumberVarietyScore(a,b,board,geo){
  const nums=[...(geo.vertexTiles[a]||[]),...(geo.vertexTiles[b]||[])].map(tid=>board[tid]?.number).filter(n=>Number.isFinite(n));
  if(!nums.length)return 0;
  const unique=new Set(nums);
  const duplicates=nums.length-unique.size;
  return unique.size + (unique.size/nums.length)*.25 - duplicates*.015;
}
function buildReadiness(p,cost,board,geo){const prod=botProduction(p,board,geo);return Math.min(...Object.entries(cost).map(([r,n])=>((p.hand?.[r]||0)+prod[r]*4)/Math.max(n,1)));}
function ComplementarityScore(v,p,players,board,geo,bank,targetVP,modeCfg){
  const beforeSettlement=buildReadiness(p,COSTS.settlement,board,geo),beforeCity=buildReadiness(p,COSTS.city,board,geo),beforeDev=buildReadiness(p,COSTS.development,board,geo);
  const temp={...p,settlements:[...(p.settlements||[]),v]},afterSettlement=buildReadiness(temp,COSTS.settlement,board,geo),afterCity=buildReadiness(temp,COSTS.city,board,geo),afterDev=buildReadiness(temp,COSTS.development,board,geo);
  let score=0;
  if(beforeSettlement<1&&afterSettlement>=1)score+=2.2;
  if(beforeCity<1&&afterCity>=1)score+=2.2;
  if(beforeDev<1&&afterDev>=1)score+=1.2;
  return score;
}
function RoadNetworkSynergy(v,p,players,geo){return pathRoadBonus(v,p,players,geo);}
function HubEfficiency(v,players,geo){const open=(geo.neighbors[v]||[]).filter(n=>legalSettlement(n,players,geo)).length;const blocked=(geo.neighbors[v]||[]).filter(n=>!legalSettlement(n,players,geo)).length;return blocked>=2&&open<=2?0.8:0;}
function YValue(v,p,players,board,geo,ports,bank,targetVP,modeCfg){return ComplementarityScore(v,p,players,board,geo,bank,targetVP,modeCfg)+RoadNetworkSynergy(v,p,players,geo)+HubEfficiency(v,players,geo);}
function BlockValue(v,p,players,board,geo,ports,bank,targetVP,modeCfg){let best=0;for(const opp of players.filter(x=>x.id!==p.id)){const oppNeed=NeedProfile(opp,players,board,geo,bank,modeCfg);const fp=spotProduction(v,board,geo);const gain=RES.reduce((a,r)=>a+fp[r]*oppNeed.need[r],0);const expansion=EValue(v,opp,players,board,geo,ports,bank,targetVP,modeCfg);const likely=Math.min(.9,.25+.12*(opp.vp+(opp.publicCardCount??total(opp.hand))));const leader=1+modeCfg.leaderMultiplier*(opp.vp/targetVP);best=Math.max(best,(gain+expansion)*likely*leader);}return best;}
function UrgencyValue(v,p,players,board,geo,ports,bank,targetVP,modeCfg){
  const e=EValue(v,p,players,board,geo,ports,bank,targetVP,modeCfg);
  const opps=players.filter(x=>x.id!==p.id);
  if(!opps.length)return 0;
  let chance=0;
  for(const opp of opps){
    const legal=geo.vertices.filter(x=>legalSettlement(x,players,geo));
    if(!legal.includes(v))continue;
    const np=NeedProfile(opp,players,board,geo,bank,modeCfg);
    const targetScore=RES.reduce((a,r)=>a+spotProduction(v,board,geo)[r]*np.need[r],0);
    const scores=legal.map(x=>{const s=spotProduction(x,board,geo);return RES.reduce((a,r)=>a+s[r]*np.need[r],0);}).sort((a,b)=>b-a);
    const rank=scores.findIndex(score=>score===targetScore);
    chance+=rank>=0?Math.max(.05,.85-rank*.08):0;
  }
  return e*clamp(chance,0,1);
}
function RiskValue(action,p,players,board,geo,targetVP,modeCfg){let variance=0;if(action.type==="settlement"||action.type==="city"){const prod=action.type==="settlement"?spotProduction(action.spot,board,geo):spotProduction(action.spot,board,geo);variance=Object.values(prod).reduce((a,b)=>a+b*b,0);}else if(action.type==="road")variance=.15;else if(action.type==="buyDev")variance=.35;else variance=.1;return variance*modeCfg.gameLengthFactor;}
function settlementPieceScarcityPenalty(p){const pieces=piecesRemaining(p);if(pieces.settlements<=1)return 1.4;if(pieces.cities<=1&&pieces.settlements>1)return -0.9;return 0;}
function VPValueDelta(before,after,players,geo,heldAwards){const a0=awards(players,geo,heldAwards),a1=awards(players.map(x=>x.id===after.id?after:x),geo,heldAwards);const vp0=before.vp+(a0.roadOwner===before.id?2:0)+(a0.armyOwner===before.id?2:0),vp1=after.vp+(a1.roadOwner===after.id?2:0)+(a1.armyOwner===after.id?2:0);return vp1-vp0;}
function unifiedPosition(v,p,players,board,geo,ports,bank,targetVP,heldAwards){
  const modeCfg=botModeConfig(players,targetVP),phase=modeCfg.phases.find(x=>p.vp<=x.maxVP)||modeCfg.phases[modeCfg.phases.length-1];const nf=NeedProfile(p,players,board,geo,bank,modeCfg);
  const P=placementResourceValue(nf.production,nf)/36;
  const C=RES.reduce((a,r)=>a+(nf.need[r]*.5)/(1+(p.settlements||[]).filter(v=>spotProduction(v,board,geo)[r]>0).length),0);const T=(p.settlements||[]).concat(p.cities||[]).reduce((a,v)=>a+TValue(v,p,players,board,geo,ports,bank,targetVP,modeCfg),0);const E=(p.settlements||[]).reduce((a,v)=>a+EValue(v,p,players,board,geo,ports,bank,targetVP,modeCfg),0);const Y=(p.settlements||[]).reduce((a,v)=>a+YValue(v,p,players,board,geo,ports,bank,targetVP,modeCfg),0)+connectedRoadLength(p,geo,players)*.10;return{P,C,T,E,Y,need:nf.need,phase,modeCfg};}
function bestYearOfPlentyPair(p,players,board,geo,ports,bank,deck,targetVP,cfg,turnState={}){
  const available=RES.filter(r=>(bank?.[r]||0)>0);
  let best=null;
  const nf=NeedProfile(p,players,board,geo,bank,cfg);
  const buildCosts=[['settlement',COSTS.settlement,11],['city',COSTS.city,13],['development',COSTS.development,6]];
  for(let i=0;i<available.length;i++){
    for(let j=i;j<available.length;j++){
      const a=available[i],b=available[j];
      if(a===b&&(bank[a]||0)<2)continue;
      const take=empty();take[a]++;take[b]++;
      const afterHand=add(p.hand,take);
      let value=0;
      // Immediate completion value dominates generic resource preference.
      for(const [name,cost,completeValue] of buildCosts){
        const beforeDef=Object.entries(cost).reduce((sum,[r,n])=>sum+Math.max(0,n-(p.hand?.[r]||0)),0);
        const afterDef=Object.entries(cost).reduce((sum,[r,n])=>sum+Math.max(0,n-(afterHand?.[r]||0)),0);
        value+=(beforeDef-afterDef)*5;
        if(canPay(afterHand,cost))value+=completeValue;
      }
      // If the pair unlocks the strongest immediate expansion, reward that directly.
      const beforeSett=p.settlements?.length||0, afterSett=canPay(afterHand,COSTS.settlement);
      if(afterSett&&beforeSett<5)value+=3;
      // Resource scarcity / production need.
      value+=RES.reduce((sum,r)=>sum+(take[r]||0)*(1.0+(nf.need[r]||1.0)*1.6),0);
      const pressurePenalty=Math.max(0,total(afterHand)-9)*0.35;
      value-=pressurePenalty;
      if(total(afterHand)<=9)value+=0.4;
      if(!best||value>best.value)best={resources:[a,b],value};
    }
  }
  return best;
}

function knownMemoryResourceEstimate(resource,me,turnState={},opponentId=null){
  const snapshots=turnState?.memorySnapshots||[];if(!snapshots.length)return 0;
  let weighted=0,totalWeight=0;
  const newest=snapshots.reduce((m,s)=>Math.max(m,Number(s.sequence)||0),0);
  for(const snap of snapshots){
    const age=Math.max(0,newest-(Number(snap.sequence)||0));
    const weight=Math.pow(0.72,age);
    for(const opp of (snap.players||[]).filter(x=>x.id!==me.id&&(opponentId==null||x.id===opponentId))){
      const count=Math.max(0,Number(opp.hand?.[resource]||0));
      weighted+=count*weight;totalWeight+=weight;
    }
  }
  return totalWeight?weighted/totalWeight:0;
}

function bestMonopolyTarget(p,players,board,geo,ports,bank,targetVP,deck,turnState={}){
  const cfg=botModeConfig(players,targetVP),need=NeedProfile(p,players,board,geo,bank,cfg).need;let best=null;
  const opponents=players.filter(x=>x.id!==p.id&&publicCardCount(x)>0);
  for(const r of RES){
    let expected=0;
    const prodByOpp={};
    for(const opp of opponents){
      const publicCount=Math.max(0,Number(opp.publicCardCount??total(opp.hand)));
      const prod=botProduction(opp,board,geo);prodByOpp[opp.id]=prod;
      const prodTotal=Object.values(prod).reduce((a,b)=>a+b,0)||1;
      const share=(prod[r]||0)/prodTotal;
      // Public hand size is exact; distribution is not. Production contributes only
      // a modest prior so memory can refine the estimate without becoming omniscient.
      const publicPrior=publicCount*(0.10+0.30*share);
      const remembered=knownMemoryResourceEstimate(r,p,turnState,opp.id);
      const memoryWeight=remembered>0?0.62:0;
      const estimate=clamp(publicPrior*(1-memoryWeight)+remembered*memoryWeight,0,publicCount);
      expected+=estimate;
    }
    if(expected<1.0)continue;
    const after=add(p.hand,{[r]:Math.floor(expected)});
    let value=expected*(1.6+(need[r]||1));
    if(canPay(after,COSTS.city))value+=16;
    if(canPay(after,COSTS.settlement))value+=14;
    if(canPay(after,COSTS.development))value+=6;
    const denial=opponents.reduce((sum,o)=>{
      const prod=prodByOpp[o.id]||{};return sum+(prod[r]||0)*(NeedProfile(o,players,board,geo,bank,cfg).need[r]||1);
    },0);
    value+=denial*1.8;
    // Do not burn Monopoly when it barely changes anything.
    value-=Math.max(0,1.5-expected)*8;
    if(!best||value>best.value)best={resource:r,value,expectedGain:expected};
  }
  return best;
}


function strategicRoadPathToSettlement(target,p,players,geo){
  if(!Number.isInteger(target))return null;
  const own=new Set(p.roads||[]),blocked=new Set(players.filter(x=>x.id!==p.id).flatMap(x=>[...(x.settlements||[]),...(x.cities||[])]));
  if(blocked.has(target))return null;
  const starts=[...(p.settlements||[]),...(p.cities||[])];
  for(const eid of own){const e=geo.edges[eid];if(e)starts.push(e.a,e.b);}
  const q=[],seen=new Set();
  for(const v of starts){if(blocked.has(v))continue;const k=`${v}|`;if(!seen.has(k)){seen.add(k);q.push({v,path:[]});}}
  while(q.length){
    const cur=q.shift(),virtual={...p,roads:[...(p.roads||[]),...cur.path]};
    for(const eid of geo.vertexEdges?.[cur.v]||[]){
      if(own.has(eid)||cur.path.includes(eid))continue;const e=geo.edges[eid];if(!e||!legalRoad(eid,virtual,players,geo))continue;
      const nv=e.a===cur.v?e.b:e.a;if(nv===target)return [...cur.path,eid];
    }
    if(cur.path.length>=5)continue;
    for(const eid of geo.vertexEdges?.[cur.v]||[]){
      if(own.has(eid)||cur.path.includes(eid))continue;const e=geo.edges[eid];if(!e||!legalRoad(eid,virtual,players,geo))continue;
      const nv=e.a===cur.v?e.b:e.a;if(blocked.has(nv)||nv===target)continue;
      const nextPath=[...cur.path,eid],key=`${nv}|${[...nextPath].sort((a,b)=>a-b).join(',')}`;if(seen.has(key))continue;seen.add(key);q.push({v:nv,path:nextPath});
    }
  }
  return null;
}

function unlockedSettlementCount(p,players,geo){let n=0;for(let v=0;v<geo.vertices.length;v++)if(legalSettlement(v,players,geo)&&settlementConnected(v,p,geo))n++;return n;}
function normalizeBundle(bundle){return RES.reduce((o,r)=>{o[r]=Math.max(0,Number(bundle?.[r]||0));return o;},{});}
function bundleTotal(bundle){return total(normalizeBundle(bundle));}
function bundleCanPay(hand,bundle){const b=normalizeBundle(bundle);return RES.every(r=>(hand?.[r]||0)>=b[r]);}
function bundlesShareResource(give,get){return RES.some(r=>(give?.[r]||0)>0&&(get?.[r]||0)>0);}
function bundleText(bundle){const b=normalizeBundle(bundle);const parts=RES.filter(r=>b[r]>0).map(r=>`${b[r]} ${LABEL[r]}`);return parts.length?parts.join(" + "):"nothing";}
function unifiedActionScore(action,p,players,board,geo,ports,bank,deck,targetVP,heldAwards,turnState={}){
  const cfg=botModeConfig(players,targetVP);const before=unifiedPosition(0,p,players,board,geo,ports,bank,targetVP,heldAwards);let nextP=p,nextPlayers=players,nextBank=bank,nextDeck=deck,nextBoard=board;
  if(action.type==="settlement"){nextP={...p,settlements:[...(p.settlements||[]),action.spot],vp:p.vp+1};nextPlayers=players.map(x=>x.id===p.id?nextP:x);}
  else if(action.type==="city"){nextP={...p,settlements:p.settlements.filter(v=>v!==action.spot),cities:[...(p.cities||[]),action.spot],vp:p.vp+1};nextPlayers=players.map(x=>x.id===p.id?nextP:x);}
  else if(action.type==="road"){nextP={...p,roads:[...(p.roads||[]),action.spot]};nextPlayers=players.map(x=>x.id===p.id?nextP:x);}
  else if(action.type==="trade"){nextP={...p,hand:add(pay(p.hand,{[action.give]:action.rate}),{[action.get]:1})};nextPlayers=players.map(x=>x.id===p.id?nextP:x);nextBank={...bank,[action.give]:(bank[action.give]||0)+action.rate,[action.get]:(bank[action.get]||0)-1};}
  else if(action.type==="play"){
    if(action.card==="Knight")nextP={...p,development:{...p.development,Knight:p.development.Knight-1,playedKnights:p.development.playedKnights+1}};
    else if(action.card==="Road Building")nextP={...p,development:{...p.development,[action.card]:p.development[action.card]-1},roads:[...(p.roads||[]),...(action.roads||[])]};
    else if(action.card==="Year of Plenty")nextP={...p,development:{...p.development,[action.card]:p.development[action.card]-1},hand:add(p.hand,action.resources||{})};
    else if(action.card==="Monopoly")nextP={...p,development:{...p.development,[action.card]:p.development[action.card]-1}};
    else if(action.card==="Victory Point")nextP={...p,development:{...p.development,VictoryPoint:p.development.VictoryPoint-1},vp:p.vp+1};
    nextPlayers=players.map(x=>x.id===p.id?nextP:x);
  }
  else if(action.type==="playerTrade"){
    const partner=players.find(x=>x.id===action.partner);
    if(partner){const giveBundle=normalizeBundle(action.giveBundle||{[action.give]:action.giveAmount}),getBundle=normalizeBundle(action.getBundle||{[action.get]:action.getAmount});nextP={...p,hand:add(pay(p.hand,giveBundle),getBundle)};nextPlayers=players.map(x=>x.id===p.id?nextP:x.id===partner.id?{...x,hand:add(pay(x.hand,getBundle),giveBundle)}:x);}
  }
  else if(action.type==="buyDev"){nextP={...p,hand:pay(p.hand,COSTS.development)};nextPlayers=players.map(x=>x.id===p.id?nextP:x);nextBank=add(bank,COSTS.development);}
  else if(action.type==="pass")return 0;
  if(action.type==="settlement"){
    const direct=placementScore(action.spot,p,players,board,geo,ports,bank,targetVP,heldAwards);
    // A settlement is a spot-selection decision. Use the production-first unified
    // placement value directly instead of comparing two whole-state scarcity profiles.
    // This prevents the act of adding a scarce resource from mechanically inflating
    // its own score through the before/after Need calculation.
    return direct + 1 - .25;
  }
  const after=unifiedPosition(0,nextP,nextPlayers,nextBoard,geo,ports,nextBank,targetVP,heldAwards);const dP=after.P-before.P,dC=after.C-before.C,dT=after.T-before.T,dE=after.E-before.E,dY=after.Y-before.Y;let denial=0,urgency=0;
  if(action.type==="settlement"){denial=cfg.beta*BlockValue(action.spot,p,players,board,geo,ports,bank,targetVP,cfg);urgency=UrgencyValue(action.spot,p,players,board,geo,ports,bank,targetVP,cfg);}
  const vpDelta=VPValueDelta(p,nextP,players,geo,heldAwards);const nextAwards=awards(nextPlayers,geo,heldAwards);const nextVP=nextP.vp+(nextAwards.roadOwner===nextP.id?2:0)+(nextAwards.armyOwner===nextP.id?2:0);const risk=RiskValue(action,p,players,board,geo,targetVP,cfg);const weightedTrade=action.type==="settlement"?0:after.phase.wT*dT;let score=after.phase.wP*dP+after.phase.wC*dC+weightedTrade+after.phase.wE*dE+after.phase.wY*dY+denial+after.phase.denialWeight*(action.type==="settlement"?BlockValue(action.spot,p,players,board,geo,ports,bank,targetVP,cfg):0)+urgency-after.phase.riskWeight*risk+vpDelta;
  if(nextVP>=targetVP)return 1000+vpDelta;
  if(action.type==="city")score+=settlementPieceScarcityPenalty(p);
  if(action.type==="settlement"&&piecesRemaining(p).cities<=1)score-=.9;
  if(action.type==="buyDev")score+=cardExpectedUtility(p,players,board,geo,ports,bank,deck,targetVP,cfg,turnState);
  if(action.type==="play"){
    if(action.card==="Road Building"){const combo=bestRoadBuildingPair(p,players,board,geo,ports,bank,targetVP,turnState?.deadline||null,turnState?.strategicPlan||null);score+=(combo?.value||0);}
    if(action.card==="Year of Plenty"){const pair=bestYearOfPlentyPair(p,players,board,geo,ports,bank,deck,targetVP,cfg,turnState);score+=(pair?.value||0)*.55;}
    if(action.card==="Monopoly"){const m=bestMonopolyTarget(p,players,board,geo,ports,bank,targetVP,deck,turnState);score+=(m?.value||0)*.8;if((m?.expectedGain||0)<1.2)score-=6;}
    if(action.card==="Knight"){const rob=chooseRobberAction(p,players,board,geo,ports,bank,targetVP,turnState?.memorySnapshots||[]);score+=(rob?.score||0)*.5+(p.development?.playedKnights>=2?6:0);}
    if(action.card==="Victory Point"&&action.winReveal)score=1000;
  }
  if(action.type==="playerTrade"){
    const partner=players.find(x=>x.id===action.partner);
    if(partner){
      const giveBundle=normalizeBundle(action.giveBundle||{[action.give]:action.giveAmount});
      const getBundle=normalizeBundle(action.getBundle||{[action.get]:action.getAmount});
      const selfAfter={...p,hand:add(pay(p.hand,giveBundle),getBundle)};
      const selfAfterV=unifiedPosition(0,selfAfter,players.map(x=>x.id===p.id?selfAfter:x),board,geo,ports,bank,targetVP,heldAwards);
      const selfDelta=(selfAfterV.P+selfAfterV.C+selfAfterV.T+selfAfterV.E+selfAfterV.Y)-(before.P+before.C+before.T+before.E+before.Y);
      // Opponent hand composition is private. Score only the public strategic value
      // of what the opponent receives, without fabricating hidden cards.
      const oppProd=botProduction(partner,board,geo),oppTotal=Object.values(oppProd).reduce((a,b)=>a+b,0)||1;
      const giveToOpp=RES.reduce((sum,r)=>sum+(giveBundle[r]||0)*(1+(oppProd[r]||0)/oppTotal*2),0);
      const oppHandBuffer=publicCardCount(partner);
      const congestion=Math.max(0,oppHandBuffer-8)*0.15;
      score+=selfDelta*0.95-giveToOpp*0.35+congestion;
      if(bundleTotal(getBundle)>bundleTotal(giveBundle))score+=0.6;
    }
  }

  return score;
}
function cardExpectedUtility(p,players,board,geo,ports,bank,deck,targetVP,cfg,turnState={}){
  const deadline=turnState?.deadline??null;
  const now=()=>typeof performance!=="undefined"&&performance.now?performance.now():Date.now();
  const probs=cardProbabilities(deck),gap=targetVP-openVictoryPoints(p,players,geo,turnState?.heldAwards);
  const y=now() < (deadline==null?Infinity:deadline-180) ? bestYearOfPlentyPair(p,players,board,geo,ports,bank,deck,targetVP,cfg,turnState) : null;
  const m=now() < (deadline==null?Infinity:deadline-180) ? bestMonopolyTarget(p,players,board,geo,ports,bank,targetVP,deck,turnState) : null;
  const rb=now() < (deadline==null?Infinity:deadline-260) ? bestRoadBuildingPair(p,players,board,geo,ports,bank,targetVP,deadline,turnState?.strategicPlan||null) : null;
  const army=awards(players,geo,turnState?.heldAwards||{roadOwner:null,armyOwner:null});
  const knightNeed=Math.max(0,3-(p.development?.playedKnights||0));
  const knightUtility=gap<=2?4.0:(knightNeed<=1?3.4:1.8);
  const rbUtility=rb?.value?Math.min(14,rb.value*.16):0;
  const yopUtility=y?.value?Math.min(14,y.value*.22):0;
  const monopolyUtility=m?.expectedGain?Math.min(16,m.expectedGain*(1.5+(NeedProfile(p,players,board,geo,bank,cfg).need[m.resource]||1))):0;
  const vpUtility=gap<=2?7.5:1.2;
  return (probs.Knight?.prob||0)*knightUtility
    +(probs["Road Building"]?.prob||0)*rbUtility
    +(probs["Year of Plenty"]?.prob||0)*yopUtility
    +(probs.Monopoly?.prob||0)*monopolyUtility
    +(probs["Victory Point"]?.prob||0)*vpUtility
    +(army.armyOwner===p.id?2:0);
}

function fastCardExpectedUtility(p,players,board,geo,ports,bank,deck,targetVP,heldAwards,turnState={},cache=null){
  const probs=cardProbabilities(deck),gap=Math.max(0,targetVP-openVictoryPoints(p,players,geo,heldAwards)),plan=turnState.strategicPlan||null;
  const missing=plan?.missing||empty();
  const missingTotal=plan?.totalMissing||Object.values(missing).reduce((a,b)=>a+b,0);
  const rbUtility=plan?.type==='settlement'?(plan.path?.length?10:4):2.5;
  const yopUtility=missingTotal>0?Math.min(12,5+missingTotal*1.5):2.0;
  const memory=turnState.memorySnapshots||[];
  let monopolyGain=0;
  if(memory.length){
    const latest=memory[memory.length-1]?.players||[];
    for(const opp of latest){if(opp.id===p.id)continue;monopolyGain=Math.max(monopolyGain,...RES.map(r=>opp.hand?.[r]||0));}
  }else{
    monopolyGain=Math.max(...RES.map(r=>players.filter(x=>x.id!==p.id).reduce((n,o)=>n+Math.min(3,publicCardCount(o)/5),0)));
  }
  const monopolyUtility=Math.min(10,monopolyGain*(1.4+(plan?.type==='settlement'?1.2:0)));
  const knightUtility=gap<=2?4.4:(p.development?.playedKnights>=2?3.8:2.0);
  const vpUtility=gap<=2?8:1;
  const army=(heldAwards?.armyOwner===p.id?2:0)+(p.development?.playedKnights>=2?5:0);
  return(probs.Knight?.prob||0)*knightUtility+(probs["Road Building"]?.prob||0)*rbUtility+(probs["Year of Plenty"]?.prob||0)*yopUtility+(probs.Monopoly?.prob||0)*monopolyUtility+(probs["Victory Point"]?.prob||0)*vpUtility+army;
}
function botRacePressure(p,players,geo,targetVP,heldAwards={}){
  const self=openVictoryPoints(p,players,geo,heldAwards);
  const gaps=players.filter(o=>o.id!==p.id).map(o=>Math.max(0,targetVP-openVictoryPoints(o,players,geo,heldAwards)));
  const nearest=Math.min(...gaps,Infinity);
  if(!Number.isFinite(nearest))return 0;
  // In 1v1, the opponent is the entire race, so a close opponent deserves
  // materially more weight than generic production.
  const duel=players.length===2;
  if(nearest<=1)return duel?8.5:6.0;
  if(nearest<=2)return duel?5.5:3.5;
  if(nearest<=3)return duel?3.0:1.5;
  return self>=targetVP-3?(duel?2.0:1.0):0;
}
function botSettlementOpportunityAfterRoad(eid,p,players,board,geo,ports,bank,targetVP,deadline=null){
  const e=geo.edges[eid];
  if(!e)return {best:-Infinity,port:0,longest:0,future:0};
  const now=()=>typeof performance!=="undefined"&&performance.now?performance.now():Date.now();
  const virtual={...p,roads:[...(p.roads||[]),eid]};
  const virtualPlayers=players.map(x=>x.id===p.id?virtual:x);
  let best=-Infinity, future=-Infinity;
  const seen=new Set();
  for(const endpoint of [e.a,e.b]){
    for(const n of (geo.neighbors[endpoint]||[])){
      if(deadline!=null&&now()>=deadline)return {best:Number.isFinite(best)?best:0,port:([e.a,e.b]).some(v=>!!portAt(v,ports))?1:0,longest:0,future:Number.isFinite(future)?future:0};
      if(seen.has(n))continue;seen.add(n);
      if(!legalSettlement(n,virtualPlayers,geo)||!settlementConnected(n,virtual,geo))continue;
      const value=quickSpotValue(n,virtual,virtualPlayers,board,geo,ports,bank,targetVP,botModeConfig(players,targetVP));
      if(value>best)best=value;
    }
  }
  // Deep future expansion is useful, but it is the most expensive road-search step.
  // Bound it aggressively so a bot can never monopolize the main thread.
  if(deadline==null || now()<deadline-90){
    const futureSeen=new Set();
    for(const endpoint of [e.a,e.b]){
      const items=reachableFutureSpots(endpoint,virtual,virtualPlayers,board,geo,ports,bank,targetVP,botModeConfig(players,targetVP))||[];
      for(const item of items.slice(0,10)){
        if(deadline!=null&&now()>=deadline-60)break;
        const v=item?.v;
        if(!Number.isInteger(v)||futureSeen.has(v)||!legalSettlement(v,virtualPlayers,geo))continue;
        futureSeen.add(v);
        const value=quickSpotValue(v,virtual,virtualPlayers,board,geo,ports,bank,targetVP,botModeConfig(players,targetVP));
        future=Math.max(future,value-Math.max(0,item.roads||0)*1.75);
      }
    }
  }
  const before=awards(players,geo,{roadOwner:null,armyOwner:null});
  const after=awards(virtualPlayers,geo,{roadOwner:null,armyOwner:null});
  const longest=after.roadOwner===p.id&&before.roadOwner!==p.id?2*BOT_LONGEST_ROAD_PRIORITY:after.roadOwner===p.id&&before.roadOwner===p.id?Math.max(0,connectedRoadLength(virtual,geo,virtualPlayers)-connectedRoadLength(p,geo,players))*0.08:0;
  const port=([e.a,e.b]).some(v=>!!portAt(v,ports))?1:0;
  return {best,future,longest,port};
}

function tradeEnablerValue(action,p,players,board,geo,ports,bank,deck,targetVP,heldAwards){
  if(!['trade','playerTrade'].includes(action.type))return 0;
  const giveBundle=action.type==='trade'?{[action.give]:action.rate}:{[action.give]:action.giveAmount};
  const getBundle=action.type==='trade'?{[action.get]:1}:{[action.get]:action.getAmount};
  const afterHand=add(pay(p.hand,giveBundle),getBundle);
  let best=-Infinity;
  const virtual={...p,hand:afterHand};
  const virtualPlayers=players.map(x=>x.id===p.id?virtual:x);
  for(const v of (p.settlements||[])){
    if(canPay(afterHand,COSTS.city))best=Math.max(best,6+2*botPipValue(12));
  }
  if(piecesRemaining(p).settlements>0&&canPay(afterHand,COSTS.settlement)){
    for(let v=0;v<geo.vertices.length;v++){
      if(legalSettlement(v,virtualPlayers,geo)&&settlementConnected(v,virtual,geo))best=Math.max(best,placementScore(v,virtual,virtualPlayers,board,geo,ports,bank,targetVP));
    }
  }
  if(canBuyDevelopmentCard(virtual,deck))best=Math.max(best,cardExpectedUtility(virtual,virtualPlayers,board,geo,ports,bank,deck,targetVP,botModeConfig(players,targetVP)));
  if(!Number.isFinite(best))return 0;
  const opponentPenalty=action.type==='playerTrade'?0.9:0;
  return best*0.55-opponentPenalty;
}
function makeScoreCache(players,board,geo,ports,bank,targetVP){
  return{legal:null,spots:new Map(),ranks:new Map(),future:new Map(),threats:new Map(),modeCfg:botModeConfig(players,targetVP)};
}
function memoryResourcePressure(memorySnapshots,oppId){
  const pressure=Object.fromEntries(RES.map(r=>[r,0]));
  const relevant=(memorySnapshots||[]).filter(s=>s?.players?.some(p=>p.id===oppId));
  if(!relevant.length)return pressure;
  let weight=1,totalWeight=0;
  for(let i=relevant.length-1;i>=0;i--){
    const snap=relevant[i], remembered=snap.players.find(p=>p.id===oppId);
    if(!remembered){weight*=.78;continue;}
    RES.forEach(r=>pressure[r]+=((remembered.hand?.[r]||0))*weight);
    totalWeight+=weight; weight*=.78;
  }
  if(totalWeight>0)RES.forEach(r=>pressure[r]/=totalWeight);
  return pressure;
}
function spotProductionVertexTileLess(tid,board){const out=empty();const t=board[tid];if(t&&t.resource!=="desert"&&!t.robber)out[t.resource]=(PROB[t.number]||0)/36;return out;}
function fastHumanRecommendation(p,players,board,geo,ports,bank,deck,targetVP,heldAwards={roadOwner:null,armyOwner:null}){
  const openVP=openVictoryPoints(p,players,geo,heldAwards);
  if(p.development?.VictoryPoint>0 && openVP+p.development.VictoryPoint>=targetVP)return {type:"play",card:"Victory Point",winReveal:true};
  if(canPay(p.hand,COSTS.city)&&p.settlements?.length){let best=null;for(const spot of p.settlements){const sp=spotProduction(spot,board,geo);const val=Object.values(sp).reduce((a,b)=>a+b,0)*100+20;if(!best||val>best.score)best={type:"city",spot,score:val};}if(best)return best;}
  if(canPay(p.hand,COSTS.settlement)&&piecesRemaining(p).settlements>0){let best=null;for(let v=0;v<geo.vertices.length;v++){if(!legalSettlement(v,players,geo)||!settlementConnected(v,p,geo))continue;const sp=spotProduction(v,board,geo);const pips=Object.values(sp).reduce((a,b)=>a+b,0);const variety=Object.values(sp).filter(x=>x>0).length;const val=pips*100+variety*8+(portAt(v,ports)?6:0);if(!best||val>best.score)best={type:"settlement",spot:v,score:val};}if(best)return best;}
  if(canBuyDevelopmentCard(p,deck)&&total(p.hand)>=BOT_HAND_PRESSURE_THRESHOLD)return {type:"buyDev",score:10};
  if(canPay(p.hand,COSTS.road)&&piecesRemaining(p).roads>0){let best=null;for(const e of geo.edges){if(!legalRoad(e.id,p,players,geo))continue;const val=[e.a,e.b].reduce((n,v)=>n+(geo.neighbors[v]||[]).filter(x=>legalSettlement(x,players,geo)).length*2.5+(portAt(v,ports)?2:0),0);if(!best||val>best.score)best={type:"road",spot:e.id,score:val};}if(best)return best;}
  if(canBuyDevelopmentCard(p,deck))return {type:"buyDev",score:2};
  return {type:"pass",score:0};
}
function aiPlan(p,players,board,geo,deck,ports,targetVP,bank=emptyBank(),heldAwards={roadOwner:null,armyOwner:null},turnState={}){const best=fastHumanRecommendation(p,players,board,geo,ports,bank,deck,targetVP,heldAwards);return{...best,reason:decisionReason(best,p,players,board,geo,ports,bank,targetVP)};}
function decisionReason(action,p,players,board,geo,ports,bank,targetVP){if(action.type==="settlement"){const nf=NeedProfile(p,players,board,geo,bank,botModeConfig(players,targetVP)),sp=spotProduction(action.spot,board,geo),parts=RES.filter(r=>sp[r]>0).sort((a,b)=>sp[b]*nf.need[b]-sp[a]*nf.need[a]).slice(0,3).map(r=>`+P(${r} ${(sp[r]*36).toFixed(1)}) +Need(${nf.need[r].toFixed(2)})`);if(portAt(action.spot,ports)&&action.portEligibleForTie)parts.push(`+Port tie-break(${portAt(action.spot,ports).type})`);return parts.join(" ")+` => V=${action.score.toFixed(2)}, chosen`;}if(action.type==="city")return `+VP(1) +production doubled at ${action.spot} => V=${action.score.toFixed(2)}, chosen`;if(action.type==="road")return `+E(expansion) +Y(road network) => V=${action.score.toFixed(2)}, chosen`;if(action.type==="trade")return `+T(port/bank conversion) ${LABEL[action.give]}→${LABEL[action.get]} => V=${action.score.toFixed(2)}, chosen`;if(action.type==="buyDev")return `+cardExpectedUtility => V=${action.score.toFixed(2)}, chosen`;if(action.type==="play")return `+${action.card} strategic value => V=${action.score.toFixed(2)}, chosen`;return `No positive action => pass`}
function actionLabel(a){return a?.type==="buyDev"?"Development card":a?.type==="settlement"?"Settlement":a?.type==="road"?"Road":a?.type==="city"?"City":a?.type==="trade"||a?.type==="playerTrade"?"Trade":a?.type==="play"?`Play ${a.card}`:a?.type||"Pass";}
function loadHistory(){
  try{
    const keys=[HISTORY_KEY,LEGACY_MONOPOLY_HISTORY_KEY,...LEGACY_HISTORY_KEYS];
    for(const key of keys){
      const raw=localStorage.getItem(key);if(!raw)continue;
      const parsed=JSON.parse(raw);
      if(!Array.isArray(parsed)||!parsed.length)continue;
      const valid=parsed.filter(x=>x&&x.id&&Array.isArray(x.players)&&Array.isArray(x.board));
      if(valid.length)return valid.slice(0,30);
    }
    return [];
  }catch{return[]}
}

/* v37 — inline SVG icon set (no external assets). Stroke icons follow currentColor; colored icons carry their own fills. */
const STROKE_ICO=new Set(["home","game","clock","gear","help","power","dice","robber","flag","trade","bank","hourglass","chevron","sword","roadb","sprout","coins","star"]);
const ICO={
  home:<><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h5v-6h3v6h5V10"/></>,
  game:<><path d="M7 8h10a4 4 0 0 1 4 4v3a3 3 0 0 1-5.4 1.8L14 15h-4l-1.6 1.8A3 3 0 0 1 3 15v-3a4 4 0 0 1 4-4z"/><path d="M8 10.5v3M6.5 12h3"/><circle cx="15.5" cy="11.2" r=".7" fill="currentColor"/><circle cx="17.6" cy="13" r=".7" fill="currentColor"/></>,
  clock:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.2 2"/></>,
  gear:<><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2.4"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/></>,
  help:<><path d="M8.6 9.2a3.4 3.4 0 1 1 4.8 3c-1 .5-1.4 1.1-1.4 2.2"/><path d="M12 18.2v.2"/></>,
  power:<><path d="M12 3v8.5"/><path d="M6.6 6.6a8 8 0 1 0 10.8 0"/></>,
  dice:<><rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="9" cy="9" r="1.3" fill="currentColor"/><circle cx="15" cy="9" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="9" cy="15" r="1.3" fill="currentColor"/><circle cx="15" cy="15" r="1.3" fill="currentColor"/></>,
  robber:<><path d="M12 3c-4 0-6.5 3-6.5 7v10l2.4-1.8L10 20l2-1.8 2 1.8 2.1-1.8L18.5 20V10c0-4-2.5-7-6.5-7z"/><circle cx="9.6" cy="11" r="1.2" fill="currentColor"/><circle cx="14.4" cy="11" r="1.2" fill="currentColor"/></>,
  flag:<><path d="M5 21V3.5"/><path d="M5 4.5h14l-2.4 4 2.4 4H5"/><path d="M9 4.5v8M13 4.5v8" opacity=".6"/></>,
  trade:<><path d="M4 8h15M15 4l4 4-4 4"/><path d="M20 16H5M9 12l-4 4 4 4"/></>,
  bank:<><path d="M3 9.5 12 4l9 5.5z"/><path d="M6 12v6M10 12v6M14 12v6M18 12v6M3.5 20.5h17"/></>,
  hourglass:<><path d="M6.5 3h11M6.5 21h11"/><path d="M7.5 3c0 5 4.5 6 4.5 9s-4.5 4-4.5 9M16.5 3c0 5-4.5 6-4.5 9s4.5 4 4.5 9"/></>,
  chevron:<path d="m9 5 7 7-7 7"/>,
  sword:<><path d="M14 4h6v6L10 20l-6-6z"/><path d="M4 20l3.5-3.5M6.5 13.5l4 4"/></>,
  roadb:<><path d="M8.5 3 4 21M15.5 3 20 21"/><path d="M12 5v3M12 11v3M12 17v3"/></>,
  sprout:<><path d="M12 21V10"/><path d="M12 13c-4.2 0-6.4-2.2-6.4-5.6 4.2 0 6.4 2.2 6.4 5.6zM12 16c4.2 0 6.4-2.2 6.4-5.6-4.2 0-6.4 2.2-6.4 5.6z"/></>,
  coins:<><circle cx="9" cy="9" r="5.2"/><path d="M13.5 13.6A5.2 5.2 0 1 0 14.5 9"/></>,
  star:<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>,
  cube:<><path d="M12 2 21 7v10l-9 5-9-5V7z" fill="#3f63f0"/><path d="M12 2 21 7l-9 5-9-5z" fill="#93b4ff"/><path d="M12 12v10l-9-5V7z" fill="#5b3fd4"/><path d="M12 8.2l3.8 2.1v4.4L12 16.8l-3.8-2.1v-4.4z" fill="#ff9d1a"/><path d="M12 8.2l3.8 2.1L12 12.4 8.2 10.3z" fill="#ffd27a"/></>,
  info:<><circle cx="12" cy="12" r="10" fill="#2f8bff"/><path d="M12 11v6" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"/><circle cx="12" cy="7.4" r="1.4" fill="#fff"/></>,
  crown:<><path d="M3 8l4.6 4.2L12 4.5l4.4 7.7L21 8l-1.8 11H4.8z" fill="#ffc933" stroke="#ff9d00" strokeWidth="1.2" strokeLinejoin="round"/><rect x="5" y="19.6" width="14" height="2" rx="1" fill="#ff9d00"/></>,
  bot:<><rect x="4" y="7.5" width="16" height="12" rx="4.5" fill="currentColor"/><rect x="1.8" y="11.5" width="2.2" height="4.5" rx="1" fill="currentColor"/><rect x="20" y="11.5" width="2.2" height="4.5" rx="1" fill="currentColor"/><path d="M12 7.5V4.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><circle cx="12" cy="3.6" r="1.7" fill="currentColor"/><circle cx="8.8" cy="13" r="2.1" fill="#fff"/><circle cx="15.2" cy="13" r="2.1" fill="#fff"/><circle cx="8.8" cy="13" r=".9" fill="#101a44"/><circle cx="15.2" cy="13" r=".9" fill="#101a44"/></>,
  user:<><circle cx="12" cy="8" r="4.4" fill="currentColor"/><path d="M3.6 21c0-4.8 3.7-7.8 8.4-7.8s8.4 3 8.4 7.8z" fill="currentColor"/></>,
  wood:<g transform="rotate(-28 12 12)"><rect x="2.5" y="7.5" width="19" height="9" rx="3.2" fill="#d9822b"/><rect x="2.5" y="7.5" width="19" height="3.6" rx="1.8" fill="#ffc06b"/><ellipse cx="19.3" cy="12" rx="2.3" ry="4.5" fill="#f4b062" stroke="#8a4a14" strokeWidth=".9"/><ellipse cx="19.3" cy="12" rx="1" ry="2" fill="none" stroke="#8a4a14" strokeWidth=".7"/></g>,
  brick:<><rect x="2.5" y="5" width="19" height="14" rx="2" fill="#e2452c"/><rect x="2.5" y="5" width="19" height="4.7" rx="2" fill="#ff8a5c" opacity=".6"/><path d="M2.5 9.7h19M2.5 14.4h19M9 5v4.7M16 9.7v4.7M9 14.4V19" stroke="#ffc1a8" strokeWidth="1" opacity=".85"/></>,
  sheep:<><circle cx="8" cy="10.5" r="4" fill="#fff"/><circle cx="12" cy="8.6" r="4.2" fill="#fff"/><circle cx="15.5" cy="10.5" r="4" fill="#fff"/><circle cx="11.5" cy="13.2" r="4.2" fill="#eef3ff"/><ellipse cx="19" cy="12.6" rx="2.6" ry="3" fill="#2b2f3a"/><rect x="8" y="16" width="1.7" height="4.4" rx=".85" fill="#2b2f3a"/><rect x="14" y="16" width="1.7" height="4.4" rx=".85" fill="#2b2f3a"/></>,
  wheat:<g fill="#ffc21f" stroke="#e08c00" strokeWidth=".6"><path d="M12 22V8" stroke="#e09a10" strokeWidth="1.6" strokeLinecap="round" fill="none"/><ellipse cx="12" cy="4.6" rx="2.2" ry="3.4"/><ellipse cx="8.2" cy="8.8" rx="2" ry="3.2" transform="rotate(-35 8.2 8.8)"/><ellipse cx="15.8" cy="8.8" rx="2" ry="3.2" transform="rotate(35 15.8 8.8)"/><ellipse cx="8.4" cy="13.8" rx="2" ry="3.2" transform="rotate(-35 8.4 13.8)"/><ellipse cx="15.6" cy="13.8" rx="2" ry="3.2" transform="rotate(35 15.6 13.8)"/></g>,
  ore:<><path d="M3 15 7 8h11l3.5 7z" fill="#b4bfd2"/><path d="M3 15h18.5v3.5a1.5 1.5 0 0 1-1.5 1.5H4.5A1.5 1.5 0 0 1 3 18.5z" fill="#6f7b92"/><path d="M7 8h11l-1.6 3H8.8z" fill="#eef2fb"/></>,
  house:<><path d="M12 3 2.5 11.5h3V21h5v-6h3v6h5v-9.5h3z" fill="#ffa62b"/><path d="M12 3 2.5 11.5h19z" fill="#ffd27a"/></>,
  city:<><path d="M3 21V11h5.5V7.5L12 4l3.5 3.5V11H21v10z" fill="#3ad8ff"/><path d="M8.5 11h7v10h-7z" fill="#8bf0ff" opacity=".55"/><path d="M6 14h1.6M6 17h1.6M16.4 14H18M16.4 17H18M11.2 9h1.6M11.2 13h1.6M11.2 17h1.6" stroke="#0a3d7a" strokeWidth="1.3"/></>,
  road:<><path d="M9 3h6l6 18H3z" fill="#4a8dff"/><path d="M12 5.5v3M12 11.5v3M12 17.5v3" stroke="#eaf4ff" strokeWidth="1.7" strokeLinecap="round"/></>,
  card:<><rect x="5" y="2.5" width="14" height="19" rx="2.6" fill="currentColor" fillOpacity=".22" stroke="currentColor" strokeWidth="1.7"/><path d="m12 7.6 1.5 3 3.3.5-2.4 2.3.6 3.3-3-1.6-3 1.6.6-3.3-2.4-2.3 3.3-.5z" fill="currentColor"/></>,
  pawn:<><circle cx="12" cy="6.6" r="3.5" fill="#efe4c8"/><path d="M7.8 19.5c0-4.2 1.3-6.4 4.2-7.4 2.9 1 4.2 3.2 4.2 7.4z" fill="#efe4c8"/><rect x="6.2" y="19" width="11.6" height="2.8" rx="1.4" fill="#cdbf9b"/></>,
  chart:<><rect x="3.5" y="12" width="4.6" height="9" rx="1" fill="#38d6ff"/><rect x="9.7" y="4" width="4.6" height="17" rx="1" fill="#38d6ff"/><rect x="15.9" y="9" width="4.6" height="12" rx="1" fill="#38d6ff"/></>
};
function Ico({n}){const g=ICO[n];if(!g)return null;return <svg viewBox="0 0 24 24" className={`ico ${STROKE_ICO.has(n)?"st":""}`} aria-hidden="true" focusable="false">{g}</svg>;}
const DEV_STYLE={Knight:{ico:"sword",c:"#ffb020"},"Road Building":{ico:"roadb",c:"#39e86b"},"Year of Plenty":{ico:"sprout",c:"#b56bff"},Monopoly:{ico:"coins",c:"#ff3d6e"},"Victory Point":{ico:"star",c:"#8f7bff"}};
const devCount=p=>Object.keys(DEV).reduce((a,k)=>a+(p?.development?.[k]||0),0);
function logIcon(t){const s=String(t).toLowerCase();if(/roll/.test(s))return"dice";if(/robber/.test(s))return"pawn";if(/built|settlement|city|road/.test(s))return"house";if(/development|dev card|knight|monopoly|year of plenty|received|card/.test(s))return"card";if(/your turn|new .*game|setup complete/.test(s))return"crown";if(/ended|turn|thinking|analyz/.test(s))return"bot";return"ore";}
function splitLog(t){const s=String(t);const m=s.split(/\s+[—–]\s+/);return m.length>1?[m[0],m.slice(1).join(" — ")]:[s,""];}
function BotChip({name,status}){
  const [t,setT]=useState(0);
  useEffect(()=>{const s=Date.now();const id=setInterval(()=>setT(Math.min(BOT_MAX_TURN_MS/1000,(Date.now()-s)/1000)),100);return()=>clearInterval(id)},[]);
  const label=status==="rolling"?"is rolling the dice…":status==="acting"?"is executing best moves…":"is thinking…";
  const budget=Math.min(BOT_MAX_TURN_MS/1000,t);
  return <div className="hxChip bot"><Ico n="crown"/><span><b>{name}</b> {label}</span><i className="hxChipBar"><u style={{width:`${Math.min(100,(budget/(BOT_MAX_TURN_MS/1000))*100)}%`}}/></i><em>{budget.toFixed(1)}s / 4.5s</em></div>;
}

const THEME_KEY="monopoly.uiTheme.v1";
const LEGACY_THEME_KEY="hexbound.uiTheme.v1";
const UI_THEMES={
  Blue:{cyan:"#4ea1ff",green:"#7bb8ff",blue:"#4ea1ff",purple:"#8b7cff",pink:"#78b7ff",yellow:"#dbeaff",border:"#2e5fa8"},
  Green:{cyan:"#25f08a",green:"#00ff66",blue:"#3bd58c",purple:"#6dffb6",pink:"#52d9a0",yellow:"#c9ff76",border:"#256b47"},
  Pink:{cyan:"#ff79ba",green:"#ffb3d7",blue:"#ff6da9",purple:"#ff4f9f",pink:"#ff2bd6",yellow:"#ffd0ea",border:"#8d2f62"},
  Cyan:{cyan:"#00f6ff",green:"#b7ff00",blue:"#2488ff",purple:"#b14cff",pink:"#ff2bd6",yellow:"#ffd43b",border:"#176c82"},
  Magenta:{cyan:"#e45cff",green:"#ff74e8",blue:"#b85cff",purple:"#ff2bd6",pink:"#ff2bd6",yellow:"#ffc9f3",border:"#7d2b88"},
  Black:{cyan:"#ffffff",green:"#d7d7d7",blue:"#ffffff",purple:"#bdbdbd",pink:"#8f8f8f",yellow:"#ffffff",border:"#555555"},
  White:{cyan:"#ffffff",green:"#f1f5f9",blue:"#ffffff",purple:"#e2e8f0",pink:"#ffffff",yellow:"#ffffff",border:"#d7dde5"},
  Red:{cyan:"#ff5b6e",green:"#ff9b8e",blue:"#ff4d61",purple:"#ff7585",pink:"#ff3344",yellow:"#ffd0b7",border:"#8a2936"},
  Orange:{cyan:"#ffb347",green:"#ffd166",blue:"#ff9f43",purple:"#ff8c42",pink:"#ff7849",yellow:"#ffe39a",border:"#87502a"}
};
const ANALYSIS_CLASSIFICATIONS=[
  {key:"blunder",icon:"💥",label:"BLUNDER",min:-Infinity,max:-0.08},
  {key:"mistake",icon:"❓",label:"MISTAKE",min:-0.08,max:-0.03},
  {key:"inaccuracy",icon:"🟡",label:"INACCURACY",min:-0.03,max:0.015},
  {key:"good",icon:"🟢",label:"GOOD",min:0.015,max:0.035},
  {key:"great",icon:"⭐",label:"GREAT",min:0.035,max:0.08},
  {key:"brilliant",icon:"💎",label:"BRILLIANT",min:0.08,max:Infinity}
];
function classifyAnalysisMove(delta,actionType="") {
  const d=Number(delta)||0;
  const base=ANALYSIS_CLASSIFICATIONS.find(x=>d>=x.min&&d<x.max)||ANALYSIS_CLASSIFICATIONS[2];
  if(base.key==="brilliant"&&["robber","play Monopoly"].some(x=>String(actionType).includes(x)))return ANALYSIS_CLASSIFICATIONS.find(x=>x.key==="great");
  return base;
}

const ANALYSIS_ACCURACY_WEIGHT={blunder:0,mistake:20,inaccuracy:50,good:75,great:90,brilliant:100};
function analysisAccuracy(frames,playerId=null){
  const usable=(frames||[]).filter(f=>f?.classification?.key && (playerId==null||f.playerId===playerId));
  if(!usable.length)return null;
  return Math.round(usable.reduce((sum,f)=>sum+(ANALYSIS_ACCURACY_WEIGHT[f.classification.key]??50),0)/usable.length);
}
function analysisRoleStats(frames,players){
  const out={overall:analysisAccuracy(frames),players:{}};
  for(const p of players||[])out.players[p.id]={name:p.name,bot:!!p.bot,accuracy:analysisAccuracy(frames,p.id),turns:(frames||[]).filter(f=>f.playerId===p.id&&f.classification).length};
  return out;
}
function themeVars(name){
  const t=UI_THEMES[name]||UI_THEMES.Cyan;
  return {
    "--neon-cyan":t.cyan,"--neon-green":t.green,"--neon-blue":t.blue,"--neon-purple":t.purple,"--neon-pink":t.pink,"--neon-yellow":t.yellow,
    "--panel-border":t.border,"--theme-primary":t.cyan,"--theme-secondary":t.green,"--theme-panel-border":t.border
  };
}