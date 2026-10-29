/*
 * 로또 추첨기 물리 엔진 (의존성 없음, 브라우저 / Node 공용)
 *
 * - 구슬: 속이 빈 플라스틱 구(껍질) 강체. 3D 위치, 선속도, 각속도, 회전(쿼터니언)
 * - 공기: 2D 비압축성 유동장(흐름함수로 정의 → 발산 0) + 난류 모드 + 확률적 요동
 *     · 하단 송풍구에서 올라오는 제트(퍼지며 올라가고 양옆으로 되돌아 내려옴)
 *     · 제트 축의 좌우 흔들림 / 기울기 / 맥동 / 돌풍
 *   구슬은 공기에 대한 상대속도로 항력(∝ v²)을 받음. 부력, 마그누스 힘, 회전 감쇠 포함
 * - 충돌: 구슬-구슬, 구슬-원통벽, 구슬-앞뒤 유리판 모두
 *   반발계수 + 쿨롱 마찰 + 회전을 고려한 충격량(impulse) 방식
 * - 배출구: 드럼 아래쪽 깔때기. 게이트가 열려 있을 때만 구슬이 들어갈 수 있음
 *
 * 좌표계: x 오른쪽, y 위, z 화면 앞쪽(관찰자). 단위는 SI(m, kg, s).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LottoPhysics = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const G = 9.81;
  const RHO_AIR = 1.2;
  const TWO_PI = Math.PI * 2;

  /* ---------------------------------------------------------------- RNG */
  // xoshiro128** — 시드는 하드웨어 엔트로피(crypto)에서 받는다.
  function makeRng(seed) {
    const s = new Uint32Array(4);
    if (seed === undefined || seed === null) {
      const c = (typeof globalThis !== 'undefined' && globalThis.crypto) || null;
      if (c && c.getRandomValues) c.getRandomValues(s);
      else {
        // 최후의 수단
        for (let i = 0; i < 4; i++) s[i] = (Math.random() * 4294967296) >>> 0;
      }
    } else if (typeof seed === 'number') {
      // splitmix32 로 확장 (테스트 재현용)
      let x = seed >>> 0;
      for (let i = 0; i < 4; i++) {
        x = (x + 0x9e3779b9) >>> 0;
        let z = x;
        z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
        z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
        s[i] = (z ^ (z >>> 16)) >>> 0;
      }
    } else {
      for (let i = 0; i < 4; i++) s[i] = seed[i] >>> 0;
    }
    if (!(s[0] | s[1] | s[2] | s[3])) s[0] = 1;
    const rotl = (x, k) => ((x << k) | (x >>> (32 - k))) >>> 0;
    function next() {
      const r = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
      const t = (s[1] << 9) >>> 0;
      s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3];
      s[2] ^= t; s[3] = rotl(s[3], 11);
      return r;
    }
    const rng = {
      next,
      float() { return next() / 4294967296; },
      range(a, b) { return a + (b - a) * rng.float(); },
      normal() {
        let u = 0;
        while (u === 0) u = rng.float();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(TWO_PI * rng.float());
      },
      // 주기적으로 새 엔트로피를 섞어 넣는다
      stir() {
        const c = (typeof globalThis !== 'undefined' && globalThis.crypto) || null;
        if (!c || !c.getRandomValues) return;
        const e = new Uint32Array(4);
        c.getRandomValues(e);
        for (let i = 0; i < 4; i++) s[i] ^= e[i];
        if (!(s[0] | s[1] | s[2] | s[3])) s[0] = 1;
      },
    };
    return rng;
  }

  /* ------------------------------------------------------------ defaults */
  const DEFAULTS = {
    seed: null,
    count: 45,
    r: 0.04,              // 구슬 반지름 [m]
    drumUnits: 7.4,       // 드럼 안쪽 반지름 = drumUnits * r
    depthUnits: 3.0,      // 앞뒤 유리판 사이 반깊이 = depthUnits * r
    hoverSpeed: 5.0,      // 구슬이 공기 중에 떠 있기 위한 상대 풍속 [m/s] (질량을 결정)
    Cd: 0.47,
    restBall: 0.80,       // 구슬-구슬 반발계수
    restWall: 0.62,       // 구슬-벽
    restGlass: 0.45,      // 구슬-유리판
    muBall: 0.18,
    muWall: 0.22,
    muGlass: 0.15,
    magnus: 0.20,
    spinDamp: 3.0,        // 공기에 의한 회전 감쇠 시간상수 [s]
    jetPeak: 3.0,         // 송풍구 바로 위 제트 중심 풍속 / hoverSpeed
    jetWidth: 0.45,       // 송풍구 제트 폭 / 드럼 반지름
    jetSpread: 1.6,       // 높이에 따른 퍼짐률
    turbulence: 0.34,     // 난류 세기 / hoverSpeed
    portAngleDeg: 8,      // 배출구 위치: 바닥 중심에서 오른쪽으로 몇 도
    mouthUnits: 1.9,      // 깔때기 입구 반지름 / r
    tubeUnits: 1.14,      // 튜브 반지름 / r
    funnelSlope: 0.55,
  };

  /* ------------------------------------------------------------- Machine */
  function Machine(options) {
    const o = Object.assign({}, DEFAULTS, options || {});
    this.o = o;
    this.rng = makeRng(o.seed);

    const r = o.r;
    this.r = r;
    this.R = o.drumUnits * r;
    this.H = o.depthUnits * r;
    this.area = Math.PI * r * r;
    // 속이 빈 구: v_hover 에서 항력 = 무게가 되도록 질량 결정
    this.m = 0.5 * RHO_AIR * o.Cd * this.area * o.hoverSpeed * o.hoverSpeed / G;
    this.I = (2 / 3) * this.m * r * r;
    this.kd = 0.5 * RHO_AIR * o.Cd * this.area / this.m;       // [1/m]
    this.rhoBall = this.m / ((4 / 3) * Math.PI * r * r * r);
    this.gEff = G * (1 - RHO_AIR / this.rhoBall);
    this.vh = o.hoverSpeed;

    const ang = (o.portAngleDeg * Math.PI) / 180;
    this.port = { dx: Math.sin(ang), dy: -Math.cos(ang) };       // 드럼 중심 → 배출구 방향
    this.mouth = o.mouthUnits * r;
    this.tube = o.tubeUnits * r;
    this.slope = o.funnelSlope;
    this.s0 = this.R - r;                                         // 깔때기 시작 (구슬 중심 기준)
    this.funnelLen = (this.mouth - this.tube) / this.slope;       // 깔때기 길이
    this.captureS = this.s0 + this.funnelLen + 0.6 * r;

    this.t = 0;
    this.balls = [];
    this.active = [];
    this.gateOpen = false;
    this.pickAssist = 0;           // 0..1 : 배출구 쪽 흡인 보조(시간이 지나면 점점 커짐)
    this.blowerTarget = 0;
    this.blower = 0;
    this.onCapture = null;
    this.events = [];              // 충돌 소리용
    this.stats = { maxSpeed: 0 };

    this._initAir();
    this.reset();
  }

  Machine.prototype._initAir = function () {
    const rng = this.rng, o = this.o, R = this.R;
    const a = (this.air = {});
    a.w0 = o.jetWidth * R;
    a.k = o.jetSpread;
    a.Vp0 = o.jetPeak * this.vh;
    a.xs = 0; a.tanT = 0;
    a.ouX = 0; a.ouT = 0;
    a.sw = [
      { A: 0.20 * R, f: rng.range(0.30, 0.55), p: rng.range(0, TWO_PI) },
      { A: 0.12 * R, f: rng.range(0.80, 1.40), p: rng.range(0, TWO_PI) },
    ];
    a.tl = [
      { A: 0.26, f: rng.range(0.25, 0.50), p: rng.range(0, TWO_PI) },
      { A: 0.12, f: rng.range(0.90, 1.60), p: rng.range(0, TWO_PI) },
    ];
    a.pu = [
      { A: 0.18, f: rng.range(0.55, 0.85), p: rng.range(0, TWO_PI) },
      { A: 0.10, f: rng.range(1.60, 2.30), p: rng.range(0, TWO_PI) },
    ];
    a.gust = 0;
    a.Vp = a.Vp0;
    a.t = 0;
    a.modes = [];
    const n = 7;
    for (let i = 0; i < n; i++) {
      const lam = rng.range(0.9, 2.6) * R * 0.5 + 0.08;       // 파장 [m]
      const k = TWO_PI / lam;
      const th = rng.range(0, TWO_PI);
      a.modes.push({
        kx: k * Math.cos(th), ky: k * Math.sin(th), k,
        amp: (o.turbulence * this.vh) / Math.sqrt(n / 2) * rng.range(0.6, 1.2),
        ampz: (o.turbulence * this.vh * 0.25) / Math.sqrt(n / 2) * rng.range(0.4, 1.0),
        om: rng.range(-5, 5), ph: rng.range(0, TWO_PI), phz: rng.range(0, TWO_PI),
      });
    }
    a.sign = rng.float() < 0.5 ? 1 : -1;
  };

  // 바람 재시드 (매 추첨마다 호출 → 어떤 추첨도 재현될 수 없음)
  Machine.prototype.reseedAir = function () {
    this.rng.stir();
    this._initAir();
  };

  Machine.prototype._updateAir = function (dt) {
    const a = this.air, rng = this.rng, R = this.R;
    a.t += dt;
    const t = a.t;
    // 요동(OU 과정)
    const tauX = 0.8, sigX = 0.13 * R;
    a.ouX += (-a.ouX / tauX) * dt + sigX * Math.sqrt((2 / tauX) * dt) * rng.normal();
    const tauT = 1.1, sigT = 0.10;
    a.ouT += (-a.ouT / tauT) * dt + sigT * Math.sqrt((2 / tauT) * dt) * rng.normal();

    let xs = a.ouX, th = a.ouT;
    for (let i = 0; i < a.sw.length; i++) xs += a.sw[i].A * Math.sin(TWO_PI * a.sw[i].f * t + a.sw[i].p);
    for (let i = 0; i < a.tl.length; i++) th += a.tl[i].A * Math.sin(TWO_PI * a.tl[i].f * t + a.tl[i].p);
    a.xs = xs;
    a.tanT = Math.tan(th);

    // 돌풍 (푸아송)
    if (rng.float() < 0.55 * dt) a.gust = Math.max(a.gust, rng.range(0.25, 0.6));
    a.gust *= Math.exp(-dt / 0.28);

    let pul = 1;
    for (let i = 0; i < a.pu.length; i++) pul += a.pu[i].A * Math.sin(TWO_PI * a.pu[i].f * t + a.pu[i].p);
    a.Vp = a.Vp0 * this.blower * (pul + a.gust);
    a.turbK = this.blower * (1 + 0.8 * a.gust);

    // 난류 모드의 위상 진행 (+ 위상 잡음)
    for (let i = 0; i < a.modes.length; i++) {
      const m = a.modes[i];
      m.ph += m.om * dt + 0.9 * Math.sqrt(dt) * rng.normal();
      m.phz += (0.7 * m.om) * dt + 0.9 * Math.sqrt(dt) * rng.normal();
    }
  };

  // 위치 (x,y,z) 에서의 공기 속도 → out[0..2]
  //   제트·난류는 2D 흐름함수의 회전(curl)이라 발산 0.
  //   벽 경계층(두께 ~1.6r)에서는 벽 속으로 들어가는 법선 성분을 없애
  //   공기가 벽에 부딪히면 벽을 따라 꺾여 흐르게 한다. (송풍구처럼 벽에서 나오는 흐름은 유지)
  Machine.prototype._air = function (x, y, z, out) {
    const a = this.air, R = this.R;

    // 제트: ψ = Ψ0 · ξ e^{-ξ²},  ξ = (x - xc(y)) / w(y)
    const yb = y + R;
    const w = a.w0 * (1 + a.k * (yb / R));
    const wp = (a.w0 * a.k) / R;
    const xc = a.xs + yb * a.tanT;
    const xi = (x - xc) / w;
    const e = Math.exp(-xi * xi);
    const f1 = (1 - 2 * xi * xi) * e;
    const psi0 = a.Vp * a.w0;
    let ux = (psi0 * f1 * (a.tanT + xi * wp)) / w;    // -∂ψ/∂y
    let uy = (psi0 * f1) / w;                         //  ∂ψ/∂x
    let uz = 0;

    // 난류 (2D 와도 모드)
    const tk = a.turbK;
    for (let i = 0; i < a.modes.length; i++) {
      const m = a.modes[i];
      const th = m.kx * x + m.ky * y + m.ph;
      const c = Math.cos(th);
      const amp = m.amp * tk * a.sign;
      ux += (-m.ky / m.k) * amp * c;
      uy += (m.kx / m.k) * amp * c;
      uz += m.ampz * tk * Math.cos(th + m.phz - m.ph);
    }
    // 벽 경계층: 벽으로 향하는 성분 제거 (원통 벽 + 앞뒤 유리)
    const rho = Math.sqrt(x * x + y * y) || 1e-9;
    const bl = 1.6 * this.r;
    const dw = R - rho;
    if (dw < bl) {
      const nx = x / rho, ny = y / rho;
      const un = ux * nx + uy * ny;
      if (un > 0) { const s = Math.min(1, 1 - dw / bl); ux -= un * nx * s; uy -= un * ny * s; }
    }
    const dz = this.H - Math.abs(z);
    if (dz < bl && uz * z > 0) uz *= Math.max(0, dz / bl);

    // 배출 보조: 게이트가 열린 동안 배출구 쪽으로 약하게 빨아들임
    if (this.gateOpen && this.pickAssist > 0) {
      const px = this.port.dx * R, py = this.port.dy * R;
      const dx = px - x, dy = py - y, dz = -z;
      const d2 = dx * dx + dy * dy + dz * dz;
      const L = 2.4 * this.r;
      const g = Math.exp(-d2 / (L * L));
      const d = Math.sqrt(d2) + 1e-6;
      const q = this.pickAssist * this.vh * 0.9 * g / d;
      ux += dx * q; uy += dy * q; uz += dz * q;
    }
    out[0] = ux; out[1] = uy; out[2] = uz;
  };

  /* ----------------------------------------------------------- balls */
  Machine.prototype.reset = function (randomize) {
    const rng = this.rng, r = this.r, R = this.R, H = this.H;
    this.balls.length = 0;
    this.active.length = 0;
    const n = this.o.count;
    const placed = [];
    for (let i = 0; i < n; i++) {
      let x, y, z, ok, tries = 0;
      do {
        tries++;
        const rad = (R - r) * Math.sqrt(rng.float());
        const th = rng.range(0, TWO_PI);
        x = rad * Math.cos(th);
        y = rad * Math.sin(th) * 0.9 - 0.15 * R;
        if (y > 0.1 * R && tries < 400) { ok = false; continue; }
        z = rng.range(-1, 1) * (H - r);
        if (Math.hypot(x, y) > R - r) { ok = false; continue; }
        ok = true;
        for (let j = 0; j < placed.length; j++) {
          const p = placed[j];
          const dx = p.x - x, dy = p.y - y, dz = p.z - z;
          if (dx * dx + dy * dy + dz * dz < 4 * r * r * 1.05) { ok = false; break; }
        }
      } while (!ok && tries < 3000);
      const b = {
        id: i + 1, x, y, z, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0,
        qw: 1, qx: 0, qy: 0, qz: 0, st: 0,
      };
      // 무작위 초기 자세
      const u1 = rng.float(), u2 = rng.float(), u3 = rng.float();
      b.qw = Math.sqrt(1 - u1) * Math.sin(TWO_PI * u2);
      b.qx = Math.sqrt(1 - u1) * Math.cos(TWO_PI * u2);
      b.qy = Math.sqrt(u1) * Math.sin(TWO_PI * u3);
      b.qz = Math.sqrt(u1) * Math.cos(TWO_PI * u3);
      placed.push(b);
      this.balls.push(b);
      this.active.push(b);
    }
    this.gateOpen = false;
    this.pickAssist = 0;
    this.blower = 0;
    this.blowerTarget = 0;
    this.t = 0;
  };

  // 바닥에 안정적으로 쌓일 때까지 풀어둔다
  Machine.prototype.settle = function (seconds, dt) {
    dt = dt || 1 / 600;
    const keepB = this.blowerTarget;
    this.blowerTarget = 0; this.blower = 0;
    const n = Math.round(seconds / dt);
    for (let i = 0; i < n; i++) this.step(dt);
    this.blowerTarget = keepB;
    this.events.length = 0;
  };

  Machine.prototype.setBlower = function (v) { this.blowerTarget = Math.max(0, Math.min(1.25, v)); };
  Machine.prototype.openGate = function () { this.gateOpen = true; this.pickAssist = 0; this.gateT = 0; };
  Machine.prototype.closeGate = function () { this.gateOpen = false; this.pickAssist = 0; };

  /* ----------------------------------------------------------- step */
  const _u = [0, 0, 0];

  Machine.prototype.step = function (dt) {
    this.t += dt;
    // 송풍기 회전수 (관성)
    const up = 1.1, down = 0.6;
    if (this.blower < this.blowerTarget) this.blower = Math.min(this.blowerTarget, this.blower + up * dt);
    else if (this.blower > this.blowerTarget) this.blower = Math.max(this.blowerTarget, this.blower - down * dt);
    if (this.gateOpen) {
      this.gateT += dt;
      // 오래 기다리면 흡인 보조를 아주 천천히 키움 (구슬 종류와 무관)
      this.pickAssist = Math.min(1, Math.max(0, (this.gateT - 0.8) / 4));
    }

    this._updateAir(dt);

    const act = this.active, n = act.length;
    const r = this.r, m = this.m, kd = this.kd, gEff = this.gEff, o = this.o;
    const spinK = Math.exp(-dt / o.spinDamp);
    const kM = o.magnus * RHO_AIR * Math.PI * r * r * r / m;
    let maxSp = 0;

    for (let i = 0; i < n; i++) {
      const b = act[i];
      this._air(b.x, b.y, b.z, _u);
      const rx = b.vx - _u[0], ry = b.vy - _u[1], rz = b.vz - _u[2];
      const sp = Math.sqrt(rx * rx + ry * ry + rz * rz);
      // 마그누스: ω × v_rel (스핀비 포화)
      let mx = b.wy * rz - b.wz * ry, my = b.wz * rx - b.wx * rz, mz = b.wx * ry - b.wy * rx;
      const ws = Math.sqrt(b.wx * b.wx + b.wy * b.wy + b.wz * b.wz);
      if (ws * r > 1.2 * sp && ws > 1e-6) { const c = (1.2 * sp) / (ws * r); mx *= c; my *= c; mz *= c; }
      const kk = kd * sp;
      const inv = 1 / (1 + dt * kk);
      b.vx = (b.vx + dt * (kk * _u[0] + kM * mx)) * inv;
      b.vy = (b.vy + dt * (-gEff + kk * _u[1] + kM * my)) * inv;
      b.vz = (b.vz + dt * (kk * _u[2] + kM * mz)) * inv;
      b.wx *= spinK; b.wy *= spinK; b.wz *= spinK;

      const v2 = b.vx * b.vx + b.vy * b.vy + b.vz * b.vz;
      if (v2 > 196) { const c = 14 / Math.sqrt(v2); b.vx *= c; b.vy *= c; b.vz *= c; }
      if (v2 > maxSp) maxSp = v2;

      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;

      // 자세 적분
      const hw = 0.5 * dt;
      const qw = b.qw, qx = b.qx, qy = b.qy, qz = b.qz;
      let nw = qw - hw * (b.wx * qx + b.wy * qy + b.wz * qz);
      let nx = qx + hw * (b.wx * qw + b.wy * qz - b.wz * qy);
      let ny = qy + hw * (b.wy * qw + b.wz * qx - b.wx * qz);
      let nz = qz + hw * (b.wz * qw + b.wx * qy - b.wy * qx);
      const il = 1 / Math.sqrt(nw * nw + nx * nx + ny * ny + nz * nz);
      b.qw = nw * il; b.qx = nx * il; b.qy = ny * il; b.qz = nz * il;
    }
    this.stats.maxSpeed = Math.max(this.stats.maxSpeed * 0.999, Math.sqrt(maxSp));

    // 충돌 해소 (순차 충격량, 2회 반복)
    for (let it = 0; it < 2; it++) {
      this._collideBalls(it === 0);
      this._collideWalls(it === 0);
    }
  };

  Machine.prototype._collideBalls = function (first) {
    const act = this.active, n = act.length, r = this.r, m = this.m, I = this.I;
    const o = this.o, d2min = 4 * r * r;
    const kt = 1 / (2 / m + 2 * r * r / I); // 접선 유효질량
    for (let i = 0; i < n - 1; i++) {
      const a = act[i];
      for (let j = i + 1; j < n; j++) {
        const b = act[j];
        const dx = b.x - a.x;
        if (dx > 2 * r || dx < -2 * r) continue;
        const dy = b.y - a.y;
        if (dy > 2 * r || dy < -2 * r) continue;
        const dz = b.z - a.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= d2min) continue;
        let d = Math.sqrt(d2);
        let nx, ny, nz;
        if (d < 1e-9) { nx = 1; ny = 0; nz = 0; d = 0; } else { nx = dx / d; ny = dy / d; nz = dz / d; }
        // 위치 보정
        const pen = 2 * r - d;
        const corr = 0.5 * pen * (first ? 1 : 0.8);
        a.x -= nx * corr; a.y -= ny * corr; a.z -= nz * corr;
        b.x += nx * corr; b.y += ny * corr; b.z += nz * corr;
        // 접촉점 속도 (a: +r n, b: -r n)
        const cax = r * nx, cay = r * ny, caz = r * nz;
        const vax = a.vx + (a.wy * caz - a.wz * cay);
        const vay = a.vy + (a.wz * cax - a.wx * caz);
        const vaz = a.vz + (a.wx * cay - a.wy * cax);
        const vbx = b.vx + (b.wy * -caz - b.wz * -cay);
        const vby = b.vy + (b.wz * -cax - b.wx * -caz);
        const vbz = b.vz + (b.wx * -cay - b.wy * -cax);
        const rvx = vbx - vax, rvy = vby - vay, rvz = vbz - vaz;
        const vn = rvx * nx + rvy * ny + rvz * nz;
        if (vn >= 0) continue;
        const e = -vn > 0.25 ? o.restBall : 0;
        const jn = -(1 + e) * vn * (m / 2);
        const jx = jn * nx, jy = jn * ny, jz = jn * nz;
        a.vx -= jx / m; a.vy -= jy / m; a.vz -= jz / m;
        b.vx += jx / m; b.vy += jy / m; b.vz += jz / m;
        // 마찰
        let tx = rvx - vn * nx, ty = rvy - vn * ny, tz = rvz - vn * nz;
        const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
        if (tl > 1e-9) {
          tx /= tl; ty /= tl; tz /= tl;
          const jt = Math.min(o.muBall * jn, tl * kt);
          const fx = tx * jt, fy = ty * jt, fz = tz * jt; // b 에 -t 방향, a 에 +t 방향
          a.vx += fx / m; a.vy += fy / m; a.vz += fz / m;
          b.vx -= fx / m; b.vy -= fy / m; b.vz -= fz / m;
          // 토크: a: (r n) × (+f) , b: (-r n) × (-f) = (r n) × f
          const tqx = cay * fz - caz * fy, tqy = caz * fx - cax * fz, tqz = cax * fy - cay * fx;
          a.wx += tqx / I; a.wy += tqy / I; a.wz += tqz / I;
          b.wx += tqx / I; b.wy += tqy / I; b.wz += tqz / I;
        }
        if (-vn > 0.5 && this.events.length < 80) this.events.push({ k: 0, s: -vn, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      }
    }
  };

  // 벽 접촉 하나 처리. n: 벽 쪽(바깥) 법선
  Machine.prototype._wall = function (b, nx, ny, nz, pen, e0, mu, kind) {
    const r = this.r, m = this.m, I = this.I;
    b.x -= nx * pen; b.y -= ny * pen; b.z -= nz * pen;
    const rcx = r * nx, rcy = r * ny, rcz = r * nz;
    const vx = b.vx + (b.wy * rcz - b.wz * rcy);
    const vy = b.vy + (b.wz * rcx - b.wx * rcz);
    const vz = b.vz + (b.wx * rcy - b.wy * rcx);
    const vn = vx * nx + vy * ny + vz * nz;
    if (vn <= 0) return;
    const e = vn > 0.25 ? e0 : 0;
    const jn = (1 + e) * vn * m;
    b.vx -= nx * jn / m; b.vy -= ny * jn / m; b.vz -= nz * jn / m;
    let tx = vx - vn * nx, ty = vy - vn * ny, tz = vz - vn * nz;
    const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (tl > 1e-9) {
      tx /= tl; ty /= tl; tz /= tl;
      const kt = m / (1 + (m * r * r) / I);
      const jt = Math.min(mu * jn, tl * kt);
      const fx = -tx * jt, fy = -ty * jt, fz = -tz * jt;
      b.vx += fx / m; b.vy += fy / m; b.vz += fz / m;
      b.wx += (rcy * fz - rcz * fy) / I;
      b.wy += (rcz * fx - rcx * fz) / I;
      b.wz += (rcx * fy - rcy * fx) / I;
    }
    if (vn > 0.5 && this.events.length < 80) this.events.push({ k: kind, s: vn, x: b.x, y: b.y });
  };

  Machine.prototype._collideWalls = function (first) {
    const act = this.active, r = this.r, R = this.R, H = this.H, o = this.o;
    const dx = this.port.dx, dy = this.port.dy;
    const open = this.gateOpen;
    const mouthC = this.mouth - r;           // 구슬 중심이 통과 가능한 입구 반경
    const tubeC = this.tube - r;
    for (let i = act.length - 1; i >= 0; i--) {
      const b = act[i];
      // 앞뒤 유리
      const az = Math.abs(b.z);
      if (az + r > H) this._wall(b, 0, 0, b.z > 0 ? 1 : -1, az + r - H, o.restGlass, o.muGlass, 2);

      // 깔때기/튜브 영역
      let inHole = false;
      if (open) {
        const s = b.x * dx + b.y * dy;
        if (s > 0) {
          const lx = b.x - s * dx, ly = b.y - s * dy, lz = b.z;
          const lat = Math.sqrt(lx * lx + ly * ly + lz * lz);
          if (lat < mouthC) {
            inHole = true;
            if (s > this.s0) {
              const Lc = Math.max(tubeC, mouthC - this.slope * (s - this.s0));
              if (lat > Lc) {
                // 깔때기 벽: 법선 = lat_dir + slope * d
                const il = 1 / (lat || 1e-9);
                let nx = lx * il + this.slope * dx, ny = ly * il + this.slope * dy, nz = lz * il;
                const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
                nx /= nl; ny /= nl; nz /= nl;
                const pen = (lat - Lc) / nl;
                this._wall(b, nx, ny, nz, pen, o.restWall, o.muWall, 3);
              }
              if (s > this.captureS) { this._capture(b, i); continue; }
            }
          }
        }
      }
      // 원통 벽
      if (!inHole) {
        const rho = Math.sqrt(b.x * b.x + b.y * b.y);
        if (rho + r > R) {
          const il = 1 / (rho || 1e-9);
          this._wall(b, b.x * il, b.y * il, 0, rho + r - R, o.restWall, o.muWall, 1);
        }
      }
    }
  };

  Machine.prototype._capture = function (b, idx) {
    b.st = 1;
    this.active.splice(idx, 1);
    if (this.onCapture) this.onCapture(b);
  };

  /* ---------------------------------------------------------- helpers */
  // 프레임 시간 → 고정 스텝(기본 600Hz)
  Machine.prototype.advance = function (dtFrame, dtStep, maxSteps) {
    dtStep = dtStep || 1 / 600;
    maxSteps = maxSteps || 40;
    this._acc = (this._acc || 0) + dtFrame;
    let k = 0;
    while (this._acc >= dtStep && k < maxSteps) { this.step(dtStep); this._acc -= dtStep; k++; }
    if (k >= maxSteps) this._acc = 0;
  };

  // 쿼터니언 → 회전행렬 열벡터 (로컬 축 → 월드)
  function rotate(b, x, y, z, out) {
    const { qw, qx, qy, qz } = b;
    const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
    out[0] = x + qw * tx + (qy * tz - qz * ty);
    out[1] = y + qw * ty + (qz * tx - qx * tz);
    out[2] = z + qw * tz + (qx * ty - qy * tx);
    return out;
  }

  return { Machine, makeRng, rotate, DEFAULTS, G, RHO_AIR };
});
