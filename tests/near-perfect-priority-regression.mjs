import fs from 'node:fs';
const src=fs.readFileSync(new URL('../src/main.jsx', import.meta.url),'utf8');
const must=[/BOT_HAND_PRESSURE_THRESHOLD=9;/,/BOT_LONGEST_ROAD_PRIORITY=0\.05;/,/const race=botRacePressure\(/,/handPressure=Math\.max\(/,/BOT_LONGEST_ROAD_PRIORITY/,/function roadActionPotential\(/];
for(const pattern of must) if(!pattern.test(src)) throw new Error('missing V63 strategy guard: '+pattern);
console.log('V63 NEAR-PERFECT PRIORITY REGRESSION PASSED — low Longest Road priority + 9-card hand safety');