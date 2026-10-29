// 실제 앱처럼 한 드럼에서 7개를 연속으로 뽑으며 배출이 막히는 경우를 찾는다
// 사용: node tests/test-sequence.js <회차> <시드>
const P = require('../src/physics.js');
const runs = +process.argv[2] || 100, base = +process.argv[3] || 1;
const dt = 1 / 600;
let worst = 0; const slow = []; const hist = new Array(8).fill(0);
for (let k = 0; k < runs; k++) {
  const M = new P.Machine({ seed: base + k });
  M.settle(3); M.setBlower(1);
  for (let s = 0; s < 4 * 600; s++) M.step(dt);
  for (let n = 0; n < 7; n++) {
    let got = null; M.onCapture = (b) => { got = b; };
    M.openGate();
    let s = 0;
    while (!got && s < 60 * 600) { M.step(dt); s++; }
    const t = s * dt;
    if (!got) {
      // 막힘: 깔때기 근처 구슬 상태 출력
      const near = M.active.filter((b) => b.x * M.port.dx + b.y * M.port.dy > M.R - 2 * M.r).map((b) => {
        const sx = b.x * M.port.dx + b.y * M.port.dy, lx = b.x - sx * M.port.dx, ly = b.y - sx * M.port.dy;
        return `#${b.id} s-s0=${((sx - M.s0) / M.r).toFixed(2)}r lat=${(Math.hypot(lx, ly, b.z) / M.r).toFixed(2)}r v=${Math.hypot(b.vx, b.vy, b.vz).toFixed(3)}`;
      });
      slow.push({ run: k, pick: n + 1, t: 'STUCK', near });
      break;
    }
    worst = Math.max(worst, t); hist[n]++;
    if (t > 12) slow.push({ run: k, pick: n + 1, t: +t.toFixed(1) });
    M.closeGate();
    for (let s2 = 0; s2 < 0.6 * 600; s2++) M.step(dt);   // 다음 뽑기까지 짧은 간격
  }
}
console.log(JSON.stringify({ runs, worst: +worst.toFixed(1), slowOrStuck: slow.length }));
for (const s of slow.slice(0, 12)) console.log(JSON.stringify(s));
