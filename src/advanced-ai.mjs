// Advanced Catan AI layer: personalities, ELO, placement Monte Carlo and heatmaps.
// This module is deliberately UI-agnostic so gameplay and analytics can share one model.

export const ADVANCED_AI_VERSION = "advanced-catan-ai-v1";

export const BOT_PERSONALITIES = Object.freeze({
  balanced: {
    id: "balanced",
    name: "Maya",
    title: "Balanced Strategist",
    description: "Balances production, diversity, cities and development cards.",
    accent: "cyan",
    priorities: ["production", "diversity", "city", "defense"]
  },
  expansionist: {
    id: "expansionist",
    name: "Rook",
    title: "Expansionist",
    description: "Values road access, settlement chains, blocking and Longest Road pressure.",
    accent: "lime",
    priorities: ["expansion", "blocking", "wood-brick", "longest-road"]
  },
  trader: {
    id: "trader",
    name: "Nova",
    title: "Port Specialist",
    description: "Builds around tradable resource surpluses and efficient port positions.",
    accent: "pink",
    priorities: ["ports", "surplus", "resource-access", "flexibility"]
  },
  raider: {
    id: "raider",
    name: "Atlas",
    title: "Knight Raider",
    description: "Prioritizes development cards, robber pressure and Largest Army routes.",
    accent: "red",
    priorities: ["development", "knights", "robber", "denial"]
  },
  diversifier: {
    id: "diversifier",
    name: "Vega",
    title: "Resource Diversifier",
    description: "Seeks broad resource coverage and resilient production rather than one narrow combo.",
    accent: "violet",
    priorities: ["resource-count", "number-spread", "resilience", "cities"]
  }
});

export function personalityForBot(nameOrId) {
  if (!nameOrId) return BOT_PERSONALITIES.balanced;
  const key = String(nameOrId).toLowerCase();
  if (BOT_PERSONALITIES[key]) return BOT_PERSONALITIES[key];
  return Object.values(BOT_PERSONALITIES).find(p => p.name.toLowerCase() === key) || BOT_PERSONALITIES.balanced;
}

export function personalityIdForBot(nameOrId) {
  return personalityForBot(nameOrId).id;
}

export function makeAdvancedGeometry() {
  const centers=[];
  for(let q=-2;q<=2;q++) for(let r=-2;r<=2;r++) if(Math.max(Math.abs(q),Math.abs(r),Math.abs(q+r))<=2) centers.push({q,r});
  const R=76,U=Math.sqrt(3)*R/2;
  const offsets=[[U,-R/2],[U,R/2],[0,R],[-U,R/2],[-U,-R/2],[0,-R]];
  const center=(q,r)=>[U*(2*q+r),1.5*R*r];
  const key=(x,y)=>`${x.toFixed(3)},${y.toFixed(3)}`;
  const vMap=new Map(),vertices=[];
  const tiles=centers.map((c,i)=>{
    const [cx,cy]=center(c.q,c.r),vids=[];
    offsets.forEach(([dx,dy])=>{const x=cx+dx,y=cy+dy,k=key(x,y);if(!vMap.has(k)){vMap.set(k,vertices.length);vertices.push({x,y});}vids.push(vMap.get(k));});
    return {id:i,q:c.q,r:c.r,cx,cy,vertices:vids};
  });
  const edgeMap=new Map(),edges=[];
  tiles.forEach(t=>{for(let k=0;k<6;k++){const a=t.vertices[k],b=t.vertices[(k+1)%6],ek=a<b?`${a}-${b}`:`${b}-${a}`;if(!edgeMap.has(ek)){edgeMap.set(ek,edges.length);edges.push({id:edges.length,a:Math.min(a,b),b:Math.max(a,b)});}}});
  const vertexTiles=vertices.map(()=>[]),vertexEdges=vertices.map(()=>[]);
  tiles.forEach(t=>t.vertices.forEach(v=>vertexTiles[v].push(t.id)));
  edges.forEach(e=>{vertexEdges[e.a].push(e.id);vertexEdges[e.b].push(e.id);});
  const neighbors=vertices.map((_,i)=>[...new Set(vertexEdges[i].map(eid=>{const e=edges[eid];return e.a===i?e.b:e.a;}))]);
  const coastal=vertices.map((_,i)=>vertexTiles[i].length<3);
  return {tiles,vertices,edges,vertexTiles,vertexEdges,neighbors,coastal};
}

const RES = ["wood", "brick", "sheep", "wheat", "ore"];
const PIP = {2:1,3:2,4:3,5:4,6:5,8:5,9:4,10:3,11:2,12:1};

function resourcePips(vertex, board, geo) {
  const out = Object.fromEntries(RES.map(r => [r, 0]));
  for (const tid of geo?.vertexTiles?.[vertex] || []) {
    const t = board?.[tid];
    if (!t || t.resource === "desert" || t.robber) continue;
    out[t.resource] += PIP[t.number] || 0;
  }
  return out;
}

function numberList(vertex, board, geo) {
  return (geo?.vertexTiles?.[vertex] || [])
    .map(tid => board?.[tid]?.number)
    .filter(Number.isFinite);
}

function hasPort(vertex, ports = []) {
  return (ports || []).some(p => p && (p.a === vertex || p.b === vertex));
}

export function personalityPlacementBias(personalityOrId, vertex, board, geo, ports = [], players = []) {
  const p = personalityForBot(personalityOrId);
  const pips = resourcePips(vertex, board, geo);
  const totalPips = RES.reduce((n, r) => n + pips[r], 0);
  const kinds = RES.filter(r => pips[r] > 0).length;
  const nums = numberList(vertex, board, geo);
  const port = hasPort(vertex, ports);
  const expansion = (geo?.neighbors?.[vertex] || []).filter(v => {
    const occupied = new Set(players.flatMap(x => [...(x.settlements || []), ...(x.cities || [])]));
    return !occupied.has(v);
  }).length;
  const woodBrick = Math.min(pips.wood, pips.brick);
  const oreWheat = Math.min(pips.ore, pips.wheat);
  const highPips = nums.filter(n => n === 6 || n === 8).length;
  switch (p.id) {
    case "expansionist":
      return expansion * 0.60 + woodBrick * 0.28 + (highPips ? 0.10 : 0);
    case "trader":
      return (port ? 3.8 : 0) + totalPips * 0.035 + kinds * 0.20;
    case "raider":
      return totalPips * 0.030 + highPips * 0.55 + (pips.ore + pips.sheep) * 0.025;
    case "diversifier":
      return kinds * 0.78 + nums.length * 0.12 - (kinds === 1 ? 0.35 : 0);
    case "balanced":
    default:
      return kinds * 0.34 + oreWheat * 0.08 + woodBrick * 0.05;
  }
}

export function personalityActionBias(personalityOrId, action, player = {}, context = {}) {
  const p = personalityForBot(personalityOrId);
  const board = context.board || [];
  const geo = context.geo;
  const ports = context.ports || [];
  const vertex = Number.isInteger(action?.spot) && action?.type === "settlement" ? action.spot : null;
  const placement = vertex == null ? 0 : personalityPlacementBias(p, vertex, board, geo, ports, context.players || []);
  let bias = placement;
  if (action?.type === "road") {
    if (p.id === "expansionist") bias += 1.9;
    if (p.id === "trader" && Number.isFinite(context.portRoadValue)) bias += context.portRoadValue;
  }
  if (action?.type === "trade" || action?.type === "playerTrade") {
    if (p.id === "trader") bias += 2.6;
    if (p.id === "expansionist") bias -= 0.35;
  }
  if (action?.type === "buyDev" || action?.type === "play") {
    if (p.id === "raider") bias += 2.3;
    if (p.id === "balanced") bias += 0.35;
    if (p.id === "expansionist") bias -= 0.25;
  }
  if (action?.card === "Knight" && p.id === "raider") bias += 4;
  if (action?.type === "city") {
    if (p.id === "diversifier" || p.id === "balanced") bias += 0.6;
    if (p.id === "expansionist") bias -= 0.15;
  }
  return bias;
}

const ELO_STORAGE_KEY = "catan.advanced.elo.v1";
const DEFAULT_RATING = 1200;
const DEFAULT_K = 32;

function safeRead(storage, key, fallback) {
  try {
    const raw = storage?.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function safeWrite(storage, key, value) {
  try { storage?.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

export function eloPlayerKey(player) {
  if (!player) return "unknown";
  if (player.bot) return personalityIdForBot(player.personality || player.name);
  return "human";
}

function makeProfile(key, label) {
  const personality = BOT_PERSONALITIES[key];
  return {
    key,
    label: personality ? personality.name : label || (key === "human" ? "You" : key),
    title: personality?.title || (key === "human" ? "Human Player" : "Player"),
    rating: DEFAULT_RATING,
    games: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    lastDelta: 0,
    history: []
  };
}

export function defaultEloStore() {
  const profiles = { human: makeProfile("human", "You") };
  for (const p of Object.values(BOT_PERSONALITIES)) profiles[p.id] = makeProfile(p.id, p.name);
  return {version: 1, kFactor: DEFAULT_K, appliedGames: [], profiles};
}

export function loadEloStore(storage = typeof localStorage !== "undefined" ? localStorage : null) {
  const base = defaultEloStore();
  const stored = safeRead(storage, ELO_STORAGE_KEY, null);
  if (!stored || typeof stored !== "object") return base;
  const profiles = {...base.profiles};
  for (const [key, value] of Object.entries(stored.profiles || {})) {
    profiles[key] = {...makeProfile(key, value?.label), ...value, history: Array.isArray(value?.history) ? value.history.slice(-50) : []};
  }
  return {
    version: stored.version || 1,
    kFactor: Number(stored.kFactor) || DEFAULT_K,
    appliedGames: Array.isArray(stored.appliedGames) ? stored.appliedGames.slice(-500) : [],
    profiles
  };
}

export function saveEloStore(store, storage = typeof localStorage !== "undefined" ? localStorage : null) {
  return safeWrite(storage, ELO_STORAGE_KEY, store);
}

function expected(a, b) {
  return 1 / (1 + Math.pow(10, (b - a) / 400));
}

export function applyEloGame(game, store = defaultEloStore(), options = {}) {
  const gameId = game?.gameId || game?.id;
  if (!gameId || !Array.isArray(game?.players) || game.players.length < 2) return {store, applied: false, changes: {}};
  if (store.appliedGames.includes(String(gameId))) return {store, applied: false, changes: {}};

  const k = Number(options.kFactor || store.kFactor || DEFAULT_K);
  const players = game.players.map(p => ({...p, eloKey: eloPlayerKey(p)}));
  const next = typeof structuredClone === "function" ? structuredClone(store) : JSON.parse(JSON.stringify(store));
  const changes = {};
  players.forEach(p => {
    if (!next.profiles[p.eloKey]) next.profiles[p.eloKey] = makeProfile(p.eloKey, p.bot ? p.name : "You");
  });

  const scores = Object.fromEntries(players.map(p => [p.id, 0.5]));
  if (game.result !== "draw") {
    const winnerId = game.winnerId;
    players.forEach(p => { scores[p.id] = p.id === winnerId ? 1 : 0; });
  }
  const baseRatings = Object.fromEntries(players.map(p => [p.eloKey, next.profiles[p.eloKey].rating]));

  players.forEach(p => {
    const opponents = players.filter(o => o.id !== p.id);
    const actual = opponents.reduce((sum) => sum + scores[p.id], 0) / Math.max(1, opponents.length);
    const avgExpected = opponents.reduce((sum, o) => sum + expected(baseRatings[p.eloKey], baseRatings[o.eloKey]), 0) / Math.max(1, opponents.length);
    const delta = Math.round(k * (actual - avgExpected));
    const profile = next.profiles[p.eloKey];
    profile.rating += delta;
    profile.games += 1;
    if (game.result === "draw") profile.draws += 1;
    else if (p.id === game.winnerId) profile.wins += 1;
    else profile.losses += 1;
    profile.lastDelta = delta;
    profile.history = [...(profile.history || []), {gameId: String(gameId), rating: profile.rating, delta, result: game.result === "draw" ? "draw" : (p.id === game.winnerId ? "win" : "loss"), at: Date.now()}].slice(-50);
    changes[p.eloKey] = delta;
  });

  next.appliedGames = [...next.appliedGames, String(gameId)].slice(-500);
  return {store: next, applied: true, changes};
}

export function recordEloGame(game, storage = typeof localStorage !== "undefined" ? localStorage : null) {
  const store = loadEloStore(storage);
  const result = applyEloGame(game, store);
  if (result.applied) saveEloStore(result.store, storage);
  return result;
}

export function eloRows(store = loadEloStore()) {
  return Object.values(store.profiles || {})
    .filter(Boolean)
    .sort((a, b) => b.rating - a.rating);
}

function cloneHand(hand) {
  return Object.fromEntries(RES.map(r => [r, Math.max(0, Number(hand?.[r] || 0))]));
}

function roll2d6(rng) {
  return 2 + Math.floor(rng() * 6) + Math.floor(rng() * 6);
}

function canPay(hand, cost) {
  return Object.entries(cost).every(([r, n]) => (hand[r] || 0) >= n);
}

const BUILD_TARGETS = [
  {name: "city", value: 18, cost: {wheat: 2, ore: 3}},
  {name: "settlement", value: 14, cost: {wood: 1, brick: 1, sheep: 1, wheat: 1}},
  {name: "development", value: 7, cost: {ore: 1, sheep: 1, wheat: 1}}
];

function runPlacementRollout({vertex, board, player, geo, turns, rng, personalityId}) {
  const hand = cloneHand(player?.hand);
  const settlements = [...(player?.settlements || []), vertex];
  const cities = [...(player?.cities || [])];
  let score = 0;
  let builds = 0;
  let blocked = 0;
  const resourceTotals = Object.fromEntries(RES.map(r => [r, 0]));
  for (let t = 0; t < turns; t++) {
    const roll = roll2d6(rng);
    if (roll === 7) {
      blocked++;
      const cards = RES.flatMap(r => Array.from({length: hand[r] || 0}, () => r));
      while (cards.length > Math.max(7, Math.floor(cards.length / 2))) cards.splice(Math.floor(rng() * cards.length), 1);
      for (const r of RES) hand[r] = Math.max(0, cards.filter(x => x === r).length);
      continue;
    }
    for (const v of [...settlements, ...cities]) {
      const mult = cities.includes(v) ? 2 : 1;
      for (const tid of geo?.vertexTiles?.[v] || []) {
        const tile = board?.[tid];
        if (!tile || tile.resource === "desert" || tile.robber) continue;
        if (tile.number === roll) {
          hand[tile.resource] = Math.min(19, (hand[tile.resource] || 0) + mult);
          resourceTotals[tile.resource] += mult;
        }
      }
    }

    const complete = BUILD_TARGETS.find(x => canPay(hand, x.cost));
    if (complete) {
      for (const [r, n] of Object.entries(complete.cost)) hand[r] -= n;
      builds++;
      score += complete.value;
    }
  }
  const kinds = RES.filter(r => resourceTotals[r] > 0).length;
  const production = RES.reduce((s, r) => s + resourceTotals[r], 0);
  const personalityBonus = personalityActionBias(personalityId, {type: "settlement", spot: vertex}, player, {board, geo, players:[player]});
  score += production * 0.34 + kinds * 1.8 + builds * 4 + personalityBonus;
  if (personalityForBot(personalityId).id === "trader") {
    const surplus = Math.max(...RES.map(r => resourceTotals[r] || 0));
    score += surplus * 0.08;
  }
  return {score, builds, blocked, resourceTotals};
}

export function monteCarloPlacement({
  vertex,
  board,
  player,
  geo,
  turns = 18,
  samples = 80,
  personalityId = "balanced",
  seed = Math.floor(Math.random() * 0xffffffff)
}) {
  let state = Number(seed) >>> 0;
  const rng = () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  const results = [];
  for (let i = 0; i < samples; i++) results.push(runPlacementRollout({vertex, board, player, geo, turns, rng, personalityId}).score);
  const mean = results.reduce((a, b) => a + b, 0) / Math.max(1, results.length);
  const variance = results.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / Math.max(1, results.length);
  const sigma = Math.sqrt(variance);
  const low = [...results].sort((a,b) => a-b)[Math.max(0, Math.floor(results.length * 0.1))] ?? mean;
  const high = [...results].sort((a,b) => a-b)[Math.min(results.length - 1, Math.floor(results.length * 0.9))] ?? mean;
  return {vertex, mean, sigma, p10: low, p90: high, samples: results.length, confidence: sigma > 0 ? Math.max(0, Math.min(1, 1 - sigma / Math.max(1, Math.abs(mean)))) : 1};
}

function isLegalSettlement(vertex, players, geo) {
  if (!Number.isInteger(vertex) || !geo?.vertices?.[vertex]) return false;
  const occupied = new Set(players.flatMap(p => [...(p.settlements || []), ...(p.cities || [])]));
  if (occupied.has(vertex)) return false;
  return !(geo.neighbors?.[vertex] || []).some(n => occupied.has(n));
}

export function rankMonteCarloPlacements({board, player, players, geo, ports = [], targetCount = 10, turns = 18, samples = 80, personalityId = player?.personality || personalityIdForBot(player?.name)}) {
  const legal = Array.from({length: geo.vertices.length}, (_, v) => v).filter(v => isLegalSettlement(v, players, geo));
  const heuristic = legal.map(v => {
    const pips = resourcePips(v, board, geo);
    const kinds = RES.filter(r => pips[r] > 0).length;
    const port = hasPort(v, ports);
    const score = RES.reduce((n, r) => n + pips[r], 0) + kinds * 0.55 + (port ? 2.6 : 0) + personalityPlacementBias(personalityId, v, board, geo, ports, players);
    return {vertex: v, heuristic: score};
  }).sort((a,b) => b.heuristic - a.heuristic).slice(0, Math.max(targetCount, 4));
  return heuristic.map(h => ({...h, ...monteCarloPlacement({vertex: h.vertex, board, player, geo, turns, samples, personalityId})}))
    .sort((a,b) => b.mean - a.mean);
}

export function heatmapForFrame(frame, personalityId = null) {
  const before = frame?.before || {};
  const players = before.players || frame?.players || [];
  const board = before.board || frame?.board || [];
  const playerId = frame?.playerId;
  const player = players.find(p => p.id === playerId) || players[0];
  const geo = frame?.geo || null;
  if (!geo || !player || !board.length) return {scores: [], chosenVertex: null, player: null, board, players, ports: before.ports || frame?.ports || []};
  const ports = before.ports || frame?.ports || [];
  const personality = personalityForBot(personalityId || player.personality || player.name);
  const legal = Array.from({length: geo.vertices.length}, (_, v) => v).filter(v => isLegalSettlement(v, players, geo));
  const chosen = (frame?.decisions || []).find(d => d?.action?.type === "settlement")?.action?.spot ?? null;
  const scores = legal.map(vertex => {
    const pips = resourcePips(vertex, board, geo);
    const nums = numberList(vertex, board, geo);
    const production = RES.reduce((n, r) => n + pips[r], 0);
    const diversity = RES.filter(r => pips[r] > 0).length;
    const bias = personalityPlacementBias(personality, vertex, board, geo, ports, players);
    const score = production * 1.2 + diversity * 2.4 + nums.filter(n => n === 6 || n === 8).length * 1.3 + bias;
    return {
      v: vertex,
      score,
      pips,
      production,
      diversity,
      numbers: nums,
      port: hasPort(vertex, ports),
      chosen: vertex === chosen
    };
  }).sort((a,b) => b.score - a.score);
  return {scores, chosenVertex: chosen, player, board, players, ports, geo, personality};
}

export function benchmarkPersonalitiesOnPosition({board, players, geo, ports = [], targetCount = 5, turns = 14, samples = 36} = {}) {
  if (!board?.length || !geo?.vertices?.length || !Array.isArray(players) || !players.length) return [];
  const anchor = players.find(p => p.bot) || players[0];
  return Object.values(BOT_PERSONALITIES).map(personality => {
    const candidate = {...anchor, bot:true, personality:personality.id, name:personality.name};
    const ranked = rankMonteCarloPlacements({
      board,
      player:candidate,
      players:players.map(p => p.id===anchor.id ? candidate : p),
      geo,
      ports,
      targetCount,
      turns,
      samples,
      personalityId:personality.id
    });
    const top=ranked[0]||null;
    const average=ranked.length ? ranked.reduce((sum,x)=>sum+x.mean,0)/ranked.length : null;
    return {
      personality:personality.id,
      name:personality.name,
      title:personality.title,
      topVertex:top?.vertex??null,
      topMean:top?.mean??null,
      averageMean:average,
      candidates:ranked.length
    };
  }).sort((a,b)=>(b.topMean??-Infinity)-(a.topMean??-Infinity));
}

export function summarizeAiPerformance(history = []) {
  const games = history.filter(g => g && g.result && Array.isArray(g.players));
  const rows = {};
  games.forEach(game => {
    (game.players || []).filter(p => p.bot).forEach(p => {
      const key = personalityIdForBot(p.personality || p.name);
      if (!rows[key]) rows[key] = {key, name: personalityForBot(key).name, title: personalityForBot(key).title, games: 0, wins: 0, losses: 0, draws: 0, accuracy: [], settlementChoices: 0};
      const r = rows[key]; r.games++;
      if (game.result === "draw") r.draws++;
      else if (p.id === game.winnerId) r.wins++;
      else r.losses++;
      const moves = (game.analysisFrames || []).flatMap(f => f.decisions || []).filter(d => d.playerId === p.id);
      const settlements = moves.filter(d => d.action?.type === "settlement").length;
      r.settlementChoices += settlements;
      if (moves.length) {
        const labels = moves.map(m => {
          const key = m.classification?.key;
          return ({blunder:20,mistake:38,inaccuracy:58,good:80,excellent:92,brilliant:98}[key] ?? 70);
        });
        r.accuracy.push(labels.reduce((a,b)=>a+b,0)/labels.length);
      }
    });
  });
  return Object.values(rows).map(r => ({
    ...r,
    winRate: r.games ? r.wins / r.games : 0,
    accuracy: r.accuracy.length ? r.accuracy.reduce((a,b)=>a+b,0)/r.accuracy.length : null,
    avgSettlementChoices: r.games ? r.settlementChoices/r.games : 0
  })).sort((a,b) => b.winRate - a.winRate);
}
