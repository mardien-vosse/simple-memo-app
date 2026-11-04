// 작은 별(행성), 풀·꽃·나무·바위, 하늘, 구름, 빛을 만들어요.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const UP = new THREE.Vector3(0, 1, 0);

const COLORS = {
  meadowDark: 0x7fc680,
  meadowLight: 0xa5dc8f,
  grass: [0x79c47a, 0x8fd388, 0x6db975, 0x9cd98a],
  flowers: [0xffb7c9, 0xfff0a3, 0xffffff, 0xcdbdff, 0xffc89e],
  stem: 0x5fae6a,
  trunk: 0x9b6f55,
  leaves: [0x66bf86, 0x58b07c, 0x7acb8c],
  pine: [0x4fa173, 0x459669],
  rock: [0xcac3d6, 0xbdb6cc],
  cloud: 0xffffff,
  skyTop: 0x86bdf0,
  skyHorizon: 0xfde6d3,
  skyBottom: 0xf5c7d6,
};

// 같은 숫자(seed)로 시작하면 매번 같은 별 모습이 나와요.
function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (list, rand) => list[Math.floor(rand() * list.length)];

function randomDirection(rand) {
  const z = rand() * 2 - 1;
  const a = rand() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return new THREE.Vector3(r * Math.cos(a), z, r * Math.sin(a));
}

// 아이가 처음 서 있는 곳(별 꼭대기) 근처는 비워 둬요.
function randomOpenDirection(rand, minAngleFromStart = 0.35) {
  for (;;) {
    const dir = randomDirection(rand);
    if (dir.angleTo(UP) > minAngleFromStart) return dir;
  }
}

// 기준 방향 근처에서 살짝 비껴난 방향 (꽃밭처럼 모여 있게 할 때)
function nearbyDirection(center, spread, rand) {
  return center
    .clone()
    .add(new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(spread))
    .normalize();
}

// 별 표면의 한 점에, 표면에 수직으로 서 있게 놓는 변환
function surfaceMatrix(dir, radius, spin, scale) {
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
  q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, spin));
  const s = typeof scale === 'number' ? new THREE.Vector3(scale, scale, scale) : scale;
  return new THREE.Matrix4().compose(dir.clone().multiplyScalar(radius), q, s);
}

// 각진(로우폴리) 느낌의 조각에 색을 칠해 둬요. 여러 조각을 하나로 합쳐 그리면 휴대폰이 덜 힘들어요.
function part(geometry, color) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  const c = new THREE.Color(color);
  const colors = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) {
    colors[i] = c.r;
    colors[i + 1] = c.g;
    colors[i + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

const lowPoly = (opts = {}) => new THREE.MeshLambertMaterial({ flatShading: true, ...opts });

function makePlanet(radius, rand) {
  const geo = new THREE.IcosahedronGeometry(radius, 10);
  geo.deleteAttribute('uv');
  geo.computeVertexNormals();
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const dark = new THREE.Color(COLORS.meadowDark);
  const light = new THREE.Color(COLORS.meadowLight);
  const c = new THREE.Color();
  const center = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    center.set(0, 0, 0);
    for (let k = 0; k < 3; k++) center.add(v.fromBufferAttribute(pos, i + k));
    center.normalize();
    // 부드러운 얼룩무늬 + 면마다 조금씩 다른 색 = 풀밭 느낌
    const wave =
      Math.sin(center.x * 3.1 + 0.4) + Math.sin(center.y * 2.3 + 1.2) + Math.sin(center.z * 2.7 + 2.1);
    const t = THREE.MathUtils.clamp((wave + 3) / 6 + (rand() - 0.5) * 0.18, 0, 1);
    c.copy(dark).lerp(light, t);
    for (let k = 0; k < 3; k++) c.toArray(colors, (i + k) * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return new THREE.Mesh(geo, lowPoly({ vertexColors: true }));
}

function makeGrass(radius, rand, count) {
  const blades = [];
  for (let i = 0; i < 3; i++) {
    const b = new THREE.ConeGeometry(0.035, 0.24 + i * 0.05, 3);
    b.translate(0, (0.24 + i * 0.05) / 2, 0);
    b.rotateZ((i - 1) * 0.38);
    b.rotateY(i * 2.1);
    blades.push(b);
  }
  const mesh = new THREE.InstancedMesh(mergeGeometries(blades), lowPoly(), count);
  const color = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const m = surfaceMatrix(randomDirection(rand), radius - 0.02, rand() * Math.PI * 2, 0.7 + rand() * 0.7);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, color.setHex(pick(COLORS.grass, rand)));
  }
  return mesh;
}

function makeFlowers(radius, rand, patches, perPatch) {
  const count = patches * perPatch;
  const stemGeo = new THREE.CylinderGeometry(0.012, 0.014, 0.2, 4);
  stemGeo.translate(0, 0.1, 0);
  const headGeo = new THREE.IcosahedronGeometry(0.055, 0);
  headGeo.translate(0, 0.22, 0);
  const stems = new THREE.InstancedMesh(stemGeo, lowPoly({ color: COLORS.stem }), count);
  const heads = new THREE.InstancedMesh(headGeo, lowPoly(), count);
  const color = new THREE.Color();
  let i = 0;
  for (let p = 0; p < patches; p++) {
    const center = randomOpenDirection(rand, 0.2);
    const patchColor = pick(COLORS.flowers, rand);
    for (let k = 0; k < perPatch; k++, i++) {
      const m = surfaceMatrix(nearbyDirection(center, 0.12, rand), radius - 0.02, rand() * 6.28, 0.8 + rand() * 0.5);
      stems.setMatrixAt(i, m);
      heads.setMatrixAt(i, m);
      heads.setColorAt(i, color.setHex(rand() < 0.8 ? patchColor : pick(COLORS.flowers, rand)));
    }
  }
  const group = new THREE.Group();
  group.add(stems, heads);
  return group;
}

function roundTree(rand) {
  const h = 0.55 + rand() * 0.35;
  const r = 0.42 + rand() * 0.18;
  const leaf = pick(COLORS.leaves, rand);
  const trunk = new THREE.CylinderGeometry(0.07, 0.11, h, 6);
  trunk.translate(0, h / 2, 0);
  const crown = new THREE.IcosahedronGeometry(r, 1);
  crown.translate(0, h + r * 0.7, 0);
  const puff = new THREE.IcosahedronGeometry(r * 0.62, 1);
  puff.translate(r * 0.55, h + r * 0.4, r * 0.15);
  return {
    geometry: mergeGeometries([part(trunk, COLORS.trunk), part(crown, leaf), part(puff, leaf)]),
    radius: r + 0.15,
  };
}

function pineTree(rand) {
  const color = pick(COLORS.pine, rand);
  const trunk = new THREE.CylinderGeometry(0.06, 0.09, 0.4, 6);
  trunk.translate(0, 0.2, 0);
  const parts = [part(trunk, COLORS.trunk)];
  for (let i = 0; i < 3; i++) {
    const w = 0.5 - i * 0.12;
    const cone = new THREE.ConeGeometry(w, 0.55, 7);
    cone.translate(0, 0.55 + i * 0.32, 0);
    parts.push(part(cone, color));
  }
  return { geometry: mergeGeometries(parts), radius: 0.55 };
}

function rock(rand) {
  const g = new THREE.DodecahedronGeometry(0.22, 0);
  const sx = 0.8 + rand() * 0.6;
  g.scale(sx, 0.55 + rand() * 0.35, 0.8 + rand() * 0.5);
  return { geometry: part(g, pick(COLORS.rock, rand)), radius: 0.22 * sx + 0.1 };
}

// 나무와 바위는 전부 하나로 합쳐서 한 번에 그려요. 아이가 피해 다닐 수 있게 위치도 기억해 둬요.
function makeProps(radius, rand, obstacles) {
  const pieces = [];
  const place = (maker, count, sink) => {
    for (let i = 0; i < count; i++) {
      const { geometry, radius: r } = maker(rand);
      let dir;
      for (let tries = 0; tries < 30; tries++) {
        dir = randomOpenDirection(rand);
        const free = obstacles.every((o) => dir.angleTo(o.dir) * radius > o.radius + r + 0.6);
        if (free) break;
      }
      const s = 0.85 + rand() * 0.4;
      geometry.applyMatrix4(surfaceMatrix(dir, radius - sink, rand() * Math.PI * 2, s));
      pieces.push(geometry);
      obstacles.push({ dir, radius: r * s });
    }
  };
  place(roundTree, 6, 0.03);
  place(pineTree, 4, 0.03);
  place(rock, 6, 0.06);
  return new THREE.Mesh(mergeGeometries(pieces), lowPoly({ vertexColors: true }));
}

function makeCloudLayer(radius, rand, count) {
  const pieces = [];
  for (let i = 0; i < count; i++) {
    const dir = randomDirection(rand);
    const puffs = [];
    const n = 3 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) {
      const r = 0.35 + rand() * 0.3;
      const g = new THREE.IcosahedronGeometry(r, 1);
      g.scale(1, 0.72, 1);
      g.translate((k - (n - 1) / 2) * 0.48, rand() * 0.12, (rand() - 0.5) * 0.4);
      puffs.push(part(g, COLORS.cloud));
    }
    const cloud = mergeGeometries(puffs);
    cloud.applyMatrix4(surfaceMatrix(dir, radius + 4.6 + rand() * 1.6, rand() * 6.28, 0.9 + rand() * 0.6));
    pieces.push(cloud);
  }
  const mesh = new THREE.Mesh(mergeGeometries(pieces), lowPoly({ vertexColors: true, emissive: 0x6f7c99 }));
  const layer = new THREE.Group();
  layer.add(mesh);
  return layer;
}

// 하늘: 위는 하늘색, 지평선은 복숭아빛, 아래는 분홍빛으로 번지는 둥근 막
function makeSky() {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color(COLORS.skyTop) },
      uHorizon: { value: new THREE.Color(COLORS.skyHorizon) },
      uBottom: { value: new THREE.Color(COLORS.skyBottom) },
      uUp: { value: new THREE.Vector3(0, 1, 0) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop, uHorizon, uBottom, uUp, uSunDir;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = dot(d, uUp);
        vec3 col = h > 0.0 ? mix(uHorizon, uTop, pow(h, 0.55)) : mix(uHorizon, uBottom, pow(-h, 0.6));
        float sun = max(dot(d, uSunDir), 0.0);
        col += vec3(1.0, 0.86, 0.7) * (pow(sun, 90.0) * 0.55 + pow(sun, 7.0) * 0.14);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), material);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  return sky;
}

export function createWorld(scene, { radius, seed }) {
  const rand = seededRandom(seed);
  const obstacles = [];

  const sky = makeSky();
  const planet = makePlanet(radius, rand);
  const props = makeProps(radius, rand, obstacles);
  const grass = makeGrass(radius, rand, 520);
  const flowers = makeFlowers(radius, rand, 16, 9);
  const clouds = makeCloudLayer(radius, rand, 9);
  clouds.rotation.set(0.4, 0, 0.25);

  // 빛은 카메라를 따라다녀서, 별 어디를 보든 아이가 밝게 보여요.
  const hemi = new THREE.HemisphereLight(0xfff4ea, 0x8fbf98, 1.5);
  const sun = new THREE.DirectionalLight(0xfff0dc, 2.2);
  scene.add(sky, planet, props, grass, flowers, clouds, hemi, sun);

  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const back = new THREE.Vector3();
  const lightDir = new THREE.Vector3();
  const skySun = sky.material.uniforms.uSunDir.value;
  const cloudAxis = new THREE.Vector3(0.3, 1, 0.2).normalize();
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  function update(dt, camera) {
    camera.matrixWorld.extractBasis(right, up, back);
    lightDir.copy(up).addScaledVector(right, -0.55).addScaledVector(back, 0.65).normalize();
    sun.position.copy(lightDir).multiplyScalar(40);
    hemi.position.copy(camera.up);

    sky.position.copy(camera.position);
    sky.material.uniforms.uUp.value.copy(camera.up);
    // 하늘의 해는 화면 왼쪽 위에 은은하게 보이도록
    skySun.copy(up).multiplyScalar(0.45).addScaledVector(right, -0.75).addScaledVector(back, -0.5).normalize();

    if (!reduceMotion) clouds.rotateOnAxis(cloudAxis, dt * 0.012);
  }

  return { update, obstacles, radius };
}
