import fs from "fs";

const core=fs.readFileSync(new URL("./logic-core.mjs", import.meta.url),"utf8");
const main=fs.readFileSync(new URL("../src/main.jsx", import.meta.url),"utf8");
if(!/ranked1v1:\{targetVP:15,discardIfHandOver:9/.test(core)) throw new Error("1v1 discard threshold is not 9");
if(!/standard:\{targetVP:10,discardIfHandOver:7/.test(core)) throw new Error("standard discard threshold is not 7");
if(!/return \(isPvBot\|\|playerCount===2\) \? 9 : 7/.test(main)) throw new Error("UI discard threshold logic mismatch");
if(!/setDiscardState\(\{queue:humanQueue,index:0,playerId:pid,remaining:required\}\)/.test(main)) throw new Error("7-roll human discard gate missing");
if(!/if\(discardState\)/.test(main)) throw new Error("Timer/action discard gate missing");
if(!/MANDATORY:<\/b> You cannot continue until exactly/.test(main)) throw new Error("Mandatory discard UI message missing");
console.log("DISCARD RULES REGRESSION PASSED — 1v1 >9, standard >7, mandatory UI gate present");