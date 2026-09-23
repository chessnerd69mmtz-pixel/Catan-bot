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

function engineActionText(action, players){
  if(!action)return "No move found";
  if(action.type==="settlement")return `Build settlement at intersection ${action.spot}`;
  if(action.type==="city")return `Upgrade settlement at intersection ${action.spot} to a city`;
  if(action.type==="road")return `Build road on edge ${action.spot}`;
  if(action.type==="buyDev")return "Buy a development card";
  if(action.type==="trade")return `Bank trade: ${action.rate}:1 ${LABEL[action.give]} → ${LABEL[action.get]}`;
  if(action.type==="playerTrade"){
    const partner=players.find(p=>p.id===action.partner)?.name||`Player ${action.partner}`;
    const give=normalizeBundle(action.giveBundle||{[action.give]:action.giveAmount});const get=normalizeBundle(action.getBundle||{[action.get]:action.getAmount});
    return `Trade with ${partner}: ${bundleText(give)} → ${bundleText(get)}`;
  }
  if(action.type==="play")return `Play ${action.card}`;
  return action.type;
}
function engineStrength(p,players,board,geo,ports,bank,targetVP){
  const cfg=botModeConfig(players,targetVP);const prod=botProduction(p,board,geo);
  const productionValue=RES.reduce((a,r)=>a+prod[r],0);
  const needProfile=NeedProfile(p,players,board,geo,bank,cfg);
  const handValue=RES.reduce((a,r)=>a+(p.hand?.[r]||0)*(needProfile.need[r]||1),0);
  const pieces=piecesRemaining(p);const award=awards(players,geo,{roadOwner:null,armyOwner:null});
  const awardVP=(award.roadOwner===p.id?2:0)+(award.armyOwner===p.id?2:0);
  const devValue=Object.entries(p.development||{}).filter(([k])=>k!=="playedKnights").reduce((a,[k,n])=>a+n*(k==="Victory Point"?5.0:k==="Knight"?1.6:1.3),0);
  const portValue=(p.settlements||[]).concat(p.cities||[]).reduce((a,v)=>a+(portAt(v,ports)?1.8:0),0);
  const buildReady=(canPay(p.hand,COSTS.city)?3.5:0)+(canPay(p.hand,COSTS.settlement)&&pieces.settlements>0?3.8:0);
  const vpNeed=Math.max(0,targetVP-(p.vp+awardVP));
  const threat=1/(1+vpNeed);
  // Longest Road is intentionally a low-weight secondary factor.
  const road=connectedRoadLength(p,geo,players);
  return p.vp*10 + awardVP*10 + productionValue*9.5 + handValue*1.0 + buildReady*4.0 + devValue + portValue + threat*5 + road*0.08;
}

function engineWinLikelihood(players,board,geo,ports,bank,targetVP){
  const raw=players.map(p=>engineStrength(p,players,board,geo,ports,bank,targetVP));
  if(players.length===2){
    const margin=raw[0]-raw[1];
    const p0=1/(1+Math.exp(-margin/18));
    return players.map((p,i)=>({id:p.id,name:p.name,value:raw[i],prob:i===0?p0:1-p0}));
  }
  const max=Math.max(...raw,0);const weights=raw.map(x=>Math.exp((x-max)/14));const totalW=weights.reduce((a,b)=>a+b,0)||1;
  return players.map((p,i)=>({id:p.id,name:p.name,value:raw[i],prob:weights[i]/totalW}));
}

function engineActionBreakdown(action,{active,players,board,geo,ports,bank,deck,targetVP,heldAwards}){
  if(!action)return [];
  const rows=[];
  if(action.type==="settlement"){
    const sp=spotProduction(action.spot,board,geo),pips=RES.reduce((n,r)=>n+sp[r]*36,0),nums=(geo.vertexTiles[action.spot]||[]).map(tid=>board[tid]?.number).filter(Number.isFinite);
    const high=nums.filter(n=>n===6||n===8).length,ore=(sp.ore||0)*36,wheat=(sp.wheat||0)*36,port=portAt(action.spot,ports);
    rows.push({label:"Production",value:pips.toFixed(1)+" pips",tone:pips>=10?"up":pips>=7?"flat":"down"});
    rows.push({label:"Diversity",value:RES.filter(r=>sp[r]>0).length+"/5",tone:RES.filter(r=>sp[r]>0).length>=4?"up":"flat"});
    rows.push({label:"6 / 8",value:high?high+" token(s)":"none",tone:high>=2?"up":high===1?"flat":"down"});
    rows.push({label:"Ore + Wheat",value:ore.toFixed(1)+" + "+wheat.toFixed(1),tone:ore>=4&&wheat>=4?"up":"flat"});
    if(port)rows.push({label:"Port",value:port.type,tone:"up"});
    const contest=opponentTakeProbability(action.spot,active,players,board,geo,ports,bank,targetVP,botModeConfig(players,targetVP));
    rows.push({label:"Contest risk",value:Math.round(contest*100)+"%",tone:contest>.65?"down":contest>.3?"flat":"up"});
  }else if(action.type==="city"){
    const sp=spotProduction(action.spot,board,geo),pips=RES.reduce((n,r)=>n+sp[r]*36,0);
    rows.push({label:"Immediate VP",value:"+1 VP",tone:"up"});
    rows.push({label:"Production doubled",value:pips.toFixed(1)+" pips",tone:pips>=8?"up":"flat"});
  }else if(action.type==="road"){
    const potential=roadActionPotential(action.spot,active,players,board,geo,targetVP,ports,bank),e=geo.edges[action.spot];
    const future=[e?.a,e?.b].flatMap(v=>v==null?[]:(geo.neighbors[v]||[])).filter(v=>legalSettlement(v,players,geo)).length;
    rows.push({label:"Network value",value:potential.toFixed(2),tone:potential>12?"up":"flat"});
    rows.push({label:"Future access",value:String(future),tone:future>=2?"up":"flat"});
  }else if(action.type==="trade"||action.type==="playerTrade"){
    const value=fastTradeOpportunity(action,active,players,board,geo,ports,bank,deck,targetVP,heldAwards,null,{});
    rows.push({label:"Trade value",value:Number.isFinite(value)?value.toFixed(2):"—",tone:value>20?"up":value>5?"flat":"down"});
    rows.push({label:"Give",value:action.type==="trade"?action.rate+":1 "+LABEL[action.give]:bundleText(action.giveBundle||{[action.give]:action.giveAmount}),tone:"flat"});
    rows.push({label:"Receive",value:action.type==="trade"?LABEL[action.get]:bundleText(action.getBundle||{[action.get]:action.getAmount}),tone:"up"});
  }else if(action.type==="buyDev"){
    const value=cardExpectedUtility(active,players,board,geo,ports,bank,deck,targetVP,botModeConfig(players,targetVP));
    rows.push({label:"Card utility",value:Number.isFinite(value)?value.toFixed(2):"—",tone:value>8?"up":value>3?"flat":"down"});
    rows.push({label:"Deck remaining",value:String(deck?.length||0),tone:"flat"});
  }else if(action.type==="play"){
    rows.push({label:"Development",value:action.card,tone:"up"});
    if(action.card==="Knight")rows.push({label:"Robber impact",value:"Block + one random physical card",tone:"flat"});
    if(action.card==="Road Building")rows.push({label:"Road search",value:"Up to 2 legal roads",tone:"up"});
    if(action.card==="Year of Plenty")rows.push({label:"Resource selection",value:"2 bank cards",tone:"up"});
    if(action.card==="Monopoly")rows.push({label:"Targeting",value:"Collect all of one type",tone:"up"});
  }
  return rows;
}
function engineRecommendations({active,players,board,geo,ports,bank,deck,targetVP,heldAwards,stage}){
  if(!active)return [];
  if(stage==="preRoll")return [{type:"roll",score:100,display:"Roll the dice — this is the mandatory start-of-turn action.",breakdown:[{label:"Turn rule",value:"Roll required",tone:"up"}]}];
  const scored=scoreActions(active,players,board,geo,ports,bank,deck,targetVP,heldAwards,{devBought:false,devPlayed:false}).filter(a=>a.type!=="pass"&&Number.isFinite(a.score));
  const seen=new Set();
  return scored.filter(a=>{const k=decisionKeyForEngine(a);if(seen.has(k))return false;seen.add(k);return true;}).slice(0,3).map((a,i)=>({...a,rank:i+1,display:engineActionText(a,players),breakdown:engineActionBreakdown(a,{active,players,board,geo,ports,bank,deck,targetVP,heldAwards})}));
}
function botEngineAnalysis({active,players,board,geo,ports,bank,deck,targetVP,heldAwards,stage="action",memorySnapshots=[]}){
  if(!active)return {odds:[],botProb:.5,recommendations:[],scored:[],analysisMs:0};
  const started=typeof performance!=="undefined"&&performance.now?performance.now():Date.now();
  const odds=engineWinLikelihood(players,board,geo,ports,bank,targetVP);
  const botProb=odds.find(x=>x.id===active.id)?.prob??.5;
  const scored=stage==="preRoll"?[{type:"roll",score:100}]:scoreActions(active,players,board,geo,ports,bank,deck,targetVP,heldAwards,{devBought:false,devPlayed:false});
  const recommendations=stage==="preRoll"?[{type:"roll",score:100,rank:1,display:"Roll the dice"}]:scored.filter(a=>a.type!=="pass"&&Number.isFinite(a.score)).slice(0,3);
  const ended=typeof performance!=="undefined"&&performance.now?performance.now():Date.now();
  return {odds,botProb,recommendations,scored,analysisMs:Math.max(0,ended-started),memorySnapshots};
}

function decisionKeyForEngine(a){
  if(!a)return "none";
  if(["settlement","road","city"].includes(a.type))return `${a.type}:${a.spot}`;
  if(a.type==="trade")return `trade:${a.give}:${a.get}:${a.rate}`;
  if(a.type==="playerTrade")return `playerTrade:${a.partner}:${JSON.stringify(a.giveBundle||{[a.give]:a.giveAmount})}:${JSON.stringify(a.getBundle||{[a.get]:a.getAmount})}`;
  if(a.type==="play")return `play:${a.card}`;
  return a.type;
}
function makeEnginePlayers(){
  return [newPlayer(0,"Side A",false,"Human"),newPlayer(1,"Side B",false,"Human")];
}
function makeEngineBoard(geo,settings){return makeBoard(geo,settings);}


/* ==================== V75 STRATEGIC BOT OVERRIDES ====================
   The V75 layer keeps the existing UI/game rules/dev cards/analysis/history,
   but replaces the bot's most error-prone decision layers with one plan-first
   planner. The legacy hidden-memory behaviour is intentionally preserved. */

function terrainAvailablePipsByResource(board,players,geo){
  const occupied=new Set();
  players.forEach(pl=>{
    [...(pl.settlements||[]),...(pl.cities||[])].forEach(v=>occupied.add(v));
  });
  const out=empty();
  board.forEach((t,tid)=>{
    if(!t||t.resource==='desert'||t.robber)return;
    const adjacent=geo.vertexTiles[tid]||[];
    if(adjacent.some(v=>occupied.has(v)))return;
    out[t.resource]+=botPipValue(t.number)/36;
  });
  return out;
}
function BoardScarcity(r,board,players,geo,modeCfg){
  if(ACTIVE_BOT_CACHE){
    const occ=players.map(pl=>`${pl.id}:${[...(pl.settlements||[]),...(pl.cities||[])].sort((a,b)=>a-b).join(',')}`).join('|');
    const key=`${r}|${occ}`;
    if(ACTIVE_BOT_CACHE.boardScarcity.has(key))return ACTIVE_BOT_CACHE.boardScarcity.get(key);
    const totalBoard=boardPipProfile(board)[r]||0;
    const available=terrainAvailablePipsByResource(board,players,geo)[r]||0;
    const ratio=available/Math.max(totalBoard,.0001);
    const value=clamp(1.75-ratio,.55,1.9);
    ACTIVE_BOT_CACHE.boardScarcity.set(key,value);
    return value;
  }
  const totalBoard=boardPipProfile(board)[r]||0;
  const available=terrainAvailablePipsByResource(board,players,geo)[r]||0;
  const ratio=available/Math.max(totalBoard,.0001);
  return clamp(1.75-ratio,.55,1.9);
}
function RelativeGap(r,p,players,board,geo){
  const self=botProduction(p,board,geo);
  const selfTotal=Math.max(Object.values(self).reduce((a,b)=>a+b,0),.0001);
  const selfShare=(self[r]||0)/selfTotal;
  const opponents=players.filter(o=>o.id!==p.id);
  if(!opponents.length)return 0;
  let strongest=-Infinity;
  for(const o of opponents){
    const prod=botProduction(o,board,geo),tot=Math.max(Object.values(prod).reduce((a,b)=>a+b,0),.0001);
    strongest=Math.max(strongest,(prod[r]||0)/tot);
  }
  return selfShare-strongest;
}
function BuildingDemand(p,modeCfg=null,strategicPlan=null){
  const is1v1=modeCfg?.key==='pvbot1v115';
  const vp=p?.vp||0;
  const citiesOk=!!(p?.settlements||[]).length&&piecesRemaining(p).cities>0;
  const settleOk=piecesRemaining(p).settlements>0;
  let settleBase,cityBase,devBase;
  if(is1v1){
    if(vp<=5){settleBase=.30;cityBase=.42;devBase=.28;}
    else if(vp<=10){settleBase=.23;cityBase=.47;devBase=.30;}
    else {settleBase=.16;cityBase=.30;devBase=.54;}
  }else{
    if(vp<=3){settleBase=.50;cityBase=.22;devBase=.28;}
    else if(vp<=6){settleBase=.34;cityBase=.38;devBase=.28;}
    else {settleBase=.20;cityBase=.36;devBase=.44;}
  }
  if(!citiesOk)cityBase=0;
  if(!settleOk)settleBase=.02;
  const targets=[
    {name:'Settlement',cost:COSTS.settlement,base:settleBase,ready:targetReadiness(p,COSTS.settlement)},
    {name:'City',cost:COSTS.city,base:cityBase,ready:citiesOk?targetReadiness(p,COSTS.city):0},
    {name:'Dev card',cost:COSTS.development,base:devBase,ready:targetReadiness(p,COSTS.development)}
  ];
  targets.forEach(t=>t.weight=t.base*(.50+.85*clamp(t.ready,0,1)));
  if(strategicPlan?.type){
    const d=strategicPlanDemand(p,strategicPlan);
    const denom=Math.max(d.totalMissing,Object.values(d.missing).reduce((a,b)=>a+b,0),1);
    const focus=.72;
    if(strategicPlan.type==='settlement'){
      const roadCount=(strategicPlan.path||[]).length;
      targets.find(t=>t.name==='Settlement').weight+=focus*(1+Math.min(2,roadCount*.18));
      Object.entries(COSTS.road).forEach(([r,n])=>{if(d.missing[r]>0)targets.find(t=>t.name==='Settlement').weight+=focus*(d.missing[r]/denom);});
    }
    if(strategicPlan.type==='city')targets.find(t=>t.name==='City').weight+=focus*1.25;
  }
  const sum=targets.reduce((a,t)=>a+t.weight,0)||1;
  const demand=empty();
  targets.forEach(t=>{
    const denom=Object.values(t.cost).reduce((a,b)=>a+b,0)||1;
    Object.entries(t.cost).forEach(([r,n])=>demand[r]+=(t.weight/sum)*(n/denom));
  });
  return demand;
}
function NeedProfile(p,players,board,geo,bank,modeCfg,strategicPlan=null){
  if(ACTIVE_BOT_CACHE){
    const key=botPlanningFingerprint(p,strategicPlan)+`|${modeCfg?.key||''}`;
    const hit=ACTIVE_BOT_CACHE.need.get(key);
    if(hit)return hit;
    const prod=botProduction(p,board,geo),raw=empty(),need=empty(),demand=BuildingDemand(p,modeCfg,strategicPlan);
    const timeBoost=strategicPlan?.estimatedTurns?clamp(2.0/Math.max(1,strategicPlan.estimatedTurns),.05,.70):0;
    RES.forEach(r=>{
      const ps=PersonalScarcity(r,prod),bs=BoardScarcity(r,board,players,geo,modeCfg),gap=RelativeGap(r,p,players,board,geo);
      const planMissing=strategicPlan?.missing?.[r]||0;
      const objectiveBoost=planMissing>0?1+timeBoost*Math.min(3,planMissing):1;
      raw[r]=demand[r]*ps*bs*(1+Math.max(0,-gap))*modeCfg.bankScarcity*objectiveBoost;
    });
    const avg=Object.values(raw).reduce((a,b)=>a+b,0)/RES.length||1;
    RES.forEach(r=>need[r]=clamp(raw[r]/avg,.55,1.75));
    const result={production:prod,demand,need,rawNeed:raw};
    ACTIVE_BOT_CACHE.need.set(key,result);
    return result;
  }
  const prod=botProduction(p,board,geo),raw=empty(),need=empty(),demand=BuildingDemand(p,modeCfg,strategicPlan);
  const timeBoost=strategicPlan?.estimatedTurns?clamp(2.0/Math.max(1,strategicPlan.estimatedTurns),.05,.70):0;
  RES.forEach(r=>{const ps=PersonalScarcity(r,prod),bs=BoardScarcity(r,board,players,geo,modeCfg),gap=RelativeGap(r,p,players,board,geo);const planMissing=strategicPlan?.missing?.[r]||0;const objectiveBoost=planMissing>0?1+timeBoost*Math.min(3,planMissing):1;raw[r]=demand[r]*ps*bs*(1+Math.max(0,-gap))*modeCfg.bankScarcity*objectiveBoost;});
  const avg=Object.values(raw).reduce((a,b)=>a+b,0)/RES.length||1;RES.forEach(r=>need[r]=clamp(raw[r]/avg,.55,1.75));
  return{production:prod,demand,need,rawNeed:raw};
}
function simulateSettlementPlacement(v,p,players){
  if(!Number.isInteger(v)||!legalSettlement(v,players,globalGeoForPlanner||EMPTY_GEO))return null;
  const geo=globalGeoForPlanner;
  const nextP={...p,settlements:[...(p.settlements||[]),v],vp:(p.vp||0)+1};
  const nextPlayers=players.map(x=>x.id===p.id?nextP:x);
  return {player:nextP,players:nextPlayers};
}
let globalGeoForPlanner=null;
function reachableFutureSpots(v,p,players,board,geo,ports,bank,targetVP,modeCfg){
  const baseIsOwned=(p.settlements||[]).includes(v)||(p.cities||[]).includes(v);
  if(!baseIsOwned){
    if(!legalSettlement(v,players,geo))return [];
    p={...p,settlements:[...(p.settlements||[]),v],vp:(p.vp||0)+1};
    players=players.map(x=>x.id===p.id?p:x);
  }
  const startRoads=[...(p.roads||[])],seen=new Set(),queue=[{v,path:[]}],out=[],bestDepth=new Map([[v,0]]);
  while(queue.length){
    const cur=queue.shift();
    if(cur.path.length>=3)continue;
    const virtual={...p,roads:[...startRoads,...cur.path]};
    for(const eid of geo.vertexEdges[cur.v]||[]){
      if(startRoads.includes(eid)||cur.path.includes(eid))continue;
      const e=geo.edges[eid];if(!e||!legalRoad(eid,virtual,players,geo))continue;
      const n=e.a===cur.v?e.b:e.a,nd=cur.path.length+1;
      const nextPath=[...cur.path,eid];
      const signature=`${n}|${nextPath.slice().sort((a,b)=>a-b).join(',')}`;
      if(seen.has(signature))continue;seen.add(signature);
      const prior=bestDepth.get(n);if(prior!=null&&prior<nd)continue;bestDepth.set(n,nd);
      const nextVirtual={...p,roads:[...startRoads,...nextPath]};
      if(legalSettlement(n,players,geo)&&settlementConnected(n,nextVirtual,geo))out.push({v:n,roads:nd,path:nextPath});
      if(!players.some(x=>x.id!==p.id&&[...(x.settlements||[]),...(x.cities||[])].includes(n)))queue.push({v:n,path:nextPath});
    }
  }
  return out.sort((a,b)=>a.roads-b.roads);
}
function opponentExpansionThreat(v,opp,players,board,geo,ports,bank,targetVP,modeCfg){
  if(!opp||!legalSettlement(v,players,geo))return 0;
  const path=strategicRoadPathToSettlement(v,opp,players,geo);
  if(path==null)return 0;
  const distance=path.length;
  const pathFactor=distance===0?.94:distance===1?.76:distance===2?.57:distance===3?.36:.18;
  const cardPressure=clamp((publicCardCount(opp)-2)/10,0,.45);
  const roadPieces=piecesRemaining(opp).roads;
  const pieceFactor=roadPieces>=Math.max(1,distance)?.18:roadPieces>0?.05:-.08;
  const openVP=openVictoryPoints(opp,players,geo,{roadOwner:null,armyOwner:null});
  const raceFactor=openVP>=targetVP-1?.18:openVP>=targetVP-3?.10:openVP>=targetVP-5?.04:0;
  return clamp(pathFactor+cardPressure*.18+pieceFactor+raceFactor,0,.98);
}
function getOpponentRankProfile(opp,players,board,geo,ports,bank,targetVP,modeCfg){
  if(ACTIVE_BOT_CACHE){
    const key=botPlanningFingerprint(opp,null)+`|rank|${targetVP}|${modeCfg?.key||''}`;
    const hit=ACTIVE_BOT_CACHE.opponentRanks.get(key);
    if(hit)return hit;
  }
  const legal=geo.vertices.map((_,i)=>i).filter(v=>legalSettlement(v,players,geo));
  const values=legal.map(v=>({v,s:quickSpotValue(v,opp,players,board,geo,ports,bank,targetVP,modeCfg)})).sort((a,b)=>b.s-a.s);
  const rank=new Map(),value=new Map();values.forEach((x,i)=>{rank.set(x.v,i);value.set(x.v,x.s);});
  const profile={rank,value,top:values.slice(0,8)};
  if(ACTIVE_BOT_CACHE){const key=botPlanningFingerprint(opp,null)+`|rank|${targetVP}|${modeCfg?.key||''}`;ACTIVE_BOT_CACHE.opponentRanks.set(key,profile);}
  return profile;
}
function opponentTakeProbability(v,p,players,board,geo,ports,bank,targetVP,modeCfg){
  const opponents=players.filter(x=>x.id!==p.id);if(!opponents.length||!legalSettlement(v,players,geo))return 0;
  const myIndex=players.findIndex(x=>x.id===p.id);let survive=1;
  for(const opp of opponents){
    const threat=opponentExpansionThreat(v,opp,players,board,geo,ports,bank,targetVP,modeCfg);
    const profile=getOpponentRankProfile(opp,players,board,geo,ports,bank,targetVP,modeCfg);
    const rank=profile.rank.get(v)??999;
    const rankChance=rank<2?.82:rank<5?.54:rank<10?.24:.07;
    const oppIndex=players.findIndex(x=>x.id===opp.id);
    const order=(oppIndex-myIndex+players.length)%players.length;
    const orderFactor=order===1?1:order===2?.72:order===3?.50:.38;
    survive*=1-clamp((threat*.65+rankChance*.35)*orderFactor,0,.97);
  }
  return clamp(1-survive,0,.99);
}
function quickSpotValue(v,p,players,board,geo,ports,bank,targetVP,modeCfg){
  const cacheKey=ACTIVE_BOT_CACHE?`${botPlanningFingerprint(p,null)}|spot|${v}|${targetVP}|${modeCfg?.key||''}`:null;
  if(ACTIVE_BOT_CACHE&&cacheKey&&ACTIVE_BOT_CACHE.spot.has(cacheKey))return ACTIVE_BOT_CACHE.spot.get(cacheKey);
  const nf=NeedProfile(p,players,board,geo,bank,modeCfg),sp=spotProduction(v,board,geo);
  const result=(function(){
  const P=placementResourceValue(sp,nf)/36,C=coverageValue(v,sp,p,board,geo,nf);
  const port=portAt(v,ports)?Math.min(3,TValue(v,p,players,board,geo,ports,bank,targetVP,modeCfg)*.18):0;
    return P+C+port;
  })();
  if(ACTIVE_BOT_CACHE&&cacheKey)ACTIVE_BOT_CACHE.spot.set(cacheKey,result);
  return result;
}
function EValue(v,p,players,board,geo,ports,bank,targetVP,modeCfg){
  const simulated=(!p.settlements?.includes(v)&&!p.cities?.includes(v))&&legalSettlement(v,players,geo)
    ? {...p,settlements:[...(p.settlements||[]),v],vp:(p.vp||0)+1}:p;
  const simPlayers=simulated===p?players:players.map(x=>x.id===p.id?simulated:x);
  let totalValue=0;
  for(const item of reachableFutureSpots(v,simulated,simPlayers,board,geo,ports,bank,targetVP,modeCfg).slice(0,24)){
    const futureValue=quickSpotValue(item.v,simulated,simPlayers,board,geo,ports,bank,targetVP,modeCfg);
    const oppChance=opponentTakeProbability(item.v,simulated,simPlayers,board,geo,ports,bank,targetVP,modeCfg);
    totalValue+=futureValue*Math.pow(.62,item.roads)*(1-oppChance);
  }
  return totalValue+pathRoadBonus(v,simulated,simPlayers,geo)*.8;
}
function fastFutureSpots(v,p,players,board,geo,ports,bank,targetVP,modeCfg,cache){
  const key=`${p.id}:${v}:${(p.roads||[]).join(',')}:${(p.settlements||[]).join(',')}`;
  if(cache.future.has(key))return cache.future.get(key);
  const future=reachableFutureSpots(v,p,players,board,geo,ports,bank,targetVP,modeCfg).slice(0,10);
  cache.future.set(key,future);return future;
}
function fastOpponentChance(v,p,players,board,geo,ports,bank,targetVP,modeCfg,cache){
  const key=`${p.id}:${v}:threat`;if(cache?.threats?.has(key))return cache.threats.get(key);
  const result=opponentTakeProbability(v,p,players,board,geo,ports,bank,targetVP,modeCfg);
  cache?.threats?.set(key,result);return result;
}
function fastEValue(v,p,players,board,geo,ports,bank,targetVP,modeCfg,cache){
  let totalValue=0;
  for(const item of fastFutureSpots(v,p,players,board,geo,ports,bank,targetVP,modeCfg,cache)){
    const simulated={...p,settlements:(p.settlements||[]).includes(v)?p.settlements:[...(p.settlements||[]),v]};
    const simPlayers=players.map(x=>x.id===p.id?simulated:x);
    const val=quickSpotValue(item.v,simulated,simPlayers,board,geo,ports,bank,targetVP,modeCfg);
    totalValue+=val*Math.pow(.62,item.roads)*(1-fastOpponentChance(item.v,simulated,simPlayers,board,geo,ports,bank,targetVP,modeCfg,cache));
  }
  return totalValue+pathRoadBonus(v,p,players,geo)*.8;
}
function fastBlockValue(v,p,players,board,geo,ports,bank,targetVP,modeCfg,cache){
  let totalThreat=0;
  for(const opp of players.filter(x=>x.id!==p.id)){
    const gain=quickSpotValue(v,opp,players,board,geo,ports,bank,targetVP,modeCfg);
    const threat=opponentExpansionThreat(v,opp,players,board,geo,ports,bank,targetVP,modeCfg);
    const leader=1+modeCfg.leaderMultiplier*(openVictoryPoints(opp,players,geo,{roadOwner:null,armyOwner:null})/Math.max(targetVP,1));
    totalThreat+=gain*(.28+threat)*leader;
  }
  return totalThreat;
}
function strategicPlanDemand(p,plan){
  const required=empty();
  if(plan?.type==='city')Object.entries(COSTS.city).forEach(([r,n])=>required[r]+=n);
  if(plan?.type==='settlement'){
    Object.entries(COSTS.settlement).forEach(([r,n])=>required[r]+=n);
    for(const _ of plan.path||[])Object.entries(COSTS.road).forEach(([r,n])=>required[r]+=n);
  }
  const missing=empty(),reserved=empty();
  RES.forEach(r=>{const have=p.hand?.[r]||0;missing[r]=Math.max(0,required[r]-have);reserved[r]=Math.min(have,required[r]);});
  return {required,missing,reserved,totalMissing:Object.values(missing).reduce((a,b)=>a+b,0)};
}
function planExpectedValue(plan,p,players,board,geo,ports,bank,targetVP){
  const d=strategicPlanDemand(p,plan),threat=plan.type==='settlement'?opponentTakeProbability(plan.target,p,players,board,geo,ports,bank,targetVP,botModeConfig(players,targetVP)):0;
  const turns=Math.max(1,1+(plan.path?.length||0)+Math.ceil(d.totalMissing/2));
  const race=openVictoryPoints(p,players,geo,{roadOwner:null,armyOwner:null});
  const completion=plan.type==='city'?24:18;
  return (plan.score||0)/(1+turns*.32)+completion*Math.max(0.15,1-threat)+(race>=targetVP-2?20:0);
}
function buildStrategicPlan(p,players,board,geo,ports,bank,targetVP,existing=null){
  const cfg=botModeConfig(players,targetVP);
  const difficulty=botDifficultyProfile(p?.diff);
  const allPlans=[];
  if(piecesRemaining(p).cities>0&&(p.settlements||[]).length){
    for(const v of p.settlements){
      const actionValue=cityActionValue(v,p,players,board,geo,ports,bank,targetVP,{strategicPlan:existing});
      allPlans.push({type:'city',target:v,score:actionValue,createdTurn:existing?.createdTurn||0,reason:'Production + race-aware city objective'});
    }
  }
  if(piecesRemaining(p).settlements>0){
    const legal=[];for(let v=0;v<geo.vertices.length;v++)if(legalSettlement(v,players,geo))legal.push(v);
    const ranked=legal.map(v=>({v,s:quickSpotValue(v,p,players,board,geo,ports,bank,targetVP,cfg)})).sort((a,b)=>b.s-a.s).slice(0,difficulty.futureCandidates);
    for(const {v} of ranked){
      const path=settlementConnected(v,p,geo)?[]:strategicRoadPathToSettlement(v,p,players,geo);if(path===null)continue;
      const expansion=openingExpansionScore(v,p,players,geo);
      let threat=0;for(const opp of players.filter(x=>x.id!==p.id))threat=Math.max(threat,opponentExpansionThreat(v,opp,players,board,geo,ports,bank,targetVP,cfg));
      const complement=ComplementarityScore(v,p,players,board,geo,bank,targetVP,cfg);
      const port=portAt(v,ports)?Math.min(3,TValue(v,p,players,board,geo,ports,bank,targetVP,cfg)*.28):0;
      const roadPenalty=(path.length||0)*2.8;
      const score=(openingPlacementScore(v,p,players,board,geo,ports,bank,targetVP)*.42)+expansion*2.4+complement*2.2+port-roadPenalty-threat*6;
      allPlans.push({type:'settlement',target:v,score,path,createdTurn:existing?.createdTurn||0,reason:'Low-latency expansion + resource-completion objective'});
    }
  }
  if(!allPlans.length)return null;
  const enriched=allPlans.map(plan=>{
    const d=strategicPlanDemand(p,plan),turns=Math.max(1,1+(plan.path?.length||0)+Math.ceil(d.totalMissing/2));
    return {...plan,demand:d.required,missing:d.missing,reserved:d.reserved,totalMissing:d.totalMissing,estimatedTurns:turns,priority:planExpectedValue({...plan,estimatedTurns:turns},p,players,board,geo,ports,bank,targetVP)};
  }).sort((a,b)=>b.priority-a.priority);
  const best=enriched[0];
  if(!existing)return best;
  let existingPlan=null;
  if(existing.type==='settlement'&&Number.isInteger(existing.target)&&legalSettlement(existing.target,players,geo)&&piecesRemaining(p).settlements>0){
    const path=settlementConnected(existing.target,p,geo)?[]:strategicRoadPathToSettlement(existing.target,p,players,geo);
    if(path!==null){const d=strategicPlanDemand(p,{...existing,path});existingPlan={...existing,path,demand:d.required,missing:d.missing,reserved:d.reserved,totalMissing:d.totalMissing,estimatedTurns:Math.max(1,1+path.length+Math.ceil(d.totalMissing/2))};existingPlan.priority=planExpectedValue(existingPlan,p,players,board,geo,ports,bank,targetVP)+6;}
  }
  if(existing.type==='city'&&existing.target!=null&&p.settlements?.includes(existing.target)&&piecesRemaining(p).cities>0){const d=strategicPlanDemand(p,existing);existingPlan={...existing,...d,estimatedTurns:Math.max(1,Math.ceil(d.totalMissing/2))};existingPlan.priority=planExpectedValue(existingPlan,p,players,board,geo,ports,bank,targetVP)+6;}
  if(existingPlan&&existingPlan.priority>=best.priority*.90){return {...existingPlan,planAge:(existing.planAge||0)+1};}
  return best;
}
function strategicPlanBonus(action,plan,p,players,board,geo,ports,bank,targetVP){
  if(!plan)return 0;const d=plan.missing?{missing:plan.missing,reserved:plan.reserved,totalMissing:plan.totalMissing}:strategicPlanDemand(p,plan);let bonus=0;
  if(plan.type==='settlement'){
    if(action.type==='settlement'&&action.spot===plan.target)return 260;
    if(action.type==='road'){const i=(plan.path||[]).indexOf(action.spot);if(i>=0)return 115-i*9;}
    if(action.type==='play'&&action.card==='Road Building')return 85;
  }
  if(plan.type==='city'&&action.type==='city'&&action.spot===plan.target)return 260;
  if(action.type==='trade'||action.type==='playerTrade'){
    const get=action.type==='trade'?normalizeBundle(action.getBundle||{[action.get]:1}):normalizeBundle(action.getBundle||{[action.get]:action.getAmount});
    const give=action.type==='trade'?normalizeBundle({[action.give]:action.rate}):normalizeBundle(action.giveBundle||{[action.give]:action.giveAmount});
    const progress=RES.reduce((n,r)=>n+Math.min(d.missing[r]||0,get[r]||0),0);
    const completion=RES.every(r=>(d.missing[r]||0)<=get[r]||((d.missing[r]||0)===0))&&d.totalMissing<=bundleTotal(get);
    bonus+=progress*26+(progress>0?10:0)+(completion?38:0);
    const reservedSpend=RES.reduce((n,r)=>n+Math.max(0,(give[r]||0)-Math.max(0,(p.hand?.[r]||0)-(d.reserved?.[r]||0))),0);
    bonus-=reservedSpend*35;
  }
  if(action.type==='buyDev'&&d.totalMissing>0)bonus-=Math.min(24,d.totalMissing*3);
  return bonus;
}
function cityActionValue(spot,p,players,board,geo,ports,bank,targetVP,turnState={}){
  const prod=spotProduction(spot,board,geo),nf=NeedProfile(p,players,board,geo,bank,botModeConfig(players,targetVP),turnState.strategicPlan||null);
  const upgradeValue=18+RES.reduce((n,r)=>(n+(prod[r]||0)*(nf.need[r]||1)*18),0);
  const race=openVictoryPoints(p,players,geo,turnState.heldAwards||{roadOwner:null,armyOwner:null})>=targetVP-2?12:0;
  const plan=turnState.strategicPlan;const goal=plan?.type==='city'&&plan.target===spot?80:0;
  const bottleneck=RES.reduce((n,r)=>n+Math.min(prod[r]*36,3)*(nf.need[r]||1),0);
  return upgradeValue+bottleneck+race+goal;
}
function bestRoadBuildingPair(p,players,board,geo,ports,bank,targetVP,deadline=null,strategicPlan=null){
  const legalAll=geo.edges.filter(e=>legalRoad(e.id,p,players,geo)).map(e=>e.id);if(!legalAll.length)return null;
  const now=()=>typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
  const targetPath=strategicPlan?.type==='settlement'?(strategicPlan.path||strategicRoadPathToSettlement(strategicPlan.target,p,players,geo)||[]):[];
  const forced=targetPath.filter(e=>legalAll.includes(e));
  let best=null;
  if(forced.length){
    let vp={...p,roads:[...(p.roads||[])]},roads=[];
    for(const eid of forced.slice(0,2)){if(legalRoad(eid,vp,players,geo)){roads.push(eid);vp={...vp,roads:[...vp.roads,eid]};}}
    if(roads.length)best={roads,value:260+roads.length*45};
  }
  const ranked=legalAll.slice().sort((a,b)=>roadActionPotential(b,p,players,board,geo,targetVP,ports,bank,strategicPlan)-roadActionPotential(a,p,players,board,geo,targetVP,ports,bank,strategicPlan)).slice(0,16);
  for(const a of ranked){
    if(deadline!=null&&now()>=deadline-160)break;
    const v1={...p,roads:[...(p.roads||[]),a]};let value=roadActionPotential(a,p,players,board,geo,targetVP,ports,bank,strategicPlan);
    if(forced.includes(a))value+=120;
    if(!best||value>best.value)best={roads:[a],value};
    for(const b of ranked){
      if(b===a||deadline!=null&&now()>=deadline-120)break;
      if(!legalRoad(b,v1,players,geo))continue;
      const v2={...v1,roads:[...v1.roads,b]};let score=value+roadActionPotential(b,v1,players,board,geo,targetVP,ports,bank,strategicPlan)*.9+unlockedSettlementCount(v2,players,geo)*1.5;
      if(forced.includes(b))score+=120;
      if(forced.includes(a)&&forced.includes(b))score+=100;
      if(!best||score>best.value)best={roads:[a,b],value:score};
    }
  }
  return best;
}
function botObjectiveTradeCandidates(p,players,board,geo,ports,bank,targetVP,turnState={}){
  if(!p?.bot||players.length<3)return [];
  const plan=turnState.strategicPlan||null;
  const needProfile=NeedProfile(p,players,board,geo,bank,botModeConfig(players,targetVP)).need;
  const demand=plan?.missing||{};
  const wanted=RES.slice().sort((a,b)=>{
    const da=(demand[b]||0)*3+(needProfile[b]||1);
    const db=(demand[a]||0)*3+(needProfile[a]||1);
    return da-db;
  }).filter(r=>(demand[r]||0)>0 || (needProfile[r]||0)>1.02).slice(0,3);
  if(!wanted.length)return [];
  const surplus=RES.slice().sort((a,b)=>{
    const sa=(p.hand?.[b]||0)-(demand[b]||0)*1.4-(needProfile[b]||1);
    const sb=(p.hand?.[a]||0)-(demand[a]||0)*1.4-(needProfile[a]||1);
    return sa-sb;
  }).filter(r=>(p.hand?.[r]||0)>0);
  const out=[];
  for(const partner of players.filter(x=>x.id!==p.id)){
    for(const get of wanted){
      for(const give of surplus){
        if(give===get)continue;
        for(const giveAmount of [1,2]){
          if((p.hand?.[give]||0)<giveAmount)continue;
          const giveBundle=normalizeBundle({[give]:giveAmount});
          const getBundle=normalizeBundle({[get]:1});
          const before=strategicPlanDemand(p,plan||{missing:empty(),reserved:empty()});
          const after=strategicPlanDemand({...p,hand:add(pay(p.hand,giveBundle),getBundle)},plan||{missing:empty(),reserved:empty()});
          const progress=(before.totalMissing||0)-(after.totalMissing||0);
          if(progress<=0&&!plan)continue;
          const objectiveBonus=progress*55+(after.totalMissing===0?90:0);
          const scarcityBonus=(needProfile[get]||1)*10-(needProfile[give]||1)*giveAmount*2;
          out.push({type:'playerTrade',partner:partner.id,give,giveAmount,get,getAmount:1,giveBundle,getBundle,botObjective:plan?.type||"resource acquisition",objectiveBonus,score:objectiveBonus+scarcityBonus});
        }
      }
    }
  }
  return out.sort((a,b)=>b.score-a.score).slice(0,18);
}

function actionCandidates(p,players,board,geo,ports,bank,deck,targetVP,heldAwards,turnState={}){
  const out=[],plan=turnState.strategicPlan||null;
  if(piecesRemaining(p).settlements>0&&canPay(p.hand,COSTS.settlement))for(let v=0;v<geo.vertices.length;v++)if(legalSettlement(v,players,geo)&&settlementConnected(v,p,geo))out.push({type:'settlement',spot:v});
  if(piecesRemaining(p).cities>0&&canPay(p.hand,COSTS.city))for(const v of p.settlements||[])out.push({type:'city',spot:v});
  if(piecesRemaining(p).roads>0&&canPay(p.hand,COSTS.road))for(const e of geo.edges)if(legalRoad(e.id,p,players,geo))out.push({type:'road',spot:e.id});
  if(canBuyDevelopmentCard(p,deck))out.push({type:'buyDev'});
  const visibleVP=openVictoryPoints(p,players,geo,heldAwards);
  if(p.development.VictoryPoint>0&&visibleVP+p.development.VictoryPoint>=targetVP)out.push({type:'play',card:'Victory Point',winReveal:true});
  else if(!turnState.devPlayed){for(const card of ['Knight','Road Building','Year of Plenty','Monopoly'])if(canPlayDevelopmentCard(card,p,turnState))out.push({type:'play',card});}
  for(const give of RES)for(const get of RES){if(give===get)continue;const rate=tradeRate(p,ports,give);if((p.hand[give]||0)>=rate&&(bank[get]||0)>0)out.push({type:'trade',give,get,rate});}
  if(players.length>2){
    const autoplay=!!turnState.botAutoplay;
    if(p.bot)out.push(...botObjectiveTradeCandidates(p,players,board,geo,ports,bank,targetVP,turnState));
    const partners=players.filter(x=>x.id!==p.id&&(!autoplay||x.bot));
    const wanted=plan?RES.slice().sort((a,b)=>(plan.missing?.[b]||0)-(plan.missing?.[a]||0)).slice(0,3):RES;
    for(const partner of partners){
      for(const get of wanted){
        for(const give of RES){
          if(give===get)continue;
          for(const amount of [1,2]){
            if((p.hand[give]||0)<amount)continue;
            const giveBundle={[give]:amount};
            if(bundleCanPay(p.hand,giveBundle)&&!bundlesShareResource(giveBundle,{[get]:1}))out.push({type:'playerTrade',partner:partner.id,give,get,giveAmount:amount,getAmount:1,giveBundle:normalizeBundle(giveBundle),getBundle:{[get]:1}});
          }
        }
      }
    }
  }
  out.push({type:'pass'});
  return out;
}
function getBundlePrimary(bundle){return RES.find(r=>(bundle?.[r]||0)>0)||RES[0];}
function fastTradeOpportunity(action,p,players,board,geo,ports,bank,deck,targetVP,heldAwards,cache,turnState={}){
  const give=action.type==='trade'?normalizeBundle({[action.give]:action.rate}):normalizeBundle(action.giveBundle||{[action.give]:action.giveAmount});
  const get=action.type==='trade'?normalizeBundle({[action.get]:1}):normalizeBundle(action.getBundle||{[action.get]:action.getAmount});
  if(!bundleCanPay(p.hand,give)||bundleTotal(get)<1||bundlesShareResource(give,get))return-Infinity;
  const after={...p,hand:add(pay(p.hand,give),get)};const plan=turnState.strategicPlan;let value=comboCompletionValue(p.hand,after.hand,p,players)*.5;
  if(canPay(after.hand,COSTS.city))value+=22;
  if(canPay(after.hand,COSTS.settlement))value+=26;
  if(canBuyDevelopmentCard(after,deck))value+=4;
  if(plan){
    const before=strategicPlanDemand(p,plan),afterD=strategicPlanDemand(after,plan);
    const progress=RES.reduce((n,r)=>n+Math.max(0,(before.missing[r]||0)-(afterD.missing[r]||0)),0);
    value+=progress*32+(afterD.totalMissing===0?55:0);
    const reserved=before.reserved||{};
    const overspend=RES.reduce((n,r)=>n+Math.max(0,(give[r]||0)-Math.max(0,(p.hand?.[r]||0)-(reserved[r]||0))),0);
    value-=overspend*55;
  }
  if(total(after.hand)>BOT_HAND_PRESSURE_THRESHOLD)value-=Math.max(0,total(after.hand)-BOT_HAND_PRESSURE_THRESHOLD)*.55;
  return value;
}
function cheapCandidateScore(action,p,players,board,geo,ports,bank,deck,targetVP,turnState={}){
  const plan=turnState.strategicPlan;
  let s=0;
  if(action.type==='settlement'){s=quickSpotValue(action.spot,p,players,board,geo,ports,bank,targetVP,botModeConfig(players,targetVP));if(plan?.type==='settlement'&&plan.target===action.spot)s+=1000;}
  else if(action.type==='city'){s=cityActionValue(action.spot,p,players,board,geo,ports,bank,targetVP,turnState)+(plan?.type==='city'&&plan.target===action.spot?1000:0);}
  else if(action.type==='road'){s=cheapRoadPotential(action.spot,p,players,board,geo,targetVP,ports,bank,turnState);}
  else if(action.type==='trade'||action.type==='playerTrade'){s=fastTradeOpportunity(action,p,players,board,geo,ports,bank,deck,targetVP,turnState.heldAwards||{},turnState.scoreCache||null,turnState)*.5;}
  else if(action.type==='buyDev')s=5+(turnState.cardUtility||0);
  else if(action.type==='play')s=6+(action.card==='Road Building'&&plan?.type==='settlement'?500:0);
  return Number.isFinite(s)?s:-Infinity;
}
function fastBotActionScore(action,p,players,board,geo,ports,bank,deck,targetVP,heldAwards,turnState={},cache){
  const planBonus=strategicPlanBonus(action,turnState.strategicPlan||null,p,players,board,geo,ports,bank,targetVP);
  const race=botRacePressure(p,players,geo,targetVP,heldAwards),handPressure=Math.max(0,total(p.hand)-8);
  if(action.type==='play'&&action.card==='Victory Point'&&action.winReveal)return 10000;
  if(action.type==='settlement')return placementScore(action.spot,p,players,board,geo,ports,bank,targetVP,heldAwards,cache)+planBonus+race*2+handPressure*.9+(portAt(action.spot,ports)?1.5:0);
  if(action.type==='city')return cityActionValue(action.spot,p,players,board,geo,ports,bank,targetVP,turnState)+planBonus+race*2+handPressure*.8;
  if(action.type==='road')return roadActionPotential(action.spot,p,players,board,geo,targetVP,ports,bank,turnState)+planBonus+race*.25+handPressure*.35;
  if(action.type==='trade'||action.type==='playerTrade')return fastTradeOpportunity(action,p,players,board,geo,ports,bank,deck,targetVP,heldAwards,cache,turnState)+planBonus;
  if(action.type==='buyDev')return 5+(turnState.cardUtility||0)*1.7+planBonus-(canPay(p.hand,COSTS.settlement)||canPay(p.hand,COSTS.city)?4:0);
  if(action.type==='pass')return -2;
  if(action.type==='play'){
    if(action.card==='Road Building')return 7+(turnState.roadBuildingPair?.value||bestRoadBuildingPair(p,players,board,geo,ports,bank,targetVP,turnState.deadline||null,turnState.strategicPlan||null)?.value||0)*.4+planBonus;
    if(action.card==='Year of Plenty')return 6+(turnState.yopPair?.value||bestYearOfPlentyPair(p,players,board,geo,ports,bank,deck,targetVP,botModeConfig(players,targetVP),turnState)?.value||0)*.7+planBonus;
    if(action.card==='Monopoly'){const m=turnState.monopolyTarget||bestMonopolyTarget(p,players,board,geo,ports,bank,targetVP,deck,turnState);return (m?.expectedGain||0)*4+(m?.value||0)*.5+planBonus;}
    if(action.card==='Knight'){const rb=chooseRobberAction(p,players,board,geo,ports,bank,targetVP,turnState.memorySnapshots||[]);return 5+(rb?.score||0)*.5+planBonus;}
  }
  return planBonus;
}
function simulatePublicBotAction(action,p,players,board,geo,ports,bank,deck){
  let nextPlayers=players.map(x=>x.id===p.id?{...x,hand:{...x.hand},settlements:[...(x.settlements||[])],cities:[...(x.cities||[])],roads:[...(x.roads||[])]}:x),nextBank={...bank};
  let self=nextPlayers.find(x=>x.id===p.id);
  if(action.type==='settlement'){self.settlements.push(action.spot);self.vp=(self.vp||0)+1;}
  else if(action.type==='city'&&self.settlements.includes(action.spot)){self.settlements=self.settlements.filter(v=>v!==action.spot);self.cities.push(action.spot);self.vp=(self.vp||0)+1;}
  else if(action.type==='road')self.roads.push(action.spot);
  else if(action.type==='trade'){self.hand[action.give]=(self.hand[action.give]||0)-action.rate;self.hand[action.get]=(self.hand[action.get]||0)+1;nextBank[action.give]=(nextBank[action.give]||0)+action.rate;nextBank[action.get]=(nextBank[action.get]||0)-1;}
  else if(action.type==='playerTrade'){
    const partner=nextPlayers.find(x=>x.id===action.partner);if(partner){const g=normalizeBundle(action.giveBundle||{}),r=normalizeBundle(action.getBundle||{});self.hand=add(pay(self.hand,g),r);partner.hand=add(pay(partner.hand,r),g);}
  }
  return {players:nextPlayers,bank:nextBank,deck};
}
function opponentResponseValue(action,p,players,board,geo,ports,bank,deck,targetVP,turnState={}){
  let worst=0;
  for(const opp of players.filter(x=>x.id!==p.id)){
    const safeOpp={...opp,hand:empty(),publicCardCount:publicCardCount(opp)};
    const profile=getOpponentRankProfile(safeOpp,players,board,geo,ports,bank,targetVP,botModeConfig(players,targetVP));
    let bestSpot=profile.top[0]?.s||0;
    if(action.type==='settlement'&&profile.top[0]?.v===action.spot)bestSpot=profile.top[1]?.s||0;
    let bestCity=0;for(const v of opp.settlements||[])bestCity=Math.max(bestCity,cityActionValue(v,safeOpp,players,board,geo,ports,bank,targetVP,turnState));
    const race=openVictoryPoints(opp,players,geo,{roadOwner:null,armyOwner:null})>=targetVP-2?16:0;
    worst=Math.max(worst,bestSpot+bestCity+race);
  }
  return worst;
}
function scoreActions(p,players,board,geo,ports,bank,deck,targetVP,heldAwards,turnState={}){
  const all=actionCandidates(p,players,board,geo,ports,bank,deck,targetVP,heldAwards,turnState).filter(a=>!turnState.failedActionKeys||!turnState.failedActionKeys.has(decisionKeyForEngine(a)));
  if(!turnState.botAutoplay){return all.map(a=>({...a,score:unifiedActionScore(a,p,players,board,geo,ports,bank,deck,targetVP,heldAwards,turnState)})).sort((a,b)=>b.score-a.score);}
  const deadline=turnState.deadline||((typeof performance!=='undefined'&&performance.now?performance.now():Date.now())+BOT_MAX_TURN_MS-120);
  const unique=new Map(all.map(a=>[decisionKeyForEngine(a),a]));
  const candidates=[...unique.values()];
  const plan=turnState.strategicPlan;
  const forced=[];
  if(plan?.type==='settlement'&&Number.isInteger(plan.target)){const a=candidates.find(x=>x.type==='settlement'&&x.spot===plan.target);if(a)forced.push(a);for(const eid of plan.path||[]){const r=candidates.find(x=>x.type==='road'&&x.spot===eid);if(r)forced.push(r);}}
  if(plan?.type==='city'){const c=candidates.find(x=>x.type==='city'&&x.spot===plan.target);if(c)forced.push(c);}
  const groups={settlement:[],city:[],road:[],trade:[],playerTrade:[],play:[],buyDev:[],pass:[]};
  candidates.forEach(a=>(groups[a.type]||groups.play).push(a));
  const quotas={settlement:8,city:4,road:8,trade:6,playerTrade:6,play:4,buyDev:2,pass:1};
  const selected=new Map();
  forced.forEach(a=>selected.set(decisionKeyForEngine(a),a));
  for(const [type,list] of Object.entries(groups)){
    const cheaplyRanked=list.map(a=>({a,cheap:cheapCandidateScore(a,p,players,board,geo,ports,bank,deck,targetVP,turnState)})).sort((x,y)=>y.cheap-x.cheap);
    cheaplyRanked.slice(0,quotas[type]||8).forEach(item=>selected.set(decisionKeyForEngine(item.a),item.a));
  }
  const planningState={...turnState,scoreCache:turnState.scoreCache||makeScoreCache(players,board,geo,ports,bank,targetVP)};
  if(!Number.isFinite(planningState.cardUtility))planningState.cardUtility=fastCardExpectedUtility(p,players,board,geo,ports,bank,deck,targetVP,heldAwards,planningState,planningState.scoreCache);
  const scored=[];let count=0;
  for(const action of selected.values()){
    const now=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
    if(now>=deadline-BOT_DEEP_SEARCH_RESERVE_MS)break;
    scored.push({...action,score:fastBotActionScore(action,p,players,board,geo,ports,bank,deck,targetVP,heldAwards,planningState,planningState.scoreCache)});count++;if(count>=BOT_DEEP_ACTION_LIMIT)break;
  }
  if(forced.length){
    const keys=new Set(forced.map(decisionKeyForEngine));
    for(const f of scored)if(keys.has(decisionKeyForEngine(f)))f.forcedPlan=true;
  }
  return scored.sort((a,b)=>b.score-a.score);
}
function bestSettlementFollowThroughAfterRoad(eid,p,players,board,geo,ports,bank,targetVP,deadline=null){
  const e=geo.edges[eid];if(!e)return null;const virtual={...p,roads:[...(p.roads||[]),eid]},virtualPlayers=players.map(x=>x.id===p.id?virtual:x);let best=null;
  for(let v=0;v<geo.vertices.length;v++){
    if(deadline!=null&&((typeof performance!=='undefined'&&performance.now?performance.now():Date.now())>=deadline-30))break;
    if(!legalSettlement(v,virtualPlayers,geo)||!settlementConnected(v,virtual,geo))continue;
    const score=placementScore(v,virtual,virtualPlayers,board,geo,ports,bank,targetVP,{},null);
    const path=[];
    if(!best||score>best.score)best={spot:v,score,path};
  }
  return best;
}
function bestCityFollowThrough(p,players,board,geo,ports,bank,targetVP,turnState={}){
  if(piecesRemaining(p).cities<=0||!canPay(p.hand,COSTS.city)||!(p.settlements||[]).length)return null;
  let best=null;
  for(const spot of p.settlements){const score=cityActionValue(spot,p,players,board,geo,ports,bank,targetVP,turnState);if(!best||score>best.score)best={spot,score};}
  return best;
}
function cheapRoadPotential(eid,p,players,board,geo,targetVP,ports=[],bank=emptyBank(),turnState={}){
  const e=geo.edges[eid];if(!e||!legalRoad(eid,p,players,geo))return-Infinity;
  const virtual={...p,roads:[...(p.roads||[]),eid]},vp=players.map(x=>x.id===p.id?virtual:x),cfg=botModeConfig(players,targetVP);
  const plan=turnState.strategicPlan;
  if(plan?.type==='settlement'){const idx=(plan.path||[]).indexOf(eid);if(idx>=0)return 900-idx*22;}
  let best=-1;
  for(const v of [e.a,e.b]){
    if(legalSettlement(v,vp,geo))best=Math.max(best,quickSpotValue(v,virtual,vp,board,geo,ports,bank,targetVP,cfg)+8);
    for(const n of geo.neighbors[v]||[]){if(legalSettlement(n,vp,geo))best=Math.max(best,quickSpotValue(n,virtual,vp,board,geo,ports,bank,targetVP,cfg)*.62);}
  }
  return best+((portAt(e.a,ports)||portAt(e.b,ports))?1.25:0);
}
function roadActionPotential(eid,p,players,board,geo,targetVP,ports=[],bank=emptyBank(),plannerState=null){
  if(ACTIVE_BOT_CACHE){const key=`${botPlanningFingerprint(p,plannerState?.strategicPlan||null)}|road|${eid}|${targetVP}`;if(ACTIVE_BOT_CACHE.road.has(key))return ACTIVE_BOT_CACHE.road.get(key);}
  const e=geo.edges[eid];if(!e||!legalRoad(eid,p,players,geo))return-Infinity;
  const virtual={...p,roads:[...(p.roads||[]),eid]},vp=players.map(x=>x.id===p.id?virtual:x),cfg=botModeConfig(players,targetVP);
  let best=0;
  for(const v of [e.a,e.b]){
    if(legalSettlement(v,vp,geo)&&settlementConnected(v,virtual,geo))best=Math.max(best,placementScore(v,virtual,vp,board,geo,ports,bank,targetVP,{},null,plannerState));
    const future=reachableFutureSpots(v,virtual,vp,board,geo,ports,bank,targetVP,cfg).slice(0,10);
    for(const item of future){const simulated={...virtual,settlements:[...(virtual.settlements||[]),item.v]},simPlayers=vp.map(x=>x.id===p.id?simulated:x);best=Math.max(best,quickSpotValue(item.v,simulated,simPlayers,board,geo,ports,bank,targetVP,cfg)-item.roads*1.2);}
  }
  const before=connectedRoadLength(p,geo,players),after=connectedRoadLength(virtual,geo,players);const awardBefore=awards(players,geo),awardAfter=awards(vp,geo),longest=(awardAfter.roadOwner===p.id&&awardBefore.roadOwner!==p.id)?2:0;
  const result=best+Math.max(0,after-before)*.7+longest*.15-.12;
  if(ACTIVE_BOT_CACHE)ACTIVE_BOT_CACHE.road.set(`${botPlanningFingerprint(p,plannerState?.strategicPlan||null)}|road|${eid}|${targetVP}`,result);
  return result;
}
function placementScore(v,p,players,board,geo,ports,bank=emptyBank(),targetVP=players.length===2?15:10,heldAwards={roadOwner:null,armyOwner:null},cache=null,plannerState=null){
  if(!legalSettlement(v,players,geo)&&!(p.settlements||[]).includes(v))return-Infinity;
  if(cache){const key=`${botPlanningFingerprint(p,plannerState?.strategicPlan||null)}|placement|${v}|${targetVP}`;if(cache.placement.has(key))return cache.placement.get(key);}
  const cfg=botModeConfig(players,targetVP),plan=plannerState?.strategicPlan||null;
  const nf=NeedProfile(p,players,board,geo,bank,cfg,plan),sp=spotProduction(v,board,geo);
  const P=placementResourceValue(sp,nf)/36,C=coverageValue(v,sp,p,board,geo,nf);
  const E=cache?fastEValue(v,p,players,board,geo,ports,bank,targetVP,cfg,cache):EValue(v,p,players,board,geo,ports,bank,targetVP,cfg);
  const Y=YValue(v,p,players,board,geo,ports,bank,targetVP,cfg);
  const block=cfg.beta*(cache?fastBlockValue(v,p,players,board,geo,ports,bank,targetVP,cfg,cache):BlockValue(v,p,players,board,geo,ports,bank,targetVP,cfg));
  const urgency=E*(cache?fastOpponentChance(v,p,players,board,geo,ports,bank,targetVP,cfg,cache):opponentTakeProbability(v,p,players,board,geo,ports,bank,targetVP,cfg));
  const risk=RiskValue({type:'settlement',spot:v},p,players,board,geo,targetVP,cfg);
  const ph=cfg.phases.find(x=>p.vp<=x.maxVP)||cfg.phases[cfg.phases.length-1];
  const port=portAt(v,ports)?Math.min(3,TValue(v,p,players,board,geo,ports,bank,targetVP,cfg)*.35):0;
  const productionPips=RES.reduce((a,r)=>a+sp[r]*36,0);
  const numbers=(geo.vertexTiles[v]||[]).map(t=>board[t]?.number).filter(Number.isFinite);
  const sixEightBonus=numbers.includes(6)&&numbers.includes(8)?2.2:0;
  const oreWheatBonus=sp.ore*36>=4&&sp.wheat*36>=4?2.6:0;
  const productionBonus=productionPips*.018;
  const result=ph.wP*P+ph.wC*C+ph.wE*E+ph.wY*Y+block+urgency-ph.riskWeight*risk+port+productionBonus+sixEightBonus+oreWheatBonus;
  if(cache)cache.placement.set(`${botPlanningFingerprint(p,plannerState?.strategicPlan||null)}|placement|${v}|${targetVP}`,result);
  return result;
}
function openingExpansionScore(v,p,players,geo){
  const sim={...p,settlements:[...(p.settlements||[]),v]};const simPlayers=players.map(x=>x.id===p.id?sim:x);let score=0;
  for(const eid of geo.vertexEdges[v]||[]){const e=geo.edges[eid];const n=e.a===v?e.b:e.a;if(legalSettlement(n,simPlayers,geo))score+=2.5;for(const eid2 of geo.vertexEdges[n]||[]){if(eid2===eid)continue;const e2=geo.edges[eid2];const n2=e2.a===n?e2.b:e2.a;if(legalSettlement(n2,simPlayers,geo))score+=.85;}}
  return Math.min(score,12);
}
function openingPlacementScore(v,p,players,board,geo,ports,bank=emptyBank(),targetVP=players.length===2?15:10,cache=null){
  if(!legalSettlement(v,players,geo))return-Infinity;
  const cfg=botModeConfig(players,targetVP),nf=NeedProfile(p,players,board,geo,bank,cfg),sp=spotProduction(v,board,geo);
  const rawPips=RES.reduce((a,r)=>a+sp[r]*36,0),resourceKinds=RES.filter(r=>sp[r]>0).length;
  const scarcityAdjusted=RES.reduce((a,r)=>a+sp[r]*36*(scarcityRankFactors(nf.need)[r]),0);
  const coverage=coverageValue(v,sp,p,board,geo,nf),expansion=openingExpansionScore(v,p,players,geo);
  const port=portAt(v,ports)?TValue(v,p,players,board,geo,ports,bank,targetVP,cfg):0;
  const numbers=(geo.vertexTiles[v]||[]).map(t=>board[t]?.number).filter(Number.isFinite),unique=new Set(numbers).size;
  const sixEightBonus=numbers.includes(6)&&numbers.includes(8)?3:0;
  const oreWheatBonus=sp.ore*36>=4&&sp.wheat*36>=4?4.5:0;
  return rawPips*1.08+scarcityAdjusted*.13+resourceKinds*4.4+coverage*1.55+expansion*1.8+port*1.1+unique*1.2+sixEightBonus+oreWheatBonus+comboHitProbability([v],board,geo)*8.5;
}
function openingPairScore(a,b,p,players,board,geo,ports,bank=emptyBank(),targetVP=players.length===2?15:10,cache=null,baseScores=null){
  if(a===b||!legalSettlement(a,players,geo))return-Infinity;
  const firstPlayers=players.map(x=>x.id===p.id?{...x,settlements:[...(x.settlements||[]),a],vp:(x.vp||0)+1}:x);
  if(!legalSettlement(b,firstPlayers,geo))return-Infinity;
  const firstP=firstPlayers.find(x=>x.id===p.id)||p;
  const sa=spotProduction(a,board,geo),sb=spotProduction(b,board,geo);
  const baseA=baseScores?.get(a)??openingPlacementScore(a,p,players,board,geo,ports,bank,targetVP);
  const baseB=baseScores?.get(b)??openingPlacementScore(b,firstP,firstPlayers,board,geo,ports,bank,targetVP);
  const combined=RES.reduce((n,r)=>n+sa[r]+sb[r],0)*36,kinds=RES.filter(r=>sa[r]+sb[r]>0).length,overlap=RES.reduce((n,r)=>n+Math.min(sa[r],sb[r]),0)*36;
  const pairNumbers=[...(geo.vertexTiles[a]||[]),...(geo.vertexTiles[b]||[])].map(t=>board[t]?.number).filter(Number.isFinite);
  const sixEightPairBonus=pairNumbers.includes(6)&&pairNumbers.includes(8)?2.8:0;
  const oreWheatPairBonus=(((sa.ore+sb.ore)*36>=4)&&((sa.wheat+sb.wheat)*36>=4))?5:0;
  let score=baseA+baseB+combined*.80+kinds*5.4-overlap*.62+pipelineComboBonus(sa,sb,players.length===2)+comboHitProbability([a,b],board,geo)*23+sixEightPairBonus+oreWheatPairBonus;
  for(const opp of players.filter(x=>x.id!==p.id)){
    const oppLegal=geo.vertices.map((_,i)=>i).filter(v=>legalSettlement(v,players,geo));
    let rank=999,best= -Infinity;
    for(const v of oppLegal){const sv=openingPlacementScore(v,opp,players,board,geo,ports,bank,targetVP);if(v===b)rank=sv>best?0:rank;best=Math.max(best,sv);}
    if(rank===0)score-=10;
    const oppBScore=openingPlacementScore(b,opp,players,board,geo,ports,bank,targetVP);
    if(oppBScore>=best*.94)score-=12;
  }
  if((geo.neighbors[a]||[]).includes(b))score-=2.5;
  return score;
}
function bestOpeningPair(p,players,board,geo,ports,bank=emptyBank(),targetVP=players.length===2?15:10,budgetMs=BOT_OPENING_PAIR_BUDGET_MS){
  const start=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
  const legal=geo.vertices.map((_,i)=>i).filter(v=>legalSettlement(v,players,geo));
  const baseScores=new Map(legal.map(v=>[v,openingPlacementScore(v,p,players,board,geo,ports,bank,targetVP)]));
  const pre=legal.slice().sort((a,b)=>(baseScores.get(b)||-Infinity)-(baseScores.get(a)||-Infinity)).slice(0,BOT_OPENING_CANDIDATES);
  let best=null;
  outer: for(const a of pre){
    for(const b of pre){
      if(a===b)continue;
      const now=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();if(now-start>=budgetMs)break outer;
      const score=openingPairScore(a,b,p,players,board,geo,ports,bank,targetVP,null,baseScores);
      if(Number.isFinite(score)&&(!best||score>best.score))best={first:a,second:b,score};
    }
  }
  return best;
}
function bestOpeningCompanion(first,p,players,board,geo,ports,bank=emptyBank(),targetVP=players.length===2?15:10,budgetMs=220){
  if(first==null)return null;
  const virtualPlayers=players.map(x=>x.id===p.id?{...x,settlements:[...(x.settlements||[]),first],vp:(x.vp||0)+1}:x),virtualBot=virtualPlayers.find(x=>x.id===p.id)||p;
  const legal=geo.vertices.map((_,i)=>i).filter(v=>legalSettlement(v,virtualPlayers,geo));
  const scores=new Map(legal.map(v=>[v,openingPlacementScore(v,virtualBot,virtualPlayers,board,geo,ports,bank,targetVP)]));
  const ranked=legal.sort((a,b)=>(scores.get(b)||-Infinity)-(scores.get(a)||-Infinity)).slice(0,BOT_OPENING_CANDIDATES);
  let best=null;const start=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
  for(const b of ranked){if((typeof performance!=='undefined'&&performance.now?performance.now():Date.now())-start>=budgetMs)break;const score=openingPairScore(first,b,virtualBot,virtualPlayers,board,geo,ports,bank,targetVP,null,scores);if(!best||score>best.score)best={first,second:b,score};}
  return best;
}
function chooseRobberAction(p,players,board,geo,ports,bank,targetVP,memorySnapshots=[]){
  const cfg=botModeConfig(players,targetVP),opps=players.filter(x=>x.id!==p.id);let best=null;
  for(let tid=0;tid<board.length;tid++){
    if(board[tid].robber)continue;
    const verts=tileVerts(geo,tid),pip=PROB[board[tid].number]||0;if(!pip)continue;
    if(players.length===2&&opps.some(o=>friendlyRobberProtected(o,players,geo,{roadOwner:null,armyOwner:null})&&verts.some(v=>(o.settlements||[]).includes(v)||(o.cities||[]).includes(v))))continue;
    let blocked=0,selfBlock=0,totalThreat=0,bestVictim=null,bestVictimValue=-Infinity,expectedStealBest=0;
    for(const opp of opps){
      let affected=false,needValue=0,blockedPips=0;for(const v of verts){if((opp.settlements||[]).includes(v)){affected=true;blockedPips+=pip;}if((opp.cities||[]).includes(v)){affected=true;blockedPips+=pip*2;}}
      if(!affected)continue;blocked+=blockedPips;
      const nf=NeedProfile(opp,players,board,geo,bank,cfg),tileProd=spotProductionVertexTileLess(tid,board),resourceDamage=RES.reduce((n,r)=>n+tileProd[r]*(nf.need[r]||1),0);
      const openVP=openVictoryPoints(opp,players,geo,{roadOwner:null,armyOwner:null});
      const planThreat=resourceDamage*95+(openVP>=targetVP-2?22:0)+(openVP>=targetVP-4?10:0);
      const actualHand=opp.hand||empty(),handTotal=total(actualHand);let stealExpected=0;if(handTotal>0){for(const r of RES)stealExpected+=((actualHand[r]||0)/handTotal)*(1+(nf.need[r]||1));}
      const victimValue=planThreat+stealExpected*8+handTotal*.5;
      totalThreat+=resourceDamage*blockedPips;
      if(victimValue>bestVictimValue){bestVictimValue=victimValue;bestVictim=opp;expectedStealBest=stealExpected;}
    }
    for(const v of verts){if((p.settlements||[]).includes(v))selfBlock+=pip;if((p.cities||[]).includes(v))selfBlock+=pip*2;}
    if(blocked<=0)continue;
    const score=totalThreat*110+bestVictimValue*4+blocked*2+expectedStealBest*10-selfBlock*38;
    const candidate={tid,score,blockedPips:blocked,opp:bestVictim};if(!best||score>best.score)best=candidate;
  }
  return best;
}
function nearPerfectBotPlan(p,players,board,geo,ports,bank,deck,targetVP,heldAwards,turnState={}){
  const difficulty=botDifficultyProfile(p?.diff);
  const raw=scoreActions(p,players,board,geo,ports,bank,deck,targetVP,heldAwards,turnState).filter(a=>a.type!=='pass'&&Number.isFinite(a.score));
  if(!raw.length)return null;
  const scored=raw.map(a=>{
    const scale=Math.max(10,Math.abs(a.score||0));
    const noise=(Math.random()-.5)*2*difficulty.noise*scale;
    return {...a,difficultyScore:a.score+noise};
  }).sort((a,b)=>b.difficultyScore-a.difficultyScore);
  const deadline=turnState.deadline||0,top=scored.slice(0,difficulty.lookaheadTop);
  let best=null;
  for(const a of top){
    const now=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
    if(deadline&&now>=deadline-BOT_DEEP_SEARCH_RESERVE_MS)break;
    let score=a.difficultyScore;
    if(a.type!=='trade'&&a.type!=='playerTrade'){
      const responseScale=difficulty.responseWeight*(top.indexOf(a)<2?1.2:.8);
      score-=opponentResponseValue(a,p,players,board,geo,ports,bank,deck,targetVP,turnState)*responseScale;
    }
    if(a.type==='settlement'&&turnState.strategicPlan?.type==='settlement'&&a.spot===turnState.strategicPlan.target)score+=40;
    if(a.type==='road'&&turnState.strategicPlan?.type==='settlement'&&(turnState.strategicPlan.path||[]).includes(a.spot))score+=28;
    const candidate={...a,score};
    if(!best||candidate.score>best.score)best=candidate;
  }
  if(!best)return null;
  best.engineTop3=scored.slice(0,3).map(a=>({type:a.type,spot:a.spot,card:a.card,partner:a.partner,score:a.score,roads:a.roads,actionKey:decisionKeyForEngine(a),difficulty:difficulty.key}));
  best.planValue=best.score;
  best.botDifficulty=difficulty.key;
  return best;
}
function staticStrategicValue(p,players,board,geo,ports,bank,deck,targetVP,heldAwards){
  const cfg=botModeConfig(players,targetVP),openVP=openVictoryPoints(p,players,geo,heldAwards),prod=botProduction(p,board,geo),totalProd=Object.values(prod).reduce((a,b)=>a+b,0),need=NeedProfile(p,players,board,geo,bank,cfg).need,flexible=RES.reduce((a,r)=>a+(p.hand?.[r]||0)*need[r],0),award=awards(players,geo,heldAwards),awardVP=(award.roadOwner===p.id?2:0)+(award.armyOwner===p.id?2:0),road=connectedRoadLength(p,geo,players);return openVP*18+awardVP*10+totalProd*18+flexible*1.8+road*.08+devCount(p)*.9;
}
/* ==================== END V75 OVERRIDES ==================== */

function gameInvariantReport(players,board,bank,deck,geo){
  const errors=[];
  if(!Array.isArray(players)||!players.length)errors.push("No players are present");
  if(!Array.isArray(board)||board.length!==19)errors.push("Board must contain exactly 19 hexes");
  if(Array.isArray(board)&&board.filter(t=>t?.robber).length!==1)errors.push("Board must contain exactly one robber");
  const occupied=new Map(),roadOwners=new Map();
  (players||[]).forEach(p=>{
    const placed=[...(p?.settlements||[]),...(p?.cities||[])];
    if(placed.length>5)errors.push(`${p?.name||p?.id} has more than 5 housing pieces`);
    if((p?.cities||[]).length>4)errors.push(`${p?.name||p?.id} has more than 4 cities`);
    if((p?.roads||[]).length>15)errors.push(`${p?.name||p?.id} has more than 15 roads`);
    if((p?.development?.playedKnights||0)>14)errors.push(`${p?.name||p?.id} has too many played Knights`);
    for(const v of placed){if(occupied.has(v))errors.push(`Intersection ${v} has multiple owners`);else occupied.set(v,p?.name||String(p?.id));if(geo&&!geo.vertices?.[v])errors.push(`Invalid housing vertex ${v}`);}
    for(const e of p?.roads||[]){if(roadOwners.has(e))errors.push(`Road ${e} has multiple owners`);else roadOwners.set(e,p?.name||String(p?.id));if(geo&&!geo.edges?.[e])errors.push(`Invalid road edge ${e}`);}
    for(const r of RES)if((p?.hand?.[r]||0)<0)errors.push(`Negative ${r}`);
  });
  if(bank)for(const r of RES){const b=Number(bank[r]||0);if(b<0||b>19)errors.push(`Bank ${r} out of range`);const held=(players||[]).reduce((n,p)=>n+Math.max(0,Number(p?.hand?.[r]||0)),0);if(Math.abs(b+held-19)>1e-9)errors.push(`Resource ledger mismatch for ${r}`);}
  if(Array.isArray(deck)&&deck.length>25)errors.push("Development deck exceeds 25 cards");
  return {ok:errors.length===0,errors};
}
function App(){
  const geo=useMemo(makeGeometry,[]);
  const [screen,setScreen]=useState("home");
  const [integrityErrors,setIntegrityErrors]=useState([]);
  const integrityStampRef=useRef("");
  const [mode,setMode]=useState(10);
  const [enginePlayers,setEnginePlayers]=useState(()=>makeEnginePlayers());
  const [engineBoard,setEngineBoard]=useState(null);
  const [enginePorts,setEnginePorts]=useState([]);
  const [engineBank,setEngineBank]=useState(()=>emptyBank());
  const [engineDeck,setEngineDeck]=useState(()=>devDeck());
  const [engineActive,setEngineActive]=useState(0);
  const [engineStage,setEngineStage]=useState("action");
  const [engineSelectedTile,setEngineSelectedTile]=useState(null);
  const [engineTerrain,setEngineTerrain]=useState("wood");
  const [engineNumber,setEngineNumber]=useState(6);
  const [enginePieceMode,setEnginePieceMode]=useState("inspect");
  const [engineAnalysis,setEngineAnalysis]=useState(false);
  const [engineCustomOpen,setEngineCustomOpen]=useState(false);
  const [botDiffs,setBotDiffs]=useState(["Easy","Medium","Hard"]);
  const [opponentTypes,setOpponentTypes]=useState(["AI","AI","AI"]);
  const [pvBot,setPvBot]=useState("Maya");
  const [pvBotDiff,setPvBotDiff]=useState("Hard");
  const [pvOpeningPlan,setPvOpeningPlan]=useState(null);
  const [mapSettings,setMapSettings]=useState({highPipsTouch:false});
  const [board,setBoard]=useState(null),[ports,setPorts]=useState([]),[deck,setDeck]=useState([]),[players,setPlayers]=useState([]),[turn,setTurn]=useState(0),[setupRound,setSetupRound]=useState(1),[setupOrder,setSetupOrder]=useState([]),[setupIndex,setSetupIndex]=useState(0);
  const [drawn,setDrawn] = useState(false),[turnSecondsLeft,setTurnSecondsLeft]=useState(TURN_BASE_SECONDS),[drawOffer,setDrawOffer]=useState(null),[roll,setRoll]=useState(null),[dice,setDice]=useState(null),[lastBotRoll,setLastBotRoll]=useState(null),[hasRolled,setHasRolled]=useState(false),[bank,setBank]=useState(()=>emptyBank()),[selectedV,setSelectedV]=useState(null),[selectedE,setSelectedE]=useState(null),[placementConfirm,setPlacementConfirm]=useState(null),[tab,setTab]=useState("game"),[analysisMode,setAnalysisMode]=useState(false),[devOpen,setDevOpen]=useState(false),[devChoice,setDevChoice]=useState(null),[winner,setWinner]=useState(null),[log,setLog]=useState([]),[history,setHistory]=useState(loadHistory),[reviewGame,setReviewGame]=useState(null),[gameStarted,setGameStarted]=useState(Date.now()),[decisions,setDecisions]=useState([]),[trade,setTrade]=useState({give:"wood",get:"wheat"}),[playerTrade,setPlayerTrade]=useState({partner:1,giveBundle:empty(),getBundle:empty()}),[tradeOffer,setTradeOffer]=useState(null),[devBought,setDevBought]=useState(false),[devCardsBought,setDevCardsBought]=useState({}),[devPlayed,setDevPlayed]=useState(false),[robberMode,setRobberMode]=useState(false),[discardState,setDiscardState]=useState(null),[discardSelection,setDiscardSelection]=useState(empty()),[robberVictim,setRobberVictim]=useState(null),[heldAwards,setHeldAwards]=useState({roadOwner:null,armyOwner:null}),[quickPanel,setQuickPanel]=useState(null),[turnNumber,setTurnNumber]=useState(1),[lastTurnSummary,setLastTurnSummary]=useState(""),[theme,setTheme]=useState(()=>{try{return (localStorage.getItem(THEME_KEY)??localStorage.getItem(LEGACY_THEME_KEY))||"Cyan"}catch{return"Cyan"}}),[analysisReplay,setAnalysisReplay]=useState(null),[analysisIndex,setAnalysisIndex]=useState(0),[musicEnabled,setMusicEnabled]=useState(()=>{try{return (localStorage.getItem(MUSIC_KEY)??localStorage.getItem(LEGACY_MUSIC_KEY))!=="off"}catch{return true}}),[actionConfirm,setActionConfirm]=useState(null),[duelNotice,setDuelNotice]=useState(null),[sidePanel,setSidePanel]=useState("activity"),[chatInput,setChatInput]=useState(""),[chatMessages,setChatMessages]=useState([]),[chatUnread,setChatUnread]=useState(0),[tradeHubTab,setTradeHubTab]=useState("bank"),[rulesOpen,setRulesOpen]=useState(false),[engineTargetVP,setEngineTargetVP]=useState(10),[engineHeldAwards,setEngineHeldAwards]=useState({roadOwner:null,armyOwner:null}),[engineSelectedPiece,setEngineSelectedPiece]=useState(null),[engineDevCounts,setEngineDevCounts]=useState(()=>({...DEV})),[lastPrivateDevDraw,setLastPrivateDevDraw]=useState(null);
  const decisionsRef=useRef([]);
  const logRef=useRef([]);
  const turnDeadlineRef=useRef(null);
  const timerTurnTokenRef=useRef(null);
  const timeoutHandlerRef=useRef(()=>{});
  const botTurnRef=useRef(null);
  const botHardStopRef=useRef(null);
  const memoryRef=useRef([]);
  const turnSequenceRef=useRef(0);
  const gameRunRef=useRef(0);
  const analysisTurnRef=useRef(null);
  const analysisFramesRef=useRef([]);
  const musicCleanupRef=useRef(null);
  const actionConfirmTimerRef=useRef(null);
  const actionLockRef=useRef(false);
  const timerExpiredTokenRef=useRef(null);
  const duelNoticeTimerRef=useRef(null);
  const botTradeResumeRef=useRef(null);
  const botSevenResumeRef=useRef(null);
  const botTradeTimeoutRef=useRef(null);
  const playersStateRef=useRef([]);
  const strategicPlansRef=useRef({});
  useEffect(()=>{playersStateRef.current=players},[players]);
  const [botTurnStatus,setBotTurnStatus]=useState("idle");
  const targetVP=mode==="pvbot"?15:10;const isPVBot=mode==="pvbot";const active=players[turn];
  useEffect(()=>{
    const vars=themeVars(theme);
    const root=document.documentElement;
    Object.entries(vars).forEach(([k,v])=>root.style.setProperty(k,v));
    root.dataset.monopolyTheme=theme.toLowerCase();
    try{localStorage.setItem(THEME_KEY,theme)}catch{}
  },[theme]);
  useEffect(()=>{
    const cards=[];Object.entries(engineDevCounts||{}).forEach(([card,count])=>{for(let i=0;i<Math.max(0,Number(count)||0);i++)cards.push(card);});
    setEngineDeck(shuffle(cards));
  },[engineDevCounts]);
  useEffect(()=>{
    if(sidePanel==="chat")setChatUnread(0);
  },[sidePanel]);
  useEffect(()=>{
    try{localStorage.setItem(MUSIC_KEY,musicEnabled?"on":"off")}catch{}
    if(!musicEnabled || !["playing","setupBoard","engineSetup"].includes(screen)){
      if(musicCleanupRef.current){musicCleanupRef.current();musicCleanupRef.current=null;}
      return;
    }
    if(!musicCleanupRef.current){
      try{musicCleanupRef.current=createViolinLoop();}catch{musicCleanupRef.current=null;}
    }
    return undefined;
  },[musicEnabled,screen]);
  const queueActionConfirm=(key,label,onConfirm)=>{
    if(!["draw","resign"].includes(key)) return;
    if(actionConfirmTimerRef.current)window.clearTimeout(actionConfirmTimerRef.current);
    setActionConfirm({key,label,onConfirm,visible:false});
    actionConfirmTimerRef.current=window.setTimeout(()=>setActionConfirm({key,label,onConfirm,visible:true}),1000);
  };
  const cancelActionConfirm=()=>{
    if(actionConfirmTimerRef.current)window.clearTimeout(actionConfirmTimerRef.current);
    actionConfirmTimerRef.current=null;setActionConfirm(null);
  };
  const executeConfirmedAction=()=>{
    if(!actionConfirm?.visible || !["draw","resign"].includes(actionConfirm.key))return;
    const fn=actionConfirm.onConfirm;
    cancelActionConfirm();
    if(typeof fn==="function")fn();
  };
  const showDuelNotice=(kind,text)=>{
    if(duelNoticeTimerRef.current)window.clearTimeout(duelNoticeTimerRef.current);
    setDuelNotice({kind,text});
    duelNoticeTimerRef.current=window.setTimeout(()=>{duelNoticeTimerRef.current=null;setDuelNotice(null)},3500);
  };
  const runHumanAction=(fn)=>{
    if(actionLockRef.current)return false;
    actionLockRef.current=true;
    try{return fn();}
    finally{window.setTimeout(()=>{actionLockRef.current=false},120);}
  };

  useEffect(()=>{
    const onGameKey=(e)=>{
      if(e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey)return;
      const tag=e.target?.tagName;
      if(tag==="INPUT"||tag==="TEXTAREA"||tag==="SELECT"||e.target?.isContentEditable)return;
      if(screen!=="playing"||tab!=="game")return;
      const k=e.key.toLowerCase();
      if(k==="r"){e.preventDefault();rollDice();}
      else if(k==="e"){e.preventDefault();endTurn(false);}
      else if(k==="t"){e.preventDefault();if(isPVBot||active?.bot)return;setQuickPanel("trade");}
      else if(k==="d"){e.preventDefault();if(!active?.bot&&canBuyDevelopmentCard(active,deck))buyDev();}
      else if(k==="p"){e.preventDefault();if(!active?.bot&&!devPlayed)setDevOpen(true);}
      else if(k==="h"){e.preventDefault();setSidePanel("activity");}
      else if(k==="c"){e.preventDefault();setSidePanel("chat");}
      else if(k==="f"){e.preventDefault();toggleFullscreen();}
      else if(k==="?"||k==="/"){e.preventDefault();setRulesOpen(true);}
    };
    window.addEventListener("keydown",onGameKey);
    return()=>window.removeEventListener("keydown",onGameKey);
  },[screen,tab,active,deck,devPlayed,isPVBot]);
  useEffect(()=>{
    const onKey=(e)=>{
      if(tab!=="historyAnalyze"||!analysisReplay)return;
      const k=e.key;
      if(k==="\\"||k==="]"||k==="ArrowRight"){e.preventDefault();setAnalysisIndex(i=>Math.min((analysisReplay.analysisFrames?.length||1)-1,i+1));}
      else if(k==="/"||k==="["||k==="ArrowLeft"){e.preventDefault();setAnalysisIndex(i=>Math.max(0,i-1));}
    };
    window.addEventListener("keydown",onKey);
    return()=>window.removeEventListener("keydown",onKey);
  },[tab,analysisReplay]);
  const award=useMemo(()=>players.length?awards(players,geo,heldAwards):{roads:[],armies:[],roadOwner:null,armyOwner:null},[players,geo,heldAwards]);
  useEffect(()=>{if(!players.length)return;const next=awards(players,geo,heldAwards);if(next.roadOwner!==heldAwards.roadOwner||next.armyOwner!==heldAwards.armyOwner)setHeldAwards({roadOwner:next.roadOwner,armyOwner:next.armyOwner});},[players,geo,heldAwards]);
  const prod=useMemo(()=>board&&active?adjacentProduction(geo,board,active):empty(),[geo,board,active]);
  const deckStats=useMemo(()=>cardProbabilities(deck||[]),[deck]);
  const normalizeLog=entries=>(entries||[]).map((x,i)=>typeof x==="string"?{id:`legacy-${Date.now()}-${i}`,turn:1,text:x}:x);
  const setLogEntries=entries=>{const next=normalizeLog(entries);logRef.current=next;setLog(next);};
  const sendChat=(text,system=false)=>{const message={id:`chat-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,name:system?"MONOPOLY":"You",text:String(text),turn:turnNumber,time:new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})};setChatMessages(m=>[...m,message].slice(-80));if(sidePanel!=="chat")setChatUnread(n=>n+1);};
  const handleChatSubmit=e=>{e.preventDefault();const t=chatInput.trim();if(!t)return;sendChat(t);setChatInput("");};
  const toggleFullscreen=()=>{try{if(!document.fullscreenElement)document.documentElement.requestFullscreen?.();else document.exitFullscreen?.();}catch{}};
  const appendLog=x=>{const entry={id:`log-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,turn:turnNumber,text:String(x)};const next=[entry,...logRef.current].slice(0,2000);logRef.current=next;setLog(next);};
  useEffect(()=>{
    if(!["setupBoard","playing"].includes(screen)||!players.length||!board?.length)return;
    const report=gameInvariantReport(players,board,bank,deck,geo);
    setIntegrityErrors(report.errors);
    const signature=report.errors.join("|");
    if(report.errors.length&&signature!==integrityStampRef.current){
      integrityStampRef.current=signature;
      console.error("MONOPOLY ENGINE INTEGRITY",report.errors);
    }
    if(!report.errors.length)integrityStampRef.current="";
  },[screen,players,board,bank,deck,geo]);
  const prependSetupLog=x=>{const entry={id:`setup-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,turn:turnNumber,text:String(x)};const next=[entry,...logRef.current].slice(0,2000);logRef.current=next;setLog(next);};
  const visibleActivityLog = (winner||drawn) ? log : log.filter(x=>x.turn>=Math.max(1,turnNumber-2));
  const activityTurnGroups = visibleActivityLog.reduce((groups,entry)=>{const key=Number(entry.turn||1);let g=groups.find(x=>x.turn===key);if(!g){g={turn:key,entries:[]};groups.push(g);}g.entries.push(entry);return groups;},[]);
  const botNames = players.filter(p=>p.bot).map(p=>String(p.name));
  const activityKind = text=>{const value=String(text||""); if(botNames.some(name=>value.includes(name))) return "bot"; if(/^(New |Turn |Robber|You |Your |Game |Draw |Trade |Bank |Development|Built |Placed |Bought |Played |Rolled |Discard|Longest|Largest|Match)/i.test(value)) return "system"; return "player";};
  const update=id=>fn=>setPlayers(ps=>ps.map(p=>p.id===id?fn(p):p));
  const extendTurnTimer=(seconds=ACTION_TIME_BONUS_SECONDS)=>{
    if(active?.bot||!turnDeadlineRef.current||winner||drawn)return false;
    timerExpiredTokenRef.current=null;
    turnDeadlineRef.current+=seconds*1000;
    setTurnSecondsLeft(Math.max(0,Math.ceil((turnDeadlineRef.current-Date.now())/1000)));
    return true;  };
  const resetSetupTimer=()=>{
    if(screen!=="setupBoard"||!currentSetupPlayer||currentSetupPlayer.bot||winner||drawn)return;
    const token=`setup:${gameStarted}:${setupRound}:${setupIndex}:${currentSetupPlayer.id}`;
    timerTurnTokenRef.current=token;
    timerExpiredTokenRef.current=null;
    turnDeadlineRef.current=Date.now()+TURN_BASE_SECONDS*1000;
    setTurnSecondsLeft(TURN_BASE_SECONDS);
  };
  const extendSetupTimer=(seconds=ACTION_TIME_BONUS_SECONDS)=>{
    if(currentSetupPlayer?.bot||screen!=="setupBoard"||!turnDeadlineRef.current)return false;
    timerExpiredTokenRef.current=null;
    turnDeadlineRef.current+=seconds*1000;
    setTurnSecondsLeft(Math.max(0,Math.ceil((turnDeadlineRef.current-Date.now())/1000)));
    return true;
  };
  const resetTurnTimer=()=>{
    if(active?.bot||screen!=="playing"||winner||drawn)return;
    const token=`${gameStarted}:${turn}:${active?.id??"none"}`;
    timerTurnTokenRef.current=token;
    timerExpiredTokenRef.current=null;
    turnDeadlineRef.current=Date.now()+TURN_BASE_SECONDS*1000;
    setTurnSecondsLeft(TURN_BASE_SECONDS);
  };
  const rememberState=(phase,ps,seq=turnSequenceRef.current)=>{
    if(!ps?.length)return;
    memoryRef.current=[...memoryRef.current,{sequence:seq,phase,time:Date.now(),players:clone(ps.map(x=>({id:x.id,name:x.name,bot:x.bot,diff:x.diff,vp:x.vp,hand:x.hand,settlements:x.settlements,cities:x.cities,roads:x.roads,development:x.development})))}].slice(-80);
  };
  const memoryForBot=bot=>{
    const all=memoryRef.current;
    if(!bot?.bot)return[];
    if(bot.diff==="Impossible")return all;
    if(bot.diff==="Hard"){
      const cutoff=Math.max(0,turnSequenceRef.current-5);
      return all.filter(x=>x.sequence>=cutoff);
    }
    if(bot.diff==="Easy")return[];
    return all.slice(-1);
  };
  const memoryAwarePlayers=(bot,ps)=>{
    // Normal move selection uses only current public information. Historical exact
    // hands/development cards are NEVER injected into the ordinary planner.
    // Special memory is passed separately to robber/Knight/Monopoly/blocking logic.
    return ps.map(op=>{
      if(op.id===bot.id)return op;
      return {
        ...op,
        publicCardCount:total(op.hand),
        hand:empty(),
        development:{...emptyDev(),playedKnights:op.development?.playedKnights||0}
      };
    });
  };

  const specialMemory=bot=>memoryForBot(bot);
  const historicalBlockBonus=(spot,bot,ps,bd,pressureById=null)=>{
    const snaps=specialMemory(bot);
    if(!snaps.length)return 0;
    const prod=spotProduction(spot,bd,geo);
    const pressures=pressureById||Object.fromEntries(ps.filter(x=>x.id!==bot.id).map(x=>[x.id,memoryResourcePressure(snaps,x.id)]));
    let bonus=0;
    for(const opp of ps.filter(x=>x.id!==bot.id)){
      const pressure=pressures[opp.id]||empty();
      bonus+=RES.reduce((sum,r)=>sum+prod[r]*Math.max(0,pressure[r]-1.5),0);
    }
    return bonus*0.9;
  };
  const memoryMonopolyTarget=(bot,ps,bd,bk=bank)=>{
    const snaps=specialMemory(bot);
    const currentNeed=NeedProfile(bot,ps,bd,geo,bk,botModeConfig(ps,targetVP)).need;
    const opponents=ps.filter(x=>x.id!==bot.id);
    const pressures=Object.fromEntries(opponents.map(x=>[x.id,memoryResourcePressure(snaps,x.id)]));
    return RES.slice().sort((a,b)=>{
      const pa=opponents.reduce((n,x)=>n+(pressures[x.id]?.[a]||0),0);
      const pb=opponents.reduce((n,x)=>n+(pressures[x.id]?.[b]||0),0);
      return (pb*currentNeed[b])-(pa*currentNeed[a]);
    })[0]||RES[0];
  };


  const beginAnalysisTurn=(playerId,turnNo,ps,bd,pr,bk,dk,ha)=>{
    if(!ps?.length||!bd?.length)return;
    const player=ps.find(x=>x.id===playerId)||ps[0];
    const frameBase={players:clone(ps),board:clone(bd),ports:clone(pr||[]),bank:clone(bk||emptyBank()),deckCount:Array.isArray(dk)?dk.length:0,heldAwards:clone(ha||{roadOwner:null,armyOwner:null})};
    analysisTurnRef.current={turn:turnNo,playerId,playerName:player?.name||"Player",decisionStart:decisionsRef.current.length,before:frameBase,beforeOdds:engineWinLikelihood(ps,bd,geo,pr||[],bk||emptyBank(),targetVP),baselineLabel:"turn start"};
  };
  const setAnalysisTurnBaseline=(ps,bd,pr,bk,dk,ha,label="post-roll")=>{
    const pending=analysisTurnRef.current;
    if(!pending||!ps?.length||!bd?.length)return;
    pending.before={players:clone(ps),board:clone(bd),ports:clone(pr||[]),bank:clone(bk||emptyBank()),deckCount:Array.isArray(dk)?dk.length:0,heldAwards:clone(ha||{roadOwner:null,armyOwner:null})};
    pending.beforeOdds=engineWinLikelihood(ps,bd,geo,pr||[],bk||emptyBank(),targetVP);
    pending.baselineLabel=label;
    pending.decisionStart=decisionsRef.current.length;
  };
  const finalizeAnalysisTurn=({ps,bd,pr,bk,dk,ha,summary=""})=>{
    const pending=analysisTurnRef.current;
    if(!pending||!ps?.length||!bd?.length)return;
    const afterOdds=engineWinLikelihood(ps,bd,geo,pr||[],bk||emptyBank(),targetVP);
    const decisionsForTurn=decisionsRef.current.slice(pending.decisionStart).filter(d=>d.turn===pending.turn&&d.playerId===pending.playerId);
    const actions=decisionsForTurn.map(d=>d.action).filter(Boolean);
    const mainAction=actions.length?actions.join(" → "):summary||"Turn completed";
    const actedPlayer=pending.before.players.find(x=>x.id===pending.playerId)||ps.find(x=>x.id===pending.playerId);
    const isBotTurn=!!actedPlayer?.bot;
    const meBefore=pending.beforeOdds.find(x=>x.id===pending.playerId)?.prob??0.5;
    const meAfter=afterOdds.find(x=>x.id===pending.playerId)?.prob??meBefore;
    const delta=meAfter-meBefore;
    const classification=classifyAnalysisMove(delta,mainAction);
    const frame={turn:pending.turn,playerId:pending.playerId,playerName:pending.playerName,isBot:isBotTurn,action:mainAction,delta,classification,beforeOdds:clone(pending.beforeOdds),afterOdds:clone(afterOdds),baseline:pending.baselineLabel||"turn start",before:pending.before,after:{players:clone(ps),board:clone(bd),ports:clone(pr||[]),bank:clone(bk||emptyBank()),deckCount:Array.isArray(dk)?dk.length:0,heldAwards:clone(ha||{roadOwner:null,armyOwner:null})},decisions:clone(decisionsForTurn),summary};
    analysisFramesRef.current=[...analysisFramesRef.current,frame];
    analysisTurnRef.current=null;
  };

  const startEngineSetup=()=>{
    const b=makeEngineBoard(geo,mapSettings);
    setEnginePlayers(makeEnginePlayers());
    setEngineBoard(b);
    setEnginePorts(makePorts(geo));
    setEngineBank(emptyBank());
    setEngineDeck(devDeck());
    setEngineActive(0);
    setEngineStage("action");
    setEngineSelectedTile(null);
    setEnginePieceMode("inspect");
    setEngineSelectedPiece(null);
    setEngineTargetVP(isPVBot?15:10);
    setEngineHeldAwards({roadOwner:null,armyOwner:null});
    setEngineDevCounts({...DEV});
    setEngineAnalysis(false);
    setEngineCustomOpen(false);
    setScreen("engineSetup");
  };
  const randomizeEngineBoard=()=>{
    try{setEngineBoard(makeEngineBoard(geo,mapSettings));setEnginePorts(makePorts(geo));setEngineSelectedTile(null);}catch(e){console.error(e);}
  };
  const updateEnginePlayer=(id,fn)=>setEnginePlayers(ps=>ps.map(p=>p.id===id?fn(p):p));
  const engineSetHand=(id,r,value)=>updateEnginePlayer(id,p=>({...p,hand:{...p.hand,[r]:Math.max(0,Math.min(19,Number(value)||0))}}));
  const engineSetVP=(id,value)=>updateEnginePlayer(id,p=>({...p,vp:Math.max(0,Number(value)||0)}));
  const engineSetDev=(id,card,value)=>updateEnginePlayer(id,p=>({...p,development:{...p.development,[card]:Math.max(0,Number(value)||0)}}));
  const engineSetKnights=(id,value)=>updateEnginePlayer(id,p=>({...p,development:{...p.development,playedKnights:Math.max(0,Number(value)||0)}}));
  const engineSetBank=(r,value)=>setEngineBank(b=>({...b,[r]:Math.max(0,Math.min(19,Number(value)||0))}));
  const engineSetAward=(key,value)=>setEngineHeldAwards(a=>({...a,[key]:value==="null"?null:Number(value)}));
  const engineSetTile=(tid,patch)=>setEngineBoard(bs=>bs?bs.map((t,i)=>i===tid?{...t,...patch}:t):bs);
  const enginePlacePiece=(type,vertexOrEdge)=>{
    if(vertexOrEdge==null)return;
    const pid=engineActive;
    setEnginePlayers(ps=>ps.map(p=>{
      if(p.id!==pid)return p;
      if(type==="settlement"){
        if(p.settlements.includes(vertexOrEdge)||p.cities.includes(vertexOrEdge))return p;
        return {...p,settlements:[...p.settlements,vertexOrEdge]};
      }
      if(type==="city"){
        if(!p.settlements.includes(vertexOrEdge))return p;
        return {...p,settlements:p.settlements.filter(v=>v!==vertexOrEdge),cities:[...p.cities,vertexOrEdge]};
      }
      if(type==="road"){
        if(p.roads.includes(vertexOrEdge)||enginePlayers.some(o=>o.roads.includes(vertexOrEdge)))return p;
        return {...p,roads:[...p.roads,vertexOrEdge]};
      }
      return p;
    }));
  };
  const removeEnginePiece=(kind,id)=>{setEnginePlayers(ps=>ps.map(p=>p.id===engineActive?{...p,[kind]:p[kind].filter(x=>x!==id)}:p));setEngineSelectedPiece(null);};
  const runEngineAnalysis=()=>setEngineAnalysis(true);
  const resetEngineState=()=>{setEnginePlayers(makeEnginePlayers(enginePlayerCount));setEngineBoard(makeEngineBoard(geo,mapSettings));setEnginePorts(makePorts(geo));setEngineBank(emptyBank());setEngineDeck(devDeck());setEngineActive(0);setEngineStage("action");setEngineSelectedTile(null);setEngineSelectedPiece(null);setEnginePieceMode("inspect");setEngineTargetVP(enginePlayerCount===2?15:10);setEngineHeldAwards({roadOwner:null,armyOwner:null});setEngineDevCounts({...DEV});setEngineAnalysis(false);};

  const startGame=()=>{
    if(musicEnabled&&!musicCleanupRef.current){try{musicCleanupRef.current=createViolinLoop();}catch{}}
    gameRunRef.current+=1;
    const b=makeBoard(geo,mapSettings);
    const ps=isPVBot
      ? [newPlayer(0,"You",false,"Human"),newPlayer(1,pvBot,true,pvBotDiff)]
      : [newPlayer(0,"You",false,"Human"),newPlayer(1,"Maya",opponentTypes[0]!=="Human",botDiffs[0]),newPlayer(2,"Rook",opponentTypes[1]!=="Human",botDiffs[1]),newPlayer(3,"Nova",opponentTypes[2]!=="Human",botDiffs[2])];
    const order=isPVBot?[0,1]:[0,1,2,3];
    botSevenResumeRef.current=null;setBoard(b);setPorts(makePorts(geo));setDeck(devDeck());setBank(emptyBank());setPlayers(ps);setTurn(0);setSetupRound(1);setSetupOrder(order);setSetupIndex(0);setRoll(null);setDice(null);setLastBotRoll(null);setHasRolled(false);setWinner(null);setDrawn(false);setDrawOffer(null);setTurnSecondsLeft(TURN_BASE_SECONDS);turnDeadlineRef.current=null;timerTurnTokenRef.current=null;timerExpiredTokenRef.current=null;setDevBought(false);setDevCardsBought({});setDevPlayed(false);setDevChoice(null);setLastPrivateDevDraw(null);setRobberMode(false);setDiscardState(null);setDiscardSelection(empty());setRobberVictim(null);setHeldAwards({roadOwner:null,armyOwner:null});setPvOpeningPlan(null);setDecisions([]);setTurnNumber(1);setLastTurnSummary("");decisionsRef.current=[];analysisFramesRef.current=[];analysisTurnRef.current=null;botTurnRef.current=null;setBotTurnStatus("idle");memoryRef.current=[];turnSequenceRef.current=0;const openingLog=isPVBot?"New 1v1 PVBot match — Colonist-style ranked rules: 15 VP, balanced dice, Friendly Robber, 9-card safe hand, no player trading, ≤5s bot engine.":`New ${targetVP}-VP game. Place your first settlement.`;setLogEntries([{id:`start-${Date.now()}`,turn:1,text:openingLog}]);setGameStarted(Date.now());setTab("game");setSidePanel("activity");setChatUnread(0);setChatMessages([{id:`welcome-${Date.now()}`,name:"MONOPOLY",text:isPVBot?"1v1 ranked-style game: no player trading, Friendly Robber, Balanced Dice, 15 VP.":"Base game: 4 players, 10 VP, standard player trading and random dice.",turn:1,time:new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}]);setRulesOpen(false);if(botTradeTimeoutRef.current)window.clearTimeout(botTradeTimeoutRef.current);botTradeTimeoutRef.current=null;botTradeResumeRef.current=null;setTradeOffer(null);setScreen("setupBoard");
  };
  const currentSetupPlayer=players[setupOrder[setupIndex]];
  const finishSetupPlacement=(pid,v,edgeId,countAsAction=true)=>{
    const expectedPid=setupOrder[setupIndex];
    const placing=players.find(p=>p.id===pid);
    const expectedPieces=setupRound===1?0:1;
    // A setup click is a transaction: only the player whose turn is actually on screen
    // may commit it, and each player may place exactly one settlement/road per round.
    // This prevents stale clicks, double-click races and 4-player setup desyncs.
    if(pid!==expectedPid||!placing||placing.settlements.length!==expectedPieces||placing.roads.length!==expectedPieces)return;
    if(players.some(p=>p.id!==pid&&((p.settlements||[]).includes(v)||(p.cities||[]).includes(v)))||!legalSettlement(v,players,geo)||!legalInitialRoad(edgeId,v,players,geo))return;
    let nextPlayers=players.map(p=>p.id===pid?{...p,settlements:[...p.settlements,v],roads:[...p.roads,edgeId],vp:p.vp+1}:p);
    if(countAsAction&&!placing.bot)extendSetupTimer();
    if(setupRound===2){const gain=empty();geo.vertexTiles[v].forEach(tid=>{const r=board[tid].resource;if(r!=="desert")gain[r]++});setBank(b=>{const out={...b};RES.forEach(r=>out[r]=Math.max(0,out[r]-(gain[r]||0)));return out});nextPlayers=nextPlayers.map(p=>p.id===pid?{...p,hand:add(p.hand,gain)}:p)}
    setPlayers(nextPlayers);
    const nextIndex=setupIndex+1;
    if(nextIndex<setupOrder.length){setSetupIndex(nextIndex);return;}
    if(setupRound===1){setSetupRound(2);setSetupOrder(isPVBot?[1,0]:[3,2,1,0]);setSetupIndex(0);prependSetupLog("Second settlement round: your second settlement also grants its adjacent starting resources.");}
    else{
      const setupComplete=nextPlayers.every(pl=>pl.settlements.length===2&&pl.roads.length===2);
      if(!setupComplete){prependSetupLog("Setup validation failed; all players must have two settlements and two roads.");return;}
      setScreen("playing");setTurn(0);prependSetupLog("Setup complete. Your turn — roll the dice.");
      const bankForTurn=emptyBank();
      // Colonist/Catan starts the main game with the resource bank reduced by every
      // card granted from all second settlements, not merely the final placement.
      nextPlayers.forEach(pl=>{RES.forEach(r=>{bankForTurn[r]=Math.max(0,bankForTurn[r]-(pl.hand?.[r]||0));});});
      beginAnalysisTurn(0,1,nextPlayers,board,ports,bankForTurn,deck,heldAwards);
    }
  };
  const autoBotSetup=()=>{
    if(screen!=="setupBoard"||!currentSetupPlayer?.bot)return;const p=currentSetupPlayer,firstRound=p.settlements.length===0;
    const difficulty=botDifficultyProfile(p.diff);
    const pair=firstRound?bestOpeningPair(p,players,board,geo,ports,bank,targetVP,Math.round(1100*difficulty.openingBudgetMultiplier)):bestOpeningCompanion(p.settlements[0],p,players,board,geo,ports,bank,targetVP,Math.round(700*difficulty.openingBudgetMultiplier));
    if(firstRound&&pair)setPvOpeningPlan(pair);
    const target=pair?.second!=null&&p.settlements.length===1?pair.second:pair?.first;let v=target;
    if(v==null){const cache=makeScoreCache(players,board,geo,ports,bank,targetVP);const candidates=geo.vertices.map((_,i)=>({i,s:openingPlacementScore(i,p,players,board,geo,ports,bank,targetVP,cache)})).filter(x=>Number.isFinite(x.s)).sort((a,b)=>b.s-a.s);v=candidates[0]?.i;}if(v==null)return;
    const placedVirtual={...p,settlements:[...(p.settlements||[]),v]},placedPlayers=players.map(x=>x.id===p.id?placedVirtual:x);
    const futureCandidates=geo.vertices.map((_,i)=>i).filter(x=>legalSettlement(x,placedPlayers,geo)).map(x=>({v:x,s:openingPlacementScore(x,placedVirtual,placedPlayers,board,geo,ports,bank,targetVP)})).sort((a,b)=>b.s-a.s).slice(0,12);
    const paths=[];for(const c of futureCandidates){const path=strategicRoadPathToSettlement(c.v,placedVirtual,placedPlayers,geo);if(path?.length)paths.push({v:c.v,path,score:c.s});}
    const edgeCandidates=(geo.vertexEdges[v]||[]).filter(eid=>legalInitialRoad(eid,v,players,geo));
    const edgeScore=eid=>{let score=0;for(const item of paths){if(item.path[0]===eid)score+=90+Math.max(0,30-item.path.length*5)+item.score*.25;}const e=geo.edges[eid];for(const ov of [e.a,e.b]){score+=(geo.neighbors[ov]||[]).filter(n=>legalSettlement(n,placedPlayers,geo)).length*.9;const pt=portAt(ov,ports);if(pt)score+=pt.type.startsWith('2:1')?2.2:.7;}return score;};
    const edge=edgeCandidates.sort((a,b)=>edgeScore(b)-edgeScore(a))[0];if(edge==null)return;finishSetupPlacement(p.id,v,edge);
  };
  const autoResolveSetupTimer=()=>{
    if(screen!=="setupBoard"||!currentSetupPlayer||currentSetupPlayer.bot||!turnDeadlineRef.current)return;
    const cache=makeScoreCache(players,board,geo,ports,bank,targetVP);
    const candidates=geo.vertices.map((_,i)=>({i,s:openingPlacementScore(i,currentSetupPlayer,players,board,geo,ports,bank,targetVP,cache)})).filter(x=>Number.isFinite(x.s)&&legalSettlement(x.i,players,geo)).sort((a,b)=>b.s-a.s);
    const v=candidates[0]?.i;
    if(v==null)return;
    const edgeCandidates=(geo.vertexEdges[v]||[]).filter(eid=>legalInitialRoad(eid,v,players,geo));
    if(!edgeCandidates.length)return;
    const edge=edgeCandidates.sort((a,b)=>{
      const score=eid=>{const e=geo.edges[eid];const other=e.a===v?e.b:e.a;const future=(geo.neighbors[other]||[]).filter(n=>legalSettlement(n,players,geo)).length;return future+(portAt(other,ports)?1:0);};
      return score(b)-score(a);
    })[0];
    finishSetupPlacement(currentSetupPlayer.id,v,edge,false);
    turnDeadlineRef.current=Date.now()+150;
    appendLog(`${currentSetupPlayer.name} timed out during setup; the engine selected the highest-scoring legal opening placement.`);
  };
  useEffect(()=>{
    if(screen!=="setupBoard"||!currentSetupPlayer||currentSetupPlayer.bot){if(screen!=="setupBoard")turnDeadlineRef.current=null;return;}
    const token=`setup:${gameStarted}:${setupRound}:${setupIndex}:${currentSetupPlayer.id}`;
    if(timerTurnTokenRef.current!==token)resetSetupTimer();
    const tick=()=>{
      if(!turnDeadlineRef.current)return;
      const remaining=Math.max(0,Math.ceil((turnDeadlineRef.current-Date.now())/1000));
      setTurnSecondsLeft(remaining);
      if(remaining<=0 && timerExpiredTokenRef.current!==token){
        timerExpiredTokenRef.current=token;
        turnDeadlineRef.current=null;
        autoResolveSetupTimer();
      }
    };
    tick();const id=setInterval(tick,250);return()=>clearInterval(id);
  },[screen,setupRound,setupIndex,currentSetupPlayer?.id,gameStarted]);
  useEffect(()=>{if(screen!=="setupBoard"||!currentSetupPlayer?.bot)return;const timer=setTimeout(autoBotSetup,0);return()=>clearTimeout(timer)},[screen,setupIndex,setupRound,players]);

  const decisionKey=a=>{if(!a)return"pass";if(["settlement","road","city"].includes(a.type))return `${a.type}:${a.spot}`;if(a.type==="trade")return `trade:${a.give}:${a.get}:${a.rate}`;if(a.type==="playerTrade")return `playerTrade:${a.partner}:${JSON.stringify(a.giveBundle||{[a.give]:a.giveAmount})}:${JSON.stringify(a.getBundle||{[a.get]:a.getAmount})}`;if(a.type==="play")return `play:${a.card}`;return a.type;};
  const recordDecision=(player,action)=>{if(!player.bot&&board){const rec=aiPlan(player,players,board,geo,deck,ports,targetVP,bank,heldAwards);const item={turn:turnNumber,playerId:player.id,playerName:player.name,action:actionLabel(action),recommended:actionLabel(rec),actionKey:decisionKey(action),recommendedKey:decisionKey(rec),match:decisionKey(action)===decisionKey(rec)};decisionsRef.current=[...decisionsRef.current,item];setDecisions(decisionsRef.current);}};
  const checkWin=(ps,turnPlayerId=turn)=>{const a=awards(ps,geo,heldAwards);const actor=ps.find(p=>p.id===turnPlayerId);return actor&&actor.vp+(a.roadOwner===actor.id?2:0)+(a.armyOwner===actor.id?2:0)>=targetVP?actor:null;};
  const finish=(winnerPlayer,finalPlayers=players,finalBoard=board,finalPorts=ports,finalHeldAwards=heldAwards,finalBank=bank,finalDeck=deck)=>{if(winner||drawn)return;finalizeAnalysisTurn({ps:finalPlayers,bd:finalBoard,pr:finalPorts,bk:finalBank,dk:finalDeck,ha:finalHeldAwards,summary:"Match ended"});const finalAwards=awards(finalPlayers,geo,finalHeldAwards),decisionList=decisionsRef.current.length?decisionsRef.current:decisions,analysisSummary=analysisRoleStats(analysisFramesRef.current,finalPlayers),my=analysisSummary.overall??(decisionList.length?Math.round(decisionList.filter(d=>d.match).length/decisionList.length*100):null);const snap={id:Date.now(),date:new Date().toISOString(),result:"win",winner:winnerPlayer.name,winnerId:winnerPlayer.id,players:clone(finalPlayers),board:clone(finalBoard),ports:clone(finalPorts),awards:clone(finalAwards),accuracy:my,analysisSummary,targetVP,settings:clone(mapSettings),decisions:clone(decisionList),memory:clone(memoryRef.current),logs:clone(logRef.current),analysisFrames:clone(analysisFramesRef.current)};const next=[snap,...history].slice(0,30);setWinner(winnerPlayer);setDrawn(false);setDrawOffer(null);turnDeadlineRef.current=null;setTurnSecondsLeft(0);setHistory(next);setReviewGame(snap);setTab("postgame");try{localStorage.setItem(HISTORY_KEY,JSON.stringify(next))}catch{}};
  const finishDraw=(reason="Draw accepted.")=>{if(winner||drawn)return;appendLog(reason);showDuelNotice("accepted",reason);finalizeAnalysisTurn({ps:players,bd:board,pr:ports,bk:bank,dk:deck,ha:heldAwards,summary:"Match ended in a draw"});const finalAwards=awards(players,geo,heldAwards),decisionList=decisionsRef.current.length?decisionsRef.current:decisions,analysisSummary=analysisRoleStats(analysisFramesRef.current,players),my=analysisSummary.overall??(decisionList.length?Math.round(decisionList.filter(d=>d.match).length/decisionList.length*100):null);const snap={id:Date.now(),date:new Date().toISOString(),result:"draw",winner:"Draw",winnerId:null,drawMessage:reason,players:clone(players),board:clone(board),ports:clone(ports),awards:clone(finalAwards),accuracy:my,analysisSummary,targetVP,settings:clone(mapSettings),decisions:clone(decisionList),memory:clone(memoryRef.current),logs:clone(logRef.current),analysisFrames:clone(analysisFramesRef.current)};const next=[snap,...history].slice(0,30);setWinner(null);setDrawn(true);setDrawOffer(null);turnDeadlineRef.current=null;setTurnSecondsLeft(0);setHistory(next);setReviewGame(snap);setTab("postgame");try{localStorage.setItem(HISTORY_KEY,JSON.stringify(next))}catch{}};
  const resignMatch=()=>{if(!isPVBot||!active||active.bot||winner||drawn)return;const bot=players.find(p=>p.bot);if(!bot)return;appendLog(`${active.name} resigned. ${bot.name} wins the 1v1 PVBot match.`);finish(bot);showDuelNotice("accepted",`${active.name} resigned — ${bot.name} wins.`);};
  const advanceBotTurn=(localPlayers, botName, summary="All useful actions completed; passing the turn automatically.",localBoardOverride=board,localBankOverride=bank,localDeckOverride=deck)=>{
    if(!localPlayers?.length)return;
    if(botHardStopRef.current){window.clearTimeout(botHardStopRef.current);botHardStopRef.current=null;}
    const nextTurn=(turn+1)%localPlayers.length;
    finalizeAnalysisTurn({ps:localPlayers,bd:localBoardOverride,pr:ports,bk:localBankOverride,dk:localDeckOverride,ha:heldAwards,summary});
    turnSequenceRef.current+=1;
    rememberState("turn-complete",localPlayers,turnSequenceRef.current);
    const botPlayer=localPlayers.find(x=>x.name===botName)||localPlayers.find(x=>x.bot);
    setLastTurnSummary(`${botName} completed Turn ${turnNumber}. ${summary}`);
    appendLog(`✓ ${botName} completed Turn ${turnNumber}. ${summary}`);
    setBotTurnStatus("finished");
    setTurnNumber(n=>n+1);
    setTurn(nextTurn);
    turnDeadlineRef.current=null;
    timerTurnTokenRef.current=null;
    setTurnSecondsLeft(TURN_BASE_SECONDS);
    setRoll(null);setDice(null);setHasRolled(false);setDevBought(false);setDevCardsBought({});setDevPlayed(false);setDevChoice(null);setRobberMode(false);setRobberVictim(null);setSelectedV(null);setSelectedE(null);
    beginAnalysisTurn(nextTurn,turnNumber+1,localPlayers,localBoardOverride,ports,localBankOverride,localDeckOverride,heldAwards);
    botTurnRef.current=null;
  };
  const offerDraw=()=>{if(!isPVBot||!active||active.bot||winner||drawn||drawOffer)return;const bot=players.find(p=>p.bot);if(!bot)return;setDrawOffer({from:active.id,to:bot.id});extendTurnTimer();appendLog(`${active.name} offered a draw to ${bot.name}. Awaiting response.`);showDuelNotice("info",`DRAW OFFER SENT — waiting for ${bot.name}.`);};
  const respondDrawOffer=(accept)=>{
    if(!drawOffer)return;
    const from=players.find(p=>p.id===drawOffer.from),to=players.find(p=>p.id===drawOffer.to);
    if(accept){finishDraw(`${to?.name||"PVBot"} ACCEPTED the draw offer. Match drawn.`);return;}
    const responder=to?.name||"PVBot";
    const message=`DRAW OFFER REJECTED — ${responder} declined.`;
    appendLog(message);
    showDuelNotice("rejected",message);
    extendTurnTimer();setDrawOffer(null);
  };
  function discardForSeven(ps){
    return ps.map(p=>{
      if(p.bot||total(p.hand)<=7)return p;
      return p;
    });
  }
  function randomDiscardBots(ps){
    const discarded=empty();
    const next=ps.map(p=>{
      if(!p.bot||total(p.hand)<=discardLimitFor(players.length,isPVBot))return p;
      const result=chooseBotDiscards(p,ps,board,geo,bank,targetVP);
      RES.forEach(r=>discarded[r]+=result.discarded[r]);
      appendLog(`${p.name} discarded ${total(result.discarded)} cards; protected direct build requirements.`);
      return {...p,hand:result.hand};
    });
    return{players:next,discarded};
  }
  function beginSevenDiscard(){
    const botResult=randomDiscardBots(players);const discardLimit=discardLimitFor(players.length,isPVBot);const humanQueue=botResult.players.filter(p=>!p.bot&&total(p.hand)>discardLimit).map(p=>p.id);
    setPlayers(botResult.players);setBank(b=>add(b,botResult.discarded));
    if(humanQueue.length){const pid=humanQueue[0],required=Math.floor(total(botResult.players.find(p=>p.id===pid).hand)/2);setDiscardState({queue:humanQueue,index:0,playerId:pid,remaining:required});setDiscardSelection(empty());appendLog(`7 rolled — ${discardLimit}-card safe hand exceeded. You must discard ${required} cards before the robber can move.`);}
    else{setRobberMode(true);appendLog("7 rolled — discards resolved. Choose a hex for the robber.");}
  }
  function resolveHumanDiscardSelection(state,chosen){
    if(!state)return;
    const pid=state.playerId;
    const current=players.find(p=>p.id===pid);
    if(!current || total(chosen)!==state.remaining)return;
    const next=players.map(p=>p.id===pid?{...p,hand:pay(p.hand,chosen)}:p);
    setPlayers(next);
    setBank(b=>add(b,chosen));
    extendTurnTimer();
    const nextIndex=state.index+1;
    if(nextIndex<state.queue.length){
      const nextPid=state.queue[nextIndex];
      const nextPlayer=next.find(p=>p.id===nextPid);
      const required=Math.floor(total(nextPlayer?.hand||empty())/2);
      setDiscardState({queue:state.queue,index:nextIndex,playerId:nextPid,remaining:required});
      setDiscardSelection(empty());
      appendLog(`${current.name} finished discarding.`);
    }else{
      const botResume=botSevenResumeRef.current;
      if(botResume){
        setDiscardState(null);
        setDiscardSelection(empty());
        botResume.resume(next,chosen);
      }else{
        setDiscardState(null);
        setDiscardSelection(empty());
        setRobberMode(true);
        appendLog("All discards resolved. Choose a hex for the robber.");
      }
    }
  }
  function handleDiscardResourceClick(resource){
    if(!discardState)return;
    const state=discardState;
    const player=players.find(p=>p.id===state.playerId)||active;
    if(!player || (player.hand?.[resource]||0)<=discardSelection[resource])return;
    setDiscardSelection(prev=>{
      const next={...prev,[resource]:(prev[resource]||0)+1};
      if(total(next)===state.remaining){
        requestAnimationFrame(()=>resolveHumanDiscardSelection(state,next));
      }
      return next;
    });
  }
  function confirmDiscard(){
    if(!discardState)return false;
    if(total(discardSelection)!==discardState.remaining)return false;
    resolveHumanDiscardSelection(discardState,discardSelection);
    return true;
  }
  function rollDice(){
    return runHumanAction(()=>{
      if(!active||active.bot||winner||drawn||hasRolled||robberMode||discardState)return false;
      const pair=rollOfficialDice();
      const a=pair[0],b=pair[1],sum=a+b;
      setDice([a,b]);setRoll(sum);setHasRolled(true);appendLog(`${active.name} rolled ${a} + ${b} = ${sum}.`);
      extendTurnTimer();
      if(sum===7){beginSevenDiscard();return true;}
      const produced=resolveDiceRoll(players,board,geo,sum,bank);
      setPlayers(produced.players);setBank(produced.bank);
      const received=produced.grants[active.id]||empty();
      const receivedText=RES.filter(r=>received[r]>0).map(r=>`${received[r]} ${LABEL[r]}`).join(", ");
      appendLog(receivedText?`${active.name} received ${receivedText}.`:`${active.name} received no resources from the roll.`);
      setAnalysisTurnBaseline(produced.players,board,ports,produced.bank,deck,heldAwards,"post-roll resource resolution");
      return true;
    });
  }
  function selectPlacementFromTile(tid,mode){
    if(tid==null||!geo.tiles[tid])return false;
    const tileVerts=geo.tiles[tid].vertices||[];
    if(mode==="setup"){
      const candidates=tileVerts.filter(v=>currentSetupPlayer&&!currentSetupPlayer.bot&&legalSettlement(v,players,geo));
      if(candidates.length){const v=candidates[0];setSelectedV(v);setSelectedE(null);setPlacementConfirm({vertex:v,kind:"settlement",mode});return true;}
      return false;
    }
    if(!active||active.bot||roll==null||roll===7)return false;
    const cityCandidates=tileVerts.filter(v=>active.settlements?.includes(v)&&canPay(active.hand,COSTS.city)&&piecesRemaining(active).cities>0);
    if(cityCandidates.length){const v=cityCandidates[0];setSelectedV(v);setPlacementConfirm({vertex:v,kind:"city",mode:"play"});return true;}
    const settlementCandidates=tileVerts.filter(v=>legalSettlement(v,players,geo)&&settlementConnected(v,active,geo)&&canPay(active.hand,COSTS.settlement)&&piecesRemaining(active).settlements>0);
    if(settlementCandidates.length){const v=settlementCandidates[0];setSelectedV(v);setPlacementConfirm({vertex:v,kind:"settlement",mode:"play"});return true;}
    return false;
  }
  function confirmPlacementPreview(){
    const preview=placementConfirm;
    if(!preview||preview.vertex==null)return false;
    const v=preview.vertex;
    if(preview.kind==="city")return buildCity(v);
    if(preview.mode==="setup"){
      if(!currentSetupPlayer||currentSetupPlayer.bot||!legalSettlement(v,players,geo))return false;
      setSelectedV(v);setSelectedE(null);setPlacementConfirm(null);
      appendLog(currentSetupPlayer.name+" confirmed settlement placement at intersection "+v+". Now choose its connected road.");
      extendTurnTimer();
      return true;
    }
    return buildSettlement(v);
  }
  function buildSettlement(v=selectedV){
    return runHumanAction(()=>{
      if(!active||active.bot||winner||drawn||v==null||!hasRolled||roll===7||robberMode||piecesRemaining(active).settlements<=0||!canPay(active.hand,COSTS.settlement)||!legalSettlement(v,players,geo)||!settlementConnected(v,active,geo)||screen!=="playing")return false;
      recordDecision(active,{type:"settlement",spot:v});
      setBank(b=>add(b,COSTS.settlement));
      update(active.id)(p=>({...p,hand:pay(p.hand,COSTS.settlement),settlements:[...p.settlements,v],vp:p.vp+1}));
      appendLog(`${active.name} built a settlement at intersection ${v}.`);
      setSelectedV(null);setPlacementConfirm(null);extendTurnTimer();
      return true;
    });
  }
  function buildCity(v=selectedV){
    return runHumanAction(()=>{
      if(!active||active.bot||winner||drawn||v==null||!hasRolled||roll===7||robberMode||piecesRemaining(active).cities<=0||!canPay(active.hand,COSTS.city)||!Array.isArray(active.settlements)||!active.settlements.includes(v)||active.cities?.includes(v)||screen!=="playing")return false;
      recordDecision(active,{type:"city",spot:v});
      setBank(b=>add(b,COSTS.city));
      update(active.id)(p=>({...p,hand:pay(p.hand,COSTS.city),settlements:p.settlements.filter(x=>x!==v),cities:[...p.cities,v],vp:p.vp+1}));
      appendLog(`${active.name} upgraded settlement ${v} to a city.`);
      setSelectedV(null);setPlacementConfirm(null);extendTurnTimer();
      return true;
    });
  }
  function buildRoad(eid=selectedE){
    return runHumanAction(()=>{
      if(!active||active.bot||winner||drawn||eid==null||!hasRolled||roll===7||robberMode||piecesRemaining(active).roads<=0||!canPay(active.hand,COSTS.road)||!legalRoad(eid,active,players,geo)||screen!=="playing")return false;
      recordDecision(active,{type:"road",spot:eid});
      setBank(b=>add(b,COSTS.road));
      update(active.id)(p=>({...p,hand:pay(p.hand,COSTS.road),roads:[...p.roads,eid]}));
      appendLog(`${active.name} built road ${eid}.`);
      setSelectedE(null);extendTurnTimer();
      return true;
    });
  }
  function buyDev(){
    return runHumanAction(()=>{
      if(!active||active.bot||winner||drawn||!hasRolled||robberMode||discardState||roll===7||!canPay(active.hand,COSTS.development)||!deck.length)return false;
      const card=deck[deck.length-1];recordDecision(active,{type:"buyDev"});
      const paidHand=pay(active.hand,COSTS.development);
      const a=awards(players,geo,heldAwards),visible=active.vp+(a.roadOwner===active.id?2:0)+(a.armyOwner===active.id?2:0),hiddenAfter=active.development.VictoryPoint+(card==="Victory Point"?1:0);
      setDeck(d=>d.slice(0,-1));setBank(b=>add(b,COSTS.development));
      if(card==="Victory Point"&&visible+hiddenAfter>=targetVP){
        const fixed=players.map(p=>p.id===active.id?{...p,hand:paidHand,vp:p.vp+hiddenAfter,development:{...p.development,VictoryPoint:0}}:p);
        setPlayers(fixed);setDevBought(true);setDevCardsBought(d=>({...d,[card]:(d[card]||0)+1}));setDevPlayed(true);appendLog(`${active.name} bought a Victory Point card and revealed ${hiddenAfter} VP card${hiddenAfter===1?"":"s"} to finish the game.`);const w=checkWin(fixed);if(w)finish(w,fixed);return true;
      }
      setDevBought(true);setDevCardsBought(d=>({...d,[card]:(d[card]||0)+1}));
      setLastPrivateDevDraw(card);
      update(active.id)(p=>({...p,hand:paidHand,development:{...p.development,[card]:(p.development[card]||0)+1}}));
      appendLog(`${active.name} bought a development card (private).`);extendTurnTimer();
      return true;
    });
  }
  function playDev(card){
    return runHumanAction(()=>{
      if(!active||active.bot||winner||drawn||roll===7||robberMode||discardState||!(active.development[card]>0))return false;
      const isVP=card==="Victory Point";
      if(!isVP&&!hasRolled){appendLog("Development cards other than Victory Point can only be played after rolling.");return false;}
      if(devPlayed&&!isVP)return false;
      if(!isVP && (active.development[card]-(devCardsBought[card]||0))<=0){appendLog(`You cannot play ${card} on the same turn it was bought.`);return false;}
      recordDecision(active,{type:"play",card});
      if(card==="Victory Point"){
        const a=awards(players,geo,heldAwards),visible=active.vp+(a.roadOwner===active.id?2:0)+(a.armyOwner===active.id?2:0),hidden=active.development.VictoryPoint;
        if(visible+hidden<targetVP){appendLog("Victory Point cards stay hidden until they can complete the win.");return false;}
        const fixed=players.map(p=>p.id===active.id?{...p,vp:p.vp+hidden,development:{...p.development,VictoryPoint:0}}:p);
        setPlayers(fixed);setDevPlayed(true);setDevOpen(false);appendLog(`${active.name} revealed ${hidden} Victory Point card${hidden===1?"":"s"} and reached ${targetVP} VP.`);const w=checkWin(fixed);if(w)finish(w,fixed);return true;
      }
      if(card==="Year of Plenty"||card==="Monopoly"||card==="Road Building"){
        setDevChoice({card,resources:[],roads:[]});setDevOpen(false);extendTurnTimer();return true;
      }
      const ps=players.map(p=>p.id===active.id?{...p,development:{...p.development,[card]:p.development[card]-1,playedKnights:card==="Knight"?p.development.playedKnights+1:p.development.playedKnights}}:p);
      setPlayers(ps);setDevPlayed(true);setDevOpen(false);extendTurnTimer();
      if(card==="Knight"){setRobberMode(true);appendLog(`${active.name} played Knight — choose a different hex for the robber.`);}else appendLog(`${active.name} played ${card}.`);
      return true;
    });
  }
  function applyDevChoice(card,resources=[],roads=[],choiceOverride=null){
    const choice=choiceOverride||devChoice;
    if(!active||winner||drawn||!choice||choice.card!==card)return false;
    const ownedCount=Number(active.development?.[card]||0);
    if(ownedCount<=0)return false;
    // Only one development card may be played per turn (VP reveal is handled separately).
    if(devPlayed&&card!=="Victory Point")return false;
    // A card bought this turn cannot be played this turn.
    if(card!=="Victory Point"&&ownedCount-(devCardsBought[card]||0)<=0)return false;
    if(card!=="Victory Point"&&!hasRolled)return false;
    if(card==="Year of Plenty"){
      if(resources.length!==2)return false;
      const counts=empty();resources.forEach(r=>counts[r]++);
      if(RES.some(r=>(bank[r]||0)<counts[r]))return false;
      let hand=active.hand;resources.forEach(r=>{hand=add(hand,{[r]:1})});
      const ps=players.map(p=>p.id===active.id?{...p,hand,development:{...p.development,[card]:p.development[card]-1}}:p);
      setBank(b=>{const out={...b};RES.forEach(r=>out[r]-=counts[r]);return out});
      setPlayers(ps);setDevChoice(null);setDevPlayed(true);extendTurnTimer();
      appendLog(`${active.name} played Year of Plenty and took ${resources.map(r=>LABEL[r]).join(" + ")}.`);return true;
    }
    if(card==="Monopoly"){
      const target=resources[0];if(!target)return false;
      let gain=0;
      const ps=players.map(p=>{if(p.id===active.id)return p;gain+=p.hand[target]||0;return{...p,hand:{...p.hand,[target]:0}}}).map(p=>p.id===active.id?{...p,hand:add(p.hand,{[target]:gain}),development:{...p.development,[card]:p.development[card]-1}}:p);
      setPlayers(ps);setDevChoice(null);setDevPlayed(true);extendTurnTimer();
      appendLog(`${active.name} played Monopoly on ${LABEL[target]} and collected ${gain}.`);return true;
    }
    if(card==="Road Building"){
      const p=players.find(x=>x.id===active.id);const chosen=roads.slice(0,2);
      if(!chosen.length)return false;
      if((p?.development?.[card]||0)<=0)return false;
      // Roads are already placed immediately when clicked. This completion step only
      // consumes the development card and closes the selection state.
      if(chosen.some(eid=>!p.roads.includes(eid)))return false;
      const ps=players.map(x=>x.id===active.id?{...x,development:{...x.development,[card]:x.development[card]-1}}:x);
      setPlayers(ps);setDevChoice(null);setDevPlayed(true);setSelectedE(null);extendTurnTimer();
      appendLog(`${active.name} completed Road Building (${chosen.length} free road${chosen.length===1?"":"s"}).`);return true;
    }
    return false;
  }

  function randomHeldResource(victim){
    // A robber steals one random PHYSICAL card, not one random resource type.
    const cards=[];
    RES.forEach(r=>{
      const count=Math.max(0,Number(victim?.hand?.[r]||0));
      for(let i=0;i<count;i++)cards.push(r);
    });
    if(!cards.length)return null;
    return cards[Math.floor(Math.random()*cards.length)];
  }
  function chooseRobberResourceForBot(_thief,victim,_currentPlayers,_currentBoard,_currentBank){
    return randomHeldResource(victim);
  }
  function stealFromVictim(victimCandidate,countAsAction=true,robberTid=null){
    // The robber's thief is always the player who rolled the 7 / played the Knight.
    // Resolve both IDs against the latest player snapshot and re-check that the
    // victim actually touches the destination hex. This prevents stale React state
    // from ever taking the card from the acting player.
    const latestPlayers=playersStateRef.current||players;
    const thiefId=active?.id;
    const victimId=victimCandidate?.id;
    const thief=latestPlayers.find(p=>p.id===thiefId);
    const victim=latestPlayers.find(p=>p.id===victimId);
    if(!thief||!victim||victimId===thiefId||total(victim.hand)<=0)return false;
    const tid=Number.isInteger(robberTid)?robberTid:(Number.isInteger(robberVictim?.tid)?robberVictim.tid:latestPlayers.length?board.findIndex(t=>t.robber):-1);
    const touching=new Set(tid>=0?(geo.vertexTiles[tid]||[]):[]);
    const stillEligible=(victim.settlements||[]).some(v=>touching.has(v))||(victim.cities||[]).some(v=>touching.has(v));
    if(!stillEligible)return false;
    const stolen=randomHeldResource(victim);
    if(!stolen||(victim.hand[stolen]||0)<=0)return false;
    const nextPlayers=latestPlayers.map(p=>{
      if(p.id===victim.id)return {...p,hand:{...p.hand,[stolen]:Math.max(0,(p.hand[stolen]||0)-1)}};
      if(p.id===thief.id)return {...p,hand:{...p.hand,[stolen]:(p.hand[stolen]||0)+1}};
      return p;
    });
    setPlayers(nextPlayers);
    if(countAsAction)extendTurnTimer();
    setRobberVictim(null);
    setRoll(roll===7?0:null);if(roll!==7)setDice(null);
    setRobberMode(false);setSelectedV(null);setSelectedE(null);
    appendLog(`${thief.name} moved the robber and stole 1 ${LABEL[stolen]} card from ${victim.name}.`);
    setAnalysisTurnBaseline(nextPlayers,board,ports,bank,deck,heldAwards,"post-robber resolution");
    return true;
  }
  function moveRobber(tid){
    return runHumanAction(()=>{
    if(!active||!robberMode||discardState||!board?.[tid]||board[tid].robber)return false;
    if(isPVBot&&players.some(p=>p.id!==active.id&&friendlyRobberProtected(p,players,geo,heldAwards)&&geo.vertexTiles[tid].some(v=>p.settlements.includes(v)||p.cities.includes(v)))){appendLog("Friendly Robber: that hex cannot block a player with 2 or fewer visible points.");return;}
    setBoard(bs=>bs.map((t,i)=>({...t,robber:i===tid})));
    const victims=players.filter(p=>p.id!==active.id&&geo.vertexTiles[tid].some(v=>p.settlements.includes(v)||p.cities.includes(v))&&total(p.hand)>0&&!friendlyRobberProtected(p,players,geo,heldAwards));
    if(victims.length===1){stealFromVictim(victims[0],true,tid);return;}
    if(victims.length>1){setRobberVictim({tid,victims:victims.map(v=>v.id)});appendLog(`${active.name} moved the robber. Choose which adjacent player to steal from.`);return;}
    appendLog(`${active.name} moved the robber. No adjacent player had a resource to steal.`);
    setRoll(roll===7?0:null);if(roll!==7)setDice(null);setRobberMode(false);setSelectedV(null);setSelectedE(null);
    setAnalysisTurnBaseline(players,board.map((t,i)=>({...t,robber:i===tid})),ports,bank,deck,heldAwards,"post-robber resolution");
    return true;
    });
  }
  function tradeNow(){
    return runHumanAction(()=>{
      if(!active||active.bot||!hasRolled||roll===7||robberMode||discardState||devChoice||trade.give===trade.get)return false;
      const rate=tradeRate(active,ports,trade.give);
      if((active.hand[trade.give]||0)<rate||(bank[trade.get]||0)<1)return false;
      recordDecision(active,{type:"trade"});
      setBank(b=>({...add(b,{[trade.give]:rate}),[trade.get]:(b[trade.get]||0)-1}));
      update(active.id)(p=>({...p,hand:add(pay(p.hand,{[trade.give]:rate}),{[trade.get]:1})}));
      appendLog(`${active.name} traded ${rate} ${LABEL[trade.give]} for 1 ${LABEL[trade.get]}${rate<4?" using a port":" with the bank"}.`);
      extendTurnTimer();
      return true;
    });
  }
  function playerTradeNow(){
    return runHumanAction(()=>{
      if(!active||active.bot||winner||drawn||players.length===2||!hasRolled||roll===7||robberMode||discardState||devChoice)return false;
      const t={partner:Number(playerTrade.partner),giveBundle:normalizeBundle(playerTrade.giveBundle),getBundle:normalizeBundle(playerTrade.getBundle)};
      const partner=players.find(p=>p.id===t.partner);
      if(!partner||partner.id===active.id||bundleTotal(t.giveBundle)<1||bundleTotal(t.getBundle)<1||bundlesShareResource(t.giveBundle,t.getBundle))return false;
      if(!bundleCanPay(active.hand,t.giveBundle))return false;
      if(partner.bot){
        const prodNeed=adjacentProduction(geo,board,partner);
        const giveValue=RES.reduce((s,r)=>s+(t.giveBundle[r]||0)*(1+(prodNeed[r]||0)/6),0);
        const getValue=RES.reduce((s,r)=>s+(t.getBundle[r]||0)*(1+(prodNeed[r]||0)/3),0);
        const handBuffer=partner.publicCardCount??total(partner.hand);
        const accepted=getValue>=giveValue*0.82 && handBuffer>0 && bundleCanPay(partner.hand,t.getBundle);
        if(!accepted){appendLog(`${partner.name} declined your trade offer.`);return true;}
        const next=players.map(p=>p.id===active.id?{...p,hand:add(pay(p.hand,t.giveBundle),t.getBundle)}:p.id===partner.id?{...p,hand:add(pay(p.hand,t.getBundle),t.giveBundle)}:p);
        setPlayers(next);recordDecision(active,{type:"trade"});extendTurnTimer();appendLog(`${partner.name} accepted: you gave ${bundleText(t.giveBundle)} for ${bundleText(t.getBundle)}.`);return true;
      }
      setTradeOffer({from:active.id,to:partner.id,giveBundle:t.giveBundle,getBundle:t.getBundle});
      appendLog(`${active.name} offered ${bundleText(t.giveBundle)} for ${bundleText(t.getBundle)} to ${partner.name}.`);
      extendTurnTimer();
      return true;
    });
  }
  function respondTradeOffer(accept){
    if(!tradeOffer)return;
    if(botTradeTimeoutRef.current){window.clearTimeout(botTradeTimeoutRef.current);botTradeTimeoutRef.current=null;}
    const from=playersStateRef.current.find(p=>p.id===tradeOffer.from),to=playersStateRef.current.find(p=>p.id===tradeOffer.to);
    if(!from||!to){setTradeOffer(null);const resume=botTradeResumeRef.current;botTradeResumeRef.current=null;resume?.resume?.(playersStateRef.current,false);return;}
    const giveBundle=normalizeBundle(tradeOffer.giveBundle||{[tradeOffer.give]:tradeOffer.giveAmount});
    const getBundle=normalizeBundle(tradeOffer.getBundle||{[tradeOffer.get]:tradeOffer.getAmount});
    let next=playersStateRef.current;
    let accepted=false;
    if(accept&&bundleCanPay(from.hand,giveBundle)&&bundleCanPay(to.hand,getBundle)&&bundleTotal(giveBundle)>0&&bundleTotal(getBundle)>0&&!bundlesShareResource(giveBundle,getBundle)){
      next=playersStateRef.current.map(p=>p.id===from.id?{...p,hand:add(pay(p.hand,giveBundle),getBundle)}:p.id===to.id?{...p,hand:add(pay(p.hand,getBundle),giveBundle)}:p);
      accepted=true;
      setPlayers(next);appendLog(`${to.name} accepted ${from.name}'s trade offer: ${bundleText(giveBundle)} for ${bundleText(getBundle)}.`);
    }else if(accept){appendLog("Trade expired or was invalid because the required cards are no longer available.");}
    else appendLog(`${to.name} declined ${from.name}'s trade offer.`);
    const resume=botTradeResumeRef.current;
    botTradeResumeRef.current=null;
    setTradeOffer(null);
    if(tradeOffer.botInitiated){
      // Bot trade offers never use the normal action confirmation flow. The trade
      // result is fed directly back into the paused bot search state.
      if(resume?.resume)window.setTimeout(()=>resume.resume(next,accepted),0);
    }else{
      extendTurnTimer();
    }
  }
  function botAct(p){
    if(!p||winner||drawn||screen!=="playing"||p.id!==turn)return;
    const runToken=gameRunRef.current;
    const turnToken=`${gameStarted}:${turn}:${p.id}`;
    if(botTurnRef.current===turnToken)return;
    botTurnRef.current=turnToken;
    const botTurnStarted=typeof performance!=="undefined"&&performance.now?performance.now():Date.now();
    let botDeadline=botTurnStarted+BOT_MAX_TURN_MS;
    let botFinished=false;
    rememberState("bot-turn-start",players);
    setBotTurnStatus("rolling");
    const pair=rollOfficialDice();const a=pair[0],b=pair[1],sum=a+b;
    let localPlayers=clone(players),localBank={...bank},localDeck=[...deck],localBoard=clone(board);
    let strategicPlan=strategicPlansRef.current[p.id]||null;
    ACTIVE_BOT_CACHE=createBotPlanningCache();
    const produced=resolveDiceRoll(localPlayers,localBoard,geo,sum,localBank);
    localPlayers=produced.players;localBank=produced.bank;
    globalGeoForPlanner=geo;
    const visiblePlanningPlayers=memoryAwarePlayers(p,localPlayers);
    const visiblePlanningBot=visiblePlanningPlayers.find(x=>x.id===p.id)||localPlayers.find(x=>x.id===p.id);
    strategicPlan=buildStrategicPlan(visiblePlanningBot,visiblePlanningPlayers,localBoard,geo,ports,localBank,targetVP,strategicPlan);
    strategicPlansRef.current[p.id]=strategicPlan;
    setDice([a,b]);setRoll(sum);setLastBotRoll({botId:p.id,botName:p.name,dice:[a,b],sum,turn:turnNumber,time:Date.now()});setHasRolled(true);
    appendLog(`${p.name} automatically rolled ${a} + ${b} = ${sum}.`);
    if(runToken!==gameRunRef.current||screen!=="playing"||winner||drawn)return;
    setBotTurnStatus("acting");
    const received=produced.grants[p.id]||empty();
    if(sum!==7){
      const receivedText=RES.filter(r=>received[r]>0).map(r=>`${received[r]} ${LABEL[r]}`).join(", ");
      appendLog(receivedText?`${p.name} received ${receivedText} from the roll.`:`${p.name} received no resources from the roll.`);
    }
    let botSevenWaitingForHuman=false;
    const resolveBotSevenAndContinue=()=>{
      const robber=chooseRobberAction(p,localPlayers,localBoard,geo,ports,localBank,targetVP,specialMemory(p));
      const robberTile=robber?.tid??localBoard.findIndex(t=>t.robber);
      const victim=robber?.opp;
      if(victim&&robberTile>=0){
        const realVictim=localPlayers.find(x=>x.id===victim.id);
        const stolen=chooseRobberResourceForBot(p,realVictim,localPlayers,localBoard,localBank);
        if(stolen){
          localPlayers=localPlayers.map(pl=>pl.id===victim.id?{...pl,hand:{...pl.hand,[stolen]:(pl.hand[stolen]||0)-1}}:pl.id===p.id?{...pl,hand:{...pl.hand,[stolen]:(pl.hand[stolen]||0)+1}}:pl);
          appendLog(`${p.name} moved the robber onto ${LABEL[localBoard[robberTile].resource]||"a target"} to block the opponents' highest production, and stole 1 ${LABEL[stolen]} card from ${victim.name}.`);
        }
        localBoard=localBoard.map((t,i)=>({...t,robber:i===robberTile}));
      }else{
        localBoard=localBoard.map((t,i)=>({...t,robber:i===robberTile}));
        appendLog(`${p.name} moved the robber using denial scoring.`);
      }
      appendLog(`${p.name} completed the 7/robber phase using the unified denial scorer; continuing the action phase.`);
      setAnalysisTurnBaseline(localPlayers,localBoard,ports,localBank,localDeck,heldAwards,"post-7 robber resolution");
      if(botSevenWaitingForHuman){
        botSevenWaitingForHuman=false;
        setBoard(localBoard);setPlayers(localPlayers);setBank(localBank);setDeck(localDeck);setRoll(0);setDice([a,b]);setHasRolled(true);
      }
    };
    if(sum===7){
      const discarded=empty();
      const limit=discardLimitFor(localPlayers.length,isPVBot);
      const humanQueue=[];
      localPlayers=localPlayers.map(pl=>{
        if(total(pl.hand)<=limit)return pl;
        if(!pl.bot){humanQueue.push(pl.id);return pl;}
        const result=chooseBotDiscards(pl,localPlayers,localBoard,geo,localBank,targetVP);
        RES.forEach(r=>discarded[r]+=result.discarded[r]);
        appendLog(`${pl.name} discarded ${total(result.discarded)} cards; protected direct build requirements.`);
        return {...pl,hand:result.hand};
      });
      RES.forEach(r=>localBank[r]=(localBank[r]||0)+discarded[r]);
      if(humanQueue.length){
        // Human players must make their own mandatory 7-discard even when the
        // active player is a bot. The bot turn is paused, not auto-resolved.
        botSevenWaitingForHuman=true;
        if(botHardStopRef.current){window.clearTimeout(botHardStopRef.current);botHardStopRef.current=null;}
        setPlayers(localPlayers);setBank(localBank);setBoard(localBoard);setDeck(localDeck);
        const firstPid=humanQueue[0];
        const firstPlayer=localPlayers.find(x=>x.id===firstPid);
        botSevenResumeRef.current={
          queue:humanQueue,
          nextIndex:0,
          resume:(resolvedPlayers,chosen)=>{
            localPlayers=clone(resolvedPlayers||playersStateRef.current);
            if(chosen)localBank=add(localBank,chosen);
            const state=botSevenResumeRef.current;
            if(state) state.nextIndex=(state.nextIndex||0)+1;
            if(state&&state.nextIndex<humanQueue.length){
              const pid=humanQueue[state.nextIndex];
              const pl=localPlayers.find(x=>x.id===pid);
              setDiscardState({queue:humanQueue,index:state.nextIndex,playerId:pid,remaining:Math.floor(total(pl?.hand||empty())/2)});
              setDiscardSelection(empty());
              return;
            }
            botSevenResumeRef.current=null;
            botDeadline=(typeof performance!=="undefined"&&performance.now?performance.now():Date.now())+BOT_MAX_TURN_MS;
            setDiscardState(null);setDiscardSelection(empty());
            resolveBotSevenAndContinue();
            window.setTimeout(iterateBot,0);
          }
        };
        setDiscardState({queue:humanQueue,index:0,playerId:firstPid,remaining:Math.floor(total(firstPlayer?.hand||empty())/2)});
        setDiscardSelection(empty());
        appendLog(`7 rolled — ${humanQueue.length} human player${humanQueue.length===1?"":"s"} must complete the mandatory discard before ${p.name} moves the robber.`);
        return;
      }
      resolveBotSevenAndContinue();
    }else{
      setAnalysisTurnBaseline(localPlayers,localBoard,ports,localBank,localDeck,heldAwards,"post-roll resource resolution");
    }
    let devBoughtThisTurn=false,devCardsBoughtThisTurn={},devPlayedThisTurn=false,botRoadsThisTurn=0;
    const failedActionKeys=new Set();
    const botMemorySnapshots=specialMemory(p);
    const botMemoryPressureById=Object.fromEntries(localPlayers.filter(x=>x.id!==p.id).map(x=>[x.id,memoryResourcePressure(botMemorySnapshots,x.id)]));
    const activeLocal=()=>localPlayers.find(x=>x.id===p.id);
    const executeAction=action=>{
      const me=activeLocal();if(!me)return false;
      if(action.type==="settlement"){
        if(piecesRemaining(me).settlements<=0||!canPay(me.hand,COSTS.settlement)||!legalSettlement(action.spot,localPlayers,geo)||!settlementConnected(action.spot,me,geo))return false;
        localBank=add(localBank,COSTS.settlement);
        localPlayers=localPlayers.map(x=>x.id===me.id?{...x,hand:pay(x.hand,COSTS.settlement),settlements:[...x.settlements,action.spot],vp:x.vp+1}:x);
        const afterSettlement=localPlayers.find(x=>x.id===me.id);
        strategicPlan=buildStrategicPlan(afterSettlement,memoryAwarePlayers(me,localPlayers),localBoard,geo,ports,localBank,targetVP,strategicPlan);
        strategicPlansRef.current[me.id]=strategicPlan;
        appendLog(`${me.name} built a settlement at intersection ${action.spot}. ${decisionReason(action,me,localPlayers,localBoard,geo,ports,localBank,targetVP)}`);
        return true;
      }
      if(action.type==="city"){
        if(piecesRemaining(me).cities<=0||!canPay(me.hand,COSTS.city)||!me.settlements.includes(action.spot))return false;
        localBank=add(localBank,COSTS.city);
        localPlayers=localPlayers.map(x=>x.id===me.id?{...x,hand:pay(x.hand,COSTS.city),settlements:x.settlements.filter(z=>z!==action.spot),cities:[...x.cities,action.spot],vp:x.vp+1}:x);
        const afterCity=localPlayers.find(x=>x.id===me.id);
        strategicPlan=buildStrategicPlan(afterCity,memoryAwarePlayers(me,localPlayers),localBoard,geo,ports,localBank,targetVP,strategicPlan);
        strategicPlansRef.current[me.id]=strategicPlan;
        appendLog(`${me.name} upgraded to a city at intersection ${action.spot}. ${decisionReason(action,me,localPlayers,localBoard,geo,ports,localBank,targetVP)}`);
        return true;
      }
      if(action.type==="road"){
        if(piecesRemaining(me).roads<=0||!canPay(me.hand,COSTS.road)||!legalRoad(action.spot,me,localPlayers,geo))return false;
        localBank=add(localBank,COSTS.road);
        localPlayers=localPlayers.map(x=>x.id===me.id?{...x,hand:pay(x.hand,COSTS.road),roads:[...x.roads,action.spot]}:x);
        const afterRoad=localPlayers.find(x=>x.id===me.id);
        strategicPlan=buildStrategicPlan(afterRoad,memoryAwarePlayers(me,localPlayers),localBoard,geo,ports,localBank,targetVP,strategicPlan);
        strategicPlansRef.current[me.id]=strategicPlan;
        if(strategicPlan?.type==='settlement'&&strategicPlan.path?.length){appendLog(`${me.name} built a road toward strategic settlement ${strategicPlan.target} and retained the multi-turn objective.`);}
        appendLog(`${me.name} built a road on edge ${action.spot}. ${decisionReason(action,me,localPlayers,localBoard,geo,ports,localBank,targetVP)}`);
        return true;
      }
      if(action.type==="trade"){
        if(action.give===action.get||action.rate<=0||(me.hand[action.give]||0)<action.rate||(localBank[action.get]||0)<1)return false;
        localBank=add(localBank,{[action.give]:action.rate});localBank[action.get]--;localPlayers=localPlayers.map(x=>x.id===me.id?{...x,hand:add(pay(x.hand,{[action.give]:action.rate}),{[action.get]:1})}:x);appendLog(`${me.name} traded ${action.rate} ${LABEL[action.give]} for 1 ${LABEL[action.get]}. ${decisionReason(action,me,localPlayers,localBoard,geo,ports,localBank,targetVP)}`);return true;
      }
      if(action.type==="playerTrade"){
        if(localPlayers.length<3)return false;
        const partner=localPlayers.find(x=>x.id===action.partner);if(!partner)return false;
        const giveBundle=normalizeBundle(action.giveBundle||{[action.give]:action.giveAmount});
        const getBundle=normalizeBundle(action.getBundle||{[action.get]:action.getAmount});
        if(bundleTotal(giveBundle)<1||bundleTotal(getBundle)<1||bundlesShareResource(giveBundle,getBundle)||!bundleCanPay(me.hand,giveBundle))return false;
        if(!partner.bot){
          // Human opponents cannot expose their hidden hand to the bot. Offer the
          // trade through the normal trade-offer UI, then resume the same bot search
          // with the accepted/declined result. The waiting offer commits the bot's
          // already-computed local state so the human sees the correct board first.
          setBoard(localBoard);setPlayers(localPlayers);setBank(localBank);setDeck(localDeck);setTradeOffer({from:me.id,to:partner.id,giveBundle,getBundle,botInitiated:true});
          appendLog(`${me.name} offered ${bundleText(giveBundle)} for ${bundleText(getBundle)} to ${partner.name}.`);
          botTradeResumeRef.current={token:runToken,resume:(resolvedPlayers)=>{localPlayers=clone(resolvedPlayers||playersStateRef.current);if(runToken===gameRunRef.current&&screen==="playing")window.setTimeout(iterateBot,0);}};
          botTradeTimeoutRef.current=window.setTimeout(()=>{
            if(!botTradeResumeRef.current)return;
            const resume=botTradeResumeRef.current;botTradeResumeRef.current=null;botTradeTimeoutRef.current=null;setTradeOffer(null);appendLog(`${me.name}'s trade offer to ${partner.name} expired.`);resume.resume(playersStateRef.current,false);
          },4500);
          return "awaiting-trade";
        }
        const partnerPublic=partner.publicCardCount??total(partner.hand);
        if(partnerPublic<bundleTotal(getBundle)||!bundleCanPay(partner.hand,getBundle))return false;
        const selfAfter={...me,hand:add(pay(me.hand,giveBundle),getBundle)};
        const partnerAfter={...partner,hand:add(pay(partner.hand,getBundle),giveBundle)};
        const selfNeed=NeedProfile(me,localPlayers,localBoard,geo,localBank,botModeConfig(localPlayers,targetVP)).need;
        const partnerNeed=NeedProfile(partner,localPlayers,localBoard,geo,localBank,botModeConfig(localPlayers,targetVP)).need;
        const selfGain=RES.reduce((sum,r)=>sum+(getBundle[r]||0)*(selfNeed[r]||1)-(giveBundle[r]||0)*(selfNeed[r]||1),0);
        const partnerGetValue=RES.reduce((sum,r)=>sum+(getBundle[r]||0)*(partnerNeed[r]||1),0);
        const partnerGiveValue=RES.reduce((sum,r)=>sum+(giveBundle[r]||0)*(partnerNeed[r]||1),0);
        if(selfGain<=0||partnerGetValue<=partnerGiveValue*.78)return false;
        localPlayers=localPlayers.map(x=>x.id===me.id?selfAfter:x.id===partner.id?partnerAfter:x);
        appendLog(`${me.name} traded ${bundleText(giveBundle)} for ${bundleText(getBundle)} with ${partner.name}; both sides passed the strategic trade-value gate.`);return true;
      }
      if(action.type==="buyDev"){
        if(!localDeck.length||!canPay(me.hand,COSTS.development))return false;
        const card=localDeck.pop();localBank=add(localBank,COSTS.development);devBoughtThisTurn=true;devCardsBoughtThisTurn[card]=(devCardsBoughtThisTurn[card]||0)+1;const aw=awards(localPlayers,geo,heldAwards),visible=me.vp+(aw.roadOwner===me.id?2:0)+(aw.armyOwner===me.id?2:0),hiddenAfter=me.development.VictoryPoint+(card==="Victory Point"?1:0);
        if(card==="Victory Point"&&visible+hiddenAfter>=targetVP){localPlayers=localPlayers.map(x=>x.id===me.id?{...x,hand:pay(x.hand,COSTS.development),vp:x.vp+hiddenAfter,development:{...x.development,VictoryPoint:0}}:x);appendLog(`${me.name} bought a Victory Point card and revealed it to win.`);return true;}
        localPlayers=localPlayers.map(x=>x.id===me.id?{...x,hand:pay(x.hand,COSTS.development),development:{...x.development,[card]:x.development[card]+1}}:x);devBoughtThisTurn=true;appendLog(`${me.name} bought a ${card} development card. ${decisionReason(action,me,localPlayers,localBoard,geo,ports,localBank,targetVP)}`);return true;
      }
      if(action.type==="play"){
        const card=action.card;
        const isVP=card==="Victory Point";
        if(!me.development[card])return false;
        if(devPlayedThisTurn&&!isVP)return false;
        if(!isVP&&((me.development[card]||0)-(devCardsBoughtThisTurn[card]||0)<=0))return false;
        if(card==="Victory Point"){
          const aw=awards(localPlayers,geo,heldAwards),visible=me.vp+(aw.roadOwner===me.id?2:0)+(aw.armyOwner===me.id?2:0),hidden=me.development.VictoryPoint;if(visible+hidden<targetVP)return false;
          localPlayers=localPlayers.map(x=>x.id===me.id?{...x,vp:x.vp+hidden,development:{...x.development,VictoryPoint:0}}:x);appendLog(`${me.name} revealed ${hidden} Victory Point card${hidden===1?"":"s"} to win.`);return true;
        }
        if(card==="Knight"){
          const robber=chooseRobberAction(me,localPlayers,localBoard,geo,ports,localBank,targetVP,specialMemory(p));let next=localPlayers.map(x=>x.id===me.id?{...x,development:{...x.development,Knight:x.development.Knight-1,playedKnights:x.development.playedKnights+1}}:x);const victim=robber?.opp,tid=robber?.tid;if(victim&&tid>=0){const realVictim=localPlayers.find(x=>x.id===victim.id)||victim;const stolen=chooseRobberResourceForBot(me,realVictim,localPlayers,localBoard,localBank);if(stolen){next=next.map(x=>x.id===victim.id?{...x,hand:{...x.hand,[stolen]:(x.hand[stolen]||0)-1}}:x.id===me.id?{...x,hand:{...x.hand,[stolen]:(x.hand[stolen]||0)+1}}:x);appendLog(`${me.name} played Knight, targeting ${victim.name}, and stole 1 ${LABEL[stolen]} card.`);}localBoard=localBoard.map((t,i)=>({...t,robber:i===tid}));}localPlayers=next;devPlayedThisTurn=true;return true;
        }
        if(card==="Year of Plenty"){
          const pair=bestYearOfPlentyPair(me,localPlayers,localBoard,geo,ports,localBank,localDeck,targetVP,botModeConfig(localPlayers,targetVP),{memorySnapshots:botMemorySnapshots,heldAwards});
          if(!pair||pair.resources.length!==2)return false;
          const take=empty();pair.resources.forEach(r=>take[r]++);
          if(RES.some(r=>(localBank[r]||0)<take[r]))return false;
          localBank=add(localBank,Object.fromEntries(RES.map(r=>[r,-take[r]])));
          localPlayers=localPlayers.map(x=>x.id===me.id?{...x,hand:add(x.hand,take),development:{...x.development,[card]:x.development[card]-1}}:x);
          devPlayedThisTurn=true;appendLog(`${me.name} played Year of Plenty for ${pair.resources.map(r=>LABEL[r]).join(" + ")}.`);return true;
        }
        if(card==="Monopoly"){
          const targetInfo=bestMonopolyTarget(me,localPlayers,localBoard,geo,ports,localBank,targetVP,localDeck,{memorySnapshots:botMemorySnapshots,heldAwards});
          if(!targetInfo||targetInfo.expectedGain<1.2)return false;
          const target=targetInfo.resource;let gain=0;
          localPlayers=localPlayers.map(x=>{if(x.id===me.id)return x;gain+=x.hand[target]||0;return{...x,hand:{...x.hand,[target]:0}}});
          localPlayers=localPlayers.map(x=>x.id===me.id?{...x,hand:add(x.hand,{[target]:gain}),development:{...x.development,[card]:x.development[card]-1}}:x);
          devPlayedThisTurn=true;appendLog(`${me.name} played Monopoly on ${LABEL[target]} and collected ${gain}.`);return true;
        }
        if(card==="Road Building"){
          const combo=bestRoadBuildingPair(me,localPlayers,localBoard,geo,ports,localBank,targetVP,botDeadline,strategicPlan);
          if(!combo?.roads?.length)return false;
          const virtual={...me,roads:[...me.roads]};const built=[];
          for(const eid of combo.roads){if(piecesRemaining(virtual).roads<=0||!legalRoad(eid,virtual,localPlayers,geo))continue;built.push(eid);virtual.roads.push(eid);}
          if(!built.length)return false;
          localPlayers=localPlayers.map(x=>x.id===me.id?{...x,roads:[...x.roads,...built],development:{...x.development,[card]:x.development[card]-1}}:x);
          const afterRB=localPlayers.find(x=>x.id===me.id);
          const rbPlan=buildStrategicPlan(afterRB,localPlayers,localBoard,geo,ports,localBank,targetVP,strategicPlan);
          if(rbPlan){strategicPlan=rbPlan;strategicPlansRef.current[me.id]=rbPlan;}
          devPlayedThisTurn=true;appendLog(`${me.name} played Road Building (${built.length} roads).`);return true;
        }
      }
      return false;
    };
    let botStep=0;
    let failedActions=0;
    const finalizeBotTurn=()=>{
      if(botFinished)return;
      resetBotPlanningCache();
      botFinished=true;
      if(botHardStopRef.current){window.clearTimeout(botHardStopRef.current);botHardStopRef.current=null;}
      if(botTradeTimeoutRef.current){window.clearTimeout(botTradeTimeoutRef.current);botTradeTimeoutRef.current=null;}
      botTradeResumeRef.current=null;
      setTradeOffer(null);
      setBoard(localBoard);setPlayers(localPlayers);setBank(localBank);setDeck(localDeck);setRoll(sum===7?0:sum);setDice([a,b]);setHasRolled(true);setBotTurnStatus("acting");
      rememberState("bot-turn-end",localPlayers,turnSequenceRef.current);
      const w=checkWin(localPlayers);
      if(w){setBotTurnStatus("finished");if(runToken===gameRunRef.current)finish(w,localPlayers,localBoard,ports,heldAwards,localBank,localDeck);return;}
      if(botHardStopRef.current){window.clearTimeout(botHardStopRef.current);botHardStopRef.current=null;}
      // Bots never initiate draw offers. A player may still offer a draw, and the bot responds separately.
      advanceBotTurn(localPlayers,p.name,"All useful actions are done; the bot ended its turn automatically.",localBoard,localBank,localDeck);
    };
    botHardStopRef.current=window.setTimeout(()=>{
      if(runToken!==gameRunRef.current||screen!=="playing"||winner||drawn||botFinished)return;
      appendLog(`${p.name} hit the 5-second safety cutoff; the best fully completed engine line was committed and the turn ended automatically.`);
      finalizeBotTurn();
    },BOT_HARD_STOP_MS);
    const iterateBot=()=>{
      const now=typeof performance!=="undefined"&&performance.now?performance.now():Date.now();
      if(now>=botDeadline){finalizeBotTurn();return;}
      if(runToken!==gameRunRef.current||screen!=="playing"||winner||drawn){botTurnRef.current=null;return;}
      const me=activeLocal();if(!me){finalizeBotTurn();return;}
      ACTIVE_BOT_CACHE=createBotPlanningCache();
      const planningPlayers=memoryAwarePlayers(me,localPlayers);
      const planningBot=planningPlayers.find(x=>x.id===me.id)||me;
      strategicPlan=buildStrategicPlan(planningBot,planningPlayers,localBoard,geo,ports,localBank,targetVP,strategicPlan);
      strategicPlansRef.current[me.id]=strategicPlan;
      let best=null;
      if(!best){
        const plan=nearPerfectBotPlan(me,planningPlayers,localBoard,geo,ports,localBank,localDeck,targetVP,heldAwards,{devBought:devBoughtThisTurn,devPlayed:devPlayedThisTurn,boughtCards:devCardsBoughtThisTurn,deadline:botDeadline,botRoadsThisTurn,memorySnapshots:botMemorySnapshots,heldAwards,botAutoplay:true,strategicPlan,failedActionKeys});
        best=plan&&plan.type!=="pass"?{...plan}:null;
      }
      if(best&&best.type==="settlement"&&best.spot!=null)best.score+=historicalBlockBonus(best.spot,me,localPlayers,localBoard,botMemoryPressureById);
      if(!best){finalizeBotTurn();return;}
      const rawBest=(best.engineTop3&&best.engineTop3[0])||best;
      const beforeMe=me;
      const beforeSignature=JSON.stringify({hand:beforeMe.hand,settlements:beforeMe.settlements,cities:beforeMe.cities,roads:beforeMe.roads,dev:beforeMe.development,bank:localBank,deck:localDeck.length});
      const executionResult=executeAction(best);
      if(executionResult==="awaiting-trade"){resetBotPlanningCache();return;}
      if(!executionResult){
        failedActions++;
        failedActionKeys.add(decisionKeyForEngine(best));
        if(strategicPlan?.type==='settlement'&&best.type==='settlement'&&best.spot===strategicPlan.target){
          strategicPlan=buildStrategicPlan(me,planningPlayers,localBoard,geo,ports,localBank,targetVP,null);
        }
        strategicPlansRef.current[p.id]=strategicPlan;
        if(failedActions>=10){appendLog(`${p.name} exhausted invalid-action retries after replanning; preserving the best completed line.`);finalizeBotTurn();return;}
        resetBotPlanningCache();window.setTimeout(iterateBot,0);return;
      }
      const engineTop3=(best.engineTop3||[]);
      const chosenEngine=engineTop3.find(x=>x.action===actionLabel(best));
      const engineBestScore=Number.isFinite(engineTop3[0]?.score)?Number(engineTop3[0].score):Number(best.score)||0;
      const engineChosenScore=Number.isFinite(chosenEngine?.score)?Number(chosenEngine.score):engineBestScore;
      const engineScale=Math.max(20,Math.abs(engineBestScore)+20);
      const engineLoss=Math.max(0,Math.min(1,(engineBestScore-engineChosenScore)/engineScale));
      const botDecision={turn:turnNumber,playerId:p.id,playerName:p.name,action:actionLabel(best),recommended:actionLabel(rawBest),actionKey:decisionKey(best),recommendedKey:decisionKey(rawBest),match:decisionKey(best)===decisionKey(rawBest),bot:true,engineTop3:(best.engineTop3||[]).map(x=>({action:actionLabel(x),score:x.score}))};
      decisionsRef.current=[...decisionsRef.current,botDecision];
      setDecisions(decisionsRef.current);
      if(best.type==="road")botRoadsThisTurn++;
      botStep++;
      const refreshedMe=activeLocal();
      const refreshedPlanningPlayers=memoryAwarePlayers(refreshedMe,localPlayers);
      strategicPlan=buildStrategicPlan(refreshedPlanningPlayers.find(x=>x.id===refreshedMe.id)||refreshedMe,refreshedPlanningPlayers,localBoard,geo,ports,localBank,targetVP,strategicPlan);
      strategicPlansRef.current[p.id]=strategicPlan;
      const afterMe=activeLocal();
      const afterSignature=JSON.stringify({hand:afterMe.hand,settlements:afterMe.settlements,cities:afterMe.cities,roads:afterMe.roads,dev:afterMe.development,bank:localBank,deck:localDeck.length});
      if(beforeSignature===afterSignature){finalizeBotTurn();return;}
      const w=checkWin(localPlayers);
      if(w){setBoard(localBoard);setPlayers(localPlayers);setBank(localBank);setDeck(localDeck);setRoll(sum===7?0:sum);setDice([a,b]);setHasRolled(true);setDevBought(devBoughtThisTurn);setDevCardsBought({...devCardsBoughtThisTurn});setDevPlayed(devPlayedThisTurn);if(runToken===gameRunRef.current)finish(w,localPlayers,localBoard,ports,heldAwards,localBank,localDeck);return;}
      window.setTimeout(iterateBot,0);
    };
    window.setTimeout(iterateBot,0);
  }
  function endTurn(force=false){
    if(!force)return runHumanAction(()=>endTurnInternal(false));
    return endTurnInternal(true);
  }
  function endTurnInternal(force=false){
    if(!active||active.bot||winner||drawn)return false;
    if(!force && (roll===null||roll===7||robberMode||discardState||devChoice))return;
    const w=checkWin(players);if(w){finish(w);return}
    const preserved=`${active.name} finished Turn ${turnNumber}${force?" by timer":""} at ${active.vp} VP with ${total(active.hand)} cards. Board pieces, resources, VP and awards are preserved.`;
    setLastTurnSummary(preserved);appendLog(`✓ ${preserved}`);
    const nextTurn=(turn+1)%players.length;
    finalizeAnalysisTurn({ps:players,bd:board,pr:ports,bk:bank,dk:deck,ha:heldAwards,summary:preserved});
    turnSequenceRef.current+=1;rememberState("turn-complete",players);
    setTurnNumber(n=>n+1);
    setTurn(nextTurn);
    turnDeadlineRef.current=null;timerTurnTokenRef.current=null;timerExpiredTokenRef.current=null;setTurnSecondsLeft(TURN_BASE_SECONDS);setRoll(null);setDice(null);setHasRolled(false);setDevBought(false);setDevCardsBought({});setDevPlayed(false);setDevChoice(null);setRobberMode(false);setRobberVictim(null);setSelectedV(null);setSelectedE(null);
    beginAnalysisTurn(nextTurn,turnNumber+1,players,board,ports,bank,deck,heldAwards);
    return true;
  }
  const confirmDiscardTimeout=(discarded)=>{
    if(!discardState)return;
    const pid=discardState.playerId;
    const next=players.map(p=>p.id===pid?{...p,hand:pay(p.hand,discarded)}:p);
    setPlayers(next);setBank(b=>add(b,discarded));appendLog(`${next.find(p=>p.id===pid)?.name||"Player"} timed out; the engine selected the discard automatically.`);
    const nextIndex=discardState.index+1;
    if(nextIndex<discardState.queue.length){const nextPid=discardState.queue[nextIndex],required=Math.floor(total(next.find(p=>p.id===nextPid).hand)/2);setDiscardState({queue:discardState.queue,index:nextIndex,playerId:nextPid,remaining:required});setDiscardSelection(empty());}
    else{setDiscardState(null);setDiscardSelection(empty());setRobberMode(true);}
    turnDeadlineRef.current=Date.now()+150;
    timerExpiredTokenRef.current=null;
  };
  const autoResolveRobber=(tid,victim)=>{
    if(!active||tid==null)return;
    setBoard(bs=>bs.map((t,i)=>({...t,robber:i===tid})));
    if(victim){stealFromVictim(victim,false);}else{setRobberMode(false);setRobberVictim(null);setRoll(roll===7?0:roll);if(roll!==7)setDice(null);}
    turnDeadlineRef.current=Date.now()+150;
    timerExpiredTokenRef.current=null;
  };
  useEffect(()=>{if(screen!=="playing"||winner||drawn||reviewGame||tab!=="game"||!players.length)return;const w=checkWin(players);if(w)finish(w);},[players,screen,winner,drawn,reviewGame,tab]);
  timeoutHandlerRef.current=()=>{
    if(!active||active.bot||winner||drawn)return;
    const token=timerTurnTokenRef.current;
    if(!token || timerExpiredTokenRef.current===token) return;
    timerExpiredTokenRef.current=token;
    if(discardState){
      const dp=players.find(p=>p.id===discardState.playerId);
      if(dp){const result=chooseBotDiscards(dp,players,board,geo,bank,targetVP);confirmDiscardTimeout(result.discarded);return;}
    }
    if(robberMode){
      const choice=chooseRobberAction(active,players,board,geo,ports,bank,targetVP,specialMemory(active));
      if(choice?.tid!=null){
        const victims=players.filter(p=>p.id!==active.id&&geo.vertexTiles[choice.tid].some(v=>p.settlements.includes(v)||p.cities.includes(v))&&total(p.hand)>0&&!friendlyRobberProtected(p,players,geo,heldAwards));
        const victim=victims.find(v=>v.id===choice.opp?.id)||victims[0];
        autoResolveRobber(choice.tid,victim);
        return;
      }
      setRobberMode(false);
    }
    setTradeOffer(null);setDevChoice(null);endTurn(true);
  };
  useEffect(()=>{
    if(screen!=="playing"||tab!=="game"||winner||drawn||reviewGame||!active||active.bot){
      if(!active?.bot)setBotTurnStatus("idle");
      return;
    }
    const token=`${gameStarted}:${turn}:${active.id}`;
    if(timerTurnTokenRef.current!==token)resetTurnTimer();
    const tick=()=>{
      if(!turnDeadlineRef.current)return;
      const remaining=Math.max(0,Math.ceil((turnDeadlineRef.current-Date.now())/1000));
      setTurnSecondsLeft(remaining);
      if(remaining<=0 && timerExpiredTokenRef.current!==token){
        turnDeadlineRef.current=null;
        timeoutHandlerRef.current();
      }
    };
    tick();const id=setInterval(tick,250);return()=>clearInterval(id);
  },[turn,active?.id,screen,tab,winner,drawn,reviewGame,gameStarted]);
  useEffect(()=>{
    if(screen!=="playing"||tab!=="game"||winner||drawn||reviewGame||!active?.bot)return;
    botAct(active);
  },[turn,active?.id,screen,winner,drawn,tab,reviewGame]);
  useEffect(()=>{
    if(!drawOffer||!isPVBot||winner||drawn)return;
    const target=players.find(p=>p.id===drawOffer.to);
    if(!target?.bot)return;
    const likelihood=engineWinLikelihood(players,board,geo,ports,bank,targetVP);
    const botProb=likelihood.find(x=>x.id===target.id)?.prob??.5;
    const accept=botProb<=0.5;    window.setTimeout(()=>{if(!drawOffer)return;respondDrawOffer(accept);},0);
  },[drawOffer,isPVBot,winner,drawn,players,board,bank,ports,targetVP]);
  const playerAccuracy=decisions.length?Math.round(decisions.filter(d=>d.match).length/decisions.length*100):null;
  const boardAnalysis=useMemo(()=>{if(!analysisMode||!board||!active)return[];const cache=makeScoreCache(players,board,geo,ports,bank,targetVP);return geo.vertices.map((_,i)=>({v:i,score:placementScore(i,active,players,board,geo,ports,bank,targetVP,heldAwards,cache),legal:legalSettlement(i,players,geo)})).sort((a,b)=>b.score-a.score).slice(0,12)},[analysisMode,geo,active,players,board,ports,bank,targetVP,heldAwards]);
  const reviewPlayers=reviewGame?.players||players,reviewBoard=reviewGame?.board||board,reviewPorts=reviewGame?.ports||ports,reviewAwards=reviewGame?.awards||award,reviewWinner=reviewGame?(reviewGame.winnerId!=null?(reviewGame.players.find(p=>p.id===reviewGame.winnerId)||reviewGame.players[0]):null):winner,reviewAccuracy=reviewGame?.accuracy??playerAccuracy;
  const clearHistory=()=>{try{[HISTORY_KEY,...LEGACY_HISTORY_KEYS].forEach(k=>localStorage.removeItem(k))}catch{}setHistory([])};
  const openHistoryAnalyze=(g)=>{
    if(!g?.result||!g?.analysisFrames?.length)return;
    setAnalysisReplay(g);setAnalysisIndex(0);
    if(g?.board&&g?.players){setBoard(g.board);setPlayers(g.players);setPorts(g.ports||[]);setTurn(g.winnerId!=null?(g.players.findIndex(p=>p.id===g.winnerId)>=0?g.players.findIndex(p=>p.id===g.winnerId):0):0);setWinner(g.result==="draw"?{id:null,name:"Draw",vp:0}:null);setDrawn(g.result==="draw");setLogEntries(g.logs||[]);}
    setTab("historyAnalyze");setScreen("playing");
  };
  const startNew=()=>{if(botHardStopRef.current){window.clearTimeout(botHardStopRef.current);botHardStopRef.current=null;}cancelActionConfirm();if(duelNoticeTimerRef.current)window.clearTimeout(duelNoticeTimerRef.current);duelNoticeTimerRef.current=null;gameRunRef.current+=1;strategicPlansRef.current={};setMode(10);setScreen("setup");setTab("game");setReviewGame(null);setWinner(null);setDrawn(false);setDrawOffer(null);turnDeadlineRef.current=null;timerTurnTokenRef.current=null;timerExpiredTokenRef.current=null;setDuelNotice(null);setTurnSecondsLeft(TURN_BASE_SECONDS);setTradeOffer(null);setChatMessages([]);setChatUnread(0);setSidePanel("activity");setRulesOpen(false);if(botTradeTimeoutRef.current)window.clearTimeout(botTradeTimeoutRef.current);botTradeTimeoutRef.current=null;botTradeResumeRef.current=null;setTradeOffer(null);};
  const goHome=()=>{if(botHardStopRef.current){window.clearTimeout(botHardStopRef.current);botHardStopRef.current=null;}cancelActionConfirm();if(duelNoticeTimerRef.current)window.clearTimeout(duelNoticeTimerRef.current);duelNoticeTimerRef.current=null;gameRunRef.current+=1;strategicPlansRef.current={};setScreen("home");setTab("game");setWinner(null);setDrawn(false);setDrawOffer(null);turnDeadlineRef.current=null;timerTurnTokenRef.current=null;timerExpiredTokenRef.current=null;setDuelNotice(null);setChatMessages([]);setChatUnread(0);setSidePanel("activity");setRulesOpen(false);if(botTradeTimeoutRef.current)window.clearTimeout(botTradeTimeoutRef.current);botTradeTimeoutRef.current=null;botTradeResumeRef.current=null;setTradeOffer(null);};

  const closeOverlay=()=>{cancelActionConfirm();setTab("game");setQuickPanel(null);setDevOpen(false);setTradeOffer(null);setRobberVictim(null);setAnalysisReplay(null);setAnalysisIndex(0);};
  const overlayTitle=tab==="analysis"?"BOARD ANALYSIS":tab==="history"?"MATCH HISTORY":"POST-GAME REVIEW";
  const analysis_block=tab==="analysis"?<div className="refOverlay"><div className="refOverlayCard refAnalysisOverlay"><button className="refClose" onClick={closeOverlay}>×</button><div className="refOverlayHead"><div><span className="eyebrow">SETTINGS + TELEMETRY</span><h2>SETTINGS</h2><p>Choose the HUD accent theme. Live board-analysis data remains available below.</p></div><div className="refOverlayMetric"><span>DECISION ACCURACY</span><b>{playerAccuracy==null?"—":`${playerAccuracy}%`}</b></div></div><section className="themePickerCard"><div><span className="eyebrow">UI THEME</span><h3>Accent & Glow</h3><p>Changes the neon accents, active tabs and panel borders across the HUD.</p></div><div className="themeSwatches">{Object.keys(UI_THEMES).map(name=><button key={name} className={`themeSwatch ${theme===name?"selected":""}`} style={{"--swatch":UI_THEMES[name].cyan}} onClick={()=>setTheme(name)}><span></span><b>{name}</b></button>)}</div></section><section className="musicSettingsCard"><div><span className="eyebrow">AMBIENT AUDIO</span><h3>Violin background music</h3><p>Looping instrumental ambience for the table. Your choice is saved on this device.</p></div><button className={`musicToggle ${musicEnabled?"on":"off"}`} onClick={()=>setMusicEnabled(v=>!v)}><span>{musicEnabled?"ON":"OFF"}</span><b>{musicEnabled?"♫ PLAYING":"♫ MUTED"}</b></button></section><div className="refAnalysisGrid"><section><h3>Top settlement spots</h3>{boardAnalysis.slice(0,8).map((x,i)=><div className="refRankRow" key={x.v}><span>#{i+1}</span><div><b>Intersection {x.v}</b><small>{x.legal?"Legal placement":"Occupied / blocked"}</small></div><strong>{Number.isFinite(x.score)?x.score.toFixed(1):"—"}</strong></div>)}</section><section><h3>Production & awards</h3><div className="refMetricTiles">{RES.map(r=><div key={r}><span>{ICON[r]}</span><b>{adjacentProduction(geo,board,active)[r].toFixed(1)}</b><small>{LABEL[r]}</small></div>)}</div><div className="refAwardLine"><span>🛣 Longest Road</span><b>{award.roadOwner!=null?players.find(p=>p.id===award.roadOwner)?.name||"Open":"Open"}</b></div><div className="refAwardLine"><span>⚔ Largest Army</span><b>{award.armyOwner!=null?players.find(p=>p.id===award.armyOwner)?.name||"Open":"Open"}</b></div></section></div></div></div>:null;
    const history_block=tab==="history"?<div className="refOverlay"><div className="refOverlayCard"><button className="refClose" onClick={closeOverlay}>×</button><div className="refOverlayHead"><div><span className="eyebrow">LOCAL ARCHIVE</span><h2>GAME HISTORY</h2><p>Completed matches are stored locally in this browser. New games also include turn-by-turn engine analysis frames.</p></div><button className="refDangerButton" onClick={clearHistory}>CLEAR HISTORY</button></div>{history.length===0?<div className="refEmpty">No completed matches yet.<button className="refPrimaryButton" onClick={()=>{closeOverlay();startNew()}}>START NEW GAME</button></div>:<div className="refHistoryGrid">{history.slice(0,12).map(g=><article key={g.id} className="refHistoryItem"><div><span>{fmtDate(g.date)}</span><h3>{g.result==="draw"?"DRAW":`${g.winner} won`}</h3></div><b>{g.targetVP} VP</b><small>{g.accuracy==null?"Accuracy unavailable":`${g.accuracy}% decision accuracy`}</small><div className="historyActionRow"><button onClick={()=>{setReviewGame(g);setBoard(g.board);setPlayers(g.players);setPorts(g.ports||[]);setTurn(g.winnerId||0);setWinner(g.result==="draw"?{id:null,name:"Draw",vp:0}:null);setDrawn(g.result==="draw");setLogEntries(g.logs||[]);setTab("postgame")}}>REVIEW →</button><button className="analyzeHistoryBtn" onClick={()=>openHistoryAnalyze(g)} disabled={!g.result||!g.analysisFrames?.length}>ANALYZE {g.analysisFrames?.length?`(${g.analysisFrames.length} TURNS)`:"(COMPLETE GAMES ONLY)"}</button></div></article>)}</div>}</div></div>:null;
  const replayFrames=analysisReplay?.analysisFrames||[];
  const replayFrame=replayFrames[Math.min(analysisIndex,Math.max(0,replayFrames.length-1))];
  const replayHumanFrames=replayFrames.filter(f=>!f.isBot);
  const replayBotFrames=replayFrames.filter(f=>f.isBot);
  const replayBreakdown=ANALYSIS_CLASSIFICATIONS.map(c=>({ ...c,count:replayFrames.filter(f=>f.classification?.key===c.key).length }));
  const replayHumanAccuracy=analysisAccuracy(replayHumanFrames);
  const replayBotAccuracy=analysisAccuracy(replayBotFrames);
  const replayOverallAccuracy=analysisAccuracy(replayFrames);
  const history_analyze_block=tab==="historyAnalyze"&&analysisReplay?.result&&analysisReplay?.analysisFrames?.length?<div className="refOverlay historyAnalyzeOverlay"><div className="refOverlayCard refHistoryAnalyzeCard"><button className="refClose" onClick={closeOverlay}>×</button><div className="refOverlayHead"><div><span className="eyebrow">TURN-BY-TURN REPLAY</span><h2>GAME ANALYZER</h2><p>Completed game review only. Step through every human and bot turn and classify each one from the engine's position change. Use <b>[</b> or <b>/</b> to step backward, <b>\</b> or <b>]</b> to step forward, or the arrow keys.</p></div><div className="refOverlayMetric"><span>TURN</span><b>{replayFrame?`${replayFrame.turn} / ${replayFrames.length}`:"—"}</b></div></div>{!replayFrame?<div className="refEmpty"><h3>No turn-by-turn analyzer data</h3><p>This older match was saved before replay frames were stored. Play a new match to use the analyzer.</p></div>:<><div className="analysisReplaySummary"><div><span>ANALYSIS SUMMARY</span><b>{replayFrames.length} analyzed turns</b><small>Human {replayHumanAccuracy==null?"—":`${replayHumanAccuracy}%`} · Bot {replayBotAccuracy==null?"—":`${replayBotAccuracy}%`} · Overall {replayOverallAccuracy==null?"—":`${replayOverallAccuracy}%`}</small></div>{replayBreakdown.map(c=><div className={`analysisSummaryChip class-${c.key}`} key={c.key}><span>{c.icon}</span><b>{c.count}</b><small>{c.label}</small></div>)}</div><div className="analysisReplayToolbar"><button className="refGhostButton" onClick={()=>setAnalysisIndex(i=>Math.max(0,i-1))} disabled={analysisIndex<=0}>← PREVIOUS TURN</button><span>Turn {replayFrame.turn} · {replayFrame.isBot?"🤖 BOT":"👤 HUMAN"} · {replayFrame.playerName}{replayFrame.classification?` · ${replayFrame.classification.label}`:""}</span><button className="refGhostButton" onClick={()=>setAnalysisIndex(i=>Math.min(replayFrames.length-1,i+1))} disabled={analysisIndex>=replayFrames.length-1}>NEXT TURN →</button></div><div className="analysisReplayGrid"><section className="analysisReplayBoard"><Board geo={geo} board={replayFrame.after.board} players={replayFrame.after.players} ports={replayFrame.after.ports} selectedV={null} selectedE={null} analysisMode={false}/></section><aside className="analysisReplaySide"><section className="replayMoveCard">{replayFrame.classification?<div className={`classificationBadge classification-${replayFrame.classification.key}`}>{replayFrame.classification.icon} {replayFrame.classification.label}</div>:null}<h3>{replayFrame.action}</h3><p>{replayFrame.summary||"Turn completed."}</p>{replayFrame.classification&&<div className="probDelta"><span>Win probability change</span><b>{replayFrame.delta>=0?"+":""}{(replayFrame.delta*100).toFixed(1)} pts</b></div>}</section><section className="replayOddsCard"><div className="refPanelTitle">POSITION ODDS AFTER TURN</div>{replayFrame.afterOdds.map(o=><div className="engineOddsRow" key={o.id}><span>{o.name}</span><b>{(o.prob*100).toFixed(1)}%</b></div>)}</section><section className="replayMoveList"><div className="refPanelTitle">ACTIONS THIS TURN</div>{replayFrame.decisions?.length?replayFrame.decisions.map((d,i)=><div className="replayActionLine" key={i}><span>{d.match?"✓":"•"}</span><div><b>{d.action}</b><small>{replayFrame.isBot?"Engine line: ":"Engine recommendation: "}{d.recommended}</small></div></div>):<div className="engineEmpty">No directly recorded action on this turn; the engine still classifies the completed position change.</div>}</section></aside></div></>}</div></div>:null;
  const post_block=tab==="postgame"?<div className="refOverlay"><div className="refOverlayCard"><button className="refClose" onClick={closeOverlay}>×</button><div className="refOverlayHead"><div><span className="eyebrow">MATCH REPORT</span><h2>{reviewGame?.result==="draw"?"DRAW":reviewWinner?.name||winner?.name||"MATCH REVIEW"}</h2><p>{reviewGame?`Frozen snapshot from ${fmtDate(reviewGame.date)}.` : "Current match summary."}</p></div><div className="refOverlayMetric"><span>{reviewGame?.result==="draw"?"RESULT":"FINAL SCORE"}</span><b>{reviewGame?.result==="draw"?"DRAW":`${reviewWinner?.vp??"—"} VP`}</b></div></div><div className="matchOutcomeNotice">{reviewGame?.result==="draw"?(reviewGame?.drawMessage||"Draw offer accepted — the match ended in a draw."):reviewGame?.result==="resign"?(reviewGame?.drawMessage||"Match ended by resignation."):""}</div><div className="refPostGrid">{(reviewPlayers||[]).map(p=><div key={p.id} className="refPostPlayer"><div><b>{p.name}</b><span>{p.bot?"AI":"YOU"}</span></div><strong>{p.vp} VP</strong><small>Settlements {p.settlements?.length||0} · Cities {p.cities?.length||0} · Roads {p.roads?.length||0}</small></div>)}</div><section className="refFullLogCard"><div className="refPanelTitle">COMPLETE TURN LOG <span>{(reviewGame?.logs||log).length} ENTRIES</span></div><div className="refFullLogList">{(reviewGame?.logs||log).map((x,i)=><div key={x.id||i}><b>T{x.turn}</b><p>{x.text}</p></div>)}</div></section><button className="refPrimaryButton" onClick={()=>{closeOverlay();setReviewGame(null)}}>BACK TO BOARD</button></div></div>:null;
  const devRoadDock=devChoice?.card==="Road Building"?<div className="refRoadChoiceDock"><b>ROAD BUILDING</b><span>Click up to 2 legal roads. Each selected road builds immediately.</span><strong>{devChoice.roads.length}/2</strong><div className="refRoadChoiceButtons"><button disabled={!devChoice.roads.length} onClick={()=>applyDevChoice("Road Building",[],devChoice.roads,devChoice)}>DONE</button><button onClick={()=>{if(devChoice.roads.length===0)setDevChoice(null)}}>CANCEL</button></div></div>:null;
  const actionConfirmBubble=(key)=>["draw","resign"].includes(key)&&actionConfirm?.visible&&actionConfirm.key===key?<div className="refActionConfirmBubble"><span>{actionConfirm.label}</span><div><button className="confirm" onClick={executeConfirmedAction}>CONFIRM</button><button className="cancel" onClick={cancelActionConfirm}>CANCEL</button></div></div>:null;
  const rules_overlay=rulesOpen?<div className="refOverlay rulesOverlay"><div className="refOverlayCard rulesCard"><button className="refClose" onClick={()=>setRulesOpen(false)}>×</button><div className="refOverlayHead"><div><span className="eyebrow">QUICK RULEBOOK</span><h2>HOW TO PLAY MONOPOLY</h2><p>Colonist-style interaction model, with Monopoly's existing rules and tools preserved.</p></div><button className="refPrimaryButton" onClick={toggleFullscreen}>⛶ FULLSCREEN</button></div><div className="rulesGrid"><section><h3>TURN FLOW</h3><p>Roll first. A 7 requires discards and robber resolution. Otherwise production is resolved, then you may trade, buy a development card, play one development card, or build directly by clicking a legal board target.</p></section><section><h3>BUILDING</h3><p>Road = 🌲 + 🧱. Settlement = one of each basic resource. City = 2 🌾 + 3 ⛰️. A normal settlement must connect to your road and respect the distance rule.</p></section><section><h3>TRADE</h3><p>Bank is normally 4:1. A 3:1 or resource-specific 2:1 port improves that rate. In 4-player play, player trades exchange resources; 1v1 PVBot disables player trading.</p></section><section><h3>DEVELOPMENT</h3><p>25-card deck. One development card may be played per turn, and a card bought this turn cannot be played this turn. Victory Point cards remain hidden until they can complete the win.</p></section><section><h3>AWARDS</h3><p>Longest Road and Largest Army are worth 2 VP and are retained on a tie; the opponent must strictly exceed the current holder.</p></section><section><h3>1v1 PVBot</h3><p>15 VP, Balanced Dice, Friendly Robber, 9-card safe hand and no player trading. The bot's engine uses current-state analysis plus limited historical memory for robber, Knight, Monopoly and blocking decisions.</p></section><section><h3>KEYBOARD SHORTCUTS</h3><p>R Roll · T Trade · D Buy Dev · P Play Card · E End Turn · C Chat · H Activity · F Fullscreen · ? Rules</p></section><section><h3>ACTION INPUT</h3><p>Roads, settlements, cities, trades, cards and end-turn execute immediately when legal. Only draw offers and resignations use an explicit confirmation step.</p></section></div></div></div>:null;
  const adjustTradeResource=(side,r,delta,max=99)=>setPlayerTrade(t=>({...t,[side]:{...t[side],[r]:clamp((t[side][r]||0)+delta,0,max)}}));
  const modal_body=(quickPanel||devOpen||tradeOffer||discardState||robberVictim||drawOffer||(devChoice&&devChoice.card!=="Road Building"))?<div className="refOverlay quickPanelModal"><div className="refOverlayCard quickPanelCard">{!discardState&&!tradeOffer?.botInitiated&&<button className="refClose" onClick={()=>{setQuickPanel(null);setDevOpen(false);setTradeOffer(null);setRobberVictim(null);cancelActionConfirm()}}>×</button>}<>{quickPanel==="trade"&&<div className="colonistTradeHub">
  <div className="colonistTradeHeader"><div><span className="eyebrow">TRADE HUB</span><h2>Trade</h2><p>Choose what you give, choose what you receive, then confirm. Your port rate is shown only on resources you can give.</p></div><div className="colonistTradeTabs"><button className={tradeHubTab==="bank"?"active":""} onClick={()=>setTradeHubTab("bank")}>🏦 BANK TRADE</button><button className={tradeHubTab==="players"?"active":""} disabled={players.length===2} onClick={()=>setTradeHubTab("players")}>👥 PLAYER TRADE</button></div></div>
  {tradeHubTab==="bank"&&<div className="colonistTradeBody">
    <section className="colonistTradeColumn"><div className="colonistTradeColumnTitle"><span>YOU GIVE</span><small>Trade cards from your hand</small></div><div className="colonistResourceGrid">{RES.map(r=>{const count=active?.hand?.[r]||0,rate=tradeRate(active,ports,r),sel=trade.give===r;return <button key={r} className={"colonistResourceCard "+(sel?"selected give":"")} disabled={count<rate} onClick={()=>setTrade(t=>({...t,give:r,get:t.get===r?(RES.find(x=>x!==r)||t.get):t.get}))}><span className="tradeCardIcon">{ICON[r]}</span><b>{LABEL[r]}</b><strong>{count}</strong><small>{rate}:1</small><em>{count>=rate?"READY":"NEED "+Math.max(0,rate-count)}</em></button>})}</div></section>
    <div className="colonistTradeCenter"><div className="tradeArrow up">↑</div><div className="colonistTradeSummary"><span>{tradeRate(active,ports,trade.give)} {LABEL[trade.give]}</span><b>⇅</b><span>1 {LABEL[trade.get]}</span></div><div className="tradeArrow down">↓</div><button className="colonistTradeConfirm" disabled={trade.give===trade.get||!canPay(active?.hand||empty(),{[trade.give]:tradeRate(active,ports,trade.give)})||!(bank[trade.get]>0)} onClick={()=>{if(tradeNow())setQuickPanel(null)}}>CONFIRM TRADE</button></div>
    <section className="colonistTradeColumn"><div className="colonistTradeColumnTitle"><span>YOU RECEIVE</span><small>Choose one resource from the bank</small></div><div className="colonistResourceGrid">{RES.map(r=>{const sel=trade.get===r,stock=bank[r]||0;return <button key={r} className={"colonistResourceCard "+(sel?"selected receive":"")} disabled={r===trade.give||stock<1} onClick={()=>setTrade(t=>({...t,get:r}))}><span className="tradeCardIcon">{ICON[r]}</span><b>{LABEL[r]}</b><strong>{stock}</strong><small>GET 1</small><em>{r===trade.give?"SAME TYPE":stock?"AVAILABLE":"BANK EMPTY"}</em></button>})}</div></section>
    <div className="colonistTradeRates"><span>YOUR RATES</span>{RES.map(r=><b key={r}>{ICON[r]} {tradeRate(active,ports,r)}:1</b>)}</div>
  </div>}
  {tradeHubTab==="players"&&<div className="colonistPlayerTrade"><div className="colonistPlayerSelector">{players.filter(p=>p.id!==active.id).map(p=><button key={p.id} className={Number(playerTrade.partner)===p.id?"active":""} onClick={()=>setPlayerTrade(t=>({...t,partner:p.id}))}><span className="playerTradeAvatar">●</span><b>{p.name}</b><small>{p.bot?"BOT":"PLAYER"} · {p.publicCardCount??total(p.hand)} cards</small></button>)}</div><div className="colonistTradeColumns">
    <section className="colonistTradeColumn"><div className="colonistTradeColumnTitle"><span>YOU GIVE</span><small>Select cards from your hand</small></div><div className="colonistBundleCards">{RES.map(r=>{const n=playerTrade.giveBundle[r]||0,max=active?.hand?.[r]||0;return <div key={r} className={"colonistBundleCard "+(n?"chosen":"")}><span>{ICON[r]}</span><b>{LABEL[r]}</b><strong>{n}</strong><div><button disabled={!n} onClick={()=>adjustTradeResource("give",r,-1)}>−</button><button disabled={n>=max} onClick={()=>adjustTradeResource("give",r,1,max)}>+</button></div></div>;})}</div></section>
    <div className="colonistPlayerTradeCenter"><div className="tradeArrow up">↑</div><div className="colonistOfferTotals"><b>{bundleTotal(playerTrade.giveBundle)}</b><span>GIVE</span><i>⇅</i><b>{bundleTotal(playerTrade.getBundle)}</b><span>GET</span></div><div className="tradeArrow down">↓</div><button className="colonistTradeConfirm" disabled={bundleTotal(playerTrade.giveBundle)<1||bundleTotal(playerTrade.getBundle)<1} onClick={()=>{if(playerTradeNow())setQuickPanel(null)}}>OFFER TRADE</button></div>
    <section className="colonistTradeColumn"><div className="colonistTradeColumnTitle"><span>YOU RECEIVE</span><small>Request cards from the player</small></div><div className="colonistBundleCards">{RES.map(r=>{const n=playerTrade.getBundle[r]||0;return <div key={r} className={"colonistBundleCard receive "+(n?"chosen":"")}><span>{ICON[r]}</span><b>{LABEL[r]}</b><strong>{n}</strong><div><button disabled={!n} onClick={()=>adjustTradeResource("get",r,-1)}>−</button><button onClick={()=>adjustTradeResource("get",r,1)}>+</button></div></div>;})}</div></section>
  </div><div className="colonistTradeRuleBar">Any combination is permitted between players, but both sides must offer resources and the same resource cannot appear on both sides.</div></div>}
</div>}{quickPanel==="robber"&&<><span className="eyebrow">ACTION DOCK</span><h2>ROBBER</h2><p className="modalHint">The robber is active. Click a highlighted hex on the board to move it and steal a resource.</p><button className="refPrimaryButton" onClick={()=>setQuickPanel(null)}>RETURN TO BOARD</button></>}{devOpen&&<><span className="eyebrow">DEVELOPMENT DECK</span><h2>PLAY A CARD</h2><p className="modalHint">Play an owned development card. Victory Points remain hidden until they can complete the win.</p><div className="refDevModalGrid">{Object.keys(DEV).map(c=><button key={c} disabled={!active?.development[c]||active.bot||winner||drawn||roll===7||robberMode||discardState||(c!=="Victory Point"&&!hasRolled)||(c!=="Victory Point"&&devPlayed)||((c!=="Victory Point")&&((active?.development[c]||0)-(devCardsBought[c]||0)<=0))} onClick={()=>playDev(c)}><span>{DEV_ICON[c]}</span><b>{c}</b><small>Owned: {active?.development[c]||0}</small></button>)}</div></>}{devChoice&&<><span className="eyebrow">CARD RESOLUTION</span><h2>{devChoice.card}</h2><p className="modalHint">{devChoice.card==="Year of Plenty"?"Choose two resources.":devChoice.card==="Monopoly"?"Choose a resource to collect from opponents.":"Choose up to two legal road locations on the board."}</p>{(devChoice.card==="Year of Plenty"||devChoice.card==="Monopoly")&&<div className="refChoiceGrid">{RES.map(r=>{const count=devChoice.resources.filter(x=>x===r).length;const maxAvailable=bank[r]||0;return <button key={r} className={count>0?"selected":""} disabled={devChoice.card==="Year of Plenty"&&(devChoice.resources.length>=2||count>=maxAvailable)} aria-label={devChoice.card==="Year of Plenty"?`${LABEL[r]} available ${maxAvailable}, selected ${count}`:LABEL[r]} onClick={()=>{setDevChoice(d=>{let next;if(d.card==="Monopoly")next={...d,resources:[r]};else if(d.resources.length<2 && d.resources.filter(x=>x===r).length<maxAvailable)next={...d,resources:[...d.resources,r]};else return d;const complete=(next.card==="Monopoly"&&next.resources.length===1)||(next.card==="Year of Plenty"&&next.resources.length===2);if(complete)requestAnimationFrame(()=>applyDevChoice(next.card,next.resources,[],next));return next;})}}>{ICON[r]} {LABEL[r]}{devChoice.card==="Year of Plenty"&&count>0?<small>×{count}</small>:null}</button>})}</div>}{devChoice.card==="Road Building"&&devChoice.roads?.length>0&&<div className="roadBuildResolveRow"><span>{devChoice.roads.length}/2 roads selected</span><button className="refPrimaryButton" onClick={()=>applyDevChoice("Road Building",[],devChoice.roads)}>DONE ROAD BUILDING</button></div>}<div className="autoResolveHint">Year of Plenty and Monopoly resolve automatically when selected. Road Building can use one or two roads.</div></>}{robberVictim&&<><span className="eyebrow">ROBBER VICTIM</span><h2>Choose who to steal from</h2><p className="modalHint">The robber is on the selected hex. Choose one adjacent opponent with resource cards.</p><div className="refChoiceGrid">{robberVictim.victims.map(id=>{const v=players.find(p=>p.id===id);return <button key={id} onClick={()=>stealFromVictim(v,true,robberVictim.tid)}><span>👤</span><b>{v?.name||"Player"}</b><small>{total(v?.hand||empty())} cards</small></button>})}</div></>} {drawOffer&&<><span className="eyebrow">DRAW OFFER</span><h2>{players.find(p=>p.id===drawOffer.from)?.name||"Player"} offered a draw</h2><p className="modalHint">Accept the draw and end the 1v1 match immediately, or decline and continue playing.</p><div className="refOfferButtons"><button className="refPrimaryButton" onClick={()=>respondDrawOffer(true)}>ACCEPT DRAW</button><button className="refDangerButton" onClick={()=>respondDrawOffer(false)}>DECLINE</button></div></>}{tradeOffer&&(()=>{const from=players.find(p=>p.id===tradeOffer.from),to=players.find(p=>p.id===tradeOffer.to);const give=tradeOffer.giveBundle||{[tradeOffer.give]:tradeOffer.giveAmount};const get=tradeOffer.getBundle||{[tradeOffer.get]:tradeOffer.getAmount};return <><div className="tradeOfferEyebrow"><span className="eyebrow">{tradeOffer.botInitiated?"BOT TRADE OFFER":"TRADE OFFER"}</span><span className="tradeOfferStatus">WAITING FOR RESPONSE</span></div><h2>{from?.name||"Player"} → {to?.name||"you"}</h2><div className="tradeOfferExchange"><div className="tradeOfferSide give"><small>THEY GIVE</small><strong>{bundleText(give)}</strong><span>{bundleTotal(give)} card{bundleTotal(give)===1?"":"s"}</span></div><div className="tradeOfferSwap">⇄</div><div className="tradeOfferSide get"><small>THEY WANT</small><strong>{bundleText(get)}</strong><span>{bundleTotal(get)} card{bundleTotal(get)===1?"":"s"}</span></div></div>{tradeOffer.botInitiated&&<p className="tradeOfferObjective">This bot offer was generated from its current strategic objective and only uses resources the bot can spare.</p>}<p className="modalHint">Both sides exchange resources. Accept or decline the offer before it expires.</p><div className="refOfferButtons"><button className="refPrimaryButton" onClick={()=>respondTradeOffer(true)}>ACCEPT TRADE</button><button className="refDangerButton" onClick={()=>respondTradeOffer(false)}>DECLINE</button></div></>})()}</>}{discardState&&(()=>{const discardPlayer=players.find(p=>p.id===discardState.playerId)||active;return <><span className="eyebrow">ROBBER DISCARDS</span><h2>{discardPlayer?.name||"Player"}: discard {discardState.remaining} cards</h2><p className="modalHint"><b>MANDATORY:</b> You cannot continue until exactly {discardState.remaining} cards are discarded. In 1v1, the safe hand is 9 cards; in standard games it is 7.</p><div className="refChoiceGrid">{RES.map(r=><button key={r} className={discardSelection[r]>0?"selected":""} disabled={(discardPlayer?.hand[r]||0)<=discardSelection[r]} onClick={()=>handleDiscardResourceClick(r)}>{ICON[r]} {LABEL[r]} · {discardPlayer?.hand[r]||0}</button>)}</div><div className="autoResolveHint">Discarding resolves automatically when the required number of cards is selected.</div></>})()}</></div></div>:null;

  if(screen==="home") return <div className="app neonHomeApp"><header className="neonHomeTop"><div className="neonBrand"><div className="neonLogo">⬡</div><div><h1>MONOPOLY</h1><small>BUILD · TRADE · DOMINATE</small></div></div><div className="neonStatus"><span>LOCAL GAME ENGINE</span><b>READY</b></div><div className="neonTopActions"><button onClick={()=>setScreen("history")}>◫<span>History</span></button><button onClick={startNew}>＋<span>New Game</span></button></div></header><main className="neonHomeMain"><section className="neonHero"><div className="neonHeroCopy"><span className="neonEyebrow">MONOPOLY COMMAND CENTER</span><h2>Build. Trade.<br/><em>Dominate.</em></h2><p>Choose your table before the first roll. The game never auto-starts, and every action remains playable from the compact desktop HUD.</p><div className="neonHeroStats"><div><b>19</b><span>HEXES</span></div><div><b>9</b><span>PORTS</span></div><div><b>4</b><span>AI LEVELS</span></div><div><b>15</b><span>1v1 VP</span></div></div></div><div className="neonLaunchCard"><div className="neonLaunchGlow">⬡</div><span>QUICK START</span><h3>1v1 PVBot</h3><p>Head-to-head strategic match to 15 Victory Points.</p><button onClick={()=>{setMode("pvbot");setScreen("setup")}}>CONFIGURE 1v1 →</button></div></section><section className="monopolyGrindBox" aria-label="Monopoly training message"><strong>Boardgames are really that deep, time for you to train</strong><span>Developed by Aryan Mohammed, to assist with the grind</span></section><section className="neonModeGrid"><article className="neonModeCard lime"><div className="neonModeIcon">⚔</div><div><span>CLASSIC TABLE</span><h3>4 PLAYER · 10 VP</h3><p>You + three opponents. Full board, ports, awards, development cards and AI strategy.</p><button onClick={startNew}>BUILD THE TABLE →</button></div></article><article className="neonModeCard pink"><div className="neonModeIcon">🤖</div><div><span>HEAD TO HEAD</span><h3>1v1 · PVBOT · 15 VP</h3><p>Select Maya, Rook or Nova and one of four difficulty settings.</p><button onClick={()=>{setMode("pvbot");setScreen("setup")}}>PLAY PVBOT →</button></div></article><article className="neonModeCard engine"><div className="neonModeIcon">♟</div><div><span>CATAN ENGINE</span><h3>ANALYSIS LAB</h3><p>Set up any board manually and get the best, second-best and third-best decisions plus a win-likelihood bar.</p><button onClick={startEngineSetup}>OPEN ENGINE →</button></div></article><article className="neonModeCard blue"><div className="neonModeIcon">◫</div><div><span>LOCAL ARCHIVE</span><h3>GAME HISTORY</h3><p>{history.length?`${history.length} completed match${history.length===1?"":"es"} stored locally.`:"Finished matches will appear here."}</p><button onClick={()=>setScreen("history")}>OPEN HISTORY →</button></div></article></section><section className="neonFeatureStrip"><div><span>01</span><b>NO AUTO START</b><small>Choose a mode first.</small></div><div><span>02</span><b>FULL DESKTOP HUD</b><small>Designed for laptop screens.</small></div><div><span>03</span><b>FUNCTIONAL ACTIONS</b><small>Build, trade, cards, robber.</small></div><div><span>04</span><b>MAP RULE</b><small>6 & 8 adjacency is configurable.</small></div></section></main><footer className="neonHomeFooter">LOCALHOST · MONOPOLY STRATEGY TABLE · BUILD / TRADE / DOMINATE</footer></div>

  if(screen==="history") return <div className="app pageApp"><header className="topbar"><div className="brand"><div className="logo">H</div><div><h1>MONOPOLY</h1><small>LOCAL ARCHIVE</small></div></div><div className="setupNav"><button className="homeNav" onClick={goHome}>← HOME</button><button className="homeNav" onClick={startNew}>NEW GAME</button></div></header><main className="historyPage"><div className="pageHero"><div><span className="eyebrow">LOCAL ARCHIVE</span><h2>Game History</h2><p>Finished games stay in this browser and include the frozen board, awards and final standings.</p></div><button className="ghost" onClick={()=>{clearHistory()}}>CLEAR HISTORY</button></div>{history.length===0?<div className="emptyHistory"><h3>No completed games yet</h3><p>Finish a 10 VP or 1v1 15 VP match to create a reviewable snapshot.</p><button className="gold" onClick={startNew}>START NEW GAME</button></div>:<div className="historyList">{history.map(g=><article className="historyCard" key={g.id}><div className="historyTitle"><div><span>{fmtDate(g.date)}</span><h3>{g.result==="draw"?"DRAW":`${g.winner} won`}</h3></div><strong>{g.targetVP} VP · {g.accuracy==null?"—":`${g.accuracy}%`} accuracy · {fmtDuration(g.durationSeconds)}</strong></div><div className="historyMeta"><span>🛣 {g.awards?.roadOwner!=null?g.players.find(p=>p.id===g.awards.roadOwner)?.name||"Player":"Open"}</span><span>⚔ {g.awards?.armyOwner!=null?g.players.find(p=>p.id===g.awards.armyOwner)?.name||"Player":"Open"}</span></div><div className="historyActionRow"><button className="openHistory" onClick={()=>{setReviewGame(g);setBoard(g.board);setPlayers(g.players);setPorts(g.ports||[]);setTurn(g.winnerId||0);setWinner(g.result==="draw"?{id:null,name:"Draw",vp:0}:null);setDrawn(g.result==="draw");setLogEntries(g.logs||[]);setTab("postgame");setScreen("playing");}}>REVIEW BOARD →</button><button className="analyzeHistoryBtn" onClick={()=>openHistoryAnalyze(g)} disabled={!g.result||!g.analysisFrames?.length} title={!g.result||!g.analysisFrames?.length?"Analysis is available only after a complete game is saved.":"Analyze every completed turn."}>ANALYZE</button></div></article>)}</div>}</main></div>;

  if(screen==="setup") return <div className="app setupApp"><header className="topbar"><div className="brand"><div className="logo">H</div><div><h1>MONOPOLY</h1><small>LOCAL STRATEGY TABLE</small></div></div><div className="setupNav"><button className="homeNav" onClick={goHome}>← HOME</button><button className="homeNav" onClick={startEngineSetup}>CATAN ENGINE</button><div className="turnpill">MATCH SETUP</div></div></header><main className="setupPage"><div className="setupHero"><span className="eyebrow">LOCAL CATAN</span><h2>Build your table.</h2><p>Choose the match format, opponents and map rules before you start. Nothing begins until you press Start.</p></div><div className="setupGrid"><section className="setupCard"><h3>Game mode</h3><div className="modeGrid"><button className={mode===10?"selected":""} onClick={()=>setMode(10)}><strong>4 PLAYER · 10 VP</strong><span>You + 3 bots</span><small>Classic-length match · 10 VP</small></button><button className={mode==="pvbot"?"selected":""} onClick={()=>setMode("pvbot")}><strong>1v1 · PVBOT · 15 VP</strong><span>You + 1 selected bot</span><small>Head-to-head strategic match</small></button></div>{isPVBot?<><h3>Choose your PVBot opponent</h3><div className="botChoiceGrid">{["Maya","Rook","Nova"].map(name=><button key={name} className={pvBot===name?"selected":""} onClick={()=>setPvBot(name)}><b>{name}</b><span>{name==="Maya"?"Unified engine":name==="Rook"?"Unified engine":"Unified engine"}</span></button>)}</div><label className="botRow"><span><b>{pvBot}</b><small>PVBot difficulty</small></span><select value={pvBotDiff} onChange={e=>setPvBotDiff(e.target.value)}>{["Easy","Medium","Hard","Impossible"].map(x=><option key={x}>{x}</option>)}</select></label></>:<><h3>Choose your bots</h3>{botDiffs.map((d,i)=><label className="botRow" key={i}><span><b>{["Maya","Rook","Nova"][i]}</b><small>Opponent {i+1}</small></span><div className="botControls"><select value={opponentTypes[i]} onChange={e=>setOpponentTypes(ts=>ts.map((x,j)=>j===i?e.target.value:x))}><option>AI</option><option>Human</option></select>{opponentTypes[i]==="AI"&&<select value={d} onChange={e=>setBotDiffs(ds=>ds.map((x,j)=>j===i?e.target.value:x))}>{["Easy","Medium","Hard","Impossible"].map(x=><option key={x}>{x}</option>)}</select>}</div></label>)}<div className="presetRow">{["Easy","Medium","Hard","Impossible"].map(d=><button key={d} onClick={()=>setBotDiffs([d,d,d])}>{d} table</button>)}</div></>}</section><section className="setupCard"><h3>Map rules</h3><label className="toggleRow"><span><b>6 and 8 may touch</b><small>Allow adjacent high-probability numbers.</small></span><input type="checkbox" checked={mapSettings.highPipsTouch} onChange={e=>setMapSettings(s=>({...s,highPipsTouch:e.target.checked}))}/></label><div className="rulePreview"><span>19 hexes</span><span>54 intersections</span><span>72 road edges</span><span>9 ports</span><span>{isPVBot?"2 players":"4 players"}</span></div><div className="setupNotes"><b>Port rules</b><p>Ports occupy random coastal edges. A settlement or city on either endpoint unlocks its trade rate.</p><b>Opening</b><p>Opening placement uses the standard snake order. In 1v1 PVBot: first player → second player → second player → first player.</p></div><button className="startButton" onClick={startGame}>START {isPVBot?"1v1 PVBOT · 15 VP":"4 PLAYER · 10 VP"} →</button></section></div></main></div>;


  if(screen==="engineSetup"&&engineBoard) return <div className="app engineApp">
    <header className="topbar"><div className="brand"><div className="logo">H</div><div><h1>MONOPOLY</h1><small>CATAN ENGINE · CUSTOM SETUP</small></div></div><div className="setupNav"><button className="homeNav" onClick={goHome}>← HOME</button><button className="homeNav" onClick={resetEngineState}>RESET BOARD</button><div className="turnpill">MANUAL ANALYSIS LAB</div></div></header>
    <main className="engineSetupPage">
      <section className="engineBoardPanel"><div className="boardHead"><div><span className="eyebrow">CUSTOM BOARD</span><h2>Set the position yourself</h2><p>Nothing is played automatically. Edit the board, cards, pieces and side to move. Placement scores stay hidden here and are revealed only after analysis.</p></div><div className="setupCounter">SIDE TO MOVE: {enginePlayers[engineActive]?.name}</div></div>
        <Board geo={geo} board={engineBoard} players={enginePlayers} ports={enginePorts} selectedV={null} selectedE={null} analysisMode={false} onTile={tid=>setEngineSelectedTile(tid)} onInspectVertex={enginePieceMode==="inspect"?v=>{const owner=enginePlayers.find(p=>p.settlements.includes(v)||p.cities.includes(v));if(owner){setEngineActive(owner.id);setEngineSelectedPiece({playerId:owner.id,kind:owner.cities.includes(v)?"cities":"settlements",id:v});}}:undefined} onInspectEdge={enginePieceMode==="inspect"?e=>{const owner=enginePlayers.find(p=>p.roads.includes(e));if(owner){setEngineActive(owner.id);setEngineSelectedPiece({playerId:owner.id,kind:"roads",id:e});}}:undefined} onVertex={v=>{if(enginePieceMode!=="inspect")enginePlacePiece(enginePieceMode,v)}} onEdge={e=>{if(enginePieceMode==="road")enginePlacePiece("road",e)}} />
        <div className="engineEditorHint">{engineSelectedTile!=null?`Editing tile ${engineSelectedTile}: ${LABEL[engineBoard[engineSelectedTile]?.resource]||"Desert"}${engineBoard[engineSelectedTile]?.number?` · ${engineBoard[engineSelectedTile].number}`:""}`:"Click a hex to edit it, or choose a piece tool and click the board."}</div>
      </section>
      <aside className="engineSetupSide">
        <section className="engineCard"><div className="engineCardTitle">ANALYSIS FORMAT</div><div className="engineSegment"><button className={enginePlayerCount===2?"selected":""} onClick={()=>{setEnginePlayerCount(2);setEnginePlayers(makeEnginePlayers(2));setEngineActive(0);setEngineTargetVP(15);}}>1v1 · 15 VP</button><button className={enginePlayerCount===4?"selected":""} onClick={()=>{setEnginePlayerCount(4);setEnginePlayers(makeEnginePlayers(4));setEngineActive(0);setEngineTargetVP(10);}}>4 PLAYER · 10 VP</button></div><p className="engineTiny">Set the complete position for either format. The engine evaluates the selected side against every opponent.</p></section>
        <section className="engineCard"><div className="engineCardTitle">BOARD TILE</div>{engineSelectedTile==null?<p>Select a hex on the board.</p>:<><label>Resource<select value={engineBoard[engineSelectedTile]?.resource||"desert"} onChange={e=>{const r=e.target.value;engineSetTile(engineSelectedTile,{resource:r,number:r==="desert"?null:(engineBoard[engineSelectedTile]?.number||6),robber:r==="desert"?engineBoard[engineSelectedTile]?.robber:false})}}>{[...RES,"desert"].map(r=><option key={r} value={r}>{LABEL[r]||"Desert"}</option>)}</select></label><label>Number<select disabled={engineBoard[engineSelectedTile]?.resource==="desert"} value={engineBoard[engineSelectedTile]?.number||6} onChange={e=>engineSetTile(engineSelectedTile,{number:Number(e.target.value)})}>{[2,3,4,5,6,8,9,10,11,12].map(n=><option key={n}>{n}</option>)}</select></label><label className="engineCheck"><input type="checkbox" checked={!!engineBoard[engineSelectedTile]?.robber} onChange={e=>setEngineBoard(bs=>bs.map((t,i)=>({...t,robber:i===engineSelectedTile?e.target.checked:false})))} /> Robber here</label></>}</section>
        <section className="engineCard"><div className="engineCardTitle">MANUAL PIECES</div><div className="engineToolGrid">{[["inspect","Inspect"],["settlement","Settlement"],["city","City"],["road","Road"]].map(([v,l])=><button key={v} className={enginePieceMode===v?"selected":""} onClick={()=>setEnginePieceMode(v)}>{l}</button>)}</div><p className="engineTiny">Side to move determines which side receives newly placed pieces. Click an existing piece with Inspect to select the position, then remove it with the controls below.</p><div className="enginePlayerTabs">{enginePlayers.map(p=><button key={p.id} className={engineActive===p.id?"selected":""} onClick={()=>setEngineActive(p.id)}>{p.name}</button>)}</div></section>
        <section className="engineCard"><div className="engineCardTitle">PLAYER STATE</div>{enginePlayers.map(p=><div className="enginePlayerEditor" key={p.id}><div className="enginePlayerEditorHead"><b>{p.name}</b><span>{p.settlements.length} S · {p.cities.length} C · {p.roads.length} R</span></div><label>VP<input type="number" min="0" max="20" value={p.vp} onChange={e=>engineSetVP(p.id,e.target.value)}/></label><div className="engineResourceInputs">{RES.map(r=><label key={r}><span>{ICON[r]}</span><input aria-label={`${p.name} ${LABEL[r]}`} type="number" min="0" max="19" value={p.hand[r]} onChange={e=>engineSetHand(p.id,r,e.target.value)}/></label>)}</div><div className="engineDevInputs">{Object.keys(DEV).map(c=><label key={c}><span>{DEV_ICON[c]}</span><input aria-label={`${p.name} ${c}`} type="number" min="0" max={DEV[c]} value={p.development[c]||0} onChange={e=>engineSetDev(p.id,c,e.target.value)}/></label>)}</div><label>Played Knights<input type="number" min="0" max="14" value={p.development.playedKnights||0} onChange={e=>engineSetKnights(p.id,e.target.value)}/></label></div>)}</section><section className="engineCard"><div className="engineCardTitle">BANK & AWARDS</div><div className="engineBankGrid">{RES.map(r=><label key={r}><span>{ICON[r]} {LABEL[r]}</span><input type="number" min="0" max="19" value={engineBank[r]} onChange={e=>engineSetBank(r,e.target.value)}/></label>)}</div><label>Victory target<select value={engineTargetVP} onChange={e=>setEngineTargetVP(Number(e.target.value))}><option value={10}>10 VP</option><option value={15}>15 VP</option></select></label><label>Longest Road<select value={engineHeldAwards.roadOwner==null?"null":engineHeldAwards.roadOwner} onChange={e=>engineSetAward("roadOwner",e.target.value)}><option value="null">Open</option>{enginePlayers.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Largest Army<select value={engineHeldAwards.armyOwner==null?"null":engineHeldAwards.armyOwner} onChange={e=>engineSetAward("armyOwner",e.target.value)}><option value="null">Open</option>{enginePlayers.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><div className="engineTiny">Development deck remaining: {Object.values(engineDevCounts).reduce((a,b)=>a+Number(b||0),0)} cards. Edit the counts below.</div><div className="engineDevDeckInputs">{Object.keys(DEV).map(c=><label key={c}><span>{c}</span><input type="number" min="0" max={DEV[c]} value={engineDevCounts[c]} onChange={e=>setEngineDevCounts(d=>({...d,[c]:Math.max(0,Math.min(DEV[c],Number(e.target.value)||0))}))}/></label>)}</div></section><section className="engineCard"><div className="engineCardTitle">SELECTED PIECE</div>{engineSelectedPiece?<><p>{enginePlayers.find(p=>p.id===engineSelectedPiece.playerId)?.name||"Player"} · {engineSelectedPiece.kind.slice(0,-1)} · {engineSelectedPiece.id}</p><div className="engineToolRow"><button className="engineDanger" onClick={()=>removeEnginePiece(engineSelectedPiece.kind,engineSelectedPiece.id)}>REMOVE</button><button onClick={()=>setEngineSelectedPiece(null)}>CLEAR</button></div></>:<p>Use Inspect and click a settlement, city or road to select it for removal.</p>}</section><section className="engineCard"><div className="engineCardTitle">TURN</div><div className="engineSegment">{[["preRoll","Before roll"],["action","Action phase"]].map(([v,l])=><button key={v} className={engineStage===v?"selected":""} onClick={()=>setEngineStage(v)}>{l}</button>)}</div><button className="enginePrimary" onClick={()=>setScreen("engineAnalysis")}>ANALYZE POSITION →</button></section>
      </aside>
    </main>
  </div>;

  if(screen==="engineAnalysis"&&engineBoard) {
    const activeEngine=enginePlayers[engineActive]||enginePlayers[0];
    const recs=engineRecommendations({active:activeEngine,players:enginePlayers,board:engineBoard,geo,ports:enginePorts,bank:engineBank,deck:engineDeck,targetVP:engineTargetVP,heldAwards:engineHeldAwards,stage:engineStage});
    const odds=engineWinLikelihood(enginePlayers,engineBoard,geo,enginePorts,engineBank,engineTargetVP);
    const topScore=recs[0]?.score||0;
    const placementScores=recs.filter(a=>a.type==="settlement").map(a=>Number(a.score)||0);
    const maxPlacement=placementScores.length?Math.max(...placementScores):0;
    const minPlacement=placementScores.length?Math.min(...placementScores):0;
    return <div className="app engineApp engineAnalysisPage">
      <header className="topbar"><div className="brand"><div className="logo">H</div><div><h1>MONOPOLY</h1><small>CATAN ENGINE · POSITION ANALYSIS</small></div></div><div className="setupNav"><button className="homeNav" onClick={()=>setScreen("engineSetup")}>← EDIT POSITION</button><div className="turnpill">ENGINE ANALYSIS</div></div></header>
      <main className="engineAnalysisLayout">
        <section className="engineAnalysisBoard">
          <div className="engineAnalysisHero"><div><span className="eyebrow">ENGINE VIEW</span><h2>{activeEngine.name} TO MOVE</h2><p>Legal moves are ranked from the current position. Scores explain the engine evaluation; they are not guaranteed outcomes.</p></div><div className="engineAnalysisHeroStats"><span><b>{engineStage==="preRoll"?"PRE-ROLL":"ACTION PHASE"}</b><small>STAGE</small></span><span><b>{recs.length}</b><small>TOP MOVES</small></span><span><b>{Number(topScore).toFixed(1)}</b><small>TOP SCORE</small></span></div></div>
          <div className="engineAnalysisLegend"><span><i className="scoreHot"/> high-value placement</span><span><i className="scoreWarm"/> viable placement</span><span><i className="scoreCool"/> lower-value placement</span>{placementScores.length>0&&<em>placement range {minPlacement.toFixed(1)} → {maxPlacement.toFixed(1)}</em>}</div>
          <div className="engineAnalysisBoardFrame"><Board geo={geo} board={engineBoard} players={enginePlayers} ports={enginePorts} selectedV={null} selectedE={null} analysisMode={true} showPlacementScores={true} placementPlayer={activeEngine} placementMode="settlement" boardAnalysis={recs.filter(a=>a.type==="settlement").map(a=>({v:a.spot,score:a.score,legal:true}))}/></div>
          <div className="engineAnalysisFootnote"><span>Tip</span><p>Use the edit screen to change the board, hands, awards or turn stage, then return here for a fresh evaluation.</p></div>
        </section>
        <aside className="engineAnalysisSide">
          <section className="engineCard engineTopMoves"><div className="engineCardTitle">CATAN ENGINE · TOP 3 MOVES</div>{recs.length?recs.map((r,i)=><article className={`engineMoveCard ${i===0?"best":""}`} key={`${r.type}-${r.spot??r.card??r.give??i}`}><div className="engineMoveHeader"><div className="engineMoveRank">{i+1}</div><div><b>{r.display}</b><small>{r.type==="settlement"?`Intersection ${r.spot} · placement evaluation`:r.type==="road"?`Road edge ${r.spot}`:"Strategic action"}</small></div><strong>{Number.isFinite(r.score)?r.score.toFixed(2):"—"}</strong></div><div className="engineBreakdown">{(r.breakdown||[]).map((b,j)=><div key={j}><span>{b.label}</span><b className={`tone-${b.tone||"flat"}`}>{b.value}</b></div>)}</div></article>):<div className="engineEmpty">No legal scored action. Adjust the position or switch to the action phase.</div>}</section>
          <section className="engineCard"><div className="engineCardTitle">WIN LIKELIHOOD</div><div className="engineOddsBar">{odds.map(o=><div key={o.id} style={{width:`${Math.max(4,o.prob*100)}%`,background:enginePlayers.find(p=>p.id===o.id)?.color}} title={`${o.name}: ${(o.prob*100).toFixed(1)}%`}/>)}</div>{odds.map(o=><div className="engineOddsRow" key={o.id}><span><i style={{background:enginePlayers.find(p=>p.id===o.id)?.color}}></i>{o.name}<small>strength {o.value.toFixed(1)}</small></span><b>{(o.prob*100).toFixed(1)}%</b></div>)}<small className="engineDisclaimer">Heuristic position estimate — useful for comparing positions, not a simulation probability or guarantee.</small></section>
          <section className="engineCard"><div className="engineCardTitle">POSITION SUMMARY</div><div className="engineSummaryGrid">{enginePlayers.map(p=>{const pp=botProduction(p,engineBoard,geo),totalProd=RES.reduce((a,r)=>a+pp[r],0),aw=awards(enginePlayers,geo,engineHeldAwards),awardVP=(aw.roadOwner===p.id?2:0)+(aw.armyOwner===p.id?2:0);return <div key={p.id}><b>{p.name}</b><span>{p.vp+awardVP} visible VP · {total(p.hand)} cards</span><span>{totalProd.toFixed(2)} expected resource / roll</span><span>{p.settlements.length} settlements · {p.cities.length} cities · {p.roads.length} roads</span></div>})}</div></section>
          <section className="engineCard engineAnalysisChecks"><div className="engineCardTitle">ENGINE CHECKS</div><div className="engineCheckRow"><span>Position data</span><b className="ok">MANUAL</b></div><div className="engineCheckRow"><span>Legal move search</span><b className="ok">{recs.length?"ACTIVE":"NONE"}</b></div><div className="engineCheckRow"><span>Board scoring overlay</span><b className="ok">{placementScores.length?"ACTIVE":"READY"}</b></div><div className="engineCheckRow"><span>Stage</span><b>{engineStage==="preRoll"?"ROLL REQUIRED":"ACTION"}</b></div></section>
        </aside>
      </main>
    </div>;
  }

  if(screen==="setupBoard"&&board) return <div className={`app setupBoardApp ${isPVBot ? "mode1v1" : "mode4p"}`}><header className="topbar"><div className="brand"><div className="logo">H</div><div><h1>MONOPOLY</h1><small>OPENING SETUP</small></div></div><div className="turnpill">{currentSetupPlayer?.bot?`${currentSetupPlayer.name.toUpperCase()} · AI THINKING`:`${currentSetupPlayer?.name?.toUpperCase()||"PLAYER"} · YOUR SETUP`}<small className="setupTimerBadge">{currentSetupPlayer?.bot?"INSTANT":`${String(Math.floor(turnSecondsLeft/60)).padStart(2,"0")}:${String(turnSecondsLeft%60).padStart(2,"0")}`} · 45s + 30s/action</small></div></header><main className="setupBoardPage"><section className="boardPanel"><div className="boardHead"><div><span className="eyebrow">OPENING PLACEMENT</span><h2>{currentSetupPlayer?.bot?`${currentSetupPlayer.name} IS CHOOSING`:`${currentSetupPlayer?.name||"Player"}'S TURN TO PLACE`}</h2><p>{currentSetupPlayer?.bot?`${currentSetupPlayer.diff} bot uses the shared strategy engine with difficulty-specific search/noise and memory settings.`:`Click a legal board location, confirm the floating settlement, then click its connected road.`}</p></div><div className="setupCounter">ROUND {setupRound} · {setupIndex+1}/{players.length}</div></div><Board geo={geo} board={board} players={players} ports={ports} selectedV={selectedV} selectedE={selectedE}
          placementMode="setup" placementPlayer={currentSetupPlayer} showPlacementScores={false}
          onTile={tid=>selectPlacementFromTile(tid,"setup")}
          onVertex={v=>{if(!currentSetupPlayer?.bot&&legalSettlement(v,players,geo)){setSelectedV(v);setSelectedE(null);setPlacementConfirm({vertex:v,kind:"settlement",mode:"setup"})}}}
          onEdge={e=>{if(!currentSetupPlayer?.bot&&selectedV!=null&&!placementConfirm&&legalInitialRoad(e,selectedV,players,geo)){setSelectedE(e);requestAnimationFrame(()=>finishSetupPlacement(currentSetupPlayer.id,selectedV,e));}}}
          placementConfirm={placementConfirm} placementPlayer={currentSetupPlayer} onPlacementConfirm={confirmPlacementPreview}
          setup selectedForSetup={currentSetupPlayer?.id} /></section><aside className="setupSide"><div className="setupChecklist"><b>OPENING ORDER</b>{setupOrder.map((id,i)=><div key={id} className={i===setupIndex?"activeStep":""}><span>{i+1}</span>{players[id]?.name}<small>{players[id]?.bot?players[id]?.diff:"YOU"}</small></div>)}</div><div className="mapProof"><b>✓ RANDOM MAP VERIFIED</b><span>19 hexes · 18 number tokens · 1 desert · 9 coastal ports</span><span>{mapSettings.highPipsTouch?"6/8 may touch":"6/8 separated"}</span></div><div className="portLegend"><h3>Ports on this map</h3>{ports.map((p,i)=><div key={i}><span>⚓</span><b>{p.type}</b><small>Coast edge {p.edge}</small></div>)}</div><div className={`botThinking ${currentSetupPlayer?.bot?"live":""}`}><b>{currentSetupPlayer?.bot?"🤖 BOT IS PLAYING":"🎯 YOUR PLACEMENT"}</b><span>{currentSetupPlayer?.bot?"The AI selects its settlement and road automatically using the shared best-move engine.":"Click a legal location, confirm the floating settlement, then choose its connected road."}</span></div></aside></main></div>;

  if(screen==="playing"&&board&&active){
    const me=active.bot?(players.find(p=>!p.bot)||active):active;
    const myPieces=piecesRemaining(me),myDev=devCount(me);
    const rates=RES.map(r=>tradeRate(me,ports,r));
    const has3=rates.includes(3),has2=rates.includes(2);
    const leaderVP=Math.max(...players.map(p=>p.vp),0);
    const ownerName=id=>id!=null?(players.find(p=>p.id===id)?.name||null):null;
    const canRoll=!active.bot&&!winner&&!hasRolled&&!robberMode&&!discardState;
    const tradeBlocked=active.bot||!hasRolled||robberMode||discardState||devChoice;
    const humanTitle=active.name==="You"?"YOUR TURN":`${active.name.toUpperCase()}'S TURN`;
    const humanSub=winner?"Game over":discardState?"Discard cards for the 7":robberMode?"Move the robber to a hex":!hasRolled?"Roll the dice to begin":"Click the board to build, trade or end turn";
    const botSub=`Turn ${turnNumber} · ${botTurnStatus==="rolling"?"Rolling dice…":botTurnStatus==="acting"?"Evaluating and building…":"AI is taking its turn"}`;
    const hint=discardState?`Discard exactly ${discardState.remaining} cards to continue`:robberMode?"Robber active — click a hex to move it":!hasRolled?"Roll the dice to start your turn":"Click a legal road, empty intersection, or your house to build immediately";
    const pName=p=>p.bot?`${p.name} (Bot)`:p.name;
    const memTip=p=>p.bot?`${p.diff} bot · ${p.diff==="Impossible"?"perfect memory":p.diff==="Hard"?"remembers the last 5 turns":"sees the current state only"}`:"";
    const dsum=dice?dice[0]+dice[1]:null;
    return <div className="app hxGame">
      <header className="hxTop">
        <div className="hxBrand"><div className="hxLogo"><Ico n="cube"/></div><div><h1>MONOPOLY</h1><small>BUILD · TRADE · DOMINATE</small></div></div>
        <nav className="hxNav" aria-label="Game navigation">
          <button className="hxTab" onClick={goHome}><Ico n="home"/><b>Home</b></button>
          <button className={`hxTab ${tab==="game"||tab==="postgame"?"active":""}`} onClick={()=>setTab("game")}><Ico n="game"/><b>Game</b></button>
          <button className={`hxTab ${tab==="history"?"active":""}`} onClick={()=>setTab("history")}><Ico n="clock"/><b>History</b></button>
          <button className={`hxTab ${tab==="analysis"?"active":""}`} onClick={()=>setTab("analysis")}><Ico n="gear"/><b>Analysis</b></button>
        </nav>
        <div className={`hxTurn ${active.bot?"bot":"human"}`}><Ico n={active.bot?"bot":"crown"}/><div><strong>{active.bot?`${active.name.toUpperCase()} IS PLAYING`:humanTitle}</strong><span>{active.bot?botSub:`${humanSub}`}</span></div></div>
        <span/>
        <div className="hxTopBtns">
          <div className="hxTopBtn"><button className={`hxRound ${canRoll?"ready":""}`} onClick={rollDice} disabled={!canRoll} title="Roll the dice"><Ico n="dice"/></button><span>Roll Dice</span></div>
          <div className="hxTopBtn"><button className="hxRound" onClick={()=>setRulesOpen(true)} title="How to play"><Ico n="help"/></button><span>Help</span></div>
          <div className="hxTopBtn"><button className="hxRound" onClick={goHome} title="Exit to home"><Ico n="power"/></button><span>Exit</span></div>
        </div>
      </header>

      {integrityErrors.length>0&&<div className="hxIntegrityBanner" role="status"><b>ENGINE INTEGRITY WARNING</b><span>{integrityErrors.slice(0,3).join(" · ")}</span></div>}
      <main className="hxMain">
        <aside className="hxLeft">
          <section className="hxPanel hxPlayers">
            <div className="hxHead"><span>PLAYERS</span><span className="hxInfo" title="Bot memory — Easy: current state · Hard: last 5 turns · Impossible: perfect memory"><Ico n="info"/></span></div>
            <div className="hxPlayerList">
              {players.map(p=>{const pr=piecesRemaining(p);return <article key={p.id} className={`hxPlayer ${p.id===turn&&!winner?"current":""}`} style={{"--pc":p.color}} title={memTip(p)}>
                {p.id===turn&&!winner&&<span className="hxCrown"><Ico n="crown"/></span>}
                <div className="hxPHead"><div className="hxAvatar"><Ico n={p.bot?"bot":"user"}/></div><div className="hxPName"><b>{pName(p)}</b><i className="hxVpBar"><u style={{width:`${Math.min(100,(p.vp/Math.max(targetVP,1))*100)}%`}}/></i></div><strong>{p.vp} VP</strong></div>
                {p.id===me.id?<div className="hxRes">{RES.map(r=><div key={r} title={LABEL[r]}><Ico n={r}/><b>{p.hand[r]||0}</b></div>)}</div>:<div className="hxHiddenRes" title="Opponent resource composition is hidden"><Ico n="card"/><b>{total(p.hand)} CARDS</b><span>RESOURCE TYPES HIDDEN</span></div>}
                <div className="hxStats"><div title="Settlements left to build"><Ico n="house"/><b>{pr.settlements}</b></div><div title="Cities left to build"><Ico n="city"/><b>{pr.cities}</b></div><div title="Roads left to build"><Ico n="road"/><b>{pr.roads}</b></div><div title="Development cards held (types are hidden)"><Ico n="card"/><b>{devCount(p)}</b></div></div>
              </article>})}
            </div>
          </section>
          <section className="hxPanel hxMyRes">
            <div className="hxHead"><span>YOUR RESOURCES</span><em>{total(me.hand)} CARDS</em></div>
            <div className="hxResRow">{RES.map(r=><div key={r} title={LABEL[r]}><Ico n={r}/><b>{me.hand[r]||0}</b></div>)}</div>
          </section>
          <section className="hxPanel hxDevPanel">
            <div className="hxHead"><span>DEVELOPMENT CARDS <small>(PRIVATE)</small></span><span className="hxInfo" title="Only you can see which development cards you hold."><Ico n="info"/></span></div>
            <div className="hxDevRow">{Object.keys(DEV).map(c=><button key={c} title={c} className={me.development[c]?"owned":""} style={{"--dc":DEV_STYLE[c].c}} onClick={()=>setDevOpen(true)}><Ico n={DEV_STYLE[c].ico}/><b>{me.development[c]||0}</b></button>)}</div>{lastPrivateDevDraw&&<div className="hxPrivateDrawNotice">You drew <b>{lastPrivateDevDraw}</b> from the deck. Private to you.</div>}
          </section>
        </aside>

        <section className="hxCenter">
          <div className="hxPanel hxBoardPanel">
            <div className="hxBoardHead"><div><small>LIVE BOARD</small><h2>THE ISLAND</h2></div><div className="hxPills">
              <span className="hxPill">Longest Road <b className={award.roadOwner!=null?"on":""}>{ownerName(award.roadOwner)||"OFF"}</b></span>
              <span className="hxPill">Largest Army <b className={award.armyOwner!=null?"on":""}>{ownerName(award.armyOwner)||"OFF"}</b></span>
              <button className={`hxPill btn ${analysisMode?"lit":""}`} onClick={()=>setAnalysisMode(!analysisMode)} title="Show ranked settlement spots on the board">Spot ranks <b className={analysisMode?"on":""}>{analysisMode?"ON":"OFF"}</b></button>
            </div></div>
            <div className="hxBoardWrap"><Board geo={geo} board={board} players={players} ports={ports} selectedV={selectedV} selectedE={selectedE}
          onTile={tid=>{if(!robberMode)selectPlacementFromTile(tid,"play")}}
          onVertex={v=>{if(winner||drawn||active?.bot||screen!=="playing"||discardState||devChoice?.card||robberMode||roll===null||roll===7)return;
            if(active.settlements?.includes(v)){if(canPay(active.hand,COSTS.city)&&piecesRemaining(active).cities>0){setSelectedV(v);setPlacementConfirm({vertex:v,kind:"city",mode:"play"});}return;}
            if(legalSettlement(v,players,geo)&&settlementConnected(v,active,geo)&&canPay(active.hand,COSTS.settlement)&&piecesRemaining(active).settlements>0){setSelectedV(v);setPlacementConfirm({vertex:v,kind:"settlement",mode:"play"});}}}
          onEdge={eid=>{if(winner||drawn||active?.bot||screen!=="playing"||discardState||robberMode)return;
            if(devChoice?.card==="Road Building"){
              const p=players.find(x=>x.id===active.id);const virtual={...p,roads:[...(p?.roads||[]),...(devChoice.roads||[])]};
              if(p&&piecesRemaining(p).roads>(devChoice.roads?.length||0)&&!devChoice.roads?.includes(eid)&&legalRoad(eid,virtual,players,geo)){
                const nextRoads=[...(devChoice.roads||[]),eid];
                setPlayers(ps=>ps.map(x=>x.id===active.id?{...x,roads:[...x.roads,eid]}:x));
                setSelectedE(eid);setDevChoice(d=>({...d,roads:nextRoads}));extendTurnTimer();appendLog(`${active.name} placed free Road Building road ${eid}.`);
                if(nextRoads.length>=2)requestAnimationFrame(()=>applyDevChoice("Road Building",[],nextRoads,{...devChoice,roads:nextRoads}));
              }
              return;
            }
            if(roll===null||roll===7)return;
            if(canPay(active.hand,COSTS.road)&&piecesRemaining(active).roads>0&&legalRoad(eid,active,players,geo))buildRoad(eid);}}
          analysisMode={analysisMode} boardAnalysis={boardAnalysis} onRobber={moveRobber} robberActive={robberMode} placementConfirm={placementConfirm} placementPlayer={active} onPlacementConfirm={confirmPlacementPreview}/></div>
          </div>
          <div className="hxActions hxActionsNoBuild">
            <div className="hxCol"><button className="hxAct trade" onClick={()=>setQuickPanel("trade")} disabled={tradeBlocked}><Ico n="trade"/><b>Trade</b><small>Bank · Ports · Players</small></button><div className="hxSub"><span>Bank rates</span><div className="hxBank"><Ico n="bank"/><button className="hxRate on" disabled={tradeBlocked} onClick={()=>setQuickPanel("trade")}>4:1</button><button className={`hxRate ${has3?"on":""}`} disabled={tradeBlocked} onClick={()=>setQuickPanel("trade")}>3:1</button><button className={`hxRate ${has2?"on":""}`} disabled={tradeBlocked} onClick={()=>setQuickPanel("trade")}>2:1</button></div></div></div>
            <div className="hxCol"><button className="hxAct buy" onClick={buyDev} disabled={active.bot||!!winner||drawn||!hasRolled||roll===7||robberMode||discardState||!!devChoice||!canPay(active.hand,COSTS.development)||!deck.length}><Ico n="card"/><b>Buy Dev</b><small>Sheep · Wheat · Ore</small></button><div className="hxSub"><span>Deck chance</span><div className="hxDevNote"><i><Ico n="card"/></i><p>{deckStats?.VictoryPoint?`VP ${(deckStats.VictoryPoint.prob*100).toFixed(0)}% · Knight ${(deckStats.Knight?.prob*100).toFixed(0)}%`:`${deck.length} cards left`}</p></div></div></div>
            <div className="hxCol"><button className="hxAct card" onClick={()=>setDevOpen(true)} disabled={active.bot||!!winner||drawn||!Object.keys(DEV).some(c=>(active.development[c]||0)>0)||!!discardState||!!devChoice||(!!devPlayed&&!((active.development?.VictoryPoint||0)>0&&openVictoryPoints(active,players,geo,heldAwards)+(active.development?.VictoryPoint||0)>=targetVP))}><Ico n="card"/><b>Play Card</b><small>{myDev} private card{myDev===1?"":"s"}</small></button><div className="hxSub"><span>Play before roll allowed</span><div className="hxDevNote"><i><Ico n="star"/></i><p>VP reveal can win immediately</p></div></div></div>
            <div className="hxCol"><button className="hxAct robber" onClick={()=>setQuickPanel("robber")} disabled={!robberMode}><Ico n="robber"/><b>Robber</b><small>{robberMode?"Choose a hex":"Inactive"}</small></button><div className="hxSub"><span>Robber state</span><div className="hxDevNote"><i><Ico n="pawn"/></i><p>{robberMode?"Target a hex":"Waiting for a 7 / Knight"}</p></div></div></div>
            <div className="hxCol"><button className="hxAct end" onClick={()=>endTurn(false)} disabled={active.bot||!!winner||drawn||!hasRolled||roll===7||robberMode||!!discardState||!!devChoice||!!tradeOffer}><Ico n="flag"/><b>End Turn</b><small>Finish immediately</small></button><div className="hxSub"><span>Timer</span><div className="hxDevNote"><i><Ico n="hourglass"/></i><p>{active.bot?"BOT ≤5s":`${String(Math.floor(turnSecondsLeft/60)).padStart(2,"0")}:${String(turnSecondsLeft%60).padStart(2,"0")}`}</p></div></div></div>
            <section className="hxPanel hxPieces"><div className="hxHead"><span>Your Pieces</span></div><div className="hxPieceRow"><div><Ico n="house"/><b>{myPieces.settlements}</b><small>Settlements</small></div><div><Ico n="city"/><b>{myPieces.cities}</b><small>Cities</small></div><div><Ico n="road"/><b>{myPieces.roads}</b><small>Roads</small></div><div><Ico n="card"/><b>{myDev}</b><small>Dev Cards</small></div></div></section>
          </div>
        </section>

        <aside className="hxRight">
          <section className="hxPanel hxRoll"><div className="hxRollTitle">ROLL / RESULT</div>
            <div className="hxDiceRow"><span className={`hxDie ${dice?"":"dim"}`}>{dice?dice[0]:"?"}</span><i>+</i><span className={`hxDie ${dice?"":"dim"}`}>{dice?dice[1]:"?"}</span></div>
            <div className="hxRollSum">{dice?`ROLLED ${dsum}`:"READY TO ROLL"}</div>
            <small>{dice?(roll===7?"Robber activated — no resources.":"Resources produced for all players."):active.bot?"The bot rolls automatically.":"Press Roll Dice to begin your turn."}</small></section>
          <section className="hxPanel hxBotRoll"><div className="hxRollTitle">BOT ROLL</div>{lastBotRoll?<><div className="hxBotRollName"><Ico n="bot"/><b>{lastBotRoll.botName} ROLLED</b><span>Turn {lastBotRoll.turn}</span></div><div className="hxDiceRow hxBotDice"><span className="hxDie">{lastBotRoll.dice[0]}</span><i>+</i><span className="hxDie">{lastBotRoll.dice[1]}</span></div><div className="hxRollSum">TOTAL {lastBotRoll.sum}</div></>:<div className="hxBotRollEmpty">No bot roll yet.</div>}</section>
          <section className="hxPanel hxLog"><div className="hxLogHead"><b>TURN LOG</b><select defaultValue="all" aria-label="Log filter"><option value="all">All</option></select></div>
            <div className="hxLogList">{activityTurnGroups.length?activityTurnGroups.map(group=><section className="hxLogTurnGroup" key={group.turn}><header className="hxLogTurnHeader"><b>TURN {group.turn}</b><span>{group.entries.length} events</span></header>{group.entries.map((x,i)=>{const kind=activityKind(x.text),actor=kind==="bot"?botNames.find(n=>String(x.text).includes(n)):null;return <div key={x.id||i} className={`hxLogRow ${kind}`}><span className="hxLogIco"><Ico n={kind==="bot"?"bot":logIcon(x.text)}/></span><p><span>{x.text}</span>{actor&&<em>BOT · {actor}</em>}</p></div>})}</section>):<div className="hxLogEmpty">No recent activity.</div>}</div></section>
          <button className="hxPanel hxLink" onClick={()=>setTab("analysis")}><Ico n="chart"/><div><b>Game Analysis</b><small>Review completed games and run the Catan Engine</small></div><Ico n="chevron"/></button>
          <section className="hxPanel hxStatus"><Ico n="hourglass"/><div><b>Game Status</b><span>Turn {turnNumber} · first to {targetVP} VP</span><i className="hxBar"><u style={{width:`${Math.min(100,(leaderVP/Math.max(targetVP,1))*100)}%`}}/></i></div></section>
          <section className="hxPanel hxMap"><div className="hxHead"><span className="hxMapT"><Ico n="gear"/>Map Settings</span><span className="hxInfo" title="Map rules are chosen when the match is set up."><Ico n="info"/></span></div>
            <div className="hxSet"><Ico n="dice"/><span>6 &amp; 8 cannot touch</span><i className={`hxSw ${mapSettings.highPipsTouch?"":"on"}`}><u/></i></div>
            <div className="hxSet"><Ico n="wood"/><span>Same resources can touch</span><i className="hxSw"><u/></i></div>
            <div className="hxSet"><Ico n="bank"/><span>4:1 Bank Trade Allowed</span><i className="hxSw on green"><u/></i></div></section>
        </aside>

        <div className="hxChipWrap">{active.bot?<BotChip key={`${turn}-${turnNumber}`} name={pName(active)} status={botTurnStatus}/>:<div className="hxChip"><Ico n="crown"/><span>{hint}</span></div>}</div>
      </main>
      {analysis_block}
      {history_block}
      {post_block}
      {rulesOpen&&<div className="refOverlay"><div className="refOverlayCard hxHelpCard"><button className="refClose" onClick={()=>setRulesOpen(false)}>×</button>
        <div className="refOverlayHead"><div><span className="eyebrow">QUICK REFERENCE</span><h2>HOW TO PLAY</h2><p>Roll, collect, build and trade. First to {targetVP} victory points wins.</p></div></div>
        <div className="hxHelpGrid">{[["road","Road","road"],["house","Settlement","settlement"],["city","City","city"],["card","Development card","development"]].map(([ic,nm,k])=><div key={k}><span><Ico n={ic}/><b>{nm}</b></span><p>{Object.entries(COSTS[k]).map(([r,n])=>`${n} ${LABEL[r]}`).join(" · ")}</p></div>)}</div>
        <div className="hxHelpNote"><b>Bank trading:</b> 4:1 by default · 3:1 with a generic port · 2:1 with a matching resource port. <b>Rolling a 7:</b> players with more than {isPVBot?9:7} cards discard half, then the roller moves the robber.</div>
        <button className="refPrimaryButton" onClick={()=>setRulesOpen(false)}>GOT IT</button></div></div>}
      {devRoadDock}
      {modal_body}
    </div>;
  }
}


const TERRAIN={
  wood:{a:"#86e04c",b:"#2a9a3a",n:9,syms:["pine","pine","tree"]},
  brick:{a:"#ffa040",b:"#d6431f",n:7,syms:["mesa","mesa","bricks"]},
  sheep:{a:"#d9f85e",b:"#84d02a",n:6,syms:["sheep","sheep","bush"]},
  wheat:{a:"#ffe46a",b:"#f0a11e",n:9,syms:["wheat"]},
  ore:{a:"#bcc8e0",b:"#62749a",n:6,syms:["peak","peak","rock"]},
  desert:{a:"#f9e2aa",b:"#dcae62",n:5,syms:["dune","cactus","rock2"]}
};
const hxRnd=(i,k)=>{const x=Math.sin(i*127.1+k*311.7)*43758.5453;return x-Math.floor(x)};
function tileArt(t,res){
  const T=TERRAIN[res]||TERRAIN.desert,out=[];
  for(let k=0;k<T.n;k++){
    const ang=(k/T.n)*Math.PI*2+hxRnd(t.id,k)*.7,rad=32+hxRnd(t.id,k+50)*15;
    out.push({sym:T.syms[k%T.syms.length],x:t.cx+Math.cos(ang)*rad,y:t.cy+Math.sin(ang)*rad*.92,s:.85+hxRnd(t.id,k+90)*.4});
  }
  return out.sort((p,q)=>p.y-q.y);
}
function BoardDefs(){
  return <defs>
    {Object.entries(TERRAIN).map(([k,T])=><radialGradient key={k} id={`hxg-${k}`} cx="50%" cy="42%" r="78%"><stop offset="0%" stopColor={T.a}/><stop offset="100%" stopColor={T.b}/></radialGradient>)}
    <radialGradient id="hxTok" cx="40%" cy="35%" r="80%"><stop offset="0%" stopColor="#fffdf3"/><stop offset="100%" stopColor="#f3dfaa"/></radialGradient>
    <radialGradient id="hxPortG" cx="40%" cy="30%" r="85%"><stop offset="0%" stopColor="#2b4fbf"/><stop offset="100%" stopColor="#0a1a63"/></radialGradient>
    <filter id="hxShoreBlur" filterUnits="userSpaceOnUse" x="-470" y="-360" width="940" height="720"><feGaussianBlur stdDeviation="9"/></filter>
    <filter id="hxGlow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <g id="hx-pine"><ellipse cy="9.5" rx="7" ry="2.2" fill="#000" opacity=".22"/><rect x="-1.5" y="5" width="3" height="5" fill="#5b3a1a"/><polygon points="0,-6 9,7 -9,7" fill="#0d6a2d"/><polygon points="0,-13 7,-1 -7,-1" fill="#0f7a35"/><polygon points="0,-13 0,-1 -7,-1" fill="#33d060" opacity=".55"/><polygon points="0,-6 0,7 -9,7" fill="#2fbf58" opacity=".35"/></g>
    <g id="hx-tree"><ellipse cy="9.5" rx="7" ry="2.2" fill="#000" opacity=".22"/><rect x="-1.5" y="3" width="3" height="7" fill="#5b3a1a"/><circle cy="-2" r="8" fill="#0e7a34"/><circle cx="-2.4" cy="-4.5" r="4.2" fill="#48e078" opacity=".65"/></g>
    <g id="hx-mesa"><ellipse cy="9" rx="10" ry="2.2" fill="#000" opacity=".2"/><path d="M-10 8 -8 -1Q-7 -5 -3 -5H4Q8 -5 9 -1L11 8z" fill="#bd3319"/><path d="M-8 -1Q-7 -5 -3 -5H4Q8 -5 9 -1z" fill="#ff9450"/><path d="M-9 3h19" stroke="#8f230f" strokeWidth="1.2" opacity=".55"/></g>
    <g id="hx-bricks"><ellipse cy="8.5" rx="10" ry="2.2" fill="#000" opacity=".2"/><rect x="-9" y="1" width="9" height="6" rx="1" fill="#c93a1c"/><rect x="0" y="1" width="9" height="6" rx="1" fill="#d94a25"/><rect x="-4.5" y="-5" width="9" height="6" rx="1" fill="#e85a2c"/><path d="M-9 2h9M0 2h9M-4.5 -4h9" stroke="#ffb18e" strokeWidth="1" opacity=".7"/></g>
    <g id="hx-sheep"><ellipse cy="8.5" rx="9" ry="2" fill="#000" opacity=".2"/><rect x="-5" y="4" width="1.8" height="4.5" rx=".9" fill="#2b2f3a"/><rect x="2.5" y="4" width="1.8" height="4.5" rx=".9" fill="#2b2f3a"/><circle cx="-3.5" cy="0" r="4.2" fill="#fff"/><circle cx="1" cy="-2" r="4.4" fill="#fff"/><circle cx="3" cy="1.4" r="4.2" fill="#f0f4ff"/><circle cx="-1" cy="2" r="4" fill="#f7f9ff"/><ellipse cx="7.6" cy="0" rx="2.4" ry="2.8" fill="#2b2f3a"/></g>
    <g id="hx-bush"><ellipse cy="6.5" rx="8" ry="2" fill="#000" opacity=".2"/><circle cx="-3" cy="2" r="5" fill="#3d9e2a"/><circle cx="3.4" cy="1" r="5.4" fill="#4cb534"/><circle cx="-1" cy="-2" r="4.4" fill="#7ee04a"/></g>
    <g id="hx-wheat"><path d="M0 9V-6" stroke="#b8791a" strokeWidth="1.4" strokeLinecap="round"/><g fill="#ffd23c" stroke="#d98d14" strokeWidth=".5"><ellipse cy="-8" rx="2" ry="3.2"/><ellipse cx="-3.4" cy="-4" rx="1.9" ry="3" transform="rotate(-35 -3.4 -4)"/><ellipse cx="3.4" cy="-4" rx="1.9" ry="3" transform="rotate(35 3.4 -4)"/><ellipse cx="-3.4" cy="1" rx="1.9" ry="3" transform="rotate(-35 -3.4 1)"/><ellipse cx="3.4" cy="1" rx="1.9" ry="3" transform="rotate(35 3.4 1)"/></g></g>
    <g id="hx-peak"><ellipse cy="9" rx="12" ry="2.2" fill="#000" opacity=".22"/><polygon points="-12,9 -3,-11 2,-4 6,-8 13,9" fill="#566689"/><polygon points="-12,9 -3,-11 -3,9" fill="#7d8fb6"/><polygon points="-3,-11 -7.5,-3 -4.5,-4.6 -2.5,-1 0,-4.6 2,-4" fill="#fff"/><polygon points="6,-8 3.5,-3.4 5.5,-4.4 7,-2 8.6,-4.4" fill="#fff" opacity=".9"/></g>
    <g id="hx-rock"><ellipse cy="6" rx="7" ry="1.8" fill="#000" opacity=".2"/><polygon points="-6,6 -4,-2 2,-4 7,1 6,6" fill="#6b7a9c"/><polygon points="-4,-2 2,-4 0,1" fill="#a9b7d4"/></g>
    <g id="hx-dune"><path d="M-11 6Q-4 -5 3 3Q7 -1 12 6z" fill="#e8bf6c"/><path d="M-11 6Q-4 -5 3 3" fill="none" stroke="#fff3cf" strokeWidth="1.2"/></g>
    <g id="hx-cactus"><ellipse cy="9" rx="5" ry="1.6" fill="#000" opacity=".2"/><rect x="-2" y="-8" width="4" height="17" rx="2" fill="#2f9e3f"/><path d="M-2 1H-5V-4M2 -1H5V-6" fill="none" stroke="#2f9e3f" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></g>
    <g id="hx-rock2"><polygon points="-6,5 -4,-1 2,-2 6,3 5,5" fill="#c69a55"/><polygon points="-4,-1 2,-2 0,2" fill="#f0d192"/></g>
  </defs>;
}

function Board({geo,board,players,ports,selectedV,selectedE,onVertex,onEdge,onTile,onInspectVertex,onInspectEdge,analysisMode,boardAnalysis=[],onRobber,robberActive,placementMode=null,placementPlayer=null,showPlacementScores=false,placementConfirm=null,onPlacementConfirm}){
  const safeBoard=asArray(board);
  const safePlayers=asArray(players);
  const safePorts=asArray(ports);
  const safeAnalysis=asArray(boardAnalysis);
  const rank=new Map(safeAnalysis.map((x,i)=>[x.v,i+1]));
  const placementCandidates = showPlacementScores && placementPlayer
    ? geo.vertices.map((_,i)=>i)
      .filter(v=>legalSettlement(v,safePlayers,geo))
      .map(v=>({v,info:placementInsight(v,safeBoard,geo,placementPlayer,safePlayers,safePorts,placementMode==="setup")}))
      .sort((a,b)=>b.info.score-a.info.score)
      .slice(0,12)
    : [];
  const placementRanks=new Map(placementCandidates.map((x,i)=>[x.v,{...x,rank:i+1}]));
  const buildVertexTargets=new Set();
  const buildEdgeTargets=new Set();
  if(placementPlayer&&placementMode==="settlement"){geo.vertices.forEach((_,i)=>{if(legalSettlement(i,safePlayers,geo)&&settlementConnected(i,placementPlayer,geo)&&canPay(placementPlayer.hand,COSTS.settlement)&&piecesRemaining(placementPlayer).settlements>0)buildVertexTargets.add(i);});}
  if(placementPlayer&&placementMode==="city"&&canPay(placementPlayer.hand,COSTS.city)&&piecesRemaining(placementPlayer).cities>0){(placementPlayer.settlements||[]).forEach(v=>buildVertexTargets.add(v));}
  if(placementPlayer&&placementMode==="road"){geo.edges.forEach(e=>{if(legalRoad(e.id,placementPlayer,safePlayers,geo)&&canPay(placementPlayer.hand,COSTS.road)&&piecesRemaining(placementPlayer).roads>0)buildEdgeTargets.add(e.id);});}
  if(placementPlayer&&placementMode==="setup"){geo.vertices.forEach((_,i)=>{if(legalSettlement(i,safePlayers,geo))buildVertexTargets.add(i);});if(selectedV!=null){geo.edges.forEach(e=>{if(legalInitialRoad(e.id,selectedV,safePlayers,geo))buildEdgeTargets.add(e.id);});}}
  return <div className="boardStage">{showPlacementScores&&placementCandidates.length>0&&<div className="placementScoreLegend"><b>PLACEMENT SCORING</b><span>PTS = production + diversity</span><small>Higher PPA = more expected production per roll</small></div>}<svg viewBox="-330 -310 660 620" className="hexboard"><defs><radialGradient id="hexOcean" cx="50%" cy="48%" r="62%"><stop offset="0%" stopColor="#0a7bba"/><stop offset="48%" stopColor="#043f79"/><stop offset="100%" stopColor="#02091c"/></radialGradient><filter id="hexGlow"><feGaussianBlur stdDeviation="5"/></filter></defs><rect x="-330" y="-310" width="660" height="620" rx="48" fill="url(#hexOcean)"/><circle cx="0" cy="0" r="285" fill="none" stroke="#00f6ff" strokeOpacity=".2" strokeWidth="8" filter="url(#hexGlow)"/><circle cx="0" cy="0" r="274" fill="none" stroke="#247bff" strokeOpacity=".35" strokeWidth="3"/>
    {geo.tiles.map((t,i)=>{const tile=safeBoard[i]||{resource:"desert",number:null,robber:false},d=t.vertices.map(v=>`${geo.vertices[v].x},${geo.vertices[v].y}`).join(" ");return <g key={i} onClick={()=>{if(robberActive)onRobber?.(i);else onTile?.(i)}}><polygon points={d} fill={COLORS[tile.resource]||COLORS.desert} className={`hexTile ${tile.robber?"robberTile":""}`}/><text x={t.cx} y={t.cy-7} className="resIcon">{ICON[tile.resource]||ICON.desert}</text>{tile.number&&<><circle cx={t.cx} cy={t.cy+22} r="19" className={tile.number===6||tile.number===8?"token hot":"token"}/><text x={t.cx} y={t.cy+28} className="tokenText">{tile.number}</text></>}{tile.robber&&<text x={t.cx} y={t.cy-28} className="robber">♟</text>}</g>})}
    {safePorts.map(port=>{const a=geo.vertices[port.a],b=geo.vertices[port.b],mx=(a.x+b.x)/2,my=(a.y+b.y)/2;return <g key={`port-${port.edge}`} className="portEdgeBadge"><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="portLine"/><rect x={mx-19} y={my-10} width="38" height="20" rx="5"/><text x={mx} y={my+3.5}>{port.type}</text></g>})}
    {analysisMode&&geo.vertices.map((v,i)=>rank.has(i)?<g key={`a${i}`} className="analysisPin"><circle cx={v.x} cy={v.y} r="13"/><text x={v.x} y={v.y+5}>{rank.get(i)}</text></g>:null)}
    {geo.edges.map(e=>{const a=geo.vertices[e.a],b=geo.vertices[e.b],owner=safePlayers.find(p=>Array.isArray(p?.roads)&&p.roads.includes(e.id));return <g key={e.id} className={`roadGroup ${buildEdgeTargets.has(e.id)?"buildEdgeTargetGroup":""}`}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="roadHit" onClick={ev=>{ev.stopPropagation();onEdge?.(e.id)}}/>{buildEdgeTargets.has(e.id)&&<line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="roadBuildHint" pointerEvents="none"/>}<line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={`road ${selectedE===e.id?"edgeSelected":""}`} stroke={owner?.color||"rgba(42,31,22,.22)"} pointerEvents="none"/></g>})}
    {placementConfirm?.vertex!=null&&placementConfirm?.kind&&(()=>{const v=geo.vertices[placementConfirm.vertex];if(!v)return null;const isCity=placementConfirm.kind==="city";return <g className="placementConfirmGhost" transform={"translate("+v.x+" "+(v.y-30)+")"} onClick={e=>{e.stopPropagation();onPlacementConfirm?.()}} role="button" aria-label={"Confirm "+(isCity?"city":"settlement")+" placement"}><circle r="24" className="placementConfirmHalo"/><g className={isCity?"cityPiece3d":"settlementPiece3d"} style={{"--piece":placementPlayer?.color||"#00f6ff"}}>{isCity?<><ellipse cx="0" cy="13" rx="17" ry="5" className="pieceShadow"/><rect x="-15" y="-8" width="30" height="21" rx="2" className="cityBody"/><polygon points="-15,-8 -9,-16 0,-11 9,-16 15,-8" className="cityRoof"/><rect x="-14" y="-15" width="7" height="20" rx="1.5" className="cityTower"/><polygon points="-15,-15 -10,-21 -5,-15" className="cityTowerRoof"/><rect x="7" y="-15" width="7" height="20" rx="1.5" className="cityTower"/><polygon points="5,-15 10,-21 15,-15" className="cityTowerRoof"/><rect x="-3" y="-1" width="6" height="14" rx="1" className="cityDoor"/></>:<><ellipse cx="0" cy="11" rx="12" ry="4" className="pieceShadow"/><path d="M-10 -1 L-10 11 L10 11 L10 -1 Z" className="houseBody"/><polygon points="-12,0 0,-11 12,0 9,3 0,-5 -9,3" className="houseRoof"/><rect x="-3" y="3" width="6" height="8" rx="1" className="houseDoor"/></>}</g><text x="0" y="35" className="placementConfirmLabel">CLICK TO CONFIRM</text></g>})()}
    {geo.vertices.map((v,i)=>{const p=safePlayers.find(p=>Array.isArray(p?.settlements)&&Array.isArray(p?.cities)&&(p.settlements.includes(i)||p.cities.includes(i)));return <g key={i} className={`intersection ${buildVertexTargets.has(i)?"buildTargetGroup":""}`} onClick={e=>{e.stopPropagation();if(onInspectVertex)onInspectVertex(i);else onVertex?.(i)}}>{p?(p.cities.includes(i)?<g className="cityPiece3d" transform={`translate(${v.x} ${v.y})`} style={{"--piece":p.color}} aria-label={`${p.name} city`}><ellipse cx="0" cy="13" rx="17" ry="5" className="pieceShadow"/><rect x="-15" y="-8" width="30" height="21" rx="2" className="cityBody"/><polygon points="-15,-8 -9,-16 0,-11 9,-16 15,-8" className="cityRoof"/><rect x="-14" y="-15" width="7" height="20" rx="1.5" className="cityTower"/><polygon points="-15,-15 -10,-21 -5,-15" className="cityTowerRoof"/><rect x="7" y="-15" width="7" height="20" rx="1.5" className="cityTower"/><polygon points="5,-15 10,-21 15,-15" className="cityTowerRoof"/><rect x="-3" y="-1" width="6" height="14" rx="1" className="cityDoor"/><rect x="-12" y="-5" width="4" height="5" rx=".7" className="cityWindow"/><rect x="8" y="-5" width="4" height="5" rx=".7" className="cityWindow"/><path d="M-15 13 L15 13 L12 17 L-12 17 Z" className="cityBase"/></g>:<g className="settlementPiece3d" transform={`translate(${v.x} ${v.y})`} style={{"--piece":p.color}} aria-label={`${p.name} settlement`}><ellipse cx="0" cy="11" rx="12" ry="4" className="pieceShadow"/><path d="M-10 -1 L-10 11 L10 11 L10 -1 Z" className="houseBody"/><polygon points="-12,0 0,-11 12,0 9,3 0,-5 -9,3" className="houseRoof"/><polygon points="-10,0 -5,-4 -5,11 -10,11" className="houseSide"/><rect x="-3" y="3" width="6" height="8" rx="1" className="houseDoor"/><rect x="4" y="1" width="4" height="4" rx=".6" className="houseWindow"/><path d="M-10 11 L10 11 L8 14 L-8 14 Z" className="houseBase"/></g>):<circle cx={v.x} cy={v.y} r={selectedV===i?"8":"4.5"} className={`${selectedV===i?"emptyVertex selectedVertex":"emptyVertex"} ${buildVertexTargets.has(i)?"buildTarget":""}`}/>}
      {analysisMode&&rank.has(i)&&<text x={v.x} y={v.y-17} className="portRank">{rank.get(i)}</text>}
      {placementRanks.has(i)&&(()=>{const item=placementRanks.get(i),info=item.info;return <g className={`placementBadge ${item.rank===1?"top":""}`} transform={`translate(${v.x} ${v.y})`} pointerEvents="none"><circle r="12" className="placementHalo"/><rect x="-38" y="-43" width="76" height="30" rx="7" className="placementBadgeBox"/><text x="-32" y="-33" className="placementRank">#{item.rank} · {info.score} PTS</text><text x="-32" y="-24" className="placementCombo">{info.label}</text><text x="-32" y="-15" className="placementPpa">{info.pips.toFixed(0)} PIPS · {info.expected.toFixed(2)} PPA</text></g>})()}
    </g>})}
  </svg></div>
}

class AppErrorBoundary extends React.Component{constructor(props){super(props);this.state={error:null}}static getDerivedStateFromError(error){return{error}}componentDidCatch(error,info){console.error("Monopoly render error",error,info)}resetLocalState=()=>{try{Object.keys(localStorage).filter(k=>k.startsWith("hexbound.")).forEach(k=>localStorage.removeItem(k))}catch{}location.reload()};render(){if(this.state.error)return <div style={{minHeight:"100vh",padding:"40px",background:"#120e0b",color:"#f5ead6",fontFamily:"system-ui"}}><h1>Monopoly could not render</h1><p style={{opacity:.8}}>A runtime guard caught an invalid game value. Resetting local Monopoly data will clear saved game history in this browser.</p><pre style={{whiteSpace:"pre-wrap",background:"#211812",padding:"16px",borderRadius:"8px",overflow:"auto"}}>{String(this.state.error?.stack||this.state.error)}</pre><div style={{display:"flex",gap:"10px",marginTop:"16px"}}><button onClick={()=>location.reload()}>Reload Catan</button><button onClick={this.resetLocalState}>Reset Local Data</button></div></div>;return this.props.children}}
createRoot(document.getElementById("root")).render(<AppErrorBoundary><App/></AppErrorBoundary>);