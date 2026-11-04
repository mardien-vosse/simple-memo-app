// 아이의 3D 모습을 준비하고 움직임(걷기·앉기)을 그려요.
// models/dog.glb 가 있으면 그 파일을 쓰고, 없으면 도형으로 만든 임시 강아지를 써요.
import * as THREE from 'three';

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (v) => v * v * (3 - 2 * v);

export async function createPet(config) {
  const root = new THREE.Group();
  root.add(makeBlobShadow(config.bodyLength));

  let rig = null;
  let notice = '';
  try {
    const res = await fetch(config.modelUrl, { cache: 'no-cache' });
    const type = res.headers.get('content-type') || '';
    if (res.ok && !type.includes('text/html')) {
      rig = await loadModelRig(await res.arrayBuffer(), config);
      notice = rig.hasClips
        ? `${config.name}의 3D 모습을 불러왔어요.`
        : `${config.name}의 3D 모습을 불러왔어요. 파일에 걷기 동작이 없어서 몸 전체를 살짝 흔들며 움직여요.`;
    } else {
      notice = `아직 ${config.modelUrl} 파일이 없어서 임시 강아지가 나왔어요. 우리 아이 3D 파일을 넣으면 바뀌어요.`;
    }
  } catch (error) {
    console.error('3D 파일을 여는 중 문제가 생겼어요:', error);
    notice = `${config.modelUrl} 파일을 열지 못해서 임시 강아지가 나왔어요. 자세한 이유는 브라우저 개발자 도구의 콘솔에 있어요.`;
  }
  if (!rig) rig = makeToyDogRig(config);

  root.add(rig.object);
  return {
    root,
    notice,
    isPlaceholder: rig.isPlaceholder === true,
    update: (dt, motion) => rig.update(dt, motion),
  };
}

// 발밑의 동그란 그림자 (진짜 그림자 계산보다 훨씬 가벼워요)
function makeBlobShadow(length) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(30, 60, 40, 0.5)');
  g.addColorStop(1, 'rgba(30, 60, 40, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const geo = new THREE.CircleGeometry(0.5, 20);
  geo.rotateX(-Math.PI / 2);
  const shadow = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false })
  );
  shadow.scale.set(length * 0.55, 1, length * 0.85);
  shadow.position.y = 0.02;
  shadow.renderOrder = 1;
  return shadow;
}

/* ---------- 우리 아이 3D 파일 (GLB) ---------- */

async function loadModelRig(buffer, config) {
  // 3D 파일 읽는 도구는 파일이 있을 때만 불러와요.
  const [{ GLTFLoader }, { DRACOLoader }, { MeshoptDecoder }] = await Promise.all([
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/loaders/DRACOLoader.js'),
    import('three/addons/libs/meshopt_decoder.module.js'),
  ]);
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  let decoderPath = 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/';
  try {
    decoderPath = import.meta.resolve('three/addons/libs/draco/gltf/');
  } catch {
    // 오래된 브라우저는 위의 주소를 그대로 써요.
  }
  draco.setDecoderPath(decoderPath);
  loader.setDRACOLoader(draco);
  loader.setMeshoptDecoder(MeshoptDecoder);

  const basePath = config.modelUrl.slice(0, config.modelUrl.lastIndexOf('/') + 1);
  const gltf = await loader.parseAsync(buffer, basePath);
  const model = gltf.scene;
  model.traverse((o) => {
    if (o.isMesh) o.frustumCulled = false;
  });

  // 방향 맞추기 → 크기 맞추기 → 발이 땅에 닿게 옮기기
  const turn = new THREE.Group();
  turn.rotation.y = THREE.MathUtils.degToRad(config.modelTurnDegrees);
  turn.add(model);
  turn.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(turn);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const length = config.bodyLength;
  const scale = length / Math.max(size.x, size.z, 1e-6);
  turn.position.set(-center.x, -box.min.y, -center.z);

  const fit = new THREE.Group();
  fit.scale.setScalar(scale);
  fit.add(turn);

  // 앉을 때 엉덩이 쪽을 축으로 몸을 살짝 세우기 위한 받침
  const hips = length * 0.35;
  const pose = new THREE.Group();
  pose.position.z = -hips;
  fit.position.z = hips;
  pose.add(fit);
  const object = new THREE.Group();
  object.add(pose);

  // 파일 안에 들어 있는 동작(애니메이션) 찾기: 이름에 walk, sit, idle 등이 있으면 써요.
  const clips = gltf.animations || [];
  let mixer = null;
  let walkAction = null;
  let restAction = null;
  if (clips.length) {
    mixer = new THREE.AnimationMixer(model);
    const find = (re) => clips.find((c) => re.test(c.name));
    const walkClip = find(/walk|trot|run|move|locomot/i) || clips[0];
    const restClip = find(/sit|idle|rest|lie|sleep|breath/i);
    walkAction = mixer.clipAction(walkClip).play();
    if (restClip && restClip !== walkClip) restAction = mixer.clipAction(restClip).play();
    console.info('[강아지별] 찾은 동작:', clips.map((c) => c.name).join(', '));
  }

  let phase = 0;
  return {
    object,
    hasClips: clips.length > 0,
    update(dt, motion) {
      const walk = clamp01(motion.speed / motion.walkSpeed);
      const s = smooth(motion.sit);
      phase += dt * motion.speed * (12 / length);

      if (mixer) {
        walkAction.timeScale = walk;
        if (restAction) {
          walkAction.setEffectiveWeight(walk);
          restAction.setEffectiveWeight(1 - walk);
        }
        mixer.update(dt);
      }

      // 쉬는 동작이 파일에 없으면, 몸을 살짝 세워서 앉은 느낌을 내요.
      const fakeSit = restAction ? 0 : s;
      pose.rotation.x = -0.32 * fakeSit;
      // 걷기 동작도 없으면 몸 전체를 통통 흔들며 걸어요.
      const fakeWalk = mixer ? 0 : walk;
      fit.position.y = Math.abs(Math.sin(phase)) * 0.035 * length * fakeWalk;
      pose.rotation.z = Math.sin(phase) * 0.04 * fakeWalk;
    },
  };
}

/* ---------- 임시 강아지 (도형으로 만든 강아지) ---------- */

const HIP_Y = 0.33; // 다리가 몸에 붙는 높이
const HIP_Z = 0.24; // 앞다리·뒷다리 위치 (앞뒤)
const SIT_TILT = 0.45; // 앉을 때 몸을 세우는 각도
const SIT_DROP = 0.217; // 앉을 때 엉덩이가 내려가는 정도
const BACK_LEG_SIT = -0.73; // 앉을 때 뒷다리를 앞으로 접는 각도

function makeStarShape(outer, inner) {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

function makeToyDogRig(config) {
  const lambert = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });
  const M = {
    fur: lambert(0xf2cf9c),
    dark: lambert(0xc68b55),
    light: lambert(0xfff4e4),
    ink: lambert(0x3a2b2a),
    collar: lambert(0xe98585),
    star: new THREE.MeshLambertMaterial({ color: 0xffd45a, emissive: 0x7a5a00, flatShading: true }),
  };
  const mesh = (geo, mat, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    return m;
  };
  const ball = (r) => new THREE.IcosahedronGeometry(r, 1);

  // 강아지의 기준: 땅이 y = 0, 앞쪽이 +Z
  const dog = new THREE.Group();
  const torso = new THREE.Group(); // 뒷다리 쪽을 축으로 앉을 때 몸이 세워져요
  torso.position.set(0, HIP_Y, -HIP_Z);
  const inner = new THREE.Group();
  inner.position.set(0, -HIP_Y, HIP_Z);
  torso.add(inner);
  dog.add(torso);

  // 몸통과 가슴
  const bodyGeo = new THREE.CapsuleGeometry(0.2, 0.42, 4, 8);
  bodyGeo.rotateX(Math.PI / 2);
  const body = mesh(bodyGeo, M.fur, 0, 0.5, 0);
  body.scale.set(0.95, 0.92, 1);
  const chest = mesh(ball(0.15), M.light, 0, 0.45, 0.3);
  chest.scale.set(0.95, 1.05, 0.7);
  inner.add(body, chest);

  // 목, 목걸이, 별 모양 이름표
  const neck = new THREE.Group();
  neck.position.set(0, 0.62, 0.34);
  inner.add(neck);
  const neckMesh = mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.2, 7), M.fur);
  neckMesh.rotation.x = 0.5;
  const collar = mesh(new THREE.TorusGeometry(0.118, 0.026, 6, 18), M.collar);
  collar.rotation.x = 0.5 - Math.PI / 2;
  const starGeo = new THREE.ExtrudeGeometry(makeStarShape(0.042, 0.019), { depth: 0.012, bevelEnabled: false });
  const star = mesh(starGeo, M.star, 0, -0.1, 0.112);
  star.rotation.x = -0.15;
  neck.add(neckMesh, collar, star);

  // 머리
  const head = new THREE.Group();
  head.position.set(0, 0.1, 0.06);
  neck.add(head);
  const skull = mesh(ball(0.19), M.fur, 0, 0.06, 0.02);
  skull.scale.set(1, 0.92, 1);
  const snoutGeo = new THREE.CapsuleGeometry(0.08, 0.09, 3, 8);
  snoutGeo.rotateX(Math.PI / 2);
  const snout = mesh(snoutGeo, M.light, 0, 0, 0.2);
  const nose = mesh(ball(0.038), M.ink, 0, 0.03, 0.33);
  const eyes = new THREE.Group();
  eyes.position.set(0, 0.1, 0.185);
  eyes.add(mesh(ball(0.027), M.ink, 0.08, 0, 0), mesh(ball(0.027), M.ink, -0.08, 0, 0));
  head.add(skull, snout, nose, eyes);

  const ear = (side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.14, 0.17, 0);
    const flap = mesh(ball(0.1), M.dark, 0, -0.09, 0);
    flap.scale.set(0.42, 1, 0.75);
    pivot.add(flap);
    head.add(pivot);
    return pivot;
  };
  const earL = ear(1);
  const earR = ear(-1);

  // 다리 (앞뒤 좌우 4개)
  const leg = (x, z, isBack) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, HIP_Y, z);
    const upperGeo = new THREE.CylinderGeometry(0.055, 0.048, 0.28, 6);
    upperGeo.translate(0, -0.14, 0);
    const paw = mesh(ball(0.06), M.light, 0, -0.285, 0.015);
    paw.scale.set(1, 0.62, 1.25);
    pivot.add(mesh(upperGeo, M.fur), paw);
    if (isBack) {
      const haunch = mesh(ball(0.1), M.fur, 0, -0.02, 0);
      haunch.scale.set(0.75, 1.15, 1.2);
      pivot.add(haunch);
    }
    inner.add(pivot);
    return pivot;
  };
  const legs = {
    fl: leg(0.11, HIP_Z, false),
    fr: leg(-0.11, HIP_Z, false),
    bl: leg(0.11, -HIP_Z, true),
    br: leg(-0.11, -HIP_Z, true),
  };

  // 꼬리 (끝이 하얀)
  const tailWag = new THREE.Group();
  tailWag.position.set(0, 0.58, -0.38);
  const tailTilt = new THREE.Group();
  tailWag.add(tailTilt);
  const tailGeo = new THREE.CapsuleGeometry(0.04, 0.2, 3, 6);
  tailGeo.translate(0, 0.14, 0);
  tailTilt.add(mesh(tailGeo, M.fur), mesh(ball(0.045), M.light, 0, 0.27, 0));
  inner.add(tailWag);

  const unitLength = 1.05; // 코끝부터 꼬리까지 길이
  dog.scale.setScalar(config.bodyLength / unitLength);

  let phase = 0;
  let wagPhase = 0;
  let time = 0;
  let blinkTimer = 2;
  let blinkLeft = 0;

  return {
    object: dog,
    isPlaceholder: true,
    update(dt, motion) {
      time += dt;
      const walk = clamp01(motion.speed / motion.walkSpeed);
      const s = smooth(motion.sit);
      phase += dt * motion.speed * 13;

      // 대각선 다리끼리 같이 움직이는 종종걸음
      const swing = Math.sin(phase) * 0.6 * walk * (1 - s);
      legs.fl.rotation.x = swing + SIT_TILT * s;
      legs.br.rotation.x = swing + BACK_LEG_SIT * s;
      legs.fr.rotation.x = -swing + SIT_TILT * s;
      legs.bl.rotation.x = -swing + BACK_LEG_SIT * s;

      // 몸: 걸을 때 통통, 앉을 때 엉덩이를 내리고 몸을 세움, 쉴 때는 숨쉬기
      torso.position.y = HIP_Y - SIT_DROP * s + Math.abs(Math.cos(phase)) * 0.018 * walk;
      torso.rotation.x = -SIT_TILT * s;
      torso.rotation.z = Math.sin(phase) * 0.03 * walk;
      body.scale.y = 0.92 * (1 + Math.sin(time * 2.4) * 0.015);

      // 머리: 걸을 때 끄덕끄덕, 앉아 있을 때 천천히 두리번
      head.rotation.x = SIT_TILT * 0.6 * s + Math.sin(phase * 2) * 0.04 * walk;
      head.rotation.y = Math.sin(time * 0.7) * 0.45 * s + Math.sin(time * 0.9) * 0.08 * (1 - s);

      // 꼬리 살랑살랑, 귀 팔랑팔랑
      wagPhase += dt * (5 + 6 * walk);
      tailWag.rotation.y = Math.sin(wagPhase) * 0.45;
      tailTilt.rotation.x = -0.8 - 0.75 * s;
      earL.rotation.z = 0.3 + Math.sin(phase * 2) * 0.12 * walk;
      earR.rotation.z = -earL.rotation.z;

      // 가끔 눈 깜빡
      blinkTimer -= dt;
      if (blinkTimer <= 0) {
        blinkLeft = 0.14;
        blinkTimer = 2.5 + Math.random() * 3.5;
      }
      blinkLeft -= dt;
      eyes.scale.y = blinkLeft > 0 ? 0.15 : 1;
    },
  };
}
