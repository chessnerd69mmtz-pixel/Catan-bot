import fs from 'node:fs';
import assert from 'node:assert/strict';
const src=fs.readFileSync(new URL('../src/main.jsx', import.meta.url),'utf8');
assert.match(src,/function nearPerfectBotPlan\(/,'near-perfect planner is missing');
assert.match(src,/Roads are a means to an end|A road is a means to an end/i,'road objective gate is missing');
assert.match(src,/botRoadsThisTurn/,'per-turn road streak guard is missing');
assert.match(src,/score=score\*0\.10/,'raw road score compression is missing');
assert.match(src,/Immediate win is always preferred|immediateBuild/,'build-priority guard is missing');
console.log('NEAR-PERFECT BOT REGRESSION TEST PASSED');