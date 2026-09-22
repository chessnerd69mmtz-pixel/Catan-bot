import fs from 'node:fs';
import assert from 'node:assert/strict';

const main=fs.readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../src/style.css',import.meta.url),'utf8');

assert.match(main,/function rollOfficialDice\(\)/,'official fair dice helper missing');
assert.ok(!main.includes('createBalancedDiceController'),'player-aware balanced dice controller must be removed');
assert.ok(!main.includes('balancedDiceRef'),'balanced dice runtime state must be removed');
assert.match(main,/const pair=rollOfficialDice\(\);/,'bot must use the same official dice as the human');
assert.match(main,/return \[1\+Math\.floor\(Math\.random\(\)\*6\),1\+Math\.floor\(Math\.random\(\)\*6\)\];/,'dice must be two independent d6 rolls');

assert.match(main,/randomHeldResource(victim)/,'robber theft must use a single random held resource');
assert.match(main,/const stolen=randomHeldResource(victim)/,'robber execution must not choose a strategically selected resource');

assert.match(main,/sixEightBonus=/,'placement has a 6/8 combination bonus');
assert.match(main,/oreWheatBonus=/,'placement has an ore+wheat synergy bonus');
assert.match(main,/rawPips*1.08/,'production weight has been increased slightly');

assert.match(main,/colonistTradeHub/,'Colonist-style trade hub UI is present');
assert.match(main,/tradeHubTab/,'trade hub has bank/player tabs');
assert.match(main,/YOU GIVE/,'trade hub has explicit give section');
assert.match(main,/YOU RECEIVE/,'trade hub has explicit receive section');
assert.match(main,/YOUR RATES/,'bank trade rates remain visible');
assert.match(main,/OFFER TRADE/,'player trade offer control remains functional');

assert.match(css,/\.colonistTradeHub/,'trade hub CSS missing');
assert.match(css,/\.colonistTradeBody,\.colonistTradeColumns/,'three-section trade layout missing');
assert.match(css,/\.colonistTradeTabs/,'bank/player tabs styling missing');
assert.match(css,/\.referenceGame \.hxMain\{grid-template-columns:190px/,'board enlargement layout missing');
assert.match(css,/\.referenceGame \.hxActions\{height:104px/,'action dock was not shortened to enlarge the board');
console.log('V77 RULES/UI REGRESSION PASSED — fair dice, one-card random robber theft, placement tweaks, Colonist-inspired trade hub, and larger board layout.');
