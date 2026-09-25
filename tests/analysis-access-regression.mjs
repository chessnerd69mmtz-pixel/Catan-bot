import fs from "node:fs";
const src=fs.readFileSync(new URL("../src/main.jsx",import.meta.url),"utf8");

const required=[
  ["interactive custom-board entry", 'CUSTOM BOARD BUILDER →'],
  ["interactive board analysis action", 'ANALYZE POSITION →'],
  ["interactive board edit route", 'setScreen("engineSetup")'],
  ["engine analysis route", 'setScreen("engineAnalysis")'],
  ["saved-game analyzer entry", "openHistoryAnalyze(g)"],
  ["saved-game replay state", "setAnalysisReplay(game)"],
  ["saved-game engine analysis", 'analyzeGameRecord(game,geo,{N:24,horizon:6})'],
  ["saved turn frames supported", "g.analysisFrames?.length"],
  ["saved decisions fallback supported", "g.decisions?.length"],
  ["bot-match analysis filter", 'setAnalysisHistoryFilter("bot")'],
  ["bot-match detection", '(g.players||[]).some(p=>p.bot)'],
  ["completed games preserve analysis frames", "analysisFrames:clone(analysisFramesRef.current)"],
];

for(const [label,needle] of required){
  if(!src.includes(needle)) throw new Error(`Analysis access regression: missing ${label}: ${needle}`);
}

// The custom board must lead to the engine analysis page, while saved games
// must lead to replay analysis rather than merely showing a frozen result.
const customIdx=src.indexOf('CUSTOM BOARD BUILDER →');
const customWindow=src.slice(customIdx,customIdx+2500);
if(!customWindow.includes("startEngineSetup")) throw new Error("Custom board builder no longer opens the interactive board editor.");

const historyIdx=src.indexOf("const openHistoryAnalyze=");
const historyWindow=src.slice(historyIdx,historyIdx+5200);
for(const needle of ["setTab(\"historyAnalyze\")","setScreen(\"playing\")","analyzeGameRecord(game,geo,{N:24,horizon:6})","setAnalysisReplay(enriched)"]){
  if(!historyWindow.includes(needle)) throw new Error(`Saved bot-game analysis path missing: ${needle}`);
}

console.log("ANALYSIS ACCESS REGRESSION PASSED — interactive custom board + saved bot-game replay analysis are both wired.");
