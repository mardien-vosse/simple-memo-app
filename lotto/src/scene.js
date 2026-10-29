// 3D 장면: 스팀펑크 로또 추첨기 모델링 (단위 m — 물리 엔진 좌표와 1:1)
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import * as TX from './textures.js';

const TAU = Math.PI * 2;
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

/* ------------------------------------------------------------ 배치 상수 */
export const LAYOUT = {
  drum: V3(-0.18, 0.72, 0),                       // 드럼 중심
  cupX: [-0.62, -0.45, -0.28, -0.11, 0.06, 0.23, 0.50],
  cupZ: 0.19,
  trayTop: 0.11,
  cupBaseY: 0.145,                                // 컵 유리 바닥
  cupRestY: 0.19,                                 // 컵 안에 놓인 구슬 중심 높이
  railX0: -0.70, railX1: 0.68, railYAt1: 0.335, railSlope: 0.05, railZ: 0.19,
  bumperX: 0.70,
  tubeR: 0.046,
};
export const railY = (x) => LAYOUT.railYAt1 + (x - LAYOUT.railX1) * LAYOUT.railSlope;

/* ------------------------------------------------------------- 재질 */
function makeMaterials() {
  const bm = TX.metalMaps('brass', 3), im = TX.metalMaps('iron', 9), cm = TX.metalMaps('copper', 21);
  const rep = (t, r) => { const c = t.clone(); c.repeat.set(r, r); c.needsUpdate = true; return c; };
  const brass = (r = 1, rough = 0.78) => new THREE.MeshStandardMaterial({
    color: 0xffffff, map: rep(bm.map, r), roughnessMap: rep(bm.roughnessMap, r), metalness: 1, roughness: rough, envMapIntensity: 1.15,
  });
  const iron = (r = 1) => new THREE.MeshStandardMaterial({
    color: 0xffffff, map: rep(im.map, r), roughnessMap: rep(im.roughnessMap, r), metalness: 0.78, roughness: 1, envMapIntensity: 0.9,
  });
  const M = {
    brass: brass(1), brassFine: brass(1, 0.55), brassTile: brass(6), brassTileFine: brass(6, 0.6),
    iron: iron(1), ironTile: iron(3),
    copper: new THREE.MeshStandardMaterial({ color: 0xffffff, map: cm.map, roughnessMap: cm.roughnessMap, metalness: 1, roughness: 0.85 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0xffffff, metalness: 0, roughness: 0.04, transmission: 1, thickness: 0.006, ior: 1.5,
      specularIntensity: 1, envMapIntensity: 1.8, attenuationColor: new THREE.Color(0xeef8f0), attenuationDistance: 1.5,
    }),
    glassThick: new THREE.MeshPhysicalMaterial({
      color: 0xffffff, metalness: 0, roughness: 0.02, transmission: 1, thickness: 0.02, ior: 1.52,
      specularIntensity: 1, envMapIntensity: 2.2, attenuationColor: new THREE.Color(0xe9f6ef), attenuationDistance: 0.8,
    }),
    darkWood: new THREE.MeshStandardMaterial({ color: 0x2a1609, roughness: 0.6, metalness: 0 }),
    knob: new THREE.MeshPhysicalMaterial({ color: 0x5a0f08, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08 }),
    black: new THREE.MeshStandardMaterial({ color: 0x0b0806, roughness: 0.7, metalness: 0.3 }),
    lampOff: new THREE.MeshStandardMaterial({ color: 0x0c2a14, emissive: 0x000000, roughness: 0.2, metalness: 0 }),
  };
  return M;
}

/* ------------------------------------------------------------- 도우미 */
function mesh(geo, mat, opts = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = opts.cast !== false;
  m.receiveShadow = opts.receive !== false;
  return m;
}

// 리벳 (반구 인스턴스). items: [{p: Vector3, n: Vector3}]
function rivets(items, r, mat) {
  const geo = new THREE.SphereGeometry(r, 12, 6, 0, TAU, 0, Math.PI / 2);
  const im = new THREE.InstancedMesh(geo, mat, items.length);
  const up = V3(0, 1, 0), q = new THREE.Quaternion(), m4 = new THREE.Matrix4(), s = V3(1, 1, 1);
  items.forEach((it, i) => { q.setFromUnitVectors(up, it.n.clone().normalize()); m4.compose(it.p, q, s); im.setMatrixAt(i, m4); });
  im.castShadow = true; im.receiveShadow = true;
  return im;
}

function gearGeometry(ro, teeth, thick, opts = {}) {
  const depth = opts.depth || ro * 0.1;
  const ri = ro - depth, step = TAU / teeth;
  const sh = new THREE.Shape();
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    const pts = [[ri, a - step * 0.3], [ro, a - step * 0.16], [ro, a + step * 0.16], [ri, a + step * 0.3]];
    pts.forEach((p, k) => {
      const x = Math.cos(p[1]) * p[0], y = Math.sin(p[1]) * p[0];
      if (i === 0 && k === 0) sh.moveTo(x, y); else sh.lineTo(x, y);
    });
  }
  sh.closePath();
  const nh = opts.holes ?? 6, hr = opts.holeR ?? ro * 0.17, hd = opts.holeDist ?? ro * 0.55;
  for (let k = 0; k < nh; k++) {
    const a = (k / nh) * TAU + 0.3, p = new THREE.Path();
    p.absarc(Math.cos(a) * hd, Math.sin(a) * hd, hr, 0, TAU, true);
    sh.holes.push(p);
  }
  const bore = new THREE.Path(); bore.absarc(0, 0, opts.bore ?? ro * 0.08, 0, TAU, true); sh.holes.push(bore);
  const g = new THREE.ExtrudeGeometry(sh, {
    depth: thick, bevelEnabled: true, bevelThickness: 0.0012, bevelSize: 0.0007, bevelSegments: 1, curveSegments: 14,
  });
  g.translate(0, 0, -thick / 2);
  return g;
}

/* ================================================================ 빌드 */
export function buildScene(renderer, machine) {
  const M = makeMaterials();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e0704);
  const L = LAYOUT, R = machine.R, H = machine.H, r = machine.r;
  const rig = { M, scene };

  /* ------------------------------------------ 환경광(반사용): 따뜻한 서재 */
  {
    const env = new THREE.Scene();
    const room = new THREE.Mesh(new THREE.BoxGeometry(12, 6, 12), new THREE.MeshBasicMaterial({ color: 0x1d1610, side: THREE.BackSide }));
    room.position.y = 2; env.add(room);
    const panel = (w, h, col, pos, look) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide }));
      m.position.copy(pos); m.lookAt(look || V3(0, 1, 0)); env.add(m);
    };
    panel(2.2, 1.2, new THREE.Color(6.5, 5.8, 4.8), V3(-2.5, 4, 2.5));      // 키 조명
    panel(1.4, 1.4, new THREE.Color(5, 3.6, 2.0), V3(3, 3, -3));          // 뒤쪽 램프
    panel(1.0, 2.4, new THREE.Color(1.1, 1.5, 2.4), V3(-5.5, 2, -1));     // 창문(차가운 빛)
    panel(6, 0.6, new THREE.Color(1.6, 1.35, 1.05), V3(0, 5, 0));          // 천장 반사
    panel(3, 1.2, new THREE.Color(1.4, 1.1, 0.8), V3(1, 1.2, 5));
    panel(0.25, 2.5, new THREE.Color(4, 3.6, 3.0), V3(2.2, 2.2, 3.5));       // 유리에 비칠 세로 하이라이트        // 앞쪽 은은한 반사
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(env, 0.03).texture;
    scene.environmentIntensity = 0.85;
    pm.dispose();
  }

  /* ---------------------------------------------------------- 조명 */
  const hemi = new THREE.HemisphereLight(0xfff6ec, 0x1a0e06, 0.4);
  scene.add(hemi);
  const key = new THREE.SpotLight(0xfff3e4, 85, 0, 0.6, 0.8, 2);
  key.position.set(-1.7, 2.7, 2.3);
  key.target.position.set(0.0, 0.45, 0.0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0003; key.shadow.normalBias = 0.015;
  key.shadow.camera.near = 1.5; key.shadow.camera.far = 6;
  scene.add(key, key.target);
  const rim = new THREE.SpotLight(0xffc489, 32, 0, 0.7, 0.8, 2);
  rim.position.set(1.9, 1.9, -1.9); rim.target.position.set(0, 0.6, 0);
  scene.add(rim, rim.target);
  const fill = new THREE.DirectionalLight(0xfff0e0, 0.5);
  fill.position.set(0.8, 1.2, 3); scene.add(fill);
  rig.key = key;

  /* ------------------------------------------------- 배경 / 테이블 */
  {
    const bd = new THREE.Mesh(new THREE.PlaneGeometry(10, 5), new THREE.MeshBasicMaterial({ map: TX.backdropTexture(), color: 0xb0a090 }));
    bd.position.set(0.2, 1.5, -3.4); scene.add(bd);
    const marble = TX.marbleTexture(1024); marble.repeat.set(2, 1);
    const table = mesh(new THREE.PlaneGeometry(8, 4), new THREE.MeshPhysicalMaterial({
      map: marble, roughness: 0.3, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.18,
    }), { cast: false });
    table.rotation.x = -Math.PI / 2; table.position.set(0, 0, 0.4);
    scene.add(table);
    // 테이블 앞 모서리 (나무 몰딩)
    const edge = mesh(new THREE.BoxGeometry(8, 0.06, 0.08), M.darkWood);
    edge.position.set(0, -0.03, 2.4); scene.add(edge);
  }

  /* ---------------------------------------------------------- 받침대 */
  const base = new THREE.Group(); scene.add(base);
  {
    // 아래 트레이
    const tray = mesh(new RoundedBoxGeometry(1.5, 0.07, 0.6, 3, 0.012), M.ironTile);
    tray.position.set(0.02, 0.075, 0.0); base.add(tray);
    const trim = mesh(new THREE.BoxGeometry(1.52, 0.012, 0.014), M.brassTileFine);
    trim.position.set(0.02, 0.108, 0.296); base.add(trim);
    const trim2 = trim.clone(); trim2.position.y = 0.046; base.add(trim2);
    const rv = [];
    for (let x = -0.70; x <= 0.74; x += 0.045) rv.push({ p: V3(x, 0.077, 0.3005), n: V3(0, 0, 1) });
    base.add(rivets(rv, 0.0045, M.brassFine));
    // 다리
    const footG = new THREE.LatheGeometry([new THREE.Vector2(0.0, 0), new THREE.Vector2(0.045, 0), new THREE.Vector2(0.05, 0.008), new THREE.Vector2(0.034, 0.02), new THREE.Vector2(0.03, 0.04), new THREE.Vector2(0.0, 0.04)], 32);
    for (const [x, z] of [[-0.68, -0.24], [0.72, -0.24], [-0.68, 0.24], [0.72, 0.24]]) {
      const f = mesh(footG, M.brassFine); f.position.set(x, 0, z); base.add(f);
    }
    // 위 상자
    const box = mesh(new RoundedBoxGeometry(1.25, 0.22, 0.34, 3, 0.015), M.ironTile);
    box.position.set(0.075, 0.22, -0.13); base.add(box);
    const topTrim = mesh(new THREE.BoxGeometry(1.27, 0.014, 0.016), M.brassTileFine);
    topTrim.position.set(0.075, 0.326, 0.041); base.add(topTrim);
    const rv2 = [];
    for (let x = -0.54; x <= 0.69; x += 0.05) rv2.push({ p: V3(x, 0.31, 0.0405), n: V3(0, 0, 1) });
    base.add(rivets(rv2, 0.004, M.brassFine));
    // 구리 그릴 패널
    const grill = mesh(new THREE.BoxGeometry(0.13, 0.15, 0.006), M.copper);
    grill.position.set(0.615, 0.205, 0.042); base.add(grill);
    for (let i = 0; i < 9; i++) {
      const bar = mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.14, 8), M.brassFine);
      bar.position.set(0.559 + i * 0.014, 0.205, 0.047); base.add(bar);
    }
    // 명판
    const pl = TX.plateTexture('LOTTO  6 / 45');
    const plate = mesh(new THREE.PlaneGeometry(0.30, 0.075), new THREE.MeshStandardMaterial({ map: pl.map, bumpMap: pl.bumpMap, bumpScale: 1.5, metalness: 1, roughness: 0.35 }));
    plate.position.set(-0.30, 0.255, 0.0415); base.add(plate);
    const bon = TX.plateTexture('BONUS', 512, 160);
    const bplate = mesh(new THREE.PlaneGeometry(0.15, 0.047), new THREE.MeshStandardMaterial({ map: bon.map, bumpMap: bon.bumpMap, bumpScale: 1.2, metalness: 1, roughness: 0.35 }));
    bplate.position.set(L.cupX[6], 0.076, 0.3012); base.add(bplate);
    for (let i = 0; i < 6; i++) {
      const t = TX.plateTexture(String(i + 1), 160, 160, { size: 96 });
      const p = mesh(new THREE.PlaneGeometry(0.04, 0.04), new THREE.MeshStandardMaterial({ map: t.map, bumpMap: t.bumpMap, bumpScale: 1, metalness: 1, roughness: 0.4 }));
      p.position.set(L.cupX[i], 0.076, 0.3012); base.add(p);
    }
  }

  /* ---------------------------------------------------------- 드럼 */
  const drum = new THREE.Group();
  drum.position.copy(L.drum);
  scene.add(drum);
  rig.drum = drum;
  {
    // 유리 앞/뒤판
    const gGeo = new THREE.CylinderGeometry(R + 0.012, R + 0.012, 0.006, 128);
    gGeo.rotateX(Math.PI / 2);
    const front = mesh(gGeo, M.glass, { cast: false, receive: false });
    front.position.z = H + 0.003; drum.add(front);
    const back = mesh(gGeo, M.glass, { cast: false, receive: false });
    back.position.z = -H - 0.003; drum.add(back);
    rig.frontGlass = front;

    // 황동 림 (단면을 회전시킨 Lathe)
    const h = H;
    const prof = [
      [R, -h - 0.006], [R, h + 0.006], [R - 0.010, h + 0.008], [R - 0.010, h + 0.020], [R - 0.005, h + 0.028],
      [R + 0.044, h + 0.028], [R + 0.052, h + 0.021], [R + 0.052, h + 0.009], [R + 0.034, h + 0.004],
      [R + 0.034, -h - 0.004], [R + 0.052, -h - 0.009], [R + 0.052, -h - 0.021], [R + 0.044, -h - 0.028],
      [R - 0.005, -h - 0.028], [R - 0.010, -h - 0.020], [R - 0.010, -h - 0.008], [R, -h - 0.006],
    ].map((p) => new THREE.Vector2(p[0], p[1]));
    const rimG = new THREE.LatheGeometry(prof, 180);
    rimG.rotateX(Math.PI / 2);
    const rimM = mesh(rimG, M.brassTile);
    drum.add(rimM);

    // 앞/뒤 베젤 리벳
    const rv = [];
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * TAU + 0.04;
      rv.push({ p: V3(Math.cos(a) * (R + 0.022), Math.sin(a) * (R + 0.022), h + 0.028), n: V3(0, 0, 1) });
      rv.push({ p: V3(Math.cos(a) * (R + 0.022), Math.sin(a) * (R + 0.022), -h - 0.028), n: V3(0, 0, -1) });
    }
    drum.add(rivets(rv, 0.0048, M.brassFine));

    // 클램프 8개
    const clampG = new RoundedBoxGeometry(0.062, 0.042, 2 * h + 0.085, 2, 0.008);
    const boltG = new THREE.CylinderGeometry(0.008, 0.008, 0.012, 6); boltG.rotateX(Math.PI / 2);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + Math.PI / 8;
      if (Math.abs(a - Math.PI * 1.5) < 0.3) continue;        // 배출구 자리
      const g = new THREE.Group(); g.rotation.z = a;
      const c = mesh(clampG, M.brassFine); c.position.x = R + 0.05; g.add(c);
      for (const s of [1, -1]) {
        const b = mesh(boltG, M.brassFine); b.position.set(R + 0.05, 0, s * (h + 0.047)); b.rotation.z = 0.3; g.add(b);
      }
      drum.add(g);
    }

    // 뒤쪽 스포크 허브 (바람개비처럼 천천히 회전)
    const hub = new THREE.Group(); hub.position.z = -h - 0.03; drum.add(hub);
    const disc = mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.03, 48).rotateX(Math.PI / 2), M.brassFine); hub.add(disc);
    const cap = mesh(new THREE.SphereGeometry(0.03, 24, 12, 0, TAU, 0, Math.PI / 2).rotateX(Math.PI / 2), M.brassFine); cap.position.z = 0.015; hub.add(cap);
    const ring2 = mesh(new THREE.TorusGeometry(0.075, 0.008, 12, 48), M.brassFine); hub.add(ring2);
    for (let i = 0; i < 8; i++) {
      const s = mesh(new THREE.BoxGeometry(R - 0.06, 0.014, 0.01), M.brass);
      const a = (i / 8) * TAU;
      s.position.set(Math.cos(a) * (0.06 + (R - 0.06) / 2), Math.sin(a) * (0.06 + (R - 0.06) / 2), 0);
      s.rotation.z = a; hub.add(s);
    }
    const hrv = [];
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + 0.39; hrv.push({ p: V3(Math.cos(a) * 0.042, Math.sin(a) * 0.042, 0.015), n: V3(0, 0, 1) }); }
    hub.add(rivets(hrv, 0.004, M.brassFine));
    rig.hub = hub;

    // 배출구 칼라 + 표시등
    const pd = machine.port;
    const collar = new THREE.Group();
    collar.position.set(pd.dx * (R + 0.03), pd.dy * (R + 0.03), 0);
    collar.rotation.z = Math.atan2(pd.dy, pd.dx) + Math.PI / 2;
    drum.add(collar);
    const c1 = mesh(new THREE.CylinderGeometry(0.06, 0.066, 0.05, 40), M.brassFine); collar.add(c1);
    const c2 = mesh(new THREE.TorusGeometry(0.063, 0.006, 10, 40).rotateX(Math.PI / 2), M.brassFine); c2.position.y = -0.026; collar.add(c2);
    const lamp = mesh(new THREE.SphereGeometry(0.011, 16, 10), M.lampOff.clone(), { cast: false });
    lamp.position.set(0, 0.0, 0.066); collar.add(lamp);
    const lampRing = mesh(new THREE.TorusGeometry(0.013, 0.003, 8, 24), M.brassFine); lampRing.position.set(0, 0, 0.064); collar.add(lampRing);
    rig.portLamp = lamp;

    // 위쪽 배관
    const pipe = mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.5, 20), M.brass); pipe.position.set(0.0, R + 0.29, -0.04); drum.add(pipe);
    const pj = mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.03, 20), M.brassFine); pj.position.set(0.0, R + 0.06, -0.04); drum.add(pj);
  }
  // 드럼 받침 기둥
  {
    const col = mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.1, 32), M.brassFine);
    col.position.set(L.drum.x - 0.04, 0.38, -0.1); scene.add(col);
    const fl = mesh(new THREE.CylinderGeometry(0.075, 0.08, 0.016, 32), M.brassFine);
    fl.position.set(L.drum.x - 0.04, 0.335, -0.1); scene.add(fl);
  }

  /* ---------------------------------------------------------- 기어 박스 */
  const gears = [];
  {
    const house = mesh(new RoundedBoxGeometry(0.54, 0.68, 0.2, 4, 0.045), M.ironTile);
    house.position.set(0.44, 0.68, -0.23); scene.add(house);
    const frame = mesh(new THREE.TorusGeometry(0.275, 0.012, 14, 96), M.brassFine);
    frame.position.set(0.36, 0.72, -0.128); scene.add(frame);
    const rv = [];
    for (let i = 0; i < 24; i++) { const a = (i / 24) * TAU; rv.push({ p: V3(0.36 + Math.cos(a) * 0.3, 0.72 + Math.sin(a) * 0.3, -0.129), n: V3(0, 0, 1) }); }
    scene.add(rivets(rv, 0.005, M.brassFine));
    const addGear = (x, y, z, ro, teeth, thick, mat, speed, o) => {
      const gm = mesh(gearGeometry(ro, teeth, thick, o), mat);
      gm.position.set(x, y, z); scene.add(gm);
      const ax = mesh(new THREE.CylinderGeometry(ro * 0.12, ro * 0.12, thick + 0.03, 24).rotateX(Math.PI / 2), M.brassFine);
      ax.position.set(x, y, z + 0.01); scene.add(ax);
      gears.push({ m: gm, speed });
      return gm;
    };
    const big = 0.25;
    addGear(0.36, 0.72, -0.11, big, 48, 0.022, M.iron, 1, { holes: 8, holeR: 0.04, holeDist: 0.15 });
    const bx = 0.36 + Math.cos(-0.87) * 0.33, by = 0.72 + Math.sin(-0.87) * 0.33;
    addGear(bx, by, -0.075, 0.1, 19, 0.02, M.brassFine, -48 / 19, {});
    addGear(bx + Math.cos(1.05) * 0.158, by + Math.sin(1.05) * 0.158, -0.055, 0.074, 14, 0.018, M.brassFine, 48 / 14, { holes: 5 });
    addGear(0.36 + Math.cos(0.52) * 0.289, 0.72 + Math.sin(0.52) * 0.289, -0.085, 0.055, 11, 0.016, M.iron, -48 / 11, { holes: 4 });
    rig.gears = gears;
    // 배관
    const curve = new THREE.CatmullRomCurve3([V3(0.62, 1.0, -0.2), V3(0.66, 1.12, -0.2), V3(0.78, 1.2, -0.22), V3(0.95, 1.22, -0.3), V3(1.3, 1.22, -0.4)]);
    scene.add(mesh(new THREE.TubeGeometry(curve, 60, 0.018, 16, false), M.brass));
    const curve2 = new THREE.CatmullRomCurve3([V3(0.69, 0.42, -0.2), V3(0.76, 0.40, -0.2), V3(0.80, 0.33, -0.2), V3(0.80, 0.25, -0.2)]);
    scene.add(mesh(new THREE.TubeGeometry(curve2, 30, 0.014, 12, false), M.copper));
  }

  /* ---------------------------------------------------------- 압력계 */
  {
    const g = new THREE.Group(); g.position.set(0.6, 0.94, -0.085); scene.add(g);
    const body = mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.035, 48).rotateX(Math.PI / 2), M.brassFine); g.add(body);
    const face = mesh(new THREE.CircleGeometry(0.064, 48), new THREE.MeshStandardMaterial({ map: TX.gaugeTexture(), roughness: 0.55 }), { cast: false });
    face.position.z = 0.0176; g.add(face);
    const bez = mesh(new THREE.TorusGeometry(0.068, 0.007, 12, 48), M.brassFine); bez.position.z = 0.019; g.add(bez);
    const needle = new THREE.Group(); needle.position.z = 0.021; g.add(needle);
    const nd = mesh(new THREE.BoxGeometry(0.0035, 0.052, 0.002), new THREE.MeshStandardMaterial({ color: 0x7a1408, roughness: 0.4 }), { cast: false });
    nd.position.y = 0.022; needle.add(nd);
    needle.add(mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.004, 16).rotateX(Math.PI / 2), M.brassFine));
    const cover = mesh(new THREE.CircleGeometry(0.064, 48), M.glass, { cast: false, receive: false }); cover.position.z = 0.024; g.add(cover);
    const stem = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.12, 16), M.brass); stem.position.set(0, -0.11, -0.02); g.add(stem);
    rig.needle = needle;
  }

  /* ---------------------------------------------------------- 레버 */
  {
    const outer = new THREE.Group(); outer.position.set(0.8, 0.4, 0.0); outer.rotation.z = -0.34; scene.add(outer);
    const boss = mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.06, 32).rotateZ(Math.PI / 2), M.brassFine); outer.add(boss);
    const plate = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.012, 40).rotateZ(Math.PI / 2), M.ironTile); plate.position.x = -0.036; outer.add(plate);
    const arm = new THREE.Group(); outer.add(arm);
    const rod = mesh(new THREE.CylinderGeometry(0.011, 0.014, 0.36, 20), M.brassFine); rod.position.y = 0.18; arm.add(rod);
    const coll = mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.02, 20), M.brassFine); coll.position.y = 0.33; arm.add(coll);
    const knob = mesh(new THREE.SphereGeometry(0.034, 32, 20), M.knob); knob.position.y = 0.37; arm.add(knob);
    arm.rotation.x = -0.12;
    rig.lever = arm; rig.leverHit = outer;
  }

  /* ---------------------------------------------------------- 유리 튜브 */
  {
    const pd = machine.port, cs = machine.captureS;
    const start = V3(L.drum.x + pd.dx * cs, L.drum.y + pd.dy * cs, 0);
    const pts = [
      start, V3(start.x + 0.008, 0.381, 0.045), V3(-0.10, 0.375, 0.092), V3(0.05, 0.368, 0.098),
      V3(0.30, 0.362, 0.098), V3(0.52, 0.359, 0.104), V3(0.635, 0.357, 0.145), V3(0.66, 0.355, 0.19),
    ];
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    curve.arcLengthDivisions = 600;
    rig.tubeCurve = curve;
    const tubeM = mesh(new THREE.TubeGeometry(curve, 220, L.tubeR, 32, false), M.glassThick, { cast: false, receive: false });
    scene.add(tubeM);
    // 황동 밴드
    for (const u of [0.18, 0.45, 0.72]) {
      const p = curve.getPointAt(u), t = curve.getTangentAt(u);
      const band = mesh(new THREE.TorusGeometry(L.tubeR + 0.004, 0.007, 12, 40), M.brassFine);
      band.position.copy(p); band.quaternion.setFromUnitVectors(V3(0, 0, 1), t); scene.add(band);
    }
    // 튜브 끝 (나팔형 황동 노즐)
    const end = curve.getPointAt(1), te = curve.getTangentAt(1);
    const noz = mesh(new THREE.CylinderGeometry(L.tubeR + 0.012, L.tubeR + 0.006, 0.03, 36, 1, true), M.brassFine);
    noz.material = M.brassFine.clone(); noz.material.side = THREE.DoubleSide;
    noz.position.copy(end).addScaledVector(te, -0.012); noz.quaternion.setFromUnitVectors(V3(0, 1, 0), te); scene.add(noz);
    const nring = mesh(new THREE.TorusGeometry(L.tubeR + 0.012, 0.005, 10, 36), M.brassFine);
    nring.position.copy(end); nring.quaternion.setFromUnitVectors(V3(0, 0, 1), te); scene.add(nring);
    // 시작 칼라
    const sc = mesh(new THREE.TorusGeometry(L.tubeR + 0.004, 0.009, 12, 40), M.brassFine);
    sc.position.copy(curve.getPointAt(0.02)); sc.quaternion.setFromUnitVectors(V3(0, 0, 1), curve.getTangentAt(0.02)); scene.add(sc);
  }

  /* ---------------------------------------------------------- 레일 */
  const flaps = [], stoppers = [];
  {
    const ang = Math.atan(L.railSlope);
    const x0 = L.railX0, x1 = L.railX1;
    const floorY = (x) => railY(x) - r - 0.003;
    const z = L.railZ;
    const seg = (xa, xb, y0, mat, h = 0.003, w = 0.06, zz = z) => {
      const len = (xb - xa) / Math.cos(ang);
      const m = mesh(new THREE.BoxGeometry(len, h, w), mat);
      const xm = (xa + xb) / 2;
      m.position.set(xm, y0(xm), zz); m.rotation.z = ang;
      scene.add(m); return m;
    };
    // 바닥판 (컵 위는 구멍 + 플랩)
    const hole = 0.092;
    let xa = x0;
    const sorted = L.cupX.slice().sort((a, b) => a - b);
    for (const cx of sorted) { seg(xa, cx - hole / 2, floorY, M.brassTileFine); xa = cx + hole / 2; }
    seg(xa, x1 + 0.02, floorY, M.brassTileFine);
    // 가드 봉 (얇은 황동 봉 두 줄)
    for (const s of [1, -1]) {
      const len = (x1 + 0.02 - x0) / Math.cos(ang);
      const rod = mesh(new THREE.CylinderGeometry(0.0035, 0.0035, len, 10).rotateZ(Math.PI / 2), M.brassFine);
      const xm = (x0 + x1 + 0.02) / 2;
      rod.position.set(xm, floorY(xm) + 0.024, z + s * 0.031); rod.rotation.z = ang; scene.add(rod);
      for (let xp = x0 + 0.02; xp < x1; xp += 0.17) {
        const post = mesh(new THREE.CylinderGeometry(0.0025, 0.0025, 0.024, 8), M.brassFine);
        post.position.set(xp, floorY(xp) + 0.012, z + s * 0.031); scene.add(post);
      }
    }
    // 플랩 (경첩: 구멍의 오른쪽 끝)
    L.cupX.forEach((cx, i) => {
      const pivot = new THREE.Group();
      pivot.position.set(cx + hole / 2, floorY(cx + hole / 2), z); pivot.rotation.z = ang;
      const f = mesh(new THREE.BoxGeometry(hole - 0.002, 0.004, 0.054), M.brassFine);
      f.position.x = -(hole - 0.002) / 2; pivot.add(f);
      scene.add(pivot);
      flaps[i] = { pivot, open: 0, target: 0 };
      // 스토퍼 핀 (구멍 왼쪽 끝 아래에서 솟아오름)
      const pin = mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.05, 12), M.brassFine);
      const px = cx - r - 0.006;
      pin.position.set(px, floorY(px) - 0.03, z); scene.add(pin);
      stoppers[i] = { pin, baseY: floorY(px) - 0.03, up: 0, target: 0, x: px };
    });
    // 지지 브래킷
    for (const bxp of [-0.535, -0.365, -0.195, -0.025, 0.145, 0.365, 0.62]) {
      const br = mesh(new THREE.BoxGeometry(0.014, 0.012, 0.16), M.brassFine);
      br.position.set(bxp, floorY(bxp) - 0.008, z - 0.07); scene.add(br);
    }
    // 끝 범퍼
    const bump = mesh(new RoundedBoxGeometry(0.02, 0.07, 0.07, 2, 0.006), M.brassFine);
    bump.position.set(L.bumperX + 0.01, railY(L.bumperX), z); scene.add(bump);
    const endL = mesh(new RoundedBoxGeometry(0.016, 0.05, 0.07, 2, 0.005), M.brassFine);
    endL.position.set(x0 - 0.008, railY(x0) - 0.01, z); scene.add(endL);
  }
  rig.flaps = flaps; rig.stoppers = stoppers;

  /* ---------------------------------------------------------- 유리컵 */
  {
    const outer = [[0, 0], [0.03, 0.002], [0.047, 0.012], [0.055, 0.03], [0.058, 0.055], [0.059, 0.07]];
    const inner = [[0.056, 0.07], [0.055, 0.055], [0.052, 0.031], [0.044, 0.015], [0.028, 0.006], [0, 0.004]];
    const prof = outer.concat(inner).map((p) => new THREE.Vector2(p[0], p[1]));
    const cupG = new THREE.LatheGeometry(prof, 64);
    const standG = new THREE.LatheGeometry([[0, 0], [0.045, 0], [0.048, 0.006], [0.03, 0.011], [0.012, 0.016], [0.011, 0.03], [0.022, 0.035], [0, 0.036]].map((p) => new THREE.Vector2(p[0], p[1])), 40);
    const ringG = new THREE.TorusGeometry(0.0598, 0.0026, 10, 64).rotateX(Math.PI / 2);
    L.cupX.forEach((cx) => {
      const st = mesh(standG, M.brassFine); st.position.set(cx, L.trayTop, L.cupZ); scene.add(st);
      const cup = mesh(cupG, M.glassThick, { cast: false, receive: false }); cup.position.set(cx, L.cupBaseY, L.cupZ); scene.add(cup);
      const ring = mesh(ringG, M.brassFine); ring.position.set(cx, L.cupBaseY + 0.0695, L.cupZ); scene.add(ring);
      const band = mesh(new THREE.CylinderGeometry(0.0485, 0.044, 0.008, 48, 1, true), M.brassFine); band.position.set(cx, L.cupBaseY + 0.016, L.cupZ); scene.add(band);
    });
  }

  /* ---------------------------------------------------------- 전구 */
  const bulbs = [];
  {
    for (const [x, y, z] of [[0.95, 1.26, -0.5], [-0.95, 1.22, -0.65], [0.38, 1.4, -0.85]]) {
      const g = new THREE.Group(); g.position.set(x, y, z); scene.add(g);
      const cord = mesh(new THREE.CylinderGeometry(0.003, 0.003, 1.2, 6), M.black); cord.position.y = 0.65; g.add(cord);
      const sock = mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.05, 20), M.brassFine); sock.position.y = 0.06; g.add(sock);
      const bulb = mesh(new THREE.SphereGeometry(0.04, 24, 16), new THREE.MeshStandardMaterial({
        color: 0xffd9a0, emissive: 0xffa040, emissiveIntensity: 3.2, roughness: 0.2, transparent: true, opacity: 0.92,
      }), { cast: false });
      bulb.scale.set(1, 1.25, 1); g.add(bulb);
      const pl = new THREE.PointLight(0xffa860, 1.6, 0, 2); g.add(pl);
      bulbs.push(bulb);
    }
  }

  /* ---------------------------------------------------------- 구슬 */
  const ballGeo = new THREE.SphereGeometry(r, 48, 32);
  const ballMeshes = new Map();
  for (let id = 1; id <= 45; id++) {
    const mat = new THREE.MeshPhysicalMaterial({
      map: TX.ballTexture(id), roughness: 0.2, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.1,
    });
    const m = mesh(ballGeo, mat);
    m.name = 'ball-' + id;
    ballMeshes.set(id, m);
    drum.add(m);
  }
  rig.ballMeshes = ballMeshes;

  return rig;
}
