
const RES=["wood","brick","sheep","wheat","ore"];
const LABEL={wood:"Wood",brick:"Brick",sheep:"Sheep",wheat:"Wheat",ore:"Ore"};
const ICON={wood:"🌲",brick:"🧱",sheep:"🐑",wheat:"🌾",ore:"⛰️",desert:"🏜️"};
const COLORS={wood:"#5d8d50",brick:"#b9664e",sheep:"#a9c875",wheat:"#d4b35d",ore:"#7f8b92",desert:"#bda77d"};
const COSTS={road:{wood:1,brick:1},settlement:{wood:1,brick:1,sheep:1,wheat:1},city:{wheat:2,ore:3},development:{sheep:1,wheat:1,ore:1}};
const PIECES={settlements:5,cities:4,roads:15};
const COLONIST_BASE_RULES={
  standard:{targetVP:10,discardIfHandOver:7,initialSettlements:2,initialRoads:2,longestRoadMin:5,largestArmyMin:3,playerTrading:true,friendlyRobber:false,balancedDice:false},
  ranked1v1:{targetVP:15,discardIfHandOver:9,initialSettlements:2,initialRoads:2,longestRoadMin:5,largestArmyMin:3,playerTrading:false,friendlyRobber:true,balancedDice:true}
};
function colonistRules(playerCount=4){return playerCount===2?COLONIST_BASE_RULES.ranked1v1:COLONIST_BASE_RULES.standard;}
function friendlyRobberProtectedCore(victim,players,geo,heldAwards={roadOwner:null,armyOwner:null}){
  if(players.length!==2)return false;
  const a=awards(players,geo,heldAwards);
  const open=(victim?.vp||0)+(a.roadOwner===victim?.id?2:0)+(a.armyOwner===victim?.id?2:0);
  return open<=2;
}
function publicCardCount(p){return Number.isFinite(p?.publicCardCount)?p.publicCardCount:total(p?.hand);}
function publicVictoryPoints(p){return p?.vp||0;}
function canPlayDevelopmentCard(card,p,turnState={}){
  if(!p?.development?.[card]||turnState.devPlayed)return false;
  const boughtThisTurn=turnState.boughtCards?.[card]||0;
  return (p.development[card]-boughtThisTurn)>0;
}
function canBuyDevelopmentCard(p,deck,turnState={}){return Array.isArray(deck)&&deck.length>0&&canPay(p?.hand||empty(),COSTS.development);}

function piecesRemaining(p){return{settlements:Math.max(0,PIECES.settlements-(p?.settlements?.length||0)),cities:Math.max(0,PIECES.cities-(p?.cities?.length||0)),roads:Math.max(0,PIECES.roads-(p?.roads?.length||0))};}
const PROB={2:1,3:2,4:3,5:4,6:5,8:5,9:4,10:3,11:2,12:1};
const DEV={Knight:14,"Road Building":2,"Year of Plenty":2,Monopoly:2,"Victory Point":5};
const DEV_ICON={Knight:"⚔", "Road Building":"🛣️", "Year of Plenty":"🌾", Monopoly:"✦", "Victory Point":"★"};
const PLAYER_COLORS=["#e0a84e","#62a8e7","#d56b6b","#8f79d6"];
const HISTORY_KEY="hexbound.gameHistory.v26";
const LEGACY_HISTORY_KEYS=["hexbound.gameHistory.v23","hexbound.gameHistory.v22","hexbound.gameHistory.v21","hexbound.gameHistory.v20","hexbound.gameHistory.v19","hexbound.gameHistory.v18","hexbound.gameHistory.v17","hexbound.gameHistory.v16","hexbound.gameHistory.v15","hexbound.gameHistory.v14","hexbound.gameHistory.v13","hexbound.gameHistory.v12","hexbound.gameHistory.v9"];
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
function connectedRoadLength(p,geo,players){
  const owned=new Set(p.roads||[]);if(!owned.size)return 0;const blocked=new Set();players.forEach(o=>{if(o.id!==p.id){o.settlements.forEach(v=>blocked.add(v));o.cities.forEach(v=>blocked.add(v));}});
  const adj=new Map();owned.forEach(eid=>{const e=geo.edges[eid];if(!adj.has(e.a))adj.set(e.a,[]);if(!adj.has(e.b))adj.set(e.b,[]);adj.get(e.a).push(eid);adj.get(e.b).push(eid)});
  let best=0;function dfs(v,used,len){best=Math.max(best,len);if(blocked.has(v)&&len>0)return;for(const eid of adj.get(v)||[]){if(used.has(eid))continue;const e=geo.edges[eid],next=e.a===v?e.b:e.a;const u=new Set(used);u.add(eid);dfs(next,u,len+1)}}adj.forEach((_,v)=>dfs(v,new Set(),0));return best;
}
function awards(players,geo,held={roadOwner:null,armyOwner:null}){
  const roads=players.map(p=>connectedRoadLength(p,geo,players)),armies=players.map(p=>p.development.playedKnights||0);
  const rm=Math.max(0,...roads),am=Math.max(0,...armies),roadLeaders=players.filter(p=>roads[p.id]===rm),armyLeaders=players.filter(p=>armies[p.id]===am);
  const roadOwner=rm>=5?(roadLeaders.length===1?roadLeaders[0].id:(held.roadOwner!=null&&roadLeaders.some(p=>p.id===held.roadOwner)?held.roadOwner:null)):null;
  const armyOwner=am>=3?(armyLeaders.length===1?armyLeaders[0].id:(held.armyOwner!=null&&armyLeaders.some(p=>p.id===held.armyOwner)?held.armyOwner:null)):null;
  return{roads,armies,roadOwner,armyOwner};
}
function legalSettlement(v,players,geo){if(v==null||!geo.vertices[v])return false;return !players.some(p=>p.settlements.includes(v)||p.cities.includes(v))&&!geo.neighbors[v].some(n=>players.some(p=>p.settlements.includes(n)||p.cities.includes(n)));}
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
    if(totalDemand<=nextBank[r]) demand.forEach((g,i)=>{grants[i][r]=g[r]});
    const paid=grants.reduce((n,g)=>n+g[r],0);nextBank[r]-=paid;
  });
  return {players:players.map((p,i)=>({...p,hand:add(p.hand,grants[i])})),bank:nextBank,demand,grants};
}
function resolveDiceRoll(players,board,geo,sum,bank){if(sum===7)return{players,bank,grants:players.map(()=>empty()),demand:players.map(()=>empty()),seven:true};return{...productionForRoll(players,board,geo,sum,bank),seven:false};}
function cardProbabilities(deck){const counts=Object.fromEntries(Object.keys(DEV).map(c=>[c,0]));deck.forEach(c=>counts[c]++);const remaining=deck.length;return Object.fromEntries(Object.keys(DEV).map(c=>{const count=counts[c],prob=remaining?count/remaining:0,draws=Math.min(3,remaining);let miss=1;for(let i=0;i<draws;i++)miss*=Math.max(0,remaining-count-i)/Math.max(1,remaining-i);return[c,{count,prob,within3:1-miss}]}));}
const BOT_DIFFICULTY_CONFIG={
  Easy:{key:"Easy",candidateScale:.58,lookaheadTop:2,responseWeight:.045,noise:.18,openingBudgetMultiplier:.55,futureCandidates:6},
  Medium:{key:"Medium",candidateScale:.78,lookaheadTop:3,responseWeight:.075,noise:.085,openingBudgetMultiplier:.78,futureCandidates:8},
  Hard:{key:"Hard",candidateScale:1,lookaheadTop:4,responseWeight:.12,noise:.025,openingBudgetMultiplier:1,futureCandidates:12},
  Impossible:{key:"Impossible",candidateScale:1.28,lookaheadTop:6,responseWeight:.18,noise:0,openingBudgetMultiplier:1.2,futureCandidates:16}
};
function botDifficultyProfile(diff){return BOT_DIFFICULTY_CONFIG[diff]||BOT_DIFFICULTY_CONFIG.Medium;}
const BOT_ENGINE_VERSION="v30-difficulty-calibrated-invariant-guard";
const BOT_MODE_CONFIGS={
  standard4p10:{
    key:"standard4p10",targetVP:10,leaderMultiplier:1.5,gameLengthFactor:1.0,beta:0.25,bankScarcity:1,
    phases:[
      {maxVP:3,wP:.35,wC:.20,wT:.15,wE:.20,wY:.10,riskWeight:.5,denialWeight:0},
      {maxVP:6,wP:.28,wC:.12,wT:.25,wE:.20,wY:.15,riskWeight:.6,denialWeight:0},
      {maxVP:9,wP:.18,wC:.05,wT:.20,wE:.10,wY:.07,riskWeight:.8,denialWeight:.35}
    ]
  },
  pvbot1v115:{
    key:"pvbot1v115",targetVP:15,leaderMultiplier:2.5,gameLengthFactor:.6,beta:.40,bankScarcity:1.3,
    phases:[
      {maxVP:5,wP:.40,wC:.20,wT:.20,wE:.15,wY:.05,riskWeight:.3,denialWeight:0},
      {maxVP:10,wP:.28,wC:.08,wT:.32,wE:.22,wY:.10,riskWeight:.4,denialWeight:0},
      {maxVP:14,wP:.18,wC:.03,wT:.22,wE:.07,wY:.05,riskWeight:.6,denialWeight:.40}
    ]
  }
};
function botModeConfig(players,targetVP){return players.length===2?BOT_MODE_CONFIGS.pvbot1v115:BOT_MODE_CONFIGS.standard4p10;}
function clamp(n,a,b){return Math.max(a,Math.min(b,n));}
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
  bonus+=RES.reduce((sum,r)=>sum+c[r],0)*6;
  return bonus;
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
function tileVerts(geo,tid){return geo?.tiles?.[tid]?.vertices||[];}
function botPipValue(number){return PROB[number]||0;}
function Production(r,hexes){return (hexes||[]).reduce((sum,t)=>sum+(t?.resource===r&&!t?.robber?botPipValue(t.number)/36:0),0);}
function spotProduction(v,board,geo){
  const out=empty();for(const tid of geo.vertexTiles[v]||[]){const t=board[tid];if(!t||t.resource==="desert"||t.robber)continue;out[t.resource]+=botPipValue(t.number)/36;}return out;
}
function botProduction(p,board,geo){
  const out=empty();const addV=(v,m)=>{for(const tid of geo.vertexTiles[v]||[]){const t=board[tid];if(!t||t.resource==="desert"||t.robber)continue;out[t.resource]+=botPipValue(t.number)/36*m;}};
  (p?.settlements||[]).forEach(v=>addV(v,1));(p?.cities||[]).forEach(v=>addV(v,2));return out;
}
function boardPipProfile(board){
  const totalPips=empty();board.forEach(t=>{if(t.resource!=="desert")totalPips[t.resource]+=botPipValue(t.number)/36;});return totalPips;
}
function aggregateProduction(players,board,geo){const out=empty();players.forEach(p=>{const prod=botProduction(p,board,geo);RES.forEach(r=>out[r]+=prod[r]);});return out;}
function BoardScarcity(r,board,players,geo,modeCfg){
  const totalBoard=boardPipProfile(board)[r]||0;const claimed=aggregateProduction(players,board,geo)[r]||0;const remaining=Math.max(0,totalBoard-claimed);return clamp(1+(1-remaining/Math.max(totalBoard,.0001)),.5,2);
}
function PersonalScarcity(r,production){const avg=Object.values(production).reduce((a,b)=>a+b,0)/RES.length;return clamp(2-(production[r]||0)/Math.max(avg,.0001),.5,2);}
function BankAvailability(r,bank){return clamp((bank?.[r]||0)/19,.3,1);}
function RelativeGap(r,p,players,board,geo){
  const self=botProduction(p,board,geo),selfTotal=Object.values(self).reduce((a,b)=>a+b,0);
  const opponents=players.filter(o=>o.id!==p.id);if(!opponents.length)return 0;
  const selfShare=(self[r]||0)/Math.max(selfTotal,.0001);
  const gaps=opponents.map(o=>{const prod=botProduction(o,board,geo),oppTotal=Object.values(prod).reduce((a,b)=>a+b,0);return selfShare-(prod[r]||0)/Math.max(oppTotal,.0001);});
  return players.length===2?gaps[0]:(gaps.reduce((a,b)=>a+b,0)/gaps.length);
}
function targetReadiness(p,cost){const totalCost=Object.values(cost).reduce((a,b)=>a+b,0);const deficit=Object.entries(cost).reduce((a,[r,n])=>a+Math.max(0,n-(p.hand?.[r]||0)),0);return 1-deficit/Math.max(totalCost,1);}
function BuildingDemand(p,modeCfg=null){
  const is1v1=modeCfg?.key==="pvbot1v115";
  const vp=p?.vp||0;
  const citiesOk=!!(p?.settlements||[]).length&&piecesRemaining(p).cities>0;
  const settleOk=piecesRemaining(p).settlements>0;
  let settleBase,cityBase,devBase;
  if(is1v1){
    if(vp<=5){settleBase=.22;cityBase=.48;devBase=.30;}
    else if(vp<=10){settleBase=.16;cityBase=.50;devBase=.34;}
    else {settleBase=.18;cityBase=.32;devBase=.50;}
  }else{
    if(vp<=3){settleBase=.46;cityBase=.24;devBase=.30;}
    else if(vp<=6){settleBase=.30;cityBase=.40;devBase=.30;}
    else {settleBase=.22;cityBase=.36;devBase=.42;}
  }
  if(!citiesOk)cityBase=0;
  if(!settleOk)settleBase*=.12;
  const prod=null;
  const targets=[
    {name:"Settlement",cost:COSTS.settlement,base:settleBase,ready:targetReadiness(p,COSTS.settlement)},
    {name:"City",cost:COSTS.city,base:cityBase,ready:citiesOk?targetReadiness(p,COSTS.city):0},
    {name:"Dev card",cost:COSTS.development,base:devBase,ready:targetReadiness(p,COSTS.development)}
  ];
  targets.forEach(t=>{t.weight=t.base*(.55+.9*clamp(t.ready,0,1));});
  const sum=targets.reduce((a,t)=>a+t.weight,0)||1;const demand=empty();targets.forEach(t=>Object.entries(t.cost).forEach(([r,n])=>demand[r]+=(t.weight/sum)*(n/Object.values(t.cost).reduce((a,b)=>a+b,0))));
  return demand;
}
function NeedProfile(p,players,board,geo,bank,modeCfg){
  const prod=botProduction(p,board,geo),raw=empty(),need=empty(),demand=BuildingDemand(p);
  RES.forEach(r=>{
    const ps=PersonalScarcity(r,prod),bs=BoardScarcity(r,board,players,geo,modeCfg),gap=RelativeGap(r,p,players,board,geo);
    raw[r]=demand[r]*ps*bs*(1+Math.max(0,-gap))*modeCfg.bankScarcity;
  });
  // Scarcity is a prioritisation signal, not permission to overturn production.
  // Compress it to a narrow band so an extremely rare 2-pip resource cannot beat a
  // genuinely strong multi-resource intersection merely because it is scarce.
  const avg=Object.values(raw).reduce((a,b)=>a+b,0)/RES.length||1;
  RES.forEach(r=>need[r]=clamp(raw[r]/avg,.72,1.28));
  return{production:prod,demand,need,rawNeed:raw};
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
function reachableFutureSpots(v,p,players,board,geo,ports,bank,targetVP,modeCfg){
  const seen=new Set([v]),queue=[[v,0]],out=[];
  while(queue.length){const [cur,d]=queue.shift();if(d>=2)continue;for(const eid of geo.vertexEdges[cur]||[]){const e=geo.edges[eid],n=e.a===cur?e.b:e.a;if(seen.has(n))continue;seen.add(n);const nd=d+1;if(legalSettlement(n,players,geo))out.push({v:n,roads:nd});queue.push([n,nd]);}}
  return out;
}
function pathRoadBonus(v,p,players,geo){return (geo.vertexEdges[v]||[]).filter(eid=>legalRoad(eid,p,players,geo)).length>=2?0.35:0;}
function quickSpotValue(v,p,players,board,geo,ports,bank,targetVP,modeCfg){const nf=NeedProfile(p,players,board,geo,bank,modeCfg),sp=spotProduction(v,board,geo);const P=placementResourceValue(sp,nf)/36;const C=coverageValue(v,sp,p,board,geo,nf);return P+C;}
function opponentTakeProbability(v,p,players,board,geo,ports,bank,targetVP,modeCfg){const opponents=players.filter(x=>x.id!==p.id);if(!opponents.length)return 0;let maxChance=0;for(const opp of opponents){if(!legalSettlement(v,players,geo))continue;const legal=geo.vertices.map((_,i)=>i).filter(x=>legalSettlement(x,players,geo));const values=legal.map(x=>quickSpotValue(x,opp,players,board,geo,ports,bank,targetVP,modeCfg)).sort((a,b)=>b-a);const target=quickSpotValue(v,opp,players,board,geo,ports,bank,targetVP,modeCfg);const rank=values.findIndex(x=>Math.abs(x-target)<1e-9);const chance=rank<0?0:(rank<2?0.82:(rank<5?0.55:(rank<10?0.25:0.08)));maxChance=Math.max(maxChance,chance);}return clamp(maxChance,0,.95);}
function EValue(v,p,players,board,geo,ports,bank,targetVP,modeCfg){
  let totalValue=0;
  for(const item of reachableFutureSpots(v,p,players,board,geo,ports,bank,targetVP,modeCfg)){
    const temp={...p,settlements:[...(p.settlements||[]),item.v]};
    const simulatedPlayers=players.map(x=>x.id===p.id?temp:x);
    // Future spots use the same production-first placement evaluator; do not let
    // scarcity alone turn a weak future intersection into a high-value expansion.
    const futureValue=quickSpotValue(item.v,temp,simulatedPlayers,board,geo,ports,bank,targetVP,modeCfg);
    const oppChance=opponentTakeProbability(item.v,p,players,board,geo,ports,bank,targetVP,modeCfg);
    totalValue+=futureValue*Math.pow(.6,item.roads)*(1-oppChance);
  }
  return totalValue+pathRoadBonus(v,p,players,geo);
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
function BlockValue(v,p,players,board,geo,ports,bank,targetVP,modeCfg){let best=0;for(const opp of players.filter(x=>x.id!==p.id)){const oppNeed=NeedProfile(opp,players,board,geo,bank,modeCfg);const fp=spotProduction(v,board,geo);const gain=RES.reduce((a,r)=>a+fp[r]*oppNeed.need[r],0);const expansion=EValue(v,opp,players,board,geo,ports,bank,targetVP,modeCfg);const likely=Math.min(.9,.25+.12*(opp.vp+publicCardCount(opp)));const leader=1+modeCfg.leaderMultiplier*(opp.vp/targetVP);best=Math.max(best,(gain+expansion)*likely*leader);}return best;}
function UrgencyValue(v,p,players,board,geo,ports,bank,targetVP,modeCfg){const e=EValue(v,p,players,board,geo,ports,bank,targetVP,modeCfg);const opps=players.filter(x=>x.id!==p.id);if(!opps.length)return 0;let chance=0;for(const opp of opps){const legal=geo.vertices.filter(x=>legalSettlement(x,players,geo));if(legal.includes(v)){const scores=legal.map(x=>{const s=spotProduction(x,board,geo);const np=NeedProfile(opp,players,board,geo,bank,modeCfg);return RES.reduce((a,r)=>a+s[r]*np.need[r],0);}).sort((a,b)=>b-a);const rank=scores.findIndex(s=>s===RES.reduce((a,r)=>a+spotProduction(v,board,geo)[r]*np.need[r],0));chance+=rank>=0?Math.max(.05,.85-rank*.08):0;}}
  return e*clamp(chance,0,1);
}
function RiskValue(action,p,players,board,geo,targetVP,modeCfg){let variance=0;if(action.type==="settlement"||action.type==="city"){const prod=action.type==="settlement"?spotProduction(action.spot,board,geo):spotProduction(action.spot,board,geo);variance=Object.values(prod).reduce((a,b)=>a+b*b,0);}else if(action.type==="road")variance=.15;else if(action.type==="buyDev")variance=.35;else variance=.1;return variance*modeCfg.gameLengthFactor;}
function settlementPieceScarcityPenalty(p){const pieces=piecesRemaining(p);if(pieces.settlements<=1)return 1.4;if(pieces.cities<=1&&pieces.settlements>1)return -0.9;return 0;}
function VPValueDelta(before,after,players,geo,heldAwards){const a0=awards(players,geo,heldAwards),a1=awards(players.map(x=>x.id===after.id?after:x),geo,heldAwards);const vp0=before.vp+(a0.roadOwner===before.id?2:0)+(a0.armyOwner===before.id?2:0),vp1=after.vp+(a1.roadOwner===after.id?2:0)+(a1.armyOwner===after.id?2:0);return vp1-vp0;}
function unifiedPosition(v,p,players,board,geo,ports,bank,targetVP,heldAwards){
  const modeCfg=botModeConfig(players,targetVP),phase=modeCfg.phases.find(x=>p.vp<=x.maxVP)||modeCfg.phases[modeCfg.phases.length-1];const nf=NeedProfile(p,players,board,geo,bank,modeCfg);
  const P=placementResourceValue(nf.production,nf)/36;
  const C=RES.reduce((a,r)=>a+(nf.need[r]*.5)/(1+(p.settlements||[]).filter(v=>spotProduction(v,board,geo)[r]>0).length),0);const T=(p.settlements||[]).concat(p.cities||[]).reduce((a,v)=>a+TValue(v,p,players,board,geo,ports,bank,targetVP,modeCfg),0);const E=(p.settlements||[]).reduce((a,v)=>a+EValue(v,p,players,board,geo,ports,bank,targetVP,modeCfg),0);const Y=(p.settlements||[]).reduce((a,v)=>a+YValue(v,p,players,board,geo,ports,bank,targetVP,modeCfg),0)+connectedRoadLength(p,geo,players)*.10;return{P,C,T,E,Y,need:nf.need,phase,modeCfg};}
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
    if(partner){nextP={...p,hand:add(pay(p.hand,{[action.give]:action.giveAmount}),{[action.get]:action.getAmount})};nextPlayers=players.map(x=>x.id===p.id?nextP:x.id===partner.id?{...x,hand:add(pay(x.hand,{[action.get]:action.getAmount}),{[action.give]:action.giveAmount})}:x);}
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
  if(action.type==="buyDev")score+=cardExpectedUtility(p,players,board,geo,ports,bank,deck,targetVP,cfg);
  if(action.type==="play"){
    if(action.card==="Road Building"){const roads=geo.edges.map(e=>roadActionPotential(e.id,p,players,board,geo,targetVP)).filter(Number.isFinite).sort((a,b)=>b-a).slice(0,2);score+=roads.reduce((a,b)=>a+b,0);}
    if(action.card==="Year of Plenty"){const nf=NeedProfile(p,players,board,geo,bank,cfg);score+=RES.slice().sort((a,b)=>nf.need[b]-nf.need[a]).slice(0,2).reduce((a,r)=>a+nf.need[r],0);}
    if(action.card==="Monopoly"){const opp=players.filter(x=>x.id!==p.id),need=NeedProfile(p,players,board,geo,bank,cfg).need;score+=Math.max(0,...RES.map(r=>opp.reduce((n,x)=>n+((botProduction(x,board,geo)[r]||0)*((x.publicCardCount??total(x.hand))*.12)),0)*(need[r]||1)));}
    if(action.card==="Knight"){const rob=chooseRobberAction(p,players,board,geo,ports,bank,targetVP);score+=(rob?.score||0)*.5;}
  }
  if(action.type==="playerTrade"){const partner=players.find(x=>x.id===action.partner);if(partner){const partnerAfter={...partner,hand:add(pay(partner.hand,{[action.get]:action.getAmount}),{[action.give]:action.giveAmount})};const oppBefore=unifiedPosition(0,partner,players,board,geo,ports,bank,targetVP,heldAwards);const oppAfter=unifiedPosition(0,partnerAfter,players.map(x=>x.id===partner.id?partnerAfter:x),board,geo,ports,bank,targetVP,heldAwards);const oppDelta=(oppAfter.P+oppAfter.C+oppAfter.T+oppAfter.E+oppAfter.Y)-(oppBefore.P+oppBefore.C+oppBefore.T+oppBefore.E+oppBefore.Y);score+=.35-Math.max(0,oppDelta)*.8;}}
  return score;
}
function cardExpectedUtility(p,players,board,geo,ports,bank,deck,targetVP,cfg){const probs=cardProbabilities(deck),vpGap=targetVP-(p.vp);let value=0;value+=(probs.Knight?.prob||0)*(vpGap<=3?2.4:1.1);value+=(probs["Road Building"]?.prob||0)*((p.roads||[]).length>=3?1.8:1);value+=(probs["Year of Plenty"]?.prob||0)*1.4;value+=(probs.Monopoly?.prob||0)*1.7;value+=(probs["Victory Point"]?.prob||0)*(vpGap<=2?4.5:1.8);return value;}
function actionCandidates(p,players,board,geo,ports,bank,deck,targetVP,heldAwards,turnState={}){
  const out=[];
  if(piecesRemaining(p).settlements>0&&canPay(p.hand,COSTS.settlement))geo.vertices.forEach((_,v)=>{if(legalSettlement(v,players,geo)&&settlementConnected(v,p,geo))out.push({type:"settlement",spot:v});});
  if(piecesRemaining(p).cities>0&&canPay(p.hand,COSTS.city))p.settlements.forEach(v=>out.push({type:"city",spot:v}));
  if(piecesRemaining(p).roads>0&&canPay(p.hand,COSTS.road))geo.edges.forEach(e=>{if(legalRoad(e.id,p,players,geo))out.push({type:"road",spot:e.id});});
  // Colonist/Catan allows buying multiple development cards in one turn.
  if(canBuyDevelopmentCard(p,deck,turnState))out.push({type:"buyDev"});
  if(!turnState.devPlayed){
    for(const card of ["Knight","Road Building","Year of Plenty","Monopoly","Victory Point"]){
      if(canPlayDevelopmentCard(card,p,turnState))out.push({type:"play",card});
    }
  }
  const aw=awards(players,geo,heldAwards),visible=p.vp+(aw.roadOwner===p.id?2:0)+(aw.armyOwner===p.id?2:0);
  if(p.development.VictoryPoint>0&&!turnState.devBought&&visible+p.development.VictoryPoint>=targetVP)out.push({type:"play",card:"Victory Point"});
  for(const give of RES)for(const get of RES){if(give===get)continue;const rate=tradeRate(p,ports,give);if((p.hand[give]||0)>=rate&&(bank[get]||0)>0)out.push({type:"trade",give,get,rate});}
  if(players.length>2){for(const partner of players.filter(x=>x.id!==p.id&&x.bot))for(const give of RES)for(const get of RES){if(give===get)continue;if((p.hand[give]||0)<1||(partner.hand[get]||0)<1)continue;out.push({type:"playerTrade",partner:partner.id,give,get,giveAmount:1,getAmount:1});}}
  out.push({type:"pass"});return out;
}
const PORT_TIE_WINDOW=0.025;
function scoreActions(p,players,board,geo,ports,bank,deck,targetVP,heldAwards,turnState={}){
  const scored=actionCandidates(p,players,board,geo,ports,bank,deck,targetVP,heldAwards,turnState).map(action=>({...action,score:unifiedActionScore(action,p,players,board,geo,ports,bank,deck,targetVP,heldAwards,turnState)}));
  const settlements=scored.filter(a=>a.type==="settlement"&&Number.isFinite(a.score));
  const bestSettlement=Math.max(0,...settlements.map(a=>a.score));
  settlements.forEach(a=>{a.portValue=TValue(a.spot,p,players,board,geo,ports,bank,targetVP,botModeConfig(players,targetVP));a.portEligibleForTie=bestSettlement>0&&a.score>=bestSettlement*(1-PORT_TIE_WINDOW);});
  return scored.sort((a,b)=>{
    if(a.type==="settlement"&&b.type==="settlement"&&a.portEligibleForTie&&b.portEligibleForTie){
      if(Math.abs(a.score-b.score)<=Math.max(0.001,bestSettlement*PORT_TIE_WINDOW))return (b.portValue||0)-(a.portValue||0);
    }
    return b.score-a.score;
  });
}
function roadActionPotential(eid,p,players,board,geo,targetVP){
  const e=geo.edges[eid];if(!e)return-Infinity;const cfg=botModeConfig(players,targetVP);let best=0;for(const v of [e.a,e.b]){const candidates=(geo.neighbors[v]||[]).filter(n=>legalSettlement(n,players,geo));best=Math.max(best,candidates.length*.8);}const before=connectedRoadLength(p,geo,players);const virtual={...p,roads:[...(p.roads||[]),eid]};const after=connectedRoadLength(virtual,geo,players);const awardBefore=awards(players,geo),awardAfter=awards(players.map(x=>x.id===p.id?virtual:x),geo);const longestGain=awardAfter.roadOwner===p.id&&awardBefore.roadOwner!==p.id?2:0;return best+(after-before)*1.2+longestGain*1.8-cfg.gameLengthFactor*.1;
}
function makeScoreCache(players,board,geo,ports,bank,targetVP){const modeCfg=botModeConfig(players,targetVP),legal=geo.vertices.map((_,i)=>i).filter(v=>legalSettlement(v,players,geo)),spots=new Map();for(const pl of players)for(const v of legal)spots.set(`${pl.id}:${v}`,quickSpotValue(v,pl,players,board,geo,ports,bank,targetVP,modeCfg));const ranks=new Map();for(const pl of players){const vals=legal.map(v=>({v,score:spots.get(`${pl.id}:${v}`)||0})).sort((a,b)=>b.score-a.score);ranks.set(pl.id,new Map(vals.map((x,i)=>[x.v,i])));}const future=new Map();for(const v of legal)future.set(v,reachableFutureSpots(v,players[0]||null,players,board,geo,ports,bank,targetVP,modeCfg));return{legal,spots,ranks,future,modeCfg};}
function fastOpponentChance(v,p,players,cache){let max=0;for(const opp of players.filter(x=>x.id!==p.id)){const rank=cache.ranks.get(opp.id)?.get(v);const chance=rank==null?0:(rank<2?0.82:(rank<5?0.55:(rank<10?0.25:0.08)));max=Math.max(max,chance);}return max;}
function fastEValue(v,p,players,board,geo,ports,bank,targetVP,modeCfg,cache){let totalValue=0;for(const item of cache?.future?.get(v)||[]){const val=cache.spots.get(`${p.id}:${item.v}`)||quickSpotValue(item.v,p,players,board,geo,ports,bank,targetVP,modeCfg);const chance=fastOpponentChance(item.v,p,players,cache);totalValue+=val*Math.pow(.6,item.roads)*(1-chance);}return totalValue+pathRoadBonus(v,p,players,geo);}
function fastBlockValue(v,p,players,board,geo,ports,bank,targetVP,modeCfg,cache){let best=0;for(const opp of players.filter(x=>x.id!==p.id)){const gain=cache?.spots?.get(`${opp.id}:${v}`)||quickSpotValue(v,opp,players,board,geo,ports,bank,targetVP,modeCfg);const rank=cache?.ranks?.get(opp.id)?.get(v);const likely=rank==null?0.05:Math.min(.9,.25+.12*Math.max(0,2-rank));const leader=1+modeCfg.leaderMultiplier*(opp.vp/targetVP);best=Math.max(best,gain*likely*leader);}return best;}
function placementScore(v,p,players,board,geo,ports,bank=emptyBank(),targetVP=players.length===2?15:10,heldAwards={roadOwner:null,armyOwner:null},cache=null){
  if(!legalSettlement(v,players,geo)&&!(p.settlements||[]).includes(v))return-Infinity;
  const cfg=botModeConfig(players,targetVP),nf=NeedProfile(p,players,board,geo,bank,cfg),sp=spotProduction(v,board,geo);
  // Production is the anchor. Scarcity can only modulate it within a tight range.
  const P=placementResourceValue(sp,nf)/36;
  const C=coverageValue(v,sp,p,board,geo,nf);
  const E=cache?fastEValue(v,p,players,board,geo,ports,bank,targetVP,cfg,cache):EValue(v,p,players,board,geo,ports,bank,targetVP,cfg);
  const Y=YValue(v,p,players,board,geo,ports,bank,targetVP,cfg);
  const block=cfg.beta*(cache?fastBlockValue(v,p,players,board,geo,ports,bank,targetVP,cfg,cache):BlockValue(v,p,players,board,geo,ports,bank,targetVP,cfg));
  const urgency=E*(cache?fastOpponentChance(v,p,players,cache):opponentTakeProbability(v,p,players,board,geo,ports,bank,targetVP,cfg));
  const risk=RiskValue({type:"settlement",spot:v},p,players,board,geo,targetVP,cfg);
  const ph=cfg.phases.find(x=>p.vp<=x.maxVP)||cfg.phases[cfg.phases.length-1];
  return ph.wP*P+ph.wC*C+ph.wE*E+ph.wY*Y+block+urgency-ph.riskWeight*risk;
}
function openingPlacementScore(v,p,players,board,geo,ports,bank=emptyBank(),targetVP=players.length===2?15:10,cache=null){
  if(!legalSettlement(v,players,geo)&&!(p.settlements||[]).includes(v))return-Infinity;
  const cfg=botModeConfig(players,targetVP),nf=NeedProfile(p,players,board,geo,bank,cfg),sp=spotProduction(v,board,geo);
  const rawPips=RES.reduce((a,r)=>a+sp[r]*36,0);
  const resourceKinds=RES.filter(r=>sp[r]>0).length;
  const factors=scarcityRankFactors(nf.need);
  const scarcityAdjusted=RES.reduce((a,r)=>a+(sp[r]*36*factors[r]),0);
  const coverage=coverageValue(v,sp,p,board,geo,nf);
  const expansion=pathRoadBonus(v,p,players,geo)*.4;
  const complement=ComplementarityScore(v,p,players,board,geo,bank,targetVP,cfg);
  const port=portAt(v,ports);
  const portValue=port?TValue(v,p,players,board,geo,ports,bank,targetVP,cfg)*1.8:0;
  const startResourceValue=RES.reduce((sum,r)=>sum+Math.min(geo.vertexTiles[v]?.filter(tid=>board[tid]?.resource===r&&board[tid]?.resource!=="desert").length||0,2)*(nf.need[r]||1),0)*1.15;
  const nums=(geo.vertexTiles[v]||[]).map(tid=>board[tid]?.number).filter(Number.isFinite);
  const correlationPenalty=nums.length>1&&new Set(nums).size===1?1.2:0;
  // Opening placement uses actual production, resource diversity, starting-card value,
  // expansion, and ports. Dice correlation is a small penalty rather than a primary driver.
  const existing=empty();
  (p.settlements||[]).concat(p.cities||[]).forEach(sv=>{const q=spotProduction(sv,board,geo);RES.forEach(r=>existing[r]+=q[r]);});
  const comboWithNetwork=pipelineComboBonus(existing,sp,players.length===2)*0.45;
  const fourPlayerClaim=players.length>2?rawPips*0.28:0;
  const hitProb=comboHitProbability([v],board,geo);
  return rawPips*1.05 + scarcityAdjusted*.10 + resourceKinds*2.75 + coverage*1.4 + expansion*.45 + complement*.35 + portValue + startResourceValue + comboWithNetwork + fourPlayerClaim + hitProb*8 - correlationPenalty;
}
function openingPairScore(a,b,p,players,board,geo,ports,bank=emptyBank(),targetVP=players.length===2?15:10,cache=null){
  const firstOwned=p.settlements.includes(a);
  if(a===b||(!firstOwned&&!legalSettlement(a,players,geo)))return-Infinity;
  const firstPlayers=firstOwned?players:players.map(x=>x.id===p.id?{...x,settlements:[...x.settlements,a]}:x);
  if(!legalSettlement(b,firstPlayers,geo))return-Infinity;
  const nf=NeedProfile(p,players,board,geo,bank,botModeConfig(players,targetVP));
  const first=openingPlacementScore(a,p,players,board,geo,ports,bank,targetVP,cache);
  const second=openingPlacementScore(b,p,firstPlayers,board,geo,ports,bank,targetVP,cache);
  const spa=spotProduction(a,board,geo),spb=spotProduction(b,board,geo);
  const combined=RES.map(r=>spa[r]+spb[r]);
  const combinedPips=combined.reduce((s,x)=>s+x*36,0);
  const combinedKinds=combined.filter(x=>x>0).length;
  const overlap=RES.reduce((s,r)=>s+Math.min(spa[r],spb[r])*36,0);
  const diversityBonus=combinedKinds*4.5;
  const diminishingOverlap=overlap*.55;
  const pairProductionBonus=combinedPips*.65;
  // The second opening settlement grants its adjacent non-desert resources immediately.
  const startingGainValue=RES.reduce((sum,r)=>sum+(geo.vertexTiles[b]||[]).filter(tid=>board[tid]?.resource===r&&board[tid]?.resource!=="desert").length*((nf.need[r]||1)*2.4),0);
  const portPairValue=(portAt(a,ports)?TValue(a,p,players,board,geo,ports,bank,targetVP,botModeConfig(players,targetVP)):0)+(portAt(b,ports)?TValue(b,p,players,board,geo,ports,bank,targetVP,botModeConfig(players,targetVP)):0);
  const allNums=[...(geo.vertexTiles[a]||[]),...(geo.vertexTiles[b]||[])].map(tid=>board[tid]?.number).filter(Number.isFinite);
  const duplicateNumberPenalty=allNums.length-new Set(allNums).size;
  const responseScores=players.filter(x=>x.id!==p.id).map(opp=>{
    const ranked=cache?.ranks?.get(opp.id);
    if(ranked){
      const ordered=[...ranked.entries()].sort((x,y)=>x[1]-y[1]);
      for(const [v] of ordered){if(legalSettlement(v,firstPlayers,geo))return cache.spots.get(`${opp.id}:${v}`)||0;}
      return 0;
    }
    let best=0;
    for(let v=0;v<geo.vertices.length;v++)if(legalSettlement(v,firstPlayers,geo)){const score=openingPlacementScore(v,opp,firstPlayers,board,geo,ports,bank,targetVP,cache);if(score>best)best=score;}
    return best;
  });
  const opponentBest=Math.max(0,...responseScores);
  const lambda=botModeConfig(players,targetVP).beta===.4?.35:.30;
  const separationPenalty=(geo.neighbors[a]||[]).includes(b)?3.5:0;
  const comboBonus=pipelineComboBonus(spa,spb,players.length===2);
  const hitProb=comboHitProbability([a,b],board,geo);
  return first+second+pairProductionBonus+diversityBonus+startingGainValue+portPairValue+comboBonus+hitProb*22-diminishingOverlap-separationPenalty-duplicateNumberPenalty*.12-lambda*opponentBest;
}
function bestOpeningPair(p,players,board,geo,ports,bank=emptyBank(),targetVP=players.length===2?15:10){const legal=geo.vertices.map((_,i)=>i).filter(v=>legalSettlement(v,players,geo));const cache=makeScoreCache(players,board,geo,ports,bank,targetVP);let best=null;for(const a of legal)for(const b of legal){if(a===b)continue;const score=openingPairScore(a,b,p,players,board,geo,ports,bank,targetVP,cache);if(!Number.isFinite(score))continue;if(!best||score>best.score)best={first:a,second:b,score};}return best;}
function bestOpeningCompanion(first,p,players,board,geo,ports,bank=emptyBank(),targetVP=players.length===2?15:10){if(first==null)return null;const cache=makeScoreCache(players,board,geo,ports,bank,targetVP);let best=null;for(let b=0;b<geo.vertices.length;b++){const score=openingPairScore(first,b,p,players,board,geo,ports,bank,targetVP,cache);if(!Number.isFinite(score))continue;if(!best||score>best.score)best={first,second:b,score};}return best;}
function chooseRobberAction(p,players,board,geo,ports,bank,targetVP,heldAwards={roadOwner:null,armyOwner:null}){
  const cfg=botModeConfig(players,targetVP);let best=null;
  const allOpponents=players.filter(x=>x.id!==p.id);
  for(let tid=0;tid<board.length;tid++){
    if(board[tid].robber)continue;
    const verts=tileVerts(geo,tid);
    for(const opp of allOpponents){
      if(friendlyRobberProtectedCore(opp,players,geo,heldAwards)&&verts.some(v=>opp.settlements.includes(v)||opp.cities.includes(v)))continue;
      let pips=0;const pip=PROB[board[tid].number]||0;
      for(const v of verts){if(opp.settlements.includes(v))pips+=pip;if(opp.cities.includes(v))pips+=pip*2;}
      if(pips<=0)continue;
      const need=NeedProfile(opp,players,board,geo,bank,cfg);
      const denial=RES.reduce((a,r)=>a+Production(r,[board[tid]])*need.need[r],0);
      const leader=1+cfg.leaderMultiplier*(opp.vp/Math.max(targetVP,1));
      const ownTouch=verts.some(v=>p.settlements.includes(v)||p.cities.includes(v));
      const handBonus=publicCardCount(opp)*.03;
      const score=denial*leader+handBonus+pips*.4-(ownTouch?denial*.55:0)+openVictoryPoints(opp,players,geo,heldAwards)*.05;
      if(!best||score>best.score)best={tid,opp,score,blockedPips:pips};
    }
  }
  return best;
}
function randomHeldResourceByCard(hand,rng=Math.random){
  const cards=[];RES.forEach(r=>{const count=Math.max(0,Number(hand?.[r]||0));for(let i=0;i<count;i++)cards.push(r)});
  if(!cards.length)return null;
  return cards[Math.floor(rng()*cards.length)];
}
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
    for(const v of placed){if(occupied.has(v))errors.push(`Intersection ${v} has multiple owners`);else occupied.set(v,p?.name||String(p?.id));if(geo&&!geo.vertices?.[v])errors.push(`Invalid housing vertex ${v}`);}
    for(const e of p?.roads||[]){if(roadOwners.has(e))errors.push(`Road ${e} has multiple owners`);else roadOwners.set(e,p?.name||String(p?.id));if(geo&&!geo.edges?.[e])errors.push(`Invalid road edge ${e}`);}
    for(const r of RES)if((p?.hand?.[r]||0)<0)errors.push(`Negative ${r}`);
  });
  if(bank)for(const r of RES){const b=Number(bank[r]||0);if(b<0||b>19)errors.push(`Bank ${r} out of range`);const held=(players||[]).reduce((n,p)=>n+Math.max(0,Number(p?.hand?.[r]||0)),0);if(Math.abs(b+held-19)>1e-9)errors.push(`Resource ledger mismatch for ${r}`);}
  if(Array.isArray(deck)&&deck.length>25)errors.push("Development deck exceeds 25 cards");
  return {ok:errors.length===0,errors};
}
function aiPlan(p,players,board,geo,deck,ports,targetVP,bank=emptyBank(),heldAwards={roadOwner:null,armyOwner:null},turnState={}){const scored=scoreActions(p,players,board,geo,ports,bank,deck,targetVP,heldAwards,turnState);const best=scored.find(a=>a.type!=="pass")||{type:"pass",score:0};return{...best,reason:decisionReason(best,p,players,board,geo,ports,bank,targetVP)};}
function decisionReason(action,p,players,board,geo,ports,bank,targetVP){if(action.type==="settlement"){const nf=NeedProfile(p,players,board,geo,bank,botModeConfig(players,targetVP)),sp=spotProduction(action.spot,board,geo),parts=RES.filter(r=>sp[r]>0).sort((a,b)=>sp[b]*nf.need[b]-sp[a]*nf.need[a]).slice(0,3).map(r=>`+P(${r} ${(sp[r]*36).toFixed(1)}) +Need(${nf.need[r].toFixed(2)})`);if(portAt(action.spot,ports)&&action.portEligibleForTie)parts.push(`+Port tie-break(${portAt(action.spot,ports).type})`);return parts.join(" ")+` => V=${action.score.toFixed(2)}, chosen`;}if(action.type==="city")return `+VP(1) +production doubled at ${action.spot} => V=${action.score.toFixed(2)}, chosen`;if(action.type==="road")return `+E(expansion) +Y(road network) => V=${action.score.toFixed(2)}, chosen`;if(action.type==="trade")return `+T(port/bank conversion) ${LABEL[action.give]}→${LABEL[action.get]} => V=${action.score.toFixed(2)}, chosen`;if(action.type==="buyDev")return `+cardExpectedUtility => V=${action.score.toFixed(2)}, chosen`;if(action.type==="play")return `+${action.card} strategic value => V=${action.score.toFixed(2)}, chosen`;return `No positive action => pass`}
function actionLabel(a){return a?.type==="buyDev"?"Development card":a?.type==="settlement"?"Settlement":a?.type==="road"?"Road":a?.type==="city"?"City":a?.type==="trade"||a?.type==="playerTrade"?"Trade":a?.type==="play"?`Play ${a.card}`:a?.type||"Pass";}
function loadHistory(){
  try{
    const keys=[HISTORY_KEY,...LEGACY_HISTORY_KEYS];
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

export {RES,PROB,makeGeometry,boardValid,makeBoard,makePorts,empty,emptyBank,total,canPay,pay,add,legalSettlement,legalInitialRoad,roadConnected,legalRoad,settlementConnected,portAt,tradeRate,productionForRoll,resolveDiceRoll,connectedRoadLength,awards,newPlayer,adjacentProduction,Production,PersonalScarcity,BoardScarcity,BankAvailability,RelativeGap,BuildingDemand,NeedProfile,spotProduction,TValue,EValue,YValue,BlockValue,UrgencyValue,RiskValue,unifiedPosition,unifiedActionScore,scoreActions,PORT_TIE_WINDOW,placementResourceValue,scarcityRankFactors,placementScore,openingPlacementScore,openingPairScore,bestOpeningPair,bestOpeningCompanion,chooseRobberAction,aiPlan,BOT_MODE_CONFIGS,BOT_ENGINE_VERSION,DEV,COSTS,PIECES,cardProbabilities,COLONIST_BASE_RULES,colonistRules,publicCardCount,publicVictoryPoints,canPlayDevelopmentCard,canBuyDevelopmentCard,friendlyRobberProtectedCore,pipelineComboBonus,expectedTurnsToCombo,tileVerts,comboHitProbability,comboCompletionValue,randomHeldResourceByCard,gameInvariantReport,BOT_DIFFICULTY_CONFIG,botDifficultyProfile,devDeck};
