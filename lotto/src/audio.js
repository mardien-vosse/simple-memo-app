// WebAudio 합성 사운드 (외부 음원 없음)
export class Sound {
  constructor() { this.ctx = null; this.muted = false; this.voices = 0; }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const a = (this.ctx = new AC());
    this.master = a.createGain(); this.master.gain.value = this.muted ? 0 : 0.8; this.master.connect(a.destination);
    const len = a.sampleRate * 2, buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    // 송풍기: 필터된 잡음 + 낮은 모터음
    const src = a.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600; lp.Q.value = 0.5;
    const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 170; bp.Q.value = 0.9;
    this.hum = a.createGain(); this.hum.gain.value = 0;
    src.connect(lp); lp.connect(this.hum); src.connect(bp); bp.connect(this.hum); this.hum.connect(this.master);
    src.start();
    const osc = a.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 42;
    const og = a.createGain(); og.gain.value = 0.03;
    const olp = a.createBiquadFilter(); olp.type = 'lowpass'; olp.frequency.value = 150;
    osc.connect(olp); olp.connect(og); og.connect(this.hum); osc.start();
    this.osc = osc; this.lp = lp;
  }

  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.8; }

  setBlower(level) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.hum.gain.setTargetAtTime(this.muted ? 0 : Math.min(0.5, level * 0.24), t, 0.15);
    this.osc.frequency.setTargetAtTime(34 + level * 28, t, 0.25);
    this.lp.frequency.setTargetAtTime(380 + level * 520, t, 0.25);
  }

  // 충돌음: kind 0 구슬-구슬, 1 금속, 2 유리, 3 깔때기
  tick(kind, speed) {
    const a = this.ctx; if (!a || this.muted || this.voices > 24) return;
    const now = a.currentTime;
    const vol = Math.min(1, 0.1 + speed / 7) * 0.3;
    const base = kind === 0 ? 2300 : kind === 1 ? 1050 : kind === 2 ? 3100 : 1500;
    const f = base * (0.85 + Math.random() * 0.3);
    const dur = kind === 1 ? 0.075 : 0.05;
    const o = a.createOscillator(); o.type = kind === 1 ? 'triangle' : 'sine';
    o.frequency.setValueAtTime(f, now); o.frequency.exponentialRampToValueAtTime(f * 0.6, now + dur);
    const g = a.createGain(); g.gain.setValueAtTime(vol, now); g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(g); g.connect(this.master);
    const n = a.createBufferSource(); n.buffer = this.noise;
    const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 1.5; bp.Q.value = 1.3;
    const ng = a.createGain(); ng.gain.setValueAtTime(vol * 0.7, now); ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.022);
    n.connect(bp); bp.connect(ng); ng.connect(this.master);
    this.voices++;
    o.onended = () => { this.voices--; };
    o.start(now); o.stop(now + dur + 0.02); n.start(now, Math.random() * 1.5); n.stop(now + 0.03);
  }

  glass(speed) {
    const a = this.ctx; if (!a || this.muted) return;
    const now = a.currentTime, vol = Math.min(0.25, 0.05 + speed * 0.2);
    for (const [f, d] of [[2630, 0.5], [4120, 0.3], [5900, 0.18]]) {
      const o = a.createOscillator(); o.type = 'sine'; o.frequency.value = f * (0.98 + Math.random() * 0.04);
      const g = a.createGain(); g.gain.setValueAtTime(vol, now); g.gain.exponentialRampToValueAtTime(0.0001, now + d);
      o.connect(g); g.connect(this.master); o.start(now); o.stop(now + d + 0.02);
    }
  }

  clunk() {
    const a = this.ctx; if (!a || this.muted) return;
    const now = a.currentTime;
    const o = a.createOscillator(); o.type = 'square';
    o.frequency.setValueAtTime(120, now); o.frequency.exponentialRampToValueAtTime(50, now + 0.22);
    const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
    const g = a.createGain(); g.gain.setValueAtTime(0.2, now); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
    o.connect(lp); lp.connect(g); g.connect(this.master); o.start(now); o.stop(now + 0.3);
    for (let i = 0; i < 3; i++) setTimeout(() => this.tick(1, 4 + Math.random() * 2), i * 50);
  }

  bell(freq, vol, len) {
    const a = this.ctx; if (!a || this.muted) return;
    const now = a.currentTime;
    for (const [m, v, d] of [[1, 1, 1], [2.01, 0.45, 0.7], [3.02, 0.22, 0.5], [4.2, 0.12, 0.35]]) {
      const o = a.createOscillator(); o.type = 'sine'; o.frequency.value = freq * m;
      const g = a.createGain(); g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(vol * v, now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + len * d);
      o.connect(g); g.connect(this.master); o.start(now); o.stop(now + len * d + 0.05);
    }
  }
}
