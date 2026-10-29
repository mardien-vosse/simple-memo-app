// 절차적 텍스처 (외부 이미지 없이 캔버스로 생성)
import * as THREE from 'three';

const TAU = Math.PI * 2;

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function seeded(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

// 값 노이즈 (fbm)
function makeNoise(seed) {
  const rnd = seeded(seed);
  const N = 256, perm = new Uint8Array(N * 2), val = new Float32Array(N);
  for (let i = 0; i < N; i++) { perm[i] = i; val[i] = rnd(); }
  for (let i = N - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  for (let i = 0; i < N; i++) perm[i + N] = perm[i];
  const sm = (t) => t * t * (3 - 2 * t);
  function n2(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const a = val[perm[X + perm[Y]]], b = val[perm[X + 1 + perm[Y]]];
    const c = val[perm[X + perm[Y + 1]]], d = val[perm[X + 1 + perm[Y + 1]]];
    const u = sm(xf), v = sm(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  return function fbm(x, y, oct = 5) {
    let s = 0, amp = 0.5, f = 1, norm = 0;
    for (let i = 0; i < oct; i++) { s += amp * n2(x * f, y * f); norm += amp; amp *= 0.5; f *= 2.02; }
    return s / norm;
  };
}

/* ---------------------------------------------------------------- 구슬 */
export const BALL_COLORS = [
  null,
  '#ffe21f', // 1-10 노랑
  '#1f63d6', // 11-20 파랑
  '#d9221d', // 21-30 빨강
  '#c7ccd3', // 31-40 회색(흰색 계열)
  '#1f9a47', // 41-45 초록
];
export const groupOf = (id) => (id <= 10 ? 1 : id <= 20 ? 2 : id <= 30 ? 3 : id <= 40 ? 4 : 5);

// 등장방형(equirect) 텍스처: ±z 방향(u=0.25, 0.75)에 흰 원형 라벨 + 번호
export function ballTexture(id, size = 512) {
  const W = size, H = size / 2;
  const c = canvas(W, H), g = c.getContext('2d');
  const base = new THREE.Color(BALL_COLORS[groupOf(id)]);
  const img = g.createImageData(W, H);
  const d = img.data;
  const alpha = 0.5;                     // 라벨 각반경(rad)
  const cosA = Math.cos(alpha), cosA2 = Math.cos(alpha + 0.035);
  const br = Math.round(base.r * 255), bg = Math.round(base.g * 255), bb = Math.round(base.b * 255);
  for (let y = 0; y < H; y++) {
    const v = 1 - (y + 0.5) / H;
    const th = (1 - v) * Math.PI, st = Math.sin(th);
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W, ph = u * TAU;
      const dz = Math.sin(ph) * st;       // 라벨 축 = ±z
      const m = Math.abs(dz);
      let t = 0;                          // 0 = 몸체색, 1 = 라벨
      if (m >= cosA) t = 1; else if (m > cosA2) t = (m - cosA2) / (cosA - cosA2);
      // 라벨 테두리의 얇은 회색 링 (인쇄된 느낌)
      const ring = m > cosA2 - 0.012 && m < cosA2 + 0.004 ? 0.25 : 0;
      const i = (y * W + x) * 4;
      const lr = 250, lg = 248, lb = 240;
      d[i] = br + (lr - br) * t - ring * 40;
      d[i + 1] = bg + (lg - bg) * t - ring * 40;
      d[i + 2] = bb + (lb - bb) * t - ring * 40;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // 번호
  const fs = id < 10 ? H * 0.30 : H * 0.235;
  g.fillStyle = '#121010';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `900 ${fs}px "Helvetica Neue", "Arial Black", Arial, sans-serif`;
  for (const cx of [W * 0.25, W * 0.75]) {
    g.save();
    g.translate(cx, H / 2);
    g.scale(id < 10 ? 1 : 0.9, 1);
    g.fillText(String(id), 0, fs * 0.04);
    if ([6, 9, 16, 19, 26, 29, 36, 39].includes(id)) {
      const w = fs * (id < 10 ? 0.52 : 1.0);
      g.fillRect(-w / 2, fs * 0.47, w, fs * 0.08);
    }
    g.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/* ------------------------------------------------------------ 금속 표면 */
// 황동/철 공용: 색 변화(패티나) + 거칠기 맵
export function metalMaps(kind, seed = 3, size = 512) {
  const fbm = makeNoise(seed);
  const rnd = seeded(seed * 7 + 1);
  const col = canvas(size, size), rough = canvas(size, size);
  const gc = col.getContext('2d'), gr = rough.getContext('2d');
  const ci = gc.createImageData(size, size), ri = gr.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm(x / 64, y / 64, 5), n2 = fbm(x / 12 + 40, y / 12, 3);
      const i = (y * size + x) * 4;
      let r, g, b, ro;
      if (kind === 'brass') {
        // 밝은 황동 ~ 어두운 산화
        const t = Math.min(1, Math.max(0, (n - 0.35) * 1.8));
        r = 232 - 68 * t + (n2 - 0.5) * 18;
        g = 200 - 66 * t + (n2 - 0.5) * 14;
        b = 132 - 56 * t;
        ro = 70 + t * 90 + (n2 - 0.5) * 50;
      } else if (kind === 'copper') {
        const t = Math.min(1, Math.max(0, (n - 0.3) * 1.6));
        r = 214 - 60 * t; g = 128 - 45 * t; b = 82 - 30 * t;
        ro = 90 + t * 80 + (n2 - 0.5) * 40;
      } else {
        // 검게 산화된 주철
        const t = Math.min(1, Math.max(0, (n - 0.3) * 1.5));
        r = 70 - 30 * t + (n2 - 0.5) * 16; g = 66 - 28 * t + (n2 - 0.5) * 14; b = 62 - 26 * t + (n2 - 0.5) * 12;
        ro = 120 + t * 80 + (n2 - 0.5) * 50;
      }
      ci.data[i] = r; ci.data[i + 1] = g; ci.data[i + 2] = b; ci.data[i + 3] = 255;
      ri.data[i] = ri.data[i + 1] = ri.data[i + 2] = Math.max(0, Math.min(255, ro)); ri.data[i + 3] = 255;
    }
  }
  gc.putImageData(ci, 0, 0); gr.putImageData(ri, 0, 0);
  // 미세 스크래치
  gr.globalAlpha = 0.35; gr.strokeStyle = '#2a2a2a'; gr.lineWidth = 1;
  for (let k = 0; k < 160; k++) {
    const x = rnd() * size, y = rnd() * size, a = rnd() * TAU, l = 8 + rnd() * 40;
    gr.beginPath(); gr.moveTo(x, y); gr.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); gr.stroke();
  }
  const map = new THREE.CanvasTexture(col); map.colorSpace = THREE.SRGBColorSpace;
  const roughnessMap = new THREE.CanvasTexture(rough);
  for (const t of [map, roughnessMap]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; }
  return { map, roughnessMap };
}

/* ---------------------------------------------------------------- 대리석 */
export function marbleTexture(size = 1024) {
  const fbm = makeNoise(17);
  const c = canvas(size, size), g = c.getContext('2d');
  const img = g.createImageData(size, size), d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = x / size, ny = y / size;
      const turb = fbm(nx * 6, ny * 6, 6);
      const vein = Math.abs(Math.sin((nx * 2.0 + ny * 0.9 + turb * 3.0) * Math.PI));
      const v2 = Math.abs(Math.sin((nx * 9 - ny * 4 + turb * 5) * Math.PI));
      const fine = Math.pow(1 - vein, 14) * 0.9 + Math.pow(1 - v2, 30) * 0.35;
      const cloud = fbm(nx * 3 + 9, ny * 3, 4);
      const i = (y * size + x) * 4;
      const base = 26 + cloud * 26;
      d[i] = base + 14 + fine * 55;
      d[i + 1] = base + 8 + fine * 48;
      d[i + 2] = base + 4 + fine * 40;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}

/* ------------------------------------------------- 각인된 황동 명판 */
export function plateTexture(text, w = 1024, h = 256, opts = {}) {
  const c = canvas(w, h), g = c.getContext('2d');
  const bump = canvas(w, h), b = bump.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#e9c97c'); grad.addColorStop(0.5, '#c79a45'); grad.addColorStop(1, '#a17830');
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  b.fillStyle = '#808080'; b.fillRect(0, 0, w, h);
  // 테두리 홈
  const inset = h * 0.1;
  g.strokeStyle = 'rgba(70,40,8,.75)'; g.lineWidth = h * 0.03; g.strokeRect(inset, inset, w - inset * 2, h - inset * 2);
  b.strokeStyle = '#303030'; b.lineWidth = h * 0.03; b.strokeRect(inset, inset, w - inset * 2, h - inset * 2);
  const font = `700 ${opts.size || h * 0.46}px Georgia, "Times New Roman", serif`;
  g.font = font; b.font = font;
  g.textAlign = b.textAlign = 'center'; g.textBaseline = b.textBaseline = 'middle';
  g.fillStyle = '#3a2208'; g.fillText(text, w / 2, h * 0.53);
  b.fillStyle = '#202020'; b.fillText(text, w / 2, h * 0.53);
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
  const bumpMap = new THREE.CanvasTexture(bump);
  return { map, bumpMap };
}

/* ---------------------------------------------------------- 압력계 */
export function gaugeTexture(size = 512) {
  const c = canvas(size, size), g = c.getContext('2d');
  const cx = size / 2, cy = size / 2, R = size * 0.48;
  const grad = g.createRadialGradient(cx, cy, R * 0.1, cx, cy, R);
  grad.addColorStop(0, '#f6ecd2'); grad.addColorStop(1, '#d9c79d');
  g.fillStyle = grad; g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.fill();
  g.strokeStyle = '#2b1a08'; g.lineCap = 'round';
  for (let i = 0; i <= 50; i++) {
    const a = (-225 + i * 5.4) * Math.PI / 180, major = i % 10 === 0;
    const r1 = R * 0.88, r2 = R * (major ? 0.72 : 0.8);
    g.lineWidth = major ? size * 0.012 : size * 0.005;
    g.beginPath(); g.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); g.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); g.stroke();
    if (major) {
      g.fillStyle = '#2b1a08'; g.font = `700 ${size * 0.07}px Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(i * 2), cx + Math.cos(a) * R * 0.58, cy + Math.sin(a) * R * 0.58);
    }
  }
  // 적색 구간
  g.strokeStyle = 'rgba(160,30,20,.85)'; g.lineWidth = size * 0.03;
  g.beginPath(); g.arc(cx, cy, R * 0.93, (-225 + 40 * 5.4) * Math.PI / 180, 45 * Math.PI / 180); g.stroke();
  g.fillStyle = '#2b1a08'; g.font = `italic 700 ${size * 0.065}px Georgia, serif`; g.textAlign = 'center';
  g.fillText('AIR  PSI', cx, cy + R * 0.42);
  g.font = `${size * 0.045}px Georgia, serif`; g.fillText('PNEUMATIC  CO.', cx, cy + R * 0.56);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

/* ---------------------------------- 배경 (초점이 나간 스팀펑크 서재) */
export function backdropTexture(w = 2048, h = 1024) {
  const c = canvas(w, h), g = c.getContext('2d');
  const rnd = seeded(5);
  let gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, '#1a0e07'); gr.addColorStop(0.6, '#2a170b'); gr.addColorStop(1, '#120904');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  // 나무 패널
  for (let x = 0; x < w; x += 150) {
    gr = g.createLinearGradient(x, 0, x + 150, 0);
    gr.addColorStop(0, 'rgba(0,0,0,.35)'); gr.addColorStop(0.15, 'rgba(120,64,24,.10)'); gr.addColorStop(0.85, 'rgba(60,30,10,.06)'); gr.addColorStop(1, 'rgba(0,0,0,.35)');
    g.fillStyle = gr; g.fillRect(x, 0, 150, h);
  }
  const soft = (x, y, r, col, a) => {
    const q = g.createRadialGradient(x, y, 0, x, y, r);
    q.addColorStop(0, col.replace('A', a)); q.addColorStop(1, col.replace('A', 0));
    g.fillStyle = q; g.fillRect(x - r, y - r, r * 2, r * 2);
  };
  // 아치 창 (해질녘 도시)
  const wx = 150, ww = 360, wy = 120, wh = 640;
  g.save();
  g.beginPath(); g.moveTo(wx, wy + wh); g.lineTo(wx, wy + ww / 2); g.arc(wx + ww / 2, wy + ww / 2, ww / 2, Math.PI, TAU); g.lineTo(wx + ww, wy + wh); g.closePath(); g.clip();
  gr = g.createLinearGradient(0, wy, 0, wy + wh);
  gr.addColorStop(0, '#26386a'); gr.addColorStop(0.55, '#6b7cad'); gr.addColorStop(0.85, '#e7a46c'); gr.addColorStop(1, '#f2c48a');
  g.fillStyle = gr; g.fillRect(wx, wy, ww, wh);
  for (let i = 0; i < 12; i++) {
    const bw = 24 + rnd() * 30, bx = wx + i * 32 - 10, bh = 90 + rnd() * 260;
    g.fillStyle = 'rgba(30,22,36,.9)'; g.fillRect(bx, wy + wh - bh, bw, bh);
    for (let k = 0; k < bh / 22; k++) if (rnd() < 0.4) { g.fillStyle = 'rgba(255,214,130,.85)'; g.fillRect(bx + 4 + rnd() * (bw - 10), wy + wh - bh + 8 + k * 22, 4, 6); }
  }
  g.restore();
  g.strokeStyle = '#7a5520'; g.lineWidth = 16;
  g.beginPath(); g.moveTo(wx, wy + wh); g.lineTo(wx, wy + ww / 2); g.arc(wx + ww / 2, wy + ww / 2, ww / 2, Math.PI, TAU); g.lineTo(wx + ww, wy + wh); g.stroke();
  g.lineWidth = 8; g.beginPath(); g.moveTo(wx + ww / 2, wy); g.lineTo(wx + ww / 2, wy + wh); g.moveTo(wx, wy + 300); g.lineTo(wx + ww, wy + 300); g.stroke();
  soft(wx + ww / 2, wy + wh * 0.7, 420, 'rgba(240,170,110,A)', 0.18);
  // 선반과 책 (흐릿하게)
  for (let s = 0; s < 3; s++) {
    const sy = 360 + s * 170;
    g.fillStyle = 'rgba(70,40,16,.75)'; g.fillRect(1250, sy, 640, 14);
    let x = 1265;
    while (x < 1870) {
      const bw = 18 + rnd() * 26, bh = 90 + rnd() * 50;
      const hue = [[90, 30, 20], [40, 50, 70], [70, 55, 25], [30, 60, 40], [100, 70, 40]][Math.floor(rnd() * 5)];
      g.fillStyle = `rgba(${hue[0]},${hue[1]},${hue[2]},.8)`; g.fillRect(x, sy - bh, bw, bh);
      g.fillStyle = 'rgba(220,170,80,.35)'; g.fillRect(x, sy - bh + 14, bw, 3);
      x += bw + 2;
    }
  }
  // 기둥, 파이프
  for (const px of [700, 1130, 1980]) {
    gr = g.createLinearGradient(px - 30, 0, px + 30, 0);
    gr.addColorStop(0, 'rgba(40,22,8,.9)'); gr.addColorStop(0.45, 'rgba(190,130,50,.75)'); gr.addColorStop(1, 'rgba(40,22,8,.9)');
    g.fillStyle = gr; g.fillRect(px - 30, 0, 60, h);
  }
  // 램프 / 보케
  for (const [x, y, r] of [[700, 420, 260], [1130, 260, 220], [1600, 140, 200], [1980, 380, 240], [380, 70, 160]]) {
    soft(x, y, r, 'rgba(255,165,60,A)', 0.55);
    soft(x, y, r * 0.25, 'rgba(255,225,160,A)', 0.9);
  }
  for (let i = 0; i < 70; i++) {
    const x = rnd() * w, y = rnd() * h * 0.8, r = 14 + rnd() * 50;
    soft(x, y, r, rnd() < 0.7 ? 'rgba(255,190,100,A)' : 'rgba(255,140,60,A)', 0.06 + rnd() * 0.12);
  }
  // 하단 어둡게
  gr = g.createLinearGradient(0, h * 0.7, 0, h);
  gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.65)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
