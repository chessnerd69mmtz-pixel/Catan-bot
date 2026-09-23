import React, { useMemo, useState } from "react";
import {
  ADVANCED_AI_VERSION,
  BOT_PERSONALITIES,
  eloRows,
  loadEloStore,
  monteCarloPlacement,
  rankMonteCarloPlacements,
  heatmapForFrame,
  personalityForBot,
  summarizeAiPerformance
} from "./advanced-ai.mjs";
import { makeGeometry } from "../tests/logic-core.mjs";

const fmt = n => Number.isFinite(n) ? Number(n).toFixed(1) : "—";

export default function AdvancedAiPanel({history = [], onClose, onOpenReplay, renderHeatmapBoard}) {
  const [eloStore, setEloStore] = useState(() => loadEloStore());
  const [selectedGameId, setSelectedGameId] = useState(() => (history.find(g => g?.result)?.gameId || history.find(g => g?.result)?.id || ""));
  const [selectedBot, setSelectedBot] = useState("Maya");
  const [mcRunning, setMcRunning] = useState(false);
  const [mcResults, setMcResults] = useState([]);
  const [heatmapData, setHeatmapData] = useState(null);

  const games = useMemo(() => history.filter(g => g?.result && Array.isArray(g?.players)), [history]);
  const selectedGame = games.find(g => String(g.gameId || g.id) === String(selectedGameId)) || games[0] || null;
  const personalities = Object.values(BOT_PERSONALITIES);
  const performance = useMemo(() => summarizeAiPerformance(games), [games]);
  const ratings = useMemo(() => eloRows(eloStore), [eloStore]);

  const findFrame = () => {
    if (!selectedGame?.analysisFrames?.length) return null;
    return selectedGame.analysisFrames.find(frame => {
      const p = selectedGame.players?.find(x => x.id === frame.playerId);
      if (!p?.bot) return false;
      if (selectedBot && p.name !== selectedBot) return false;
      return (frame.decisions || []).some(d => d?.action?.type === "settlement");
    }) || selectedGame.analysisFrames.find(frame => (frame.decisions || []).some(d => d?.action?.type === "settlement")) || null;
  };

  const loadHeatmap = () => {
    const frame = findFrame();
    if (!frame) return;
    const geo = makeGeometry();
    const enrichedFrame = {...frame, geo};
    const data = heatmapForFrame(enrichedFrame, personalityForBot(selectedBot).id);
    setHeatmapData(data);
  };

  const runMonteCarlo = () => {
    if (!selectedGame?.players?.length || !selectedGame?.board?.length) return;
    const geo = makeGeometry();
    const bot = selectedGame.players.find(p => p.bot && (!selectedBot || p.name === selectedBot)) || selectedGame.players.find(p => p.bot) || selectedGame.players[0];
    if (!bot) return;
    setMcRunning(true);
    setMcResults([]);
    window.setTimeout(() => {
      try {
        const results = rankMonteCarloPlacements({
          board: selectedGame.board,
          player: bot,
          players: selectedGame.players,
          geo,
          ports: selectedGame.ports || [],
          targetCount: 8,
          turns: 18,
          samples: 70,
          personalityId: personalityForBot(bot.personality || bot.name).id
        });
        setMcResults(results);
      } finally {
        setMcRunning(false);
      }
    }, 40);
  };

  return <div className="advancedAiOverlay refOverlay">
    <div className="advancedAiCard refOverlayCard">
      <button className="refClose" onClick={onClose}>×</button>
      <div className="refOverlayHead advancedAiHeader">
        <div>
          <span className="eyebrow">ADVANCED CATAN AI · {ADVANCED_AI_VERSION.toUpperCase()}</span>
          <h2>AI LAB</h2>
          <p>ELO, distinct bot personalities, bounded Monte Carlo placement analysis, settlement heatmaps and replay access. No tournament/bracket system is included.</p>
        </div>
        <div className="refOverlayMetric"><span>RATED GAMES</span><b>{eloRows(eloStore).reduce((n,x) => n + x.games, 0) / 2 | 0}</b></div>
      </div>

      <div className="advancedAiGrid">
        <section className="advancedAiSection eloSection">
          <div className="advancedAiSectionHead"><div><span className="eyebrow">PERSISTENT RATING</span><h3>ELO LADDER</h3></div><span className="advancedAiK">K={eloStore.kFactor || 32}</span></div>
          <div className="advancedAiRatings">{ratings.map((row, i) => <article className="advancedAiRating" key={row.key}>
            <div className="advancedAiRank">{i + 1}</div><div className="advancedAiAvatar">{row.key === "human" ? "YOU" : row.label.slice(0,2).toUpperCase()}</div>
            <div className="advancedAiRatingBody"><b>{row.label}</b><span>{row.title}</span><small>{row.games} games · {row.wins}W / {row.losses}L / {row.draws}D</small></div>
            <strong>{Math.round(row.rating)}</strong><em className={row.lastDelta > 0 ? "up" : row.lastDelta < 0 ? "down" : ""}>{row.lastDelta > 0 ? "+" : ""}{row.lastDelta}</em>
          </article>)}</div>
        </section>

        <section className="advancedAiSection performanceSection">
          <div className="advancedAiSectionHead"><div><span className="eyebrow">RECORDED PERFORMANCE</span><h3>BOT PROFILING</h3></div></div>
          <div className="advancedAiPerformance">{performance.length ? performance.map(row => <div className="advancedAiPerfRow" key={row.key}><div><b>{row.name} · {row.title}</b><small>{row.games} completed games · {Math.round(row.winRate * 100)}% wins · {row.accuracy == null ? "—" : fmt(row.accuracy) + "%"} accuracy</small></div><strong>{row.avgSettlementChoices.toFixed(1)}</strong></div>) : <div className="advancedAiEmpty">Complete a match to build AI performance data.</div>}</div>
        </section>
      </div>

      <section className="advancedAiSection personalitySection">
        <div className="advancedAiSectionHead"><div><span className="eyebrow">PLAYSTYLE PROFILES</span><h3>BOT PERSONALITIES</h3></div></div>
        <div className="advancedAiPersonalityGrid">{personalities.map(p => <article className="advancedAiPersonality" key={p.id} data-accent={p.accent}><div className="advancedAiBotIcon">🤖</div><div><b>{p.name}</b><h4>{p.title}</h4><p>{p.description}</p><div className="advancedAiPriorityRow">{p.priorities.map(x => <span key={x}>{x}</span>)}</div></div></article>)}</div>
      </section>

      <div className="advancedAiGrid">
        <section className="advancedAiSection mcSection">
          <div className="advancedAiSectionHead"><div><span className="eyebrow">SEARCH</span><h3>MONTE CARLO PLACEMENT LAB</h3></div><select value={selectedGame ? (selectedGame.gameId || selectedGame.id) : ""} onChange={e => setSelectedGameId(e.target.value)}><option value="">Select a completed game</option>{games.map(g => <option key={g.gameId || g.id} value={g.gameId || g.id}>{g.winner || "Game"} · {new Date(g.date).toLocaleDateString()}</option>)}</select></div>
          <p className="advancedAiDescription">Runs short randomized placement rollouts from a saved board. It is a placement-focused simulation, not a guarantee of the final game result.</p>
          <div className="advancedAiControls"><select value={selectedBot} onChange={e => setSelectedBot(e.target.value)}>{Object.values(BOT_PERSONALITIES).map(p => <option key={p.name}>{p.name}</option>)}</select><button className="refPrimaryButton" onClick={runMonteCarlo} disabled={!selectedGame || mcRunning}>{mcRunning ? "SIMULATING…" : "RUN 70 × 18-ROLL SEARCH"}</button></div>
          <div className="advancedAiMcList">{mcResults.length ? mcResults.map((r, i) => <div className={"advancedAiMcRow " + (i === 0 ? "best" : "")} key={r.vertex}><div className="advancedAiMcRank">{i + 1}</div><div><b>Intersection {r.vertex}</b><small>Heuristic {fmt(r.heuristic)} · P10 {fmt(r.p10)} · P90 {fmt(r.p90)}</small></div><strong>{fmt(r.mean)}</strong><span>{Math.round(r.confidence * 100)}% stable</span></div>) : <div className="advancedAiEmpty">Choose a completed game and run the bounded Monte Carlo placement search.</div>}</div>
        </section>

        <section className="advancedAiSection heatmapSection">
          <div className="advancedAiSectionHead"><div><span className="eyebrow">EXPLAINABILITY</span><h3>SETTLEMENT HEATMAP</h3></div><div className="advancedAiControls compact"><select value={selectedBot} onChange={e => setSelectedBot(e.target.value)}>{Object.values(BOT_PERSONALITIES).slice(0,3).map(p => <option key={p.name}>{p.name}</option>)}</select><button className="refGhostButton" onClick={loadHeatmap} disabled={!selectedGame}>SHOW HEATMAP</button></div></div>
          <div className="advancedAiHeatmapPanel">{heatmapData ? <><div className="advancedAiChosen"><b>{heatmapData.player?.name || selectedBot}</b><span>Chosen intersection: {heatmapData.chosenVertex == null ? "Not captured" : heatmapData.chosenVertex}</span><em>{heatmapData.personality?.title || "Strategy profile"}</em></div>{renderHeatmapBoard?.({geo:heatmapData.geo,board:heatmapData.board,players:heatmapData.players,ports:heatmapData.ports,scores:heatmapData.scores,chosenVertex:heatmapData.chosenVertex})}<div className="advancedAiHeatRows">{heatmapData.scores.slice(0,10).map((r,i)=><div key={r.v} className={r.chosen ? "chosen" : ""}><span>#{i + 1}</span><b>Intersection {r.v}</b><small>{r.port ? "Port · " : ""}{r.numbers.join("/") || "—"} · {r.diversity}/5 resources</small><strong>{fmt(r.score)}</strong></div>)}</div></> : <div className="advancedAiEmpty">Load a bot settlement decision from a completed game to explain its spot choice.</div>}</div>
        </section>
      </div>

      <section className="advancedAiSection replaySection">
        <div className="advancedAiSectionHead"><div><span className="eyebrow">GAME REPLAY</span><h3>TURN-BY-TURN REVIEW</h3></div>{selectedGame && <button className="refPrimaryButton" onClick={() => onOpenReplay?.(selectedGame)}>OPEN FULL REPLAY →</button>}</div>
        <div className="advancedAiReplayStrip">{selectedGame ? <><span>{selectedGame.winner || selectedGame.result || "Completed game"}</span><span>{selectedGame.analysisFrames?.length || 0} analysis turns</span><span>{(selectedGame.players || []).map(p => p.name).join(" · ")}</span><span>{selectedGame.gameMode === "1v1" ? "1v1 · 15 VP" : "4 PLAYER · 10 VP"}</span></> : <span>Complete a match to unlock replay.</span>}</div>
      </section>
    </div>
  </div>;
}
