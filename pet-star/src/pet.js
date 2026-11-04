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
      notice =
        rig.hasClips || rig.hasLegs
          ? `${config.name}의 3D 모습을 불러왔어요.`
          : `${config.name}의 3D 모습을 불러왔어요. 파일에 걷기 동작이나 네발 뼈대가 없어서 몸 전체를 살짝 흔들며 움직여요.`;
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
  model.updateMatrixWorld(true);

  // 파일에 걷기 동작이 없으면, 네발 뼈대(Tripo 리깅)를 찾아 코드로 직접 움직여요.
  const clips = gltf.animations || [];
  const legs = clips.length ? null : findQuadrupedSkeleton(model);

  // 방향 맞추기 → 크기 맞추기 → 발이 땅에 닿게 옮기기
  // 뼈대가 있으면 머리 쪽을 보고 앞쪽을 자동으로 찾아요.
  const turn = new THREE.Group();
  const autoTurn = legs ? -Math.atan2(legs.forward.x, legs.forward.z) : 0;
  turn.rotation.y = autoTurn + THREE.MathUtils.degToRad(config.modelTurnDegrees);
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

  // 앉을 때 엉덩이를 축으로 몸을 세우기 위한 받침 (pose = 엉덩이 위치)
  const inner = new THREE.Group();
  inner.add(fit);
  const pose = new THREE.Group();
  pose.add(inner);
  const object = new THREE.Group();
  object.add(pose);
  object.updateMatrixWorld(true);

  const hip = new THREE.Vector3(0, 0, -length * 0.35);
  let sitTilt = SIT_TILT;
  let sitDrop = 0;
  let backThighFold = 0;
  let backShinFold = 0;
  if (legs) {
    // 뼈 위치를 별 위 크기로 바꿔서 앉는 자세를 계산해요.
    const toObject = (v) => v.clone().applyMatrix4(model.matrixWorld);
    hip.copy(toObject(legs.backHip));
    const frontPaw = toObject(legs.frontPaw);
    const reach = frontPaw.z - hip.z;
    // 엉덩이를 축으로 몸을 세운 만큼 내려서 앞발이 땅에 닿게 해요.
    const dropFor = (a) => hip.y * (1 - Math.cos(a)) + reach * Math.sin(a);
    // 다리가 짧은 아이는 몸을 많이 세우면 엉덩이가 땅에 파묻혀요. 딱 닿는 만큼만 세워요.
    sitTilt = solveSitTilt(model, hip, dropFor);
    sitDrop = dropFor(sitTilt);
    // 내려간 엉덩이 높이에 맞춰 뒷다리를 접어요: 허벅지는 앞으로, 정강이는 뒤로 (뒷발이 엉덩이 밑에 와요).
    const fold = foldHindLeg(hip.y - sitDrop, legs.backThigh * scale, legs.backShin * scale);
    backThighFold = -fold.thigh + sitTilt;
    backShinFold = fold.thigh + fold.shin;
    legs.stepRate = Math.PI / (2 * legs.frontLegLength * scale * Math.sin(LEG_SWING));
  }
  pose.position.copy(hip);
  inner.position.copy(hip).negate();
  if (legs) console.info(`[강아지별] 앉는 각도 ${(THREE.MathUtils.radToDeg(sitTilt)).toFixed(0)}도`);

  // 파일 안에 들어 있는 동작(애니메이션) 찾기: 이름에 walk, sit, idle 등이 있으면 써요.
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
  } else if (legs) {
    console.info('[강아지별] 네발 뼈대를 찾았어요. 걷기·앉기를 코드로 움직여요.');
  }

  let phase = 0;
  let time = 0;
  let wagPhase = 0;
  return {
    object,
    hasClips: clips.length > 0,
    hasLegs: legs !== null,
    update(dt, motion) {
      time += dt;
      const walk = clamp01(motion.speed / motion.walkSpeed);
      const s = smooth(motion.sit);

      if (mixer) {
        walkAction.timeScale = walk;
        if (restAction) {
          walkAction.setEffectiveWeight(walk);
          restAction.setEffectiveWeight(1 - walk);
        }
        mixer.update(dt);
        if (!restAction) pose.rotation.x = -0.32 * s;
        return;
      }

      if (legs) {
        // 발이 미끄러지지 않을 만큼의 걸음 속도로 다리를 움직여요.
        phase += dt * motion.speed * legs.stepRate;
        const stride = walk * (1 - s);
        for (const leg of legs.all) {
          const p = phase + (leg.diagonal ? 0 : Math.PI);
          const swing = LEG_SWING * Math.sin(p) * stride;
          const lift = 0.55 * Math.max(0, -Math.cos(p)) * stride;
          const sitUpper = leg.front ? sitTilt : backThighFold;
          const sitLower = leg.front ? 0 : backShinFold;
          setJoint(leg.upper, swing + sitUpper * s);
          if (leg.lower) setJoint(leg.lower, lift + sitLower * s);
        }
        // 몸: 걸을 때 통통, 앉을 때 엉덩이를 내리고 몸을 세워요.
        pose.rotation.x = -sitTilt * s;
        pose.position.y = hip.y - sitDrop * s;
        object.position.y = Math.abs(Math.sin(phase)) * 0.012 * length * walk;
        // 머리: 걸을 때 끄덕끄덕, 앉아 있을 때 천천히 두리번
        if (legs.neck) setJoint(legs.neck, sitTilt * 0.6 * s + Math.sin(phase * 2) * 0.03 * walk);
        if (legs.head) {
          const look = Math.sin(time * 0.7) * 0.4 * s + Math.sin(time * 0.9) * 0.08 * (1 - s);
          setJoint(legs.head, 0, look);
        }
        // 꼬리 살랑살랑
        wagPhase += dt * (5 + 5 * walk);
        legs.tails.forEach((joint, i) => setJoint(joint, 0, Math.sin(wagPhase - i * 0.6) * (i ? 0.25 : 0.35)));
        return;
      }

      // 뼈대도 동작도 없으면 몸 전체를 통통 흔들며 걷고, 몸을 살짝 세워 앉아요.
      phase += dt * motion.speed * (12 / length);
      pose.rotation.x = -0.32 * s;
      object.position.y = Math.abs(Math.sin(phase)) * 0.035 * length * walk;
      pose.rotation.z = Math.sin(phase) * 0.04 * walk;
    },
  };
}

const LEG_SWING = 0.38; // 걸을 때 다리를 앞뒤로 흔드는 각도

// 앉은 엉덩이 높이(height)에서 허벅지(thigh)·정강이(shin)를 접는 각도를 찾아요.
// 허벅지는 앞으로, 정강이는 뒤로 기울여서 발끝이 엉덩이 바로 밑 땅에 닿게 해요.
function foldHindLeg(height, thigh, shin) {
  let best = { thigh: 0, shin: 0, error: Infinity };
  for (let a = 0; a <= 1.5; a += 0.01) {
    const b = Math.asin(Math.min(1, (thigh * Math.sin(a)) / Math.max(shin, 1e-6)));
    const error = Math.abs(thigh * Math.cos(a) + shin * Math.cos(b) - height);
    if (error < best.error) best = { thigh: a, shin: b, error };
  }
  return best;
}

// 몸을 세웠을 때 엉덩이 쪽 몸통이 땅 밑으로 내려가지 않는 가장 큰 각도를 찾아요.
function solveSitTilt(model, hip, dropFor) {
  const points = [];
  const v = new THREE.Vector3();
  model.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const count = o.geometry.attributes.position.count;
    const step = Math.max(1, Math.floor(count / 6000));
    const joints = o.geometry.attributes.skinIndex;
    const weights = o.geometry.attributes.skinWeight;
    const legBones = new Set(o.skeleton.bones.map((b, i) => (/limb/i.test(b.name) ? i : -1)).filter((i) => i >= 0));
    for (let i = 0; i < count; i += step) {
      // 다리에 붙은 부분(접히는 허벅지)은 빼고 몸통만 봐요.
      let main = 0;
      for (let k = 1; k < 4; k++) if (weights.getComponent(i, k) > weights.getComponent(i, main)) main = k;
      if (legBones.has(joints.getComponent(i, main))) continue;
      o.getVertexPosition(i, v);
      o.localToWorld(v);
      // 엉덩이 뒤쪽, 다리보다 위에 있는 몸통 부분만 봐요.
      if (v.z < hip.z && v.y > hip.y * 0.45) points.push(v.clone());
    }
  });
  if (points.length === 0) return SIT_TILT;
  let best = 0.12;
  for (let a = 0.12; a <= 0.55; a += 0.02) {
    const ground = hip.y - dropFor(a);
    const lowest = points.reduce((min, p) => Math.min(min, ground + (p.y - hip.y) * Math.cos(a) + (p.z - hip.z) * Math.sin(a)), Infinity);
    if (lowest < 0.01) break;
    best = a;
  }
  return best;
}

// 뼈 하나를 '쉬는 자세'에서 옆축(앞뒤로 끄덕) · 위축(좌우로 돌림)만큼 돌려요.
const _q = new THREE.Quaternion();
function setJoint(joint, pitch, yaw = 0) {
  joint.bone.quaternion.copy(joint.rest);
  if (pitch) joint.bone.quaternion.multiply(_q.setFromAxisAngle(joint.side, pitch));
  if (yaw) joint.bone.quaternion.multiply(_q.setFromAxisAngle(joint.up, yaw));
}

// Tripo가 붙여 주는 네발 뼈대를 찾아요: 다리 4개(…_Limb_0~4), 등뼈(Spine), 머리(Head), 꼬리.
function findQuadrupedSkeleton(model) {
  const bones = [];
  model.traverse((o) => o.isBone && bones.push(o));
  const chains = {};
  for (const bone of bones) {
    const m = bone.name.match(/(\d+)_(?:Left|Right)_Limb_(\d+)/i);
    if (!m) continue;
    const key = bone.name.slice(0, m.index + m[0].lastIndexOf('_'));
    (chains[key] ||= { group: m[1], bones: [] }).bones[Number(m[2])] = bone;
  }
  const chainList = Object.values(chains).filter((c) => c.bones[1] && c.bones[c.bones.length - 1]);
  const heads = bones.filter((b) => /head/i.test(b.name));
  if (chainList.length !== 4 || heads.length === 0) return null;

  const pos = (b) => b.getWorldPosition(new THREE.Vector3());
  const average = (list) => list.reduce((a, v) => a.add(v), new THREE.Vector3()).divideScalar(list.length);
  const groups = {};
  for (const c of chainList) (groups[c.group] ||= []).push(c);
  const pairs = Object.values(groups);
  if (pairs.length !== 2 || pairs.some((p) => p.length !== 2)) return null;

  // 머리에 가까운 쌍이 앞다리예요.
  const headPos = average(heads.map(pos));
  const hipOf = (pair) => average(pair.map((c) => pos(c.bones[1])));
  const [front, back] = hipOf(pairs[0]).distanceTo(headPos) < hipOf(pairs[1]).distanceTo(headPos) ? pairs : [pairs[1], pairs[0]];
  const backHip = hipOf(back);
  const forward = hipOf(front).sub(backHip).setY(0).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3().crossVectors(up, forward).normalize();

  const joint = (bone) => {
    const inverse = bone.getWorldQuaternion(new THREE.Quaternion()).invert();
    return {
      bone,
      rest: bone.quaternion.clone(),
      side: side.clone().applyQuaternion(inverse),
      up: up.clone().applyQuaternion(inverse),
    };
  };
  const legLength = (c) => {
    let sum = 0;
    for (let i = 2; i < c.bones.length; i++) if (c.bones[i] && c.bones[i - 1]) sum += pos(c.bones[i]).distanceTo(pos(c.bones[i - 1]));
    return sum;
  };
  const segment = (c, from, to) => {
    let sum = 0;
    for (let i = from + 1; i <= to; i++) if (c.bones[i] && c.bones[i - 1]) sum += pos(c.bones[i]).distanceTo(pos(c.bones[i - 1]));
    return sum;
  };
  const toLeg = (c, isFront) => {
    const isLeft = pos(c.bones[1]).sub(backHip).dot(side) > hipOf(isFront ? front : back).sub(backHip).dot(side);
    return {
      front: isFront,
      diagonal: isFront === isLeft, // 앞왼발+뒷오른발, 앞오른발+뒷왼발이 같이 움직여요
      upper: joint(c.bones[1]),
      lower: c.bones[2] ? joint(c.bones[2]) : null,
    };
  };

  // 머리 쪽 뼈: 목(가장 앞 등뼈 다음)과 머리
  const byName = (re) => bones.filter((b) => re.test(b.name)).sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  const headChain = byName(/head_\d+$/i);
  // 꼬리: 엉덩이 쪽 뿌리 뼈에 바로 붙은, 다리·등뼈가 아닌 뼈 줄기
  const root = (back[0].bones[0] || back[0].bones[1]).parent;
  const tails = [];
  if (root && root.isBone) {
    for (const child of root.children) {
      if (!child.isBone || /limb|spine|head/i.test(child.name)) continue;
      if (pos(child).sub(backHip).dot(forward) > 0.1) continue;
      tails.push(joint(child));
      if (child.children[0]?.isBone) tails.push(joint(child.children[0]));
    }
  }

  return {
    forward,
    backHip,
    frontPaw: average(front.map((c) => pos(c.bones[c.bones.length - 1]))),
    frontLegLength: (legLength(front[0]) + legLength(front[1])) / 2,
    backThigh: (segment(back[0], 1, 2) + segment(back[1], 1, 2)) / 2,
    backShin: (segment(back[0], 2, back[0].bones.length - 1) + segment(back[1], 2, back[1].bones.length - 1)) / 2,
    all: [...front.map((c) => toLeg(c, true)), ...back.map((c) => toLeg(c, false))],
    neck: headChain[0] ? joint(headChain[0]) : null,
    head: headChain[1] ? joint(headChain[1]) : null,
    tails,
    stepRate: 10,
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
