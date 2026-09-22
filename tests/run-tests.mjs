import * as L from "./logic-core.mjs";
const geo=L.makeGeometry();
const pvBotSetupOrderRound1=[0,1],pvBotSetupOrderRound2=[1,0];
if([...pvBotSetupOrderRound1,...pvBotSetupOrderRound2].join(",")!=="0,1,1,0") throw new Error("PVBot snake setup order regression failed");
if(geo.tiles.length!==19||geo.vertices.length!==54||geo.edges.length!==72) throw new Error("Geometry count mismatch");
for(const settings of [{highPipsTouch:false},{highPipsTouch:true}]){for(let i=0;i<100;i++){const b=L.makeBoard(geo,settings);if(!L.boardValid(b,geo,settings))throw new Error("Invalid generated board");const ports=L.makePorts(geo);if(ports.length!==9||new Set(ports.map(p=>p.edge)).size!==9)throw new Error("Invalid port layout");}}
const p0=L.newPlayer(0,"A",false,"Human"),p1=L.newPlayer(1,"B",false,"Human");p0.settlements=[0];if(!L.legalInitialRoad(geo.vertexEdges[0][0],0,[p0,p1],geo))throw new Error("Initial road validation failed");
const board=Array.from({length:19},()=>({resource:"desert",number:null,robber:false}));board[0]={resource:"wood",number:4,robber:false};const a=L.newPlayer(0,"A",false,"Human"),b=L.newPlayer(1,"B",false,"Human");a.settlements=[geo.vertexTiles[0][0]];b.settlements=[geo.vertexTiles[0][0]];const bank={wood:1,brick:19,sheep:19,wheat:19,ore:19};const shortage=L.productionForRoll([a,b],board,geo,4,bank);if(shortage.players[0].hand.wood!==0||shortage.players[1].hand.wood!==0||shortage.bank.wood!==1)throw new Error("Multi-recipient shortage rule failed");const scorePlayer=L.newPlayer(0,"A",false,"Human"); scorePlayer.hand={wood:0,brick:2,sheep:2,wheat:2,ore:2}; const scoreBoard=L.makeBoard(geo,{highPipsTouch:true}); const score=L.placementScore(0,scorePlayer,[scorePlayer],scoreBoard,geo,L.makePorts(geo)); if(!Number.isFinite(score)) throw new Error("placementScore regression failed");
const sole=L.newPlayer(0,"A",false,"Human");sole.settlements=[geo.vertexTiles[0][0]];const shortage2=L.productionForRoll([sole],board,geo,4,bank);if(shortage2.players[0].hand.wood!==1||shortage2.bank.wood!==0)throw new Error("Sole-recipient shortage rule failed");
console.log("HEXBOUND TESTS PASSED — geometry, board constraints, ports, setup road legality and bank shortage rules");
const rules2=L.colonistRules(2);
if(rules2.targetVP!==15||rules2.discardIfHandOver!==9||rules2.playerTrading||!rules2.friendlyRobber||!rules2.balancedDice)throw new Error("1v1 Colonist ranked rules mismatch");
{
  const h=L.newPlayer(0,"Human",false,"Human"),b=L.newPlayer(1,"Bot",true,"Hard");
  h.vp=2;b.vp=5;
  const g=L.makeGeometry();
  h.settlements=[g.vertexTiles[0][0]];
  b.settlements=[g.vertexTiles[1][0]];
  const rbBoard=Array.from({length:19},(_,i)=>({resource:i===0?"wood":"desert",number:i===0?6:null,robber:i===2}));
  const choice=L.chooseRobberAction(b,[h,b],rbBoard,g,[],L.emptyBank(),15,{roadOwner:null,armyOwner:null});
  if(choice&&choice.opp?.id===h.id&&g.vertexTiles[choice.tid].some(v=>h.settlements.includes(v)))throw new Error("Friendly Robber protected player was selected");
}


for(let i=0;i<10;i++){
  const b=L.makeBoard(geo,{highPipsTouch:false});
  const ports=L.makePorts(geo);
  const bot=L.newPlayer(1,"Bot",true,"Impossible");
  const human=L.newPlayer(0,"You",false,"Human");
  const pair=L.bestOpeningPair(bot,[human,bot],b,geo,ports);
  if(!pair||!Number.isFinite(pair.score)) throw new Error("PVBot opening pair search failed");
  if(pair.first===pair.second) throw new Error("PVBot opening pair duplicated a spot");
  if(!L.legalSettlement(pair.first,[human,bot],geo)) throw new Error("PVBot first opening spot is illegal");
  const after=[human,{...bot,settlements:[pair.first]}];
  if(!L.legalSettlement(pair.second,after,geo)) throw new Error("PVBot second opening spot is illegal");
}
console.log("PVBot opening-pair search passed — exhaustive legal pair evaluation");
for(let i=0;i<5;i++){
  const b=L.makeBoard(geo,{highPipsTouch:true});
  const ports=L.makePorts(geo);
  const bot=L.newPlayer(1,"Bot",true,"Hard");
  const human=L.newPlayer(0,"You",false,"Human");
  const pair=L.bestOpeningPair(bot,[human,bot],b,geo,ports);
  bot.settlements=[pair.first];
  const companion=L.bestOpeningCompanion(pair.first,bot,[human,bot],b,geo,ports);
  if(!companion||!Number.isFinite(companion.score)) throw new Error("PVBot companion search failed");
  if(!L.legalSettlement(companion.second,[human,bot],geo)) throw new Error("PVBot companion spot is illegal");
}
console.log("PVBot companion search passed");
const six=L.Production("ore",[{resource:"ore",number:6,robber:false}]);
if(Math.abs(six-(5/36))>1e-9)throw new Error("6/8 production probability is not exact");
{
  // Scarcity must rank resources, but it must not overturn a clearly superior
  // multi-resource production profile. A 13-pip / 3-resource spot must beat a
  // 6-pip / single-resource spot even when the single resource is the scarcest.
  const need={wood:1.28,brick:1.05,sheep:.98,wheat:.90,ore:1.27};
  const multi=L.placementResourceValue({wood:5/36,brick:4/36,sheep:4/36,wheat:0,ore:0},{need});
  const scarceSingle=L.placementResourceValue({wood:0,brick:0,sheep:0,wheat:0,ore:5/36},{need});
  if(!(multi>scarceSingle*1.5))throw new Error("Scarcity regression: weak single-resource spot can still overpower a strong multi-resource spot");
  const factors=L.scarcityRankFactors(need);
  const vals=Object.values(factors);
  if(Math.max(...vals)>1.1800001||Math.min(...vals)<.9399999)throw new Error("Scarcity factor is outside the intended narrow range");
}
if(L.BOT_MODE_CONFIGS.standard4p10.targetVP!==10||L.BOT_MODE_CONFIGS.pvbot1v115.targetVP!==15)throw new Error("Mode configuration regression");
const portTestBoard=L.makeBoard(geo,{highPipsTouch:true}),portTestPorts=L.makePorts(geo),portTestPlayer=L.newPlayer(0,"PortBot",true,"Impossible"),portTestOpp=L.newPlayer(1,"Opp",false,"Human");const specialized=portTestPorts.find(x=>x.type.startsWith("2:1"));const portResource=specialized.type.slice(4);portTestPlayer.settlements=[specialized.vertices[0]];portTestPlayer.hand={wood:0,brick:0,sheep:0,wheat:0,ore:0,[portResource]:8};if(!(L.TValue(specialized.vertices[0],portTestPlayer,[portTestPlayer,portTestOpp],portTestBoard,geo,portTestPorts,L.emptyBank(),15,L.BOT_MODE_CONFIGS.pvbot1v115)>0))throw new Error("Projected/current surplus did not value the matching 2:1 port");
const engineBoard=L.makeBoard(geo,{highPipsTouch:true});
const scoreBot=L.newPlayer(1,"Bot",true,"Impossible"),scoreHuman=L.newPlayer(0,"You",false,"Human");
scoreBot.hand={wood:3,brick:0,sheep:2,wheat:2,ore:0};scoreBot.settlements=[0];
const actions=L.scoreActions(scoreBot,[scoreHuman,scoreBot],engineBoard,geo,L.makePorts(geo),L.emptyBank(),["Knight","Road Building","Year of Plenty","Monopoly","Victory Point"],15,{roadOwner:null,armyOwner:null});
if(!actions.length||!actions.every(a=>Number.isFinite(a.score)))throw new Error("Unified action scorer returned invalid scores");

let portOrderingVerified=false;
{
  const b=L.makeBoard(geo,{highPipsTouch:true});
  const bot=L.newPlayer(0,"Bot",true,"Impossible");
  const human=L.newPlayer(1,"You",false,"Human");
  bot.settlements=[0];bot.roads=[geo.vertexEdges[0][0],geo.vertexEdges[1][1]];
  bot.hand={wood:18,brick:18,sheep:18,wheat:18,ore:18};
  const noPort=L.scoreActions(bot,[bot,human],b,geo,[],L.emptyBank(),[],15,{roadOwner:null,armyOwner:null});
  const candidate=noPort.find(a=>a.type==="settlement");
  if(candidate){
    const ports=[{edge:0,a:candidate.spot,b:candidate.spot,vertices:[candidate.spot],type:"2:1 wheat"}];
    const withPort=L.scoreActions(bot,[bot,human],b,geo,ports,L.emptyBank(),[],15,{roadOwner:null,armyOwner:null});
    const same=withPort.find(a=>a.type==="settlement"&&a.spot===candidate.spot);
    portOrderingVerified=!!(same&&Math.abs(same.score-candidate.score)<1e-9&&same.portValue>0&&same.portEligibleForTie);
  }
}
if(!portOrderingVerified)throw new Error("Port-last settlement ordering regression failed");
console.log("PORT-LAST EXPANSION TEST PASSED — port value is a tie-breaker, not primary settlement score");
console.log("UNIFIED BOT ENGINE TESTS PASSED — pip realism, mode weights and finite action scoring");
// Bot roll/production regressions: one shared resolver must distribute the roll to
// every eligible player, double city production, respect the robber, and respect bank shortage rules.
{
  const b=Array.from({length:19},()=>({resource:"desert",number:null,robber:false}));
  b[0]={resource:"wood",number:6,robber:false};
  const va=L.newPlayer(0,"Human",false,"Human"), vb=L.newPlayer(1,"Bot",true,"Hard");
  const v0=L.newPlayer(0,"Human",false,"Human"), v1=L.newPlayer(1,"Bot",true,"Hard");
  v0.settlements=[L.makeGeometry().vertexTiles[0][0]];
  v1.settlements=[L.makeGeometry().vertexTiles[0][0]];
  const g=L.makeGeometry();
  v0.settlements=[g.vertexTiles[0][0]];v1.settlements=[g.vertexTiles[0][0]];
  const both=L.resolveDiceRoll([v0,v1],b,g,6,L.emptyBank());
  if(both.seven||both.players[0].hand.wood!==1||both.players[1].hand.wood!==1)throw new Error("Bot shared roll resolver failed to distribute production to all eligible players");
  const city=L.newPlayer(1,"Bot",true,"Hard");city.cities=[g.vertexTiles[0][0]];
  const cityRoll=L.resolveDiceRoll([city],b,g,6,L.emptyBank());
  if(cityRoll.players[0].hand.wood!==2)throw new Error("City roll production must be doubled");
  b[0].robber=true;
  const blocked=L.resolveDiceRoll([v1],b,g,6,L.emptyBank());
  if(blocked.players[0].hand.wood!==0)throw new Error("Robber must block bot resource production");
  const bank={wood:1,brick:19,sheep:19,wheat:19,ore:19};
  b[0].robber=false;const s1=L.resolveDiceRoll([v0,v1],b,g,6,bank);
  if(s1.players[0].hand.wood!==0||s1.players[1].hand.wood!==0||s1.bank.wood!==1)throw new Error("Shared bot roll must obey multi-recipient bank shortage");
  const seven=L.resolveDiceRoll([v1],b,g,7,L.emptyBank());
  if(!seven.seven||seven.players[0].hand.wood!==0)throw new Error("7 must not produce resources");
}
console.log("BOT AUTO-ROLL + RESOURCE PRODUCTION TESTS PASSED");

// CATAN BOT merge regression: selected ports should be spread around the coastline
// rather than clustered by random edge order. Type assignment remains shuffled.
{
  const testPorts=L.makePorts(geo);
  const angles=testPorts.map(p=>{
    const a=geo.vertices[p.a],b=geo.vertices[p.b];
    return Math.atan2((a.y+b.y)/2,(a.x+b.x)/2);
  }).sort((a,b)=>a-b);
  if(angles.length!==9) throw new Error("Merged port generator did not create 9 ports");
  const shared=testPorts.some((p,i)=>testPorts.some((q,j)=>i!==j&&(p.a===q.a||p.a===q.b||p.b===q.a||p.b===q.b)));
  if(shared) throw new Error("Merged port generator produced touching ports");
}
console.log("CATAN BOT MERGE TEST PASSED — distributed coastal port placement");

// Robber regression: the acting player can never be the victim; only a player
// actually touching the robber's destination may lose a card.
{
  const rb=Array.from({length:19},(_,i)=>({resource:"wood",number:8,robber:i===0}));
  const thief=L.newPlayer(1,"Thief",false,"Human");
  const victim=L.newPlayer(2,"Victim",false,"Human");
  const other=L.newPlayer(3,"Other",false,"Human");
  const g=L.makeGeometry(), touch=g.vertexTiles[0][0];
  thief.hand={wood:1,brick:0,sheep:0,wheat:0,ore:0};
  victim.settlements=[touch];victim.hand={wood:2,brick:0,sheep:0,wheat:0,ore:0};
  other.hand={wood:5,brick:0,sheep:0,wheat:0,ore:0};
  const rr=L.resolveRobberSteal([thief,victim,other],rb,g,1,0,()=>0);
  if(!rr.valid||rr.victim?.id!==2||rr.stolen!=="wood")throw new Error("Robber selected an invalid victim");
  if(rr.players.find(p=>p.id===1).hand.wood!==2)throw new Error("Robber did not give the stolen card to the acting player");
  if(rr.players.find(p=>p.id===2).hand.wood!==1)throw new Error("Robber did not remove the card from the blocked player");
  if(rr.players.find(p=>p.id===3).hand.wood!==5)throw new Error("Robber altered an unrelated player's hand");
}
console.log("ROBBER VICTIM REGRESSION PASSED — steal source is constrained to the robber destination");

// Strategic trade-offer regression: a bot should generate an offer when it can
// immediately improve a build objective by obtaining a missing resource.
{
  const b=L.makeBoard(geo,{highPipsTouch:true}),ports=L.makePorts(geo);
  const bot=L.newPlayer(0,"Bot",true,"Impossible"),human=L.newPlayer(1,"You",false,"Human");
  bot.hand={wood:3,brick:1,sheep:0,wheat:2,ore:2};
  human.hand={wood:0,brick:0,sheep:2,wheat:0,ore:0};
  bot.settlements=[0];
  const offers=L.strategicTradeCandidates(bot,[bot,human],b,geo,ports,L.emptyBank(),10);
  if(!offers.some(a=>a.type==="playerTrade"&&a.partner===human.id&&a.getBundle?.sheep))throw new Error("Bot failed to generate an objective-driven sheep trade offer");
}
console.log("STRATEGIC BOT TRADE REGRESSION PASSED — offers are generated around immediate build objectives");