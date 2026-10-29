// 스팀펑크 로또 추첨기 — 진입점: 렌더링 루프, 구슬 배달, 사운드, UI
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import Physics from './physics.js';
import { buildScene, LAYOUT, railY } from './scene.js';
import { groupOf } from './textures.js';
import { Sound } from './audio.js';

const G = 9.81;
const $ = (id) => document.getElementById(id);
const stage = $('stage');
const loading = $('loading');

/* ================================================================ 렌더러 */
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.prepend(renderer.domElement);
renderer.domElement.id = 'scene';

const camera = new THREE.PerspectiveCamera(30, 16 / 10, 0.05, 30);
const HOME_POS = new THREE.Vector3(-0.52, 1.12, 2.42);
const HOME_TARGET = new THREE.Vector3(0.06, 0.55, 0.04);
camera.position.copy(HOME_POS);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(HOME_TARGET);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minDistance = 0.85; controls.maxDistance = 3.6;
controls.minPolarAngle = 0.35; controls.maxPolarAngle = 1.48;
controls.minAzimuthAngle = -1.0; controls.maxAzimuthAngle = 1.0;
controls.rotateSpeed = 0.6; controls.zoomSpeed = 0.8;
controls.update();

let quality = Math.min(window.devicePixelRatio || 1, 1.75);
let composer, bloom;

/* ================================================================ 물리 + 장면 */
const machine = new Physics.Machine({ seed: null });
let rig;

/* ================================================================ 사운드 */
const sound = new Sound();

/* ================================================================ 구슬 배달 */
const travelers = [];
const cupBalls = new Array(7).fill(null);
let nextCup = 0;
const tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), dummy = new THREE.Object3D();

function spin(mesh, wx, wy, wz, dt) {
  const w = Math.hypot(wx, wy, wz);
  if (w < 1e-6) return;
  tmpV.set(wx / w, wy / w, wz / w);
  tmpQ.setFromAxisAngle(tmpV, w * dt);
  mesh.quaternion.premultiply(tmpQ);
}

function spawnTraveler(b) {
  const m = rig.ballMeshes.get(b.id);
  rig.scene.attach(m);                                         // 드럼 로컬 → 월드
  const curve = rig.tubeCurve;
  const t0 = curve.getTangentAt(0);
  const v0 = Math.max(0.3, b.vx * t0.x + b.vy * t0.y + b.vz * t0.z);
  const tr = {
    id: b.id, mesh: m, cup: nextCup++, phase: 'tube', len: curve.getLength(), s: 0, v: v0,
    pos: m.position.clone(), vel: new THREE.Vector3(), off: m.position.clone().sub(curve.getPointAt(0)),
    still: 0, wait: 0, restT: 0,
  };
  rig.stoppers[tr.cup].target = 1;
  travelers.push(tr);
  return tr;
}

function updateTraveler(tr, dt) {
  const L = LAYOUT, r = machine.r, m = tr.mesh;
  const curve = rig.tubeCurve;
  if (tr.phase === 'tube') {
    const u = Math.min(1, tr.s / tr.len);
    const t = curve.getTangentAt(u);
    // 속이 빈 구가 미끄럼 없이 구를 때: a = g sinθ / (1 + I/mr²) = 0.6 g sinθ
    let a = 0.6 * G * -t.y - 0.25 * tr.v;
    if (tr.v < 0.28) a += 0.9;                                 // 튜브 안 잔류 기류가 살짝 밀어줌
    tr.v = Math.max(0.05, tr.v + a * dt);
    tr.s += tr.v * dt;
    tr.off.multiplyScalar(Math.exp(-dt * 10));
    const p = curve.getPointAt(Math.min(1, tr.s / tr.len));
    tr.pos.copy(p).add(tr.off); tr.pos.y -= (L.tubeR - r) * 0.9;
    spin(m, t.z * tr.v / r, 0, -t.x * tr.v / r, dt);
    if (tr.s >= tr.len) {
      tr.phase = 'fall';
      tr.vel.copy(t).multiplyScalar(tr.v);
      sound.tick(1, 2.2);
    }
  } else if (tr.phase === 'fall') {
    tr.vel.y -= G * dt;
    tr.pos.addScaledVector(tr.vel, dt);
    // 레일 옆벽이 z 를 붙잡음
    if (Math.abs(tr.pos.z - L.railZ) > 0.004) { tr.pos.z += (L.railZ - tr.pos.z) * Math.min(1, dt * 18); tr.vel.z *= Math.exp(-dt * 12); }
    const floor = railY(tr.pos.x);
    if (tr.pos.y <= floor) {
      tr.pos.y = floor;
      if (Math.abs(tr.vel.y) > 0.25) { tr.vel.y = -tr.vel.y * 0.3; sound.tick(1, Math.abs(tr.vel.y) * 6); }
      else { tr.phase = 'rail'; tr.vel.y = 0; tr.pos.z = L.railZ; sound.tick(1, 2); }
    }
    spin(m, tr.vel.z / r, 0, -tr.vel.x / r, dt);
  } else if (tr.phase === 'rail') {
    const ang = Math.atan(L.railSlope);
    let ax = -0.6 * G * Math.sin(ang);                         // 내리막(왼쪽)으로 굴러감
    ax -= Math.sign(tr.vel.x) * 0.025;                         // 구름 저항
    tr.vel.x += ax * dt;
    tr.pos.x += tr.vel.x * dt;
    if (tr.pos.x > L.bumperX - r) { tr.pos.x = L.bumperX - r; tr.vel.x = -tr.vel.x * 0.4; sound.tick(1, 3); }
    const st = rig.stoppers[tr.cup];
    const stopX = st.x + 0.006 + r;
    if (tr.pos.x < stopX) {
      tr.pos.x = stopX;
      if (tr.vel.x < -0.06) { tr.vel.x = -tr.vel.x * 0.28; sound.tick(1, 2 + Math.abs(tr.vel.x) * 8); }
      else tr.vel.x = 0;
    }
    tr.pos.y = railY(tr.pos.x); tr.pos.z = L.railZ;
    spin(m, 0, 0, -tr.vel.x / r, dt);
    if (Math.abs(tr.vel.x) < 0.03 && tr.pos.x - stopX < 0.004) tr.still += dt; else tr.still = 0;
    if (tr.still > 0.18) { tr.phase = 'open'; rig.flaps[tr.cup].target = 1; tr.wait = 0; sound.clunk(); }
  } else if (tr.phase === 'open') {
    tr.wait += dt;
    if (tr.wait > 0.12) { tr.phase = 'drop'; tr.vel.set(0.04, 0, 0); }
  } else if (tr.phase === 'drop') {
    tr.vel.y -= G * dt;
    tr.pos.y += tr.vel.y * dt;
    const cx = L.cupX[tr.cup];
    tr.pos.x += (cx - tr.pos.x) * Math.min(1, dt * 8);
    tr.pos.z += (L.cupZ - tr.pos.z) * Math.min(1, dt * 8);
    if (tr.pos.y < railY(cx) - 0.09) { rig.stoppers[tr.cup].target = 0; }
    if (tr.pos.y <= L.cupRestY) {
      tr.pos.y = L.cupRestY;
      if (Math.abs(tr.vel.y) > 0.18) { tr.vel.y = -tr.vel.y * 0.34; sound.glass(Math.abs(tr.vel.y)); }
      else { tr.phase = 'rest'; tr.restT = 0; rig.flaps[tr.cup].target = 0; cupBalls[tr.cup] = tr; onLanded(tr); }
    }
  } else if (tr.phase === 'rest') {
    // 번호가 카메라를 향하도록 천천히 굴러 자리잡음
    tr.restT += dt;
    dummy.position.copy(tr.pos); dummy.lookAt(camera.position.x, camera.position.y, camera.position.z);
    m.quaternion.slerp(dummy.quaternion, Math.min(1, dt * 3));
  }
  m.position.copy(tr.pos);
}

function animateMechanics(dt) {
  for (const f of rig.flaps) {
    f.open += (f.target - f.open) * Math.min(1, dt * 14);
    f.pivot.rotation.z = Math.atan(LAYOUT.railSlope) - f.open * 1.7;
  }
  for (const s of rig.stoppers) {
    s.up += (s.target - s.up) * Math.min(1, dt * 12);
    s.pin.position.y = s.baseY + s.up * 0.045;
  }
}

/* ================================================================ 진행 */
const ui = {
  status: $('status'), btnBlow: $('btnBlow'), btnPick: $('btnPick'), btnAuto: $('btnAuto'), btnReset: $('btnReset'), btnView: $('btnView'),
  power: $('power'), powerOut: $('powerOut'), speed: $('speed'), speedOut: $('speedOut'), sound: $('sound'),
  resMain: $('resMain'), resBonus: $('resBonus'), resOrder: $('resOrder'), btnCopy: $('btnCopy'),
  history: $('history'), histCount: $('histCount'), btnClearHist: $('btnClearHist'), debug: $('debug'),
};
const game = { blowing: false, auto: false, picking: false, mixClock: 0, drawn: [], done: false, power: 1, timeScale: 1, autoGap: 0 };
const READY_MIX = 4;
const setStatus = (t) => { ui.status.textContent = t; };

function startBlow() {
  if (game.done) return;
  sound.init();
  machine.reseedAir();
  machine.setBlower(game.power);
  game.blowing = true; game.mixClock = 0;
  sound.clunk();
  ui.btnBlow.textContent = '송풍 정지';
  setStatus('송풍기가 돌기 시작합니다… 구슬이 떠오르는 중');
}
function stopBlow() {
  machine.setBlower(0); machine.closeGate();
  game.blowing = false; game.picking = false; game.auto = false;
  ui.btnBlow.textContent = '송풍 시작';
  ui.btnAuto.textContent = '자동 추첨';
  setStatus(game.done ? '추첨이 끝났습니다. ‘초기화’를 누르면 다시 할 수 있어요.' : '송풍을 멈췄습니다. 구슬이 가라앉습니다.');
}
function canPick() {
  return game.blowing && !game.picking && !game.done && game.drawn.length < 7 && travelers.length === 0 &&
    machine.blower > 0.9 * machine.blowerTarget && game.mixClock >= READY_MIX;
}
function pickOne() {
  if (!canPick()) return;
  sound.init();
  game.picking = true;
  machine.openGate();
  sound.clunk();
  setStatus((game.drawn.length < 6 ? (game.drawn.length + 1) + '번째' : '보너스') + ' 구슬을 뽑는 중… 배출구가 열렸습니다');
}
machine.onCapture = (b) => {
  machine.closeGate();
  game.picking = false;
  game.drawn.push(b.id);
  spawnTraveler(b);
  setStatus(b.id + '번 구슬이 튜브로 굴러 나갑니다…');
};
function onLanded(tr) {
  sound.bell(tr.cup === 6 ? 660 : 880 + tr.cup * 40, 0.18, 1.4);
  renderResults();
  if (game.drawn.length >= 7) finishDraw();
  else {
    setStatus(tr.cup < 6 ? `${tr.id}번 구슬이 ${tr.cup + 1}번 컵에 들어갔습니다.` : `보너스 구슬 ${tr.id}번!`);
    game.mixClock = Math.max(game.mixClock, READY_MIX - 1.5);
  }
}
function finishDraw() {
  game.done = true; game.auto = false;
  machine.setBlower(0); game.blowing = false;
  ui.btnBlow.textContent = '송풍 시작'; ui.btnAuto.textContent = '자동 추첨';
  const main = game.drawn.slice(0, 6).sort((a, b) => a - b), bonus = game.drawn[6];
  setStatus(`추첨 완료!  ${main.join(', ')}  + 보너스 ${bonus}`);
  saveHistory({ main, bonus, order: game.drawn.slice(), at: Date.now() });
  renderHistory();
  setTimeout(() => { sound.bell(1046, 0.14, 1.8); setTimeout(() => sound.bell(1318, 0.12, 1.8), 140); setTimeout(() => sound.bell(1568, 0.12, 2.2), 290); }, 200);
}
function startAuto() {
  if (game.done) return;
  sound.init();
  if (game.auto) { game.auto = false; ui.btnAuto.textContent = '자동 추첨'; setStatus('자동 추첨을 멈췄습니다 (송풍은 계속).'); return; }
  game.auto = true; game.autoGap = 0;
  ui.btnAuto.textContent = '자동 추첨 중단';
  if (!game.blowing) startBlow();
  setStatus('자동 추첨: 먼저 구슬을 충분히 섞습니다…');
}
function resetAll() {
  stopBlow();
  game.done = false; game.drawn = []; game.picking = false; game.mixClock = 0;
  for (const m of rig.ballMeshes.values()) rig.drum.attach(m);
  travelers.length = 0; cupBalls.fill(null); nextCup = 0;
  for (const f of rig.flaps) f.target = 0;
  for (const s of rig.stoppers) s.target = 0;
  machine.rng.stir(); machine.reset(); machine.settle(3.2);
  syncBalls();
  renderResults();
  setStatus('구슬을 다시 담았습니다. 레버를 당기거나 ‘송풍 시작’을 눌러 보세요.');
}

/* 결과 표시 / 기록 */
function chip(id) {
  const s = document.createElement('span');
  s.className = 'chip ' + (id ? 'c' + groupOf(id) : 'empty');
  s.textContent = id || '·';
  return s;
}
function renderResults() {
  const landed = cupBalls.map((t) => (t ? t.id : 0));
  const main = landed.slice(0, 6).filter(Boolean).sort((a, b) => a - b);
  ui.resMain.textContent = '';
  for (let i = 0; i < 6; i++) ui.resMain.appendChild(chip(main[i] || 0));
  ui.resBonus.textContent = ''; ui.resBonus.appendChild(chip(landed[6]));
  const order = landed.slice(0, 6).filter(Boolean);
  ui.resOrder.textContent = order.length ? order.join(' → ') + (landed[6] ? '  |  보너스 ' + landed[6] : '') : '—';
  ui.btnCopy.disabled = !game.done;
}
const HKEY = 'steampunk-lotto-history-v1';
function loadHistory() { try { return JSON.parse(localStorage.getItem(HKEY) || '[]'); } catch (e) { return []; } }
function saveHistory(rec) { try { const h = loadHistory(); h.unshift(rec); localStorage.setItem(HKEY, JSON.stringify(h.slice(0, 30))); } catch (e) { /* 저장 불가 환경 */ } }
function renderHistory() {
  const h = loadHistory();
  ui.history.textContent = '';
  for (const r of h) {
    const li = document.createElement('li');
    li.textContent = r.main.join(' · ') + ' ';
    const b = document.createElement('span'); b.className = 'b'; b.textContent = '+ ' + r.bonus; li.appendChild(b);
    const t = document.createElement('small'); t.textContent = '  ' + new Date(r.at).toLocaleString('ko-KR'); li.appendChild(t);
    ui.history.appendChild(li);
  }
  ui.histCount.textContent = h.length ? `(${h.length})` : '';
}

/* 입력 */
ui.btnBlow.addEventListener('click', () => (game.blowing ? stopBlow() : startBlow()));
ui.btnPick.addEventListener('click', pickOne);
ui.btnAuto.addEventListener('click', startAuto);
ui.btnReset.addEventListener('click', resetAll);
ui.btnView.addEventListener('click', () => { viewAnim = 1; });
ui.power.addEventListener('input', () => { game.power = ui.power.value / 100; ui.powerOut.textContent = ui.power.value + '%'; if (game.blowing) machine.setBlower(game.power); });
ui.speed.addEventListener('input', () => { game.timeScale = ui.speed.value / 100; ui.speedOut.textContent = game.timeScale.toFixed(1) + '×'; });
ui.sound.addEventListener('change', () => sound.setMuted(!ui.sound.checked));
ui.btnClearHist.addEventListener('click', () => { try { localStorage.removeItem(HKEY); } catch (e) { /* 무시 */ } renderHistory(); });
ui.btnCopy.addEventListener('click', () => {
  const txt = `로또 6/45 추첨: ${game.drawn.slice(0, 6).sort((a, b) => a - b).join(', ')} + 보너스 ${game.drawn[6]}`;
  const done = () => { ui.btnCopy.textContent = '복사됨'; setTimeout(() => (ui.btnCopy.textContent = '복사'), 1200); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, () => {}); else done();
});
window.addEventListener('keydown', (e) => {
  if (e.target && e.target.tagName === 'INPUT' && e.target.type === 'text') return;
  if (e.code === 'Space') { e.preventDefault(); pickOne(); }
  else if (e.code === 'Enter') { e.preventDefault(); game.blowing ? stopBlow() : startBlow(); }
  else if (e.key === 'm' || e.key === 'M') { ui.sound.checked = !ui.sound.checked; sound.setMuted(!ui.sound.checked); }
  else if (e.key === 'd' || e.key === 'D') { ui.debug.hidden = !ui.debug.hidden; }
});
// 레버 클릭 (드래그와 구분)
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let downAt = null;
function hitLever(ev) {
  const rc = renderer.domElement.getBoundingClientRect();
  ndc.set(((ev.clientX - rc.left) / rc.width) * 2 - 1, -((ev.clientY - rc.top) / rc.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return rig && ray.intersectObject(rig.leverHit, true).length > 0;
}
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 6 && hitLever(e)) game.blowing ? stopBlow() : startBlow();
  downAt = null;
});
renderer.domElement.addEventListener('pointermove', (e) => { if (!downAt) renderer.domElement.style.cursor = hitLever(e) ? 'pointer' : 'grab'; });

/* ================================================================ 루프 */
function syncBalls() {
  for (const b of machine.active) {
    const m = rig.ballMeshes.get(b.id);
    m.position.set(b.x, b.y, b.z);
    m.quaternion.set(b.qx, b.qy, b.qz, b.qw);
  }
}

let leverAngle = -0.12, needle = 0, viewAnim = 0;
function update(dt) {
  const sdt = dt * game.timeScale;
  machine.advance(sdt, 1 / 600, 40);
  syncBalls();
  // 충돌음
  let n = 0;
  for (const e of machine.events) { if (n++ > 7) break; sound.tick(e.k, e.s); }
  machine.events.length = 0;

  if (game.blowing) game.mixClock += sdt;
  for (const tr of travelers) updateTraveler(tr, sdt);
  for (let i = travelers.length - 1; i >= 0; i--) if (travelers[i].phase === 'rest' && travelers[i].restT > 1.2) travelers.splice(i, 1);
  // 컵 안에서 쉬는 구슬도 계속 카메라 쪽으로 정렬
  for (const tr of cupBalls) if (tr && !travelers.includes(tr)) updateTraveler(tr, sdt);
  animateMechanics(sdt);

  if (game.auto && canPick()) { game.autoGap += sdt; if (game.autoGap > (game.drawn.length ? 0.8 : 0)) { game.autoGap = 0; pickOne(); } }
  ui.btnPick.disabled = !canPick() || game.auto;
  if (game.blowing && !game.picking && !game.done && !game.auto && game.drawn.length === 0 && canPick())
    setStatus('충분히 섞였습니다. ‘번호 뽑기’ 또는 Space 로 구슬을 하나씩 꺼내세요.');

  // 기계 구동부
  const bl = machine.blower;
  rig.hub.rotation.z -= bl * 1.6 * sdt;
  for (const g of rig.gears) g.m.rotation.z += g.speed * bl * 0.5 * sdt;
  const lt = game.blowing ? 0.95 : -0.12;
  leverAngle += (lt - leverAngle) * Math.min(1, dt * 6);
  rig.lever.rotation.x = leverAngle;
  needle += (bl - needle) * Math.min(1, dt * 3);
  rig.needle.rotation.z = (135 - Math.min(1, needle / 1.25) * 270) * Math.PI / 180 + Math.sin(performance.now() / 70) * 0.01 * bl;
  const lamp = game.picking ? 0.5 + 0.5 * Math.sin(performance.now() / 120) : 0;
  rig.portLamp.material.emissive.setRGB(0.2 * lamp, 2.2 * lamp, 0.6 * lamp);
  sound.setBlower(bl);

  if (viewAnim > 0) {
    viewAnim = Math.max(0, viewAnim - dt * 1.5);
    const k = Math.min(1, dt * 4);
    camera.position.lerp(HOME_POS, k); controls.target.lerp(HOME_TARGET, k);
  }
  controls.update();
}

let last = performance.now(), slowFrames = 0, fpsAcc = 0, fpsN = 0;
function frame(now) {
  const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000)); last = now;
  update(dt);
  composer.render();
  // 느린 기기면 화질을 낮춤
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 1) {
    const fps = fpsN / fpsAcc;
    if (fps < 28 && quality > 1) { slowFrames++; if (slowFrames >= 2) { quality = Math.max(1, quality - 0.5); resize(true); slowFrames = 0; } }
    else slowFrames = 0;
    if (!ui.debug.hidden) {
      let up = 0; for (const b of machine.active) if (b.y > 0) up++;
      ui.debug.textContent = `fps ${fps.toFixed(0)} · 해상도 배율 ${quality}\n제트 중심 풍속 ${machine.air.Vp.toFixed(2)} m/s (부양 한계 ${machine.vh} m/s)\n송풍 ${bl2(machine.blower)} · 최대 구슬 속도 ${machine.stats.maxSpeed.toFixed(1)} m/s\n드럼 안 ${machine.active.length}개 · 위쪽 절반 ${up}개\n구슬 ${(machine.m * 1000).toFixed(2)} g · 지름 ${(machine.r * 200).toFixed(0)} cm`;
    }
    fpsAcc = 0; fpsN = 0;
  }
  requestAnimationFrame(frame);
}
const bl2 = (v) => v.toFixed(2);

function resize(force) {
  const w = Math.max(320, stage.clientWidth), h = Math.max(200, stage.clientHeight);
  renderer.setPixelRatio(quality);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w / h < 1.2 ? 40 : 30;
  camera.updateProjectionMatrix();
  if (composer) { composer.setPixelRatio(quality); composer.setSize(w, h); }
  if (bloom) bloom.resolution.set(w * quality, h * quality);
}
new ResizeObserver(() => resize()).observe(stage);

/* ================================================================ 시작 */
function init() {
  rig = buildScene(renderer, machine);
  const w = stage.clientWidth, h = stage.clientHeight;
  const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(rig.scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.3, 0.5, 1.6);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  resize(true);
  machine.settle(3.2);
  syncBalls();
  renderHistory(); renderResults();
  loading.classList.add('hide');
  setTimeout(() => loading.remove(), 800);
  requestAnimationFrame((t) => { last = t; frame(t); });
}
// 첫 화면(로딩 문구)을 먼저 그린 뒤 무거운 텍스처 생성
requestAnimationFrame(() => setTimeout(() => {
  try { init(); } catch (err) {
    console.error(err);
    loading.textContent = '3D 장면을 만들지 못했습니다: ' + err.message + ' (WebGL 지원 브라우저가 필요합니다)';
  }
}, 30));

// 테스트용 핸들
window.__lotto = { tick(sec) { for (let i = 0; i < sec * 60; i++) update(1 / 60); }, simulate(sec, blow) { if (blow) { machine.setBlower(1); machine.blower = 1; game.blowing = true; game.mixClock = 99; } for (let i = 0; i < sec * 600; i++) machine.step(1 / 600); syncBalls(); }, machine, game, travelers, cupBalls, startBlow, pickOne, startAuto, resetAll, camera, controls, get rig() { return rig; } };
