// 사용: node test-draw.js <추첨횟수> <시드기준> <섞는시간(s)>
const { Machine } = require('../src/physics.js');
const draws = +process.argv[2] || 100, base = +process.argv[3] || 1000, mixT = +process.argv[4] || 6;
const M = new Machine({ seed: 424242 });      // 초기 배치는 항상 같다 (물리만 검증)
M.settle(3);
const snap = M.active.map(b => ({...b}));
const initRankY = [...snap].sort((a,b)=>a.y-b.y).map(b=>b.id);           // 낮은 순
const initRankX = [...snap].sort((a,b)=>a.x-b.x).map(b=>b.id);
const posY = {}, posX = {}; initRankY.forEach((id,i)=>posY[id]=i); initRankX.forEach((id,i)=>posX[id]=i);
const counts = new Array(46).fill(0), times = [];
let sumY=0,sumX=0, timeouts=0;
const dt=1/600;
const t0=Date.now();
for (let d=0; d<draws; d++){
  // 복원
  M.active.length=0; M.balls.length=0;
  for (const s of snap){ const b={...s}; M.balls.push(b); M.active.push(b); }
  M.rng = require('../src/physics.js').makeRng(base+d);
  M.reseedAir(); M.t=0; M.blower=0; M.setBlower(1); M.closeGate();
  for(let s=0;s<mixT*600;s++) M.step(dt);
  let got=null; M.onCapture = b=>{ got=b; };
  M.openGate();
  let s=0; const t1=M.t;
  while(!got && s<30*600){ M.step(dt); s++; }
  if(!got){ timeouts++; continue; }
  counts[got.id]++; times.push(M.t-t1); sumY+=posY[got.id]; sumX+=posX[got.id];
  if((d+1)%50===0) console.error('draw',d+1,'elapsed s',((Date.now()-t0)/1000).toFixed(0));
}
const n = draws-timeouts, exp=n/45;
let chi=0; for(let i=1;i<=45;i++) chi+=(counts[i]-exp)**2/exp;
times.sort((a,b)=>a-b);
console.log(JSON.stringify({draws, timeouts, chi2:+chi.toFixed(1), df:44,
  expectedChi2:'~44±9.4', minCount:Math.min(...counts.slice(1)), maxCount:Math.max(...counts.slice(1)),
  meanRankY: +(sumY/n).toFixed(2), expRank:22, meanRankX:+(sumX/n).toFixed(2),
  tMedian:+times[Math.floor(n/2)].toFixed(2), t90:+times[Math.floor(n*0.9)].toFixed(2), tMax:+times[n-1].toFixed(2)}));
console.log(counts.slice(1).join(' '));
