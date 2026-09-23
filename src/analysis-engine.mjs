
/* Catan Analysis Engine — formula, rollouts, classification and accuracy.
 * Source basis: the uploaded Catan Analysis Engine implementation specification.
 */
export const ENGINE_VERSION="catan-engine-v2-rollout";
export const WEIGHTS=Object.freeze({w1:1,w2:.42,w3:.32,w4:.28,w5:.24,w6:.18,w7:.16,w8:.14,w9:.10});
export const MOVE_LABELS=Object.freeze(["blunder","mistake","inaccuracy","good","excellent","brilliant"]);
export const LABEL_META=Object.freeze({
  blunder:{key:"blunder",icon:"💥",label:"BLUNDER"},
  mistake:{key:"mistake",icon:"❓",label:"MISTAKE"},
  inaccuracy:{key:"inaccuracy",icon:"🟡",label:"INACCURACY"},
  good:{key:"good",icon:"🟢",label:"GOOD"},
  excellent:{key:"excellent",icon:"⭐",label:"EXCELLENT"},
  brilliant:{key:"brilliant",icon:"💎",label:"BRILLIANT"}
});
const RES=["wood","brick","sheep","wheat","ore"];
const COSTS={road:{wood:1,brick:1},settlement:{wood:1,brick:1,sheep:1,wheat:1},city:{wheat:2,ore:3},development:{sheep:1,wheat:1,ore:1}};
const PIP={2:1,3:2,4:3,5:4,6:5,8:5,9:4,10:3,11:2,12:1};
const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
const sum=o=>RES.reduce((n,r)=>n+Number(o&&o[r]||0),0);
const empty=()=>({wood:0,brick:0,sheep:0,wheat:0,ore:0});
const canPay=(h,c)=>Object.entries(c||{}).every(([r,n])=>Number(h&&h[r]||0)>=n);
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const pips=n=>PIP[Number(n)]||0;
const sigmoid=x=>1/(1+Math.exp(-x));
const ownedAt=(p,v)=>[...(p&&p.settlements||[]),...(p&&p.cities||[])].includes(v);
const adjacentTiles=(v,geo)=>(geo&&geo.vertexTiles&&geo.vertexTiles[v])||[];

function producingPlayers(resource,state){
  return (state.players||[]).filter(p=>
    (p.settlements||[]).some(v=>adjacentTiles(v,state.geo).some(tid=>{
      const t=state.board&&state.board[tid]; return t&&t.resource===resource&&!t.robber;
    })) ||
    (p.cities||[]).some(v=>adjacentTiles(v,state.geo).some(tid=>{
      const t=state.board&&state.board[tid]; return t&&t.resource===resource&&!t.robber;
    }))
  ).length;
}
function scarcityMultiplier(resource,state){return 1+1/Math.max(1,producingPlayers(resource,state));}

export function productionScore(player,state){
  let score=0;
  const add=(v,mult)=>{
    for(const tid of adjacentTiles(v,state.geo)){
      const t=state.board&&state.board[tid];
      if(t&&t.resource!=="desert"&&!t.robber)score+=pips(t.number)*scarcityMultiplier(t.resource,state)*mult;
    }
  };
  (player&&player.settlements||[]).forEach(v=>add(v,1));
  (player&&player.cities||[]).forEach(v=>add(v,2));
  return score;
}
function legalSettlement(v,players,geo){
  if(!Number.isInteger(v)||!geo||!geo.vertices||!geo.vertices[v])return false;
  for(const p of players||[]){
    if(ownedAt(p,v))return false;
    if((geo.neighbors&&geo.neighbors[v]||[]).some(n=>ownedAt(p,n)))return false;
  }
  return true;
}
function networkedVertex(v,player,geo){
  if(!player||!(player.roads||[]).length)return false;
  return (geo.vertexEdges&&geo.vertexEdges[v]||[]).some(eid=>(player.roads||[]).includes(eid));
}
export function expansionPotential(player,state){
  const candidates=[];
  for(let v=0;v<(state.geo&&state.geo.vertices||[]).length;v++){
    if(!legalSettlement(v,state.players,state.geo))continue;
    if((player.settlements||[]).length===0||networkedVertex(v,player,state.geo))candidates.push(v);
  }
  return candidates.length?Math.max(...candidates.map(v=>
    adjacentTiles(v,state.geo).reduce((s,tid)=>{
      const t=state.board&&state.board[tid];
      return s+(t&&t.resource!=="desert"?pips(t.number)*scarcityMultiplier(t.resource,state):0);
    },0)
  )):0;
}
export function armyProgress(player,state){
  if(player&&player.hasLargestArmy)return 2;
  const leader=Math.max(...(state.players||[]).map(p=>Number(p.knightsPlayed||p.development&&p.development.playedKnights||0)),0);
  const own=Number(player&&player.knightsPlayed||player&&player.development&&player.development.playedKnights||0);
  const turnsLeft=Math.max(1,Math.round(((state.targetVP||10)-(player&&player.vp||0))*1.5));
  return sigmoid(-.4*(leader-own)+.05*turnsLeft)*2;
}
function roadLength(player,state){
  const roads=new Set(player&&player.roads||[]); if(!roads.size)return 0;
  let best=0;
  for(const start of roads){
    const e=state.geo&&state.geo.edges&&state.geo.edges[start]; if(!e)continue;
    const q=[e.a,e.b],seen=new Set();
    while(q.length){
      const v=q.pop(); best=Math.max(best,1);
      for(const eid of state.geo.vertexEdges&&state.geo.vertexEdges[v]||[]){
        if(!roads.has(eid)||seen.has(eid))continue;
        seen.add(eid); const ne=state.geo.edges[eid]; if(ne)q.push(ne.a===v?ne.b:ne.a);
      }
    }
  }
  return Math.min(best,roads.size);
}
export function roadProgress(player,state){
  const leader=Math.max(...(state.players||[]).map(p=>roadLength(p,state)),0);
  if(!leader)return 0;
  const own=roadLength(player,state);
  const extend=(player&&player.roads||[]).length?0.65:.15;
  return (own/leader)*extend*2+(player&&player.hasLongestRoad?2:0);
}
export function handEfficiency(player){
  const hand=player&&player.hand||empty(),n=sum(hand);
  const ready=[COSTS.road,COSTS.settlement,COSTS.city,COSTS.development].filter(c=>canPay(hand,c)).length;
  const readiness=n?ready/n:0;
  const overflow=n>7?Math.min(1,(n-7)/7):0;
  const devHeld=Object.entries(player&&player.development||{}).filter(x=>x[0]!=="playedKnights").reduce((a,x)=>a+Number(x[1]||0),0);
  return clamp(readiness+.35-overflow*.35-devHeld*.08,0,1.5);
}
export function tradeLeverage(player,state){
  let best=4;
  const ports=state.ports||[];
  for(const r of RES){
    if((ports||[]).some(port=>(port.type===r||port.type==="2:1")&&(([...(player.settlements||[]),...(player.cities||[])]).includes(port.a)||([...(player.settlements||[]),...(player.cities||[])]).includes(port.b))))best=Math.min(best,port.type===r?2:3);
  }
  return Math.max(0,(4-best)/4);
}
export function blockingValue(player,state){
  let v=0;
  for(const opp of state.players||[]){
    if(opp.id===player.id)continue;
    v+=Math.min(1,productionScore(opp,state)/30)*.15;
  }
  return Math.min(2,v);
}
export function vulnerabilityPenalty(player){
  const n=sum(player&&player.hand||empty());
  return n<=7?0:.5*n*(1/6);
}
export function evaluateState(state,weights=WEIGHTS){
  const players=state.players||[],raw=players.map(p=>
    weights.w1*(p.vp||0)+
    weights.w2*productionScore(p,state)+
    weights.w3*expansionPotential(p,state)+
    weights.w4*armyProgress(p,state)+
    weights.w5*roadProgress(p,state)+
    weights.w6*handEfficiency(p)+
    weights.w7*tradeLeverage(p,state)+
    weights.w8*blockingValue(p,state)-
    weights.w9*vulnerabilityPenalty(p)
  );
  const mx=Math.max(...raw,0),ex=raw.map(v=>Math.exp(v-mx)),den=ex.reduce((a,b)=>a+b,0)||1;
  return Object.fromEntries(players.map((p,i)=>[p.id,ex[i]/den]));
}

function legalRoad(edgeId,player,state){
  const e=state.geo&&state.geo.edges&&state.geo.edges[edgeId];
  if(!e||((player.roads||[]).includes(edgeId)))return false;
  return [e.a,e.b].some(v=>ownedAt(player,v)||(state.geo.vertexEdges&&state.geo.vertexEdges[v]||[]).some(x=>(player.roads||[]).includes(x)));
}
function immediateObjectiveBonus(state,player,action){
  const hand=player&&player.hand||empty();
  if(action.type==="city"){
    const pipValue=adjacentTiles(action.spot,state.geo).reduce((s,tid)=>{
      const t=state.board&&state.board[tid]; return s+(t?pips(t.number)*scarcityMultiplier(t.resource,state):0);
    },0);
    return 18+pipValue*1.25-(sum(hand)>7?2:0);
  }
  if(action.type==="play"&&action.card==="Knight"){
    const own=Number(player.knightsPlayed||player.development&&player.development.playedKnights||0);
    const leader=Math.max(...(state.players||[]).map(p=>Number(p.knightsPlayed||p.development&&p.development.playedKnights||0)),0);
    return own+1>=leader?14:4;
  }
  if(action.type==="trade"||action.type==="playerTrade"){
    const get=action.getBundle||{[action.get]:1};
    let best=0;
    for(const cost of Object.values(COSTS)){
      const before=Object.entries(cost).reduce((n,x)=>n+Math.max(0,x[1]-Number(hand[x[0]]||0)),0);
      const afterHand={...hand}; Object.entries(get).forEach(x=>afterHand[x[0]]=(afterHand[x[0]]||0)+Number(x[1]||0));
      const after=Object.entries(cost).reduce((n,x)=>n+Math.max(0,x[1]-Number(afterHand[x[0]]||0)),0);
      best=Math.max(best,before-after);
    }
    return best*8;
  }
  return 0;
}
function applyApproximateAction(state,action){
  const s=clone(state),p=(s.players||[]).find(x=>x.id===action.playerId);
  if(!p)return null;
  const pay=(cost)=>{
    if(!canPay(p.hand,cost))return false;
    for(const x of Object.entries(cost)){p.hand[x[0]]-=x[1];s.bank=s.bank||empty();s.bank[x[0]]+=x[1];}
    return true;
  };
  if(action.type==="city"){
    if(!pay(COSTS.city)||!(p.settlements||[]).includes(action.spot))return null;
    p.settlements=p.settlements.filter(v=>v!==action.spot);p.cities=[...(p.cities||[]),action.spot];p.vp=(p.vp||0)+1;
  }else if(action.type==="settlement"){
    if(!pay(COSTS.settlement)||!legalSettlement(action.spot,s.players,s.geo)||!networkedVertex(action.spot,p,s.geo))return null;
    p.settlements=[...(p.settlements||[]),action.spot];p.vp=(p.vp||0)+1;
  }else if(action.type==="road"){
    if(!pay(COSTS.road)||!legalRoad(action.spot,p,s))return null;
    p.roads=[...(p.roads||[]),action.spot];
  }else if(action.type==="buyDev"){
    if(!pay(COSTS.development)||Number(s.deckCount||0)<=0)return null;
    s.deckCount=Math.max(0,Number(s.deckCount)-1);p.development={...(p.development||{}),__hidden:(p.development&&p.development.__hidden||0)+1};
  }else if(action.type==="trade"||action.type==="playerTrade"){
    const give=action.giveBundle||{[action.give]:action.giveAmount||action.rate};
    const get=action.getBundle||{[action.get]:action.getAmount||1};
    if(!canPay(p.hand,give))return null;
    for(const x of Object.entries(give)){p.hand[x[0]]-=x[1];s.bank=s.bank||empty();s.bank[x[0]]+=x[1];}
    const receiver=action.type==="playerTrade"?(s.players||[]).find(x=>x.id===action.partner):null;
    if(receiver){
      if(!canPay(receiver.hand,get))return null;
      for(const x of Object.entries(get)){receiver.hand[x[0]]-=x[1];p.hand[x[0]]=(p.hand[x[0]]||0)+x[1];}
      for(const x of Object.entries(give))receiver.hand[x[0]]=(receiver.hand[x[0]]||0)+x[1];
    }else{
      for(const x of Object.entries(get)){if(Number(s.bank[x[0]]||0)<x[1])return null;s.bank[x[0]]-=x[1];p.hand[x[0]]=(p.hand[x[0]]||0)+x[1];}
    }
  }else if(action.type==="play"&&action.card==="Knight"&&p.development&&p.development.Knight){
    p.development.Knight-=1;p.knightsPlayed=(p.knightsPlayed||0)+1;
  }else return null;
  return s;
}
function candidateMoves(state,playerId){
  const p=(state.players||[]).find(x=>x.id===playerId);if(!p)return[];
  const out=[];
  if(canPay(p.hand,COSTS.city))(p.settlements||[]).forEach(spot=>out.push({type:"city",spot,playerId}));
  if(canPay(p.hand,COSTS.road))(state.geo.edges||[]).forEach(e=>{if(legalRoad(e.id,p,state))out.push({type:"road",spot:e.id,playerId});});
  if(canPay(p.hand,COSTS.settlement))for(let v=0;v<(state.geo.vertices||[]).length;v++)if(legalSettlement(v,state.players,state.geo)&&networkedVertex(v,p,state.geo))out.push({type:"settlement",spot:v,playerId});
  if(canPay(p.hand,COSTS.development)&&(state.deckCount||0)>0)out.push({type:"buyDev",playerId});
  if((p.development&&p.development.Knight||0)>0)out.push({type:"play",card:"Knight",playerId});
  return out.slice(0,48);
}
function actionScore(state,p,action){
  const next=applyApproximateAction(state,action);if(!next)return-Infinity;
  const before=evaluateState(state)[p.id]||0,after=evaluateState(next)[p.id]||0;
  return (after-before)*100+immediateObjectiveBonus(state,p,action)-(sum(p.hand)>7?1:0);
}
function rollout(state,playerId,horizon=6,rng=Math.random){
  let s=clone(state);
  for(let turn=0;turn<horizon;turn++){
    const roll=2+Math.floor(rng()*11);
    for(const owner of s.players||[]){
      for(let tid=0;tid<(s.board||[]).length;tid++){
        const tile=s.board[tid];
        if(!tile||tile.number!==roll||tile.robber||tile.resource==="desert")continue;
        for(const v of s.geo.vertexTiles&&s.geo.vertexTiles[tid]||[]){
          if((owner.settlements||[]).includes(v)||(owner.cities||[]).includes(v)){
            owner.hand=owner.hand||empty();owner.hand[tile.resource]=(owner.hand[tile.resource]||0)+((owner.cities||[]).includes(v)?2:1);
          }
        }
      }
    }
    const actor=s.players&&s.players[turn%s.players.length];if(!actor)break;
    const candidates=candidateMoves(s,actor.id);if(!candidates.length)continue;
    let best=null,bestScore=-Infinity;
    for(const c of candidates){const sc=actionScore(s,actor,c);if(sc>bestScore){bestScore=sc;best=c;}}
    if(best){s=applyApproximateAction(s,best)||s;}
  }
  return s;
}
export function findBestAlternative(state,actualMove,playerId,options={}){
  const consequential=!["end_turn","roll_dice","discard"].includes(actualMove&&actualMove.type);
  const N=Number(options.N|| (consequential?30:6));
  const legal=options.generateLegalMoves?options.generateLegalMoves(state,playerId):candidateMoves(state,playerId);
  const results=[];
  for(const candidate of legal){
    let totalWP=0;
    for(let i=0;i<N;i++){
      const next=options.applyMove?options.applyMove(state,candidate):applyApproximateAction(state,candidate);
      if(!next)continue;
      const sim=options.rollout?options.rollout(next,playerId,options.horizon||6):rollout(next,playerId,options.horizon||6,options.rng||Math.random);
      totalWP+=evaluateState(sim)[playerId]||0;
    }
    results.push({move:candidate,wp:totalWP/Math.max(N,1)});
  }
  results.sort((a,b)=>b.wp-a.wp);
  const best=results[0]||{move:null,wp:evaluateState(state)[playerId]||0};
  let actualWP=results.find(x=>JSON.stringify(x.move)===JSON.stringify(actualMove))?.wp;
  if(actualWP==null){
    const next=options.applyMove?options.applyMove(state,actualMove):applyApproximateAction(state,actualMove);
    if(next){
      let total=0;for(let i=0;i<N;i++){const sim=options.rollout?options.rollout(next,playerId,options.horizon||6):rollout(next,playerId,options.horizon||6,options.rng||Math.random);total+=evaluateState(sim)[playerId]||0;}actualWP=total/Math.max(1,N);
    }else actualWP=evaluateState(state)[playerId]||0;
  }
  return{bestMove:best.move,bestMoveWP:best.wp,actualMoveWP,rolloutCount:N};
}
export function classifyMove({move,before,after,bestAfter,gameWinning=false}){
  const lossPct=Math.max(0,(Number(bestAfter||0)-Number(after||0))*100);
  let label=lossPct<.5?"excellent":lossPct<2?"good":lossPct<5?"inaccuracy":lossPct<12?"mistake":"blunder";
  const nonBuild=!(["settlement","city","road","buyDev"].includes(move&&move.type));
  if(gameWinning&&nonBuild&&lossPct<.5&&before<.5&&Number(after)-Number(before)>=.15)label="brilliant";
  return{label,meta:LABEL_META[label],equityLossPct:lossPct};
}
export function computePlayerAnalysis(playerId,evaluations){
  const moves=(evaluations||[]).filter(m=>m.playerId===playerId);
  if(!moves.length)return{playerId,accuracy:null,avgEquityLossPct:null,moveCounts:Object.fromEntries(MOVE_LABELS.map(k=>[k,0])),brilliantMoveIds:[],worstMoveIds:[]};
  const avg=moves.reduce((s,m)=>s+Number(m.equityLossPct||0),0)/moves.length;
  const accuracy=clamp(103.17*Math.exp(-.044*avg)-3.17,0,100);
  const moveCounts=Object.fromEntries(MOVE_LABELS.map(k=>[k,0]));moves.forEach(m=>moveCounts[m.label]=(moveCounts[m.label]||0)+1);
  const worst=[...moves].sort((a,b)=>Number(b.equityLossPct||0)-Number(a.equityLossPct||0)).slice(0,3).map(m=>m.moveId);
  return{playerId,accuracy,avgEquityLossPct:avg,moveCounts,brilliantMoveIds:moves.filter(m=>m.label==="brilliant").map(m=>m.moveId),worstMoveIds:worst};
}
export function analyzeGameRecord(gameRecord,geo,options={}){
  const frames=gameRecord&&gameRecord.analysisFrames||[];
  const moves=gameRecord&&gameRecord.decisions&&gameRecord.decisions.length?gameRecord.decisions:frames.flatMap(f=>f.decisions||[]);
  const evals=[];
  for(let i=0;i<moves.length;i++){
    const d=moves[i],frame=frames.find(f=>f.turn===d.turn&&f.playerId===d.playerId)||frames.find(f=>f.turn===d.turn);
    const beforeRaw=d.stateBefore||frame&&frame.before,afterRaw=d.stateAfter||frame&&frame.after;if(!beforeRaw||!afterRaw||d.playerId==null)continue;
    const beforeState={...clone(beforeRaw),geo};const afterState={...clone(afterRaw),geo};
    const before=evaluateState(beforeState)[d.playerId]||0,after=evaluateState(afterState)[d.playerId]||before;
    const payload=d.payload||{type:d.type||"unknown",spot:d.spot,give:d.give,get:d.get,rate:d.rate,card:d.card,partner:d.partner,giveBundle:d.giveBundle,getBundle:d.getBundle};
    payload.playerId=d.playerId;
    const sim=findBestAlternative(beforeState,payload,d.playerId,{N:options.N||24,horizon:options.horizon||6});
    const c=classifyMove({move:payload,before,after,bestAfter:sim.bestMoveWP,gameWinning:!!d.gameWinning});
    const delta=(after-before)*100,bestDelta=(sim.bestMoveWP-before)*100;
    const explanation=(delta>=0?"+":"")+delta.toFixed(1)+" WP; best alternative: "+(sim.bestMove?sim.bestMove.type:"none")+"; equity gap "+Math.max(0,bestDelta-delta).toFixed(1)+" points"+(sum((beforeState.players||[]).find(p=>p.id===d.playerId)?.hand||{})>7?" · 7+ card risk was present":"");
    evals.push({moveId:d.moveId||String(gameRecord.id)+"-"+i,playerId:d.playerId,playerName:d.playerName,turn:d.turn,action:d.action||payload.type,payload,stateBefore:beforeState,stateAfter:afterState,beforeState,afterState,winProbBefore:before,winProbAfterActual:after,winProbAfterBest:sim.bestMoveWP,equityLossPct:c.equityLossPct,label:c.label,classification:c.meta,bestAlternative:sim.bestMove,rolloutCount:sim.rolloutCount,explanation});
  }
  const perPlayer={};for(const p of gameRecord.players||[])perPlayer[p.id]=computePlayerAnalysis(p.id,evals);
  return{gameId:gameRecord.id,computedAt:Date.now(),engineVersion:ENGINE_VERSION,perPlayer,moveEvaluations:evals};
}
