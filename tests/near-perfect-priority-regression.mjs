import fs from 'node:fs';

const src=fs.readFileSync(new URL('../src/main.jsx', import.meta.url),'utf8');
const mustInclude=[
  'BOT_HAND_PRESSURE_THRESHOLD=9',
  'BOT_LONGEST_ROAD_PRIORITY=0.05',
  'const strongGoal=rp.port>0||rp.best>=11||rp.future>=13||winsViaLongest;',
  'if(handPressure>0)score+=handPressure*1.55;',
  'const best=ranked[0]||null;',
  'longestGain*BOT_LONGEST_ROAD_PRIORITY',
];
for(const needle of mustInclude){
  if(!src.includes(needle)) throw new Error(`missing v63 strategy guard: ${needle}`);
}
console.log('V63 NEAR-PERFECT PRIORITY REGRESSION PASSED — low Longest Road priority + 9-card hand safety');