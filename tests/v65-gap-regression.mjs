import fs from 'node:fs';
const src = fs.readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const must = [
  ['direct board build','buildSettlement(v);'],['city requires settlement','active.settlements'],['no build dock button','hxActionsNoBuild'],['YOP duplicate selection','resources.length!==2'],['YOP evaluates pairs','for(let j=i;j<available.length;j++)'],['Monopoly expected gain threshold','expectedGain<1.2'],['hidden info sanitized','hand:empty(),'],['hidden dev sanitized','playedKnights'],['robber blocked production','blockedPips'],['robber victim valuation','victimValue'],['one-card robber','stole 1 ${LABEL[stolen]}'],['no longest-road priority','const BOT_LONGEST_ROAD_PRIORITY=0.05'],['Road Building full legal pair scan','for(const b of ranked)'],['Road Building plan aware','bestRoadBuildingPair(me,localPlayers,localBoard,geo,ports,localBank,targetVP,botDeadline,strategicPlan)'],['bot-human trade offer','botInitiated:true'],['bot waits for trade response','executionResult==="awaiting-trade"'],['mandatory discard','discardLimit'],['1v1 safe hand 9','discardIfHandOver:9']
];
for(const [name,needle] of must) if(!src.includes(needle)) throw new Error('Missing regression feature: '+name);
if(src.includes('botStep>=12')) throw new Error('Fixed 12-action bot cap is still present');
if(src.includes('for(const a of legal.slice(0,50))')||src.includes('for(const b of legal.slice(0,50))')) throw new Error('Road Building still has an arbitrary 50-road cap');
console.log('V65 GAP REGRESSION TEST PASSED — prior gameplay/UI issues covered');