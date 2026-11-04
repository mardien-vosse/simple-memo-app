// 이웃 아이들: 같은 별에서 함께 지내는 다른 강아지·고양이들이에요.
// 지금은 연습용으로 만든 아이들이고, 2단계에서 실시간 서버가 생기면 실제로 접속한 집사들의 아이로 바뀌어요.
// 수백 마리를 휴대폰에서 그리려고, 몸의 부위마다 '복사 그리기(InstancedMesh)'를 써서 열 번 정도만 그려요.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createBrain } from './brain.js';

// 성격마다 행동 확률이 달라요. (1단계 계획: 성격 태그 → 행동 확률표)
const PERSONALITIES = [
  { name: '활발함', chances: { walk: 50, sniff: 15, look: 10, sit: 10, lie: 10, nap: 5 }, speed: [0.75, 1.0] },
  { name: '느긋함', chances: { walk: 15, sniff: 8, look: 7, sit: 20, lie: 25, nap: 25 }, speed: [0.45, 0.65] },
  { name: '호기심', chances: { walk: 30, sniff: 25, look: 20, sit: 10, lie: 10, nap: 5 }, speed: [0.6, 0.85] },
];

const DOG_COATS = [
  { fur: 0xf6f1ea, ear: 0xe8dccb, light: 0xffffff }, // 하양
  { fur: 0xf1d6ad, ear: 0xd9b07a, light: 0xfff6ea }, // 크림
  { fur: 0xdeae6c, ear: 0xb98446, light: 0xfff1dd }, // 황금
  { fur: 0xb5764a, ear: 0x8a5532, light: 0xf3e2cf }, // 갈색
  { fur: 0x7a5238, ear: 0x5a3a27, light: 0xe9d6c2 }, // 초콜릿
  { fur: 0x3a3333, ear: 0x2b2626, light: 0xf2ede8 }, // 검정
  { fur: 0xbdb8b4, ear: 0x9a9591, light: 0xf7f5f2 }, // 회색
];
const CAT_COATS = [
  { fur: 0xe7a05a, ear: 0xe7a05a, light: 0xfff3e3 }, // 치즈
  { fur: 0x9c9a9e, ear: 0x9c9a9e, light: 0xf1f0f2 }, // 회색
  { fur: 0x353234, ear: 0x353234, light: 0x4a4547 }, // 검정
  { fur: 0xf4f1ec, ear: 0xf4f1ec, light: 0xffffff }, // 하양
  { fur: 0xa58463, ear: 0xa58463, light: 0xf0e4d4 }, // 고등어
];

const HIP_Y = 0.33;
const HIP_Z = 0.24;
const LEG_SPOTS = [
  [0.11, HIP_Z, true],
  [-0.11, HIP_Z, true],
  [0.11, -HIP_Z, false],
  [-0.11, -HIP_Z, false],
];

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (v) => v * v * (3 - 2 * v);

function geometry(base, { x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0 } = {}) {
  base.scale(sx, sy, sz);
  base.rotateX(rx);
  base.translate(x, y, z);
  return base;
}

// 부위별 모양 (임시 강아지와 같은 기준: 땅이 y = 0, 앞쪽이 +Z, 몸길이 약 1.05)
function makeParts() {
  const ball = (r, detail = 1) => new THREE.IcosahedronGeometry(r, detail);
  const neck = new THREE.CylinderGeometry(0.1, 0.13, 0.2, 6);
  neck.rotateX(0.5);
  neck.translate(0, 0.62, 0.34);
  neck.deleteAttribute('uv');
  const torso = geometry(new THREE.CapsuleGeometry(0.2, 0.42, 3, 7), { rx: Math.PI / 2, y: 0.5, sx: 0.95, sy: 0.92 });
  torso.deleteAttribute('uv');
  const body = mergeGeometries([torso.index ? torso.toNonIndexed() : torso, neck.index ? neck.toNonIndexed() : neck]);
  const chest = geometry(ball(0.15, 0), { y: 0.45, z: 0.3, sx: 0.95, sy: 1.05, sz: 0.7 });
  // 머리 부위는 머리 회전축(목) 기준 위치예요.
  const skull = geometry(ball(0.19), { y: 0.06, z: 0.02, sy: 0.92 });
  const snout = geometry(new THREE.CapsuleGeometry(0.08, 0.09, 2, 7), { rx: Math.PI / 2, z: 0.2 });
  const catSnout = geometry(ball(0.075), { y: -0.01, z: 0.17, sy: 0.8 });
  const ink = mergeGeometries([
    geometry(ball(0.038, 0), { y: 0.03, z: 0.33 }),
    geometry(ball(0.027, 0), { x: 0.08, y: 0.1, z: 0.185 }),
    geometry(ball(0.027, 0), { x: -0.08, y: 0.1, z: 0.185 }),
  ]);
  const catInk = mergeGeometries([
    geometry(ball(0.03, 0), { y: 0.02, z: 0.24 }),
    geometry(ball(0.03, 0), { x: 0.08, y: 0.1, z: 0.18 }),
    geometry(ball(0.03, 0), { x: -0.08, y: 0.1, z: 0.18 }),
  ]);
  const flap = (side) => {
    const g = geometry(ball(0.1, 0), { y: -0.09, sx: 0.42, sz: 0.75 });
    g.rotateZ(side * 0.3);
    g.translate(side * 0.14, 0.17, 0);
    return g;
  };
  const dogEars = mergeGeometries([flap(1), flap(-1)]);
  const point = (side) => {
    const g = new THREE.ConeGeometry(0.07, 0.15, 4);
    g.rotateZ(-side * 0.25);
    g.translate(side * 0.11, 0.25, 0);
    return g;
  };
  const catEars = mergeGeometries([point(1), point(-1)]);
  const legGeo = mergeGeometries([
    geometry(new THREE.CylinderGeometry(0.055, 0.048, 0.28, 5), { y: -0.14 }).toNonIndexed(),
    geometry(ball(0.06, 0), { y: -0.285, z: 0.015, sy: 0.62, sz: 1.25 }),
  ]);
  const tail = geometry(new THREE.CapsuleGeometry(0.04, 0.22, 2, 5), { y: 0.15 });
  // 다른 부위와 합칠 수 있도록 uv를 빼고 맞춰 둬요.
  for (const g of [chest, skull, snout, catSnout, ink, catInk, dogEars, catEars, legGeo, tail]) if (g.attributes.uv) g.deleteAttribute('uv');
  return { body, chest, skull, snout, catSnout, ink, catInk, dogEars, catEars, legGeo, tail };
}

function makeShadowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(30, 60, 40, 0.42)');
  g.addColorStop(1, 'rgba(30, 60, 40, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createNeighbors(scene, { count, radius, behaviors, obstacles, keepClear = [], seed = 7 }) {
  let s = seed >>> 0;
  const random = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = (list) => list[Math.floor(random() * list.length)];

  // 아이 한 마리씩: 종류, 털색, 크기, 성격, 행동 두뇌
  const pets = [];
  const dogs = [];
  const cats = [];
  for (let i = 0; i < count; i++) {
    const isCat = random() < 0.3;
    const personality = pick(PERSONALITIES);
    const table = {};
    for (const [name, b] of Object.entries(behaviors)) {
      if (personality.chances[name]) table[name] = { ...b, chance: personality.chances[name] };
    }
    const walkSpeed = personality.speed[0] + random() * (personality.speed[1] - personality.speed[0]);
    const brain = createBrain({ behaviors: table, walkSpeed, radius, obstacles, random });
    // 처음 자리: 나무·집·별이와 겹치지 않는 곳
    for (let tries = 0; tries < 40; tries++) {
      const z = random() * 2 - 1;
      const a = random() * Math.PI * 2;
      const r = Math.sqrt(1 - z * z);
      brain.normal.set(r * Math.cos(a), z, r * Math.sin(a));
      const free =
        obstacles.every((o) => brain.normal.angleTo(o.dir) * radius > o.radius + 0.8) &&
        keepClear.every((c) => brain.normal.angleTo(c.dir) * radius > c.radius);
      if (free) break;
    }
    const side = new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5);
    brain.forward.copy(side).addScaledVector(brain.normal, -side.dot(brain.normal)).normalize();
    brain.force(pick(Object.keys(table)));
    const pet = {
      brain,
      isCat,
      coat: pick(isCat ? CAT_COATS : DOG_COATS),
      size: (isCat ? 0.85 : 0.8) + random() * (isCat ? 0.25 : 0.5),
      phase: random() * 10,
      wag: random() * 10,
      look: random() * 10,
      slot: 0,
      skip: 0,
    };
    pet.slot = isCat ? cats.length : dogs.length;
    (isCat ? cats : dogs).push(pet);
    pets.push(pet);
  }

  // 부위마다 InstancedMesh 하나씩 (같은 모양을 한 번에 여러 마리 그려요)
  const parts = makeParts();
  const material = new THREE.MeshLambertMaterial({ flatShading: true });
  const make = (geo, n) => {
    const mesh = new THREE.InstancedMesh(geo, material, Math.max(1, n));
    mesh.count = n;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(mesh);
    return mesh;
  };
  const meshes = {
    body: make(parts.body, count),
    chest: make(parts.chest, count),
    skull: make(parts.skull, count),
    dogSnout: make(parts.snout, dogs.length),
    catSnout: make(parts.catSnout, cats.length),
    dogInk: make(parts.ink, dogs.length),
    catInk: make(parts.catInk, cats.length),
    dogEars: make(parts.dogEars, dogs.length),
    catEars: make(parts.catEars, cats.length),
    legs: make(parts.legGeo, count * 4),
    tail: make(parts.tail, count),
  };
  const shadowGeo = new THREE.CircleGeometry(0.5, 12);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadows = new THREE.InstancedMesh(
    shadowGeo,
    new THREE.MeshBasicMaterial({ map: makeShadowTexture(), transparent: true, depthWrite: false }),
    count
  );
  shadows.frustumCulled = false;
  shadows.renderOrder = 1;
  scene.add(shadows);

  // 털색은 아이마다 미리 계산해 두고, 그릴 때 칸에 칠해요.
  for (const pet of pets) {
    pet.colors = {
      fur: new THREE.Color(pet.coat.fur),
      light: new THREE.Color(pet.coat.light),
      ear: new THREE.Color(pet.coat.ear),
      ink: new THREE.Color(pet.isCat ? 0x2f3a2a : 0x2a1f1d),
    };
  }

  // 매 순간 쓰는 계산용 그릇 (새로 만들지 않고 계속 다시 써요)
  const rootM = new THREE.Matrix4();
  const torsoM = new THREE.Matrix4();
  const headM = new THREE.Matrix4();
  const tmp = new THREE.Matrix4();
  const tmp2 = new THREE.Matrix4();
  const out = new THREE.Matrix4();
  const left = new THREE.Vector3();
  const sizeV = new THREE.Vector3();
  const camDir = new THREE.Vector3();
  const rot = new THREE.Matrix4();

  // 보이는 아이만 앞칸부터 차례로 채워서 그려요. (i: 모든 아이 칸, j: 강아지끼리·고양이끼리 칸)
  function draw(pet, i, j, dt) {
    const col = pet.colors;
    meshes.body.setColorAt(i, col.fur);
    meshes.skull.setColorAt(i, col.fur);
    meshes.tail.setColorAt(i, col.fur);
    for (let k = 0; k < 4; k++) meshes.legs.setColorAt(i * 4 + k, col.fur);
    meshes.chest.setColorAt(i, col.light);
    (pet.isCat ? meshes.catInk : meshes.dogInk).setColorAt(j, col.ink);
    (pet.isCat ? meshes.catSnout : meshes.dogSnout).setColorAt(j, col.light);
    (pet.isCat ? meshes.catEars : meshes.dogEars).setColorAt(j, col.ear);

    const b = pet.brain;
    const m = b.motion;
    const walk = clamp01(m.speed / m.walkSpeed);
    const st = smooth(m.sit);
    const l = smooth(m.lie);
    const z = smooth(m.sleep);
    const sn = smooth(m.sniff);
    pet.phase += dt * m.speed * 13;
    pet.wag += dt * (5 + 6 * walk) * (1 - 0.6 * z);
    pet.look += dt;

    // 별 위 자리와 방향, 크기
    left.crossVectors(b.normal, b.forward);
    rootM.makeBasis(left, b.normal, b.forward).scale(sizeV.set(pet.size, pet.size, pet.size));
    rootM.setPosition(b.normal.x * radius, b.normal.y * radius, b.normal.z * radius);

    // 그림자
    out.copy(rootM).multiply(tmp.makeScale(0.8, 1, 1.2).setPosition(0, 0.02, 0));
    shadows.setMatrixAt(i, out);

    // 몸통: 뒷다리 쪽을 축으로 앉을 때 세우고, 엎드리면 내려요.
    const tilt = -0.45 * st + 0.06 * sn;
    const drop = 0.217 * st + 0.285 * l - Math.abs(Math.cos(pet.phase)) * 0.018 * walk;
    torsoM.makeTranslation(0, HIP_Y - drop, -HIP_Z).multiply(rot.makeRotationX(tilt)).multiply(tmp.makeTranslation(0, -HIP_Y, HIP_Z));
    out.copy(rootM).multiply(torsoM);
    meshes.body.setMatrixAt(i, out);
    meshes.chest.setMatrixAt(i, out);

    // 머리: 두리번 + 킁킁 + 졸기
    const yaw = (1 - sn) * (1 - z) * Math.sin(pet.look * 0.6) * (walk > 0.5 ? 0.15 : 0.5) + sn * Math.sin(pet.look * 3) * 0.25 + 0.35 * z;
    const pitch = 0.27 * st + sn * (0.65 + Math.sin(pet.look * 14) * 0.06) + 0.5 * z - 0.1 * l * (1 - z);
    headM.makeTranslation(0, 0.72, 0.4).multiply(rot.makeRotationY(yaw)).multiply(tmp.makeRotationX(pitch));
    out.copy(rootM).multiply(torsoM).multiply(headM);
    meshes.skull.setMatrixAt(i, out);
    if (pet.isCat) {
      meshes.catSnout.setMatrixAt(j, out);
      meshes.catInk.setMatrixAt(j, out);
      meshes.catEars.setMatrixAt(j, out);
    } else {
      meshes.dogSnout.setMatrixAt(j, out);
      meshes.dogInk.setMatrixAt(j, out);
      meshes.dogEars.setMatrixAt(j, out);
    }

    // 다리: 대각선 종종걸음, 앉기·엎드리기 자세
    const swing = Math.sin(pet.phase) * 0.6 * walk * (1 - Math.max(st, l));
    LEG_SPOTS.forEach(([x, zz, front], k) => {
      const diagonal = (x > 0) === front;
      const angle = (diagonal ? swing : -swing) + (front ? 0.45 * st - 1.45 * l : -0.73 * st - 1.4 * l);
      const splay = front ? 0 : Math.sign(x) * 0.35 * l;
      tmp2.makeTranslation(x, HIP_Y, zz).multiply(rot.makeRotationX(angle)).multiply(tmp.makeRotationZ(splay));
      out.copy(rootM).multiply(torsoM).multiply(tmp2);
      meshes.legs.setMatrixAt(i * 4 + k, out);
    });

    // 꼬리: 강아지는 살랑살랑, 고양이는 위로 세워 천천히
    const wag = Math.sin(pet.wag * (pet.isCat ? 0.35 : 1)) * (pet.isCat ? 0.25 : 0.45) * (1 - 0.85 * z);
    const tailTilt = (pet.isCat ? -0.35 : -0.8) - 0.75 * st - 0.85 * l;
    tmp2.makeTranslation(0, 0.58, -0.38).multiply(rot.makeRotationY(wag)).multiply(tmp.makeRotationX(tailTilt));
    out.copy(rootM).multiply(torsoM).multiply(tmp2);
    meshes.tail.setMatrixAt(i, out);
  }

  let frame = 0;
  function update(dt, camera) {
    frame++;
    // 카메라에서 보이는 쪽(지평선 안쪽)에 있는 아이만 그려요.
    const camDistance = camera.position.length();
    camDir.copy(camera.position).divideScalar(camDistance);
    const horizon = Math.cos(Math.min(Math.PI, Math.acos(Math.min(1, radius / camDistance)) + 0.12));
    let shown = 0;
    let shownDogs = 0;
    let shownCats = 0;
    pets.forEach((pet, i) => {
      const visible = pet.brain.normal.dot(camDir) > horizon;
      // 안 보이는 아이는 4번에 1번만 움직임을 계산해요 (대신 4배 시간만큼).
      if (visible || (frame + i) % 4 === 0) pet.brain.update(visible ? dt : Math.min(dt * 4, 0.25));
      if (visible) draw(pet, shown++, pet.isCat ? shownCats++ : shownDogs++, dt);
    });
    for (const key of ['body', 'chest', 'skull', 'tail']) meshes[key].count = shown;
    meshes.legs.count = shown * 4;
    shadows.count = shown;
    for (const key of ['dogSnout', 'dogInk', 'dogEars']) meshes[key].count = shownDogs;
    for (const key of ['catSnout', 'catInk', 'catEars']) meshes[key].count = shownCats;
    for (const mesh of Object.values(meshes)) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    shadows.instanceMatrix.needsUpdate = true;
    visibleCount = shown;
  }

  let visibleCount = 0;
  return {
    update,
    count,
    get visible() {
      return visibleCount;
    },
  };
}
