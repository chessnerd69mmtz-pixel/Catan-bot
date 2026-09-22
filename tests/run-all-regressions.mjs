import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
const dir = new URL('.', import.meta.url);
const files = readdirSync(dir).filter(x => x.endsWith('-regression.mjs') || x === 'robber-house-rule-test.mjs').sort();
let failed = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, [new URL(file, dir).pathname], { stdio: 'inherit' });
  if (result.status !== 0) failed = result.status || 1;
}
if (failed) process.exit(failed);
console.log('ALL REGRESSION TESTS PASSED');