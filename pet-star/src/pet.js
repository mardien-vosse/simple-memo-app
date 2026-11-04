// 아이의 3D 모습을 준비하고 움직임(걷기·앉기·엎드리기·낮잠·킁킁·두리번)과 표정(시선·눈 깜빡임)을 그려요.
// models/dog.glb 가 있으면 그 파일을 쓰고, 없으면 도형으로 만든 임시 강아지를 써요.
import * as THREE from 'three';

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (v) => v * v * (3 - 2 * v);
const damp = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));

export async function createPet(config) {
  const root = new THREE.Group();
  root.add(makeBlobShadow(config.bodyLength));

  let rig = null;
  let notice = '';
  try {
    const bytes = await fetchModel(config.modelUrl);
    if (bytes) {
      rig = await loadModelRig(bytes, config);
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

  const gaze = createGaze();
  const blink = createBlink();
  const cameraLocal = new THREE.Vector3();
  return {
    root,
    notice,
    isPlaceholder: rig.isPlaceholder === true,
    // cameraPosition: 집사(카메라)의 위치. 아이가 가끔 그쪽을 바라봐요.
    update(dt, motion, cameraPosition) {
      let camera = null;
      if (cameraPosition) {
        root.worldToLocal(cameraLocal.copy(cameraPosition)).sub(rig.headPosition);
        const yaw = Math.atan2(cameraLocal.x, cameraLocal.z);
        if (Math.abs(yaw) < 1.4) {
          const pitch = -Math.atan2(cameraLocal.y, Math.hypot(cameraLocal.x, cameraLocal.z));
          camera = { yaw: THREE.MathUtils.clamp(yaw, -1, 1), pitch: THREE.MathUtils.clamp(pitch, -0.45, 0.35) };
        }
      }
      const look = gaze.update(dt, motion, camera);
      rig.update(dt, motion, { yaw: look.yaw, pitch: look.pitch, closed: blink.update(dt, motion) });
    },
  };
}

// 3D 파일을 가져와요. 파일이 없으면 null을 돌려줘요.
// .glb 형식을 올릴 수 없는 곳(예: Claude 미리보기 페이지)에서는 GLB를 base64 글자로 담은
// .js 파일(export default '…')을 modelUrl로 써도 돼요.
async function fetchModel(url) {
  if (/\.js$/i.test(url)) {
    let mod;
    try {
      mod = await import(new URL(url, document.baseURI).href);
    } catch {
      return null;
    }
    const text = atob(mod.default);
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
    return bytes.buffer;
  }
  const res = await fetch(url, { cache: 'no-cache' });
  const type = res.headers.get('content-type') || '';
  // 일부 서버는 없는 파일 대신 index.html을 돌려줘서 그것도 '없음'으로 봐요.
  if (!res.ok || type.includes('text/html')) return null;
  return res.arrayBuffer();
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

/* ---------- 표정: 시선과 눈 깜빡임 ---------- */

// 시선: 걸을 때는 주로 앞을 보다가 가끔 곁눈질하고, 멈춰 있을 때는 주변을 둘러보거나 집사(카메라)를 바라봐요.
function createGaze(random = Math.random) {
  let yaw = 0;
  let pitch = 0;
  let targetYaw = 0;
  let targetPitch = 0;
  let timer = 0.5;
  let watching = false; // 집사를 바라보는 중
  return {
    update(dt, motion, camera) {
      timer -= dt;
      if (timer <= 0) {
        watching = false;
        const roll = random();
        if (motion.look > 0.5) {
          targetYaw = (random() * 2 - 1) * 0.9;
          targetPitch = (random() - 0.6) * 0.3;
          timer = 0.7 + random() * 0.9;
        } else if (motion.speed > 0.1) {
          targetYaw = roll < 0.25 ? (random() * 2 - 1) * 0.45 : (random() * 2 - 1) * 0.1;
          targetPitch = 0;
          timer = 1.2 + random() * 2.2;
        } else if (camera && roll < 0.4) {
          watching = true;
          timer = 1.5 + random() * 2.5;
        } else {
          targetYaw = (random() * 2 - 1) * 0.6;
          targetPitch = (random() - 0.5) * 0.25;
          timer = 1.2 + random() * 2.5;
        }
      }
      if (watching && camera) {
        targetYaw = camera.yaw;
        targetPitch = camera.pitch;
      }
      const awake = 1 - motion.sleep;
      yaw = damp(yaw, targetYaw * awake, 4, dt);
      pitch = damp(pitch, targetPitch * awake, 4, dt);
      return { yaw, pitch };
    },
  };
}

// 눈 깜빡임: 2~6초마다 깜빡, 가끔 두 번 연달아. 엎드리면 살짝 졸린 눈, 낮잠 자면 꼭 감아요.
function createBlink(random = Math.random) {
  let timer = 1.5;
  let time = -1; // 0 이상이면 깜빡이는 중
  let gap = 0;
  let again = false;
  const BLINK = 0.16; // 한 번 깜빡이는 데 걸리는 시간(초)
  return {
    update(dt, motion) {
      if (time < 0) {
        if (gap > 0) {
          gap -= dt;
          if (gap <= 0) time = 0;
        } else {
          timer -= dt;
          if (timer <= 0) {
            time = 0;
            again = random() < 0.2;
            timer = 2.2 + random() * 4;
          }
        }
      }
      let blink = 0;
      if (time >= 0) {
        time += dt;
        const k = time / BLINK;
        if (k >= 1) {
          time = -1;
          if (again) {
            again = false;
            gap = 0.1;
          }
        } else {
          blink = Math.sin(Math.PI * k);
        }
      }
      return Math.max(blink, smooth(motion.sleep), 0.3 * motion.lie);
    },
  };
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
  // 털 사진에서 눈 2개와 코를 찾아 얼굴 방향을 알아내고, 눈 위에 눈꺼풀을 붙여요.
  const face = legs ? findFace(model, legs) : null;
  const eyelids = face ? makeEyelids(face) : [];
  if (face) {
    const degrees = THREE.MathUtils.radToDeg(face.turn).toFixed(0);
    console.info(`[강아지별] 눈과 코를 찾았어요. 모델의 고개가 ${degrees}도 돌아가 있어서 바로잡아요.`);
  }

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
  const toObject = (v) => v.clone().applyMatrix4(model.matrixWorld);

  const hip = new THREE.Vector3(0, 0, -length * 0.35);
  const headPosition = new THREE.Vector3(0, size.y * scale * 0.8, length * 0.4);
  const sit = { tilt: SIT_TILT, drop: 0, backUpper: 0, backLower: 0 };
  const lie = { drop: 0, frontUpper: 0, backUpper: 0, backLower: 0 };
  if (legs) {
    // 뼈 위치를 별 위 크기로 바꿔서 앉는·엎드리는 자세를 계산해요.
    hip.copy(toObject(legs.backHip));
    if (face) headPosition.copy(toObject(face.middle));
    const frontPaw = toObject(legs.frontPaw);
    const shoulder = toObject(legs.frontHip);
    const reach = frontPaw.z - hip.z;
    const body = analyzeBody(model, hip);

    // 앉기: 엉덩이를 축으로 몸을 세운 만큼 내려서 앞발이 땅에 닿게 해요.
    // 다리가 짧은 아이는 몸을 많이 세우면 엉덩이가 땅에 파묻혀요. 딱 닿는 만큼만 세워요.
    const dropFor = (a) => hip.y * (1 - Math.cos(a)) + reach * Math.sin(a);
    sit.tilt = solveSitTilt(body.rear, hip, dropFor);
    sit.drop = dropFor(sit.tilt);
    // 뒷다리: 허벅지는 앞으로, 정강이는 뒤로 접어서 뒷발이 엉덩이 밑에 오게 해요.
    const sitFold = foldHindLeg(hip.y - sit.drop, legs.backThigh * scale, legs.backShin * scale);
    sit.backUpper = -sitFold.thigh + sit.tilt;
    sit.backLower = sitFold.thigh + sitFold.shin;

    // 엎드리기: 배가 땅에 닿을 만큼 몸을 내리고, 앞다리는 앞으로 뻗고, 뒷다리는 접어요.
    lie.drop = Math.max(0, body.bellyY - 0.015 * length);
    const frontLeg = legs.frontLegLength * scale;
    lie.frontUpper = -Math.acos(clamp01((shoulder.y - lie.drop) / Math.max(frontLeg, 1e-6)));
    const lieFold = foldHindLeg(hip.y - lie.drop, legs.backThigh * scale, legs.backShin * scale);
    lie.backUpper = -lieFold.thigh;
    lie.backLower = lieFold.thigh + lieFold.shin;

    legs.stepRate = Math.PI / (2 * frontLeg * Math.sin(LEG_SWING));
    console.info(`[강아지별] 앉는 각도 ${THREE.MathUtils.radToDeg(sit.tilt).toFixed(0)}도`);
  }
  pose.position.copy(hip);
  inner.position.copy(hip).negate();

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
    console.info('[강아지별] 네발 뼈대를 찾았어요. 걷기·앉기·엎드리기를 코드로 움직여요.');
  }

  let phase = 0;
  let time = 0;
  let wagPhase = 0;
  return {
    object,
    headPosition,
    hasClips: clips.length > 0,
    hasLegs: legs !== null,
    update(dt, motion, expression) {
      time += dt;
      const walk = clamp01(motion.speed / motion.walkSpeed);
      const s = smooth(motion.sit);
      const l = smooth(motion.lie);
      const z = smooth(motion.sleep);
      const sn = smooth(motion.sniff);

      if (mixer) {
        walkAction.timeScale = walk;
        if (restAction) {
          walkAction.setEffectiveWeight(walk);
          restAction.setEffectiveWeight(1 - walk);
        }
        mixer.update(dt);
        if (!restAction) pose.rotation.x = -0.32 * s;
        pose.position.y = hip.y - hip.y * 0.3 * l;
        return;
      }

      if (!legs) {
        // 뼈대도 동작도 없으면 몸 전체를 통통 흔들며 걷고, 몸을 살짝 세워 앉고, 낮춰서 엎드려요.
        phase += dt * motion.speed * (12 / length);
        pose.rotation.x = -0.32 * s;
        pose.position.y = hip.y - hip.y * 0.3 * l;
        object.position.y = Math.abs(Math.sin(phase)) * 0.035 * length * walk;
        pose.rotation.z = Math.sin(phase) * 0.04 * walk;
        return;
      }

      // 다리: 발이 미끄러지지 않을 만큼의 걸음 속도로 움직이고, 자세에 맞춰 접어요.
      phase += dt * motion.speed * legs.stepRate;
      const stride = walk * (1 - Math.max(s, l));
      for (const leg of legs.all) {
        const p = phase + (leg.diagonal ? 0 : Math.PI);
        const swing = LEG_SWING * Math.sin(p) * stride;
        const lift = 0.55 * Math.max(0, -Math.cos(p)) * stride;
        const upper = leg.front ? sit.tilt * s + lie.frontUpper * l : sit.backUpper * s + lie.backUpper * l;
        const lower = leg.front ? 0 : sit.backLower * s + lie.backLower * l;
        setJoint(leg.upper, swing + upper);
        if (leg.lower) setJoint(leg.lower, lift + lower);
      }

      // 몸: 걸을 때 통통, 앉으면 엉덩이를 내리고 세우고, 엎드리면 배를 땅에 대요.
      pose.rotation.x = -sit.tilt * s;
      pose.position.y = hip.y - sit.drop * s - lie.drop * l;
      object.position.y = Math.abs(Math.sin(phase)) * 0.012 * length * walk;
      // 숨쉬기: 잘 때는 더 크고 천천히
      if (legs.chest) setJoint(legs.chest, Math.sin(time * (2.2 - 1.1 * z)) * (0.012 + 0.02 * z));

      // 머리: (모델에 굳은 고개 돌림 바로잡기) + 시선 + 자세(킁킁·졸기)
      const sniffNod = sn * (0.55 + Math.sin(time * 14) * 0.05);
      const turnHead = (face ? face.turn : 0) + expression.yaw * (1 - 0.6 * sn) + sn * Math.sin(time * 3) * 0.2 + 0.3 * z;
      const nod = sit.tilt * 0.6 * s + sniffNod + 0.5 * z - 0.08 * l * (1 - z) + Math.sin(phase * 2) * 0.03 * walk;
      const lookUp = expression.pitch * 0.5 * (1 - sn);
      if (legs.neck) setJoint(legs.neck, nod * 0.6 + lookUp, turnHead * 0.6);
      if (legs.head) setJoint(legs.head, nod * 0.4 + lookUp, turnHead * 0.4);

      // 꼬리 살랑살랑 (잘 때는 거의 멈춰요)
      wagPhase += dt * (5 + 5 * walk) * (1 - 0.6 * z);
      const wag = (1 - 0.85 * z) * (1 - 0.4 * l);
      legs.tails.forEach((joint, i) => setJoint(joint, 0, Math.sin(wagPhase - i * 0.6) * (i ? 0.25 : 0.35) * wag));

      // 눈꺼풀: 위에서 아래로 내려와 눈을 덮어요.
      for (const lid of eyelids) {
        lid.scale.y = Math.max(0.001, expression.closed);
        lid.visible = expression.closed > 0.03;
      }
    },
  };
}

const LEG_SWING = 0.38; // 걸을 때 다리를 앞뒤로 흔드는 각도

// 뼈 하나를 '쉬는 자세'에서 위축(좌우로 돌림)만큼 돌린 뒤 옆축(앞뒤로 끄덕)만큼 숙여요.
const _q = new THREE.Quaternion();
function setJoint(joint, pitch, yaw = 0) {
  joint.bone.quaternion.copy(joint.rest);
  if (pitch) joint.bone.quaternion.multiply(_q.setFromAxisAngle(joint.side, pitch));
  if (yaw) joint.bone.quaternion.multiply(_q.setFromAxisAngle(joint.up, yaw));
}

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

// 몸통(다리를 뺀 부분)의 점들을 살펴요: 엉덩이 뒤쪽 점들(앉는 각도용)과 배의 가장 낮은 높이(엎드리기용).
function analyzeBody(model, hip) {
  const rear = [];
  let bellyY = Infinity;
  const v = new THREE.Vector3();
  model.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const count = o.geometry.attributes.position.count;
    const step = Math.max(1, Math.floor(count / 8000));
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
      bellyY = Math.min(bellyY, v.y);
      if (v.z < hip.z && v.y > hip.y * 0.45) rear.push(v.clone());
    }
  });
  return { rear, bellyY: Number.isFinite(bellyY) ? bellyY : 0 };
}

// 몸을 세웠을 때 엉덩이 쪽 몸통이 땅 밑으로 내려가지 않는 가장 큰 각도를 찾아요.
function solveSitTilt(points, hip, dropFor) {
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

  const byName = (re) => bones.filter((b) => re.test(b.name)).sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  const headChain = byName(/head_\d+$/i);
  const spine = byName(/spine_\d+$/i);
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

  const frontLeg = (c) => segment(c, 1, c.bones.length - 1);
  return {
    forward,
    up,
    backHip,
    frontHip: hipOf(front),
    frontPaw: average(front.map((c) => pos(c.bones[c.bones.length - 1]))),
    frontLegLength: (frontLeg(front[0]) + frontLeg(front[1])) / 2,
    backThigh: (segment(back[0], 1, 2) + segment(back[1], 1, 2)) / 2,
    backShin: (segment(back[0], 2, back[0].bones.length - 1) + segment(back[1], 2, back[1].bones.length - 1)) / 2,
    all: [...front.map((c) => toLeg(c, true)), ...back.map((c) => toLeg(c, false))],
    neck: headChain[0] ? joint(headChain[0]) : null,
    head: headChain[1] ? joint(headChain[1]) : null,
    headBone: headChain[1] || headChain[0],
    chest: spine.length > 2 ? joint(spine[Math.floor(spine.length / 2)]) : null,
    tails,
    stepRate: 10,
  };
}

// 털 사진(텍스처)에서 머리 부분의 까만 점들을 찾아, 두 눈과 코를 골라내요.
// 두 눈을 잇는 선과 코 쪽 방향이 직각인 조합을 고르고, 거기서 얼굴이 향한 방향을 알아내요.
function findFace(model, legs) {
  let mesh = null;
  model.traverse((o) => {
    if (o.isSkinnedMesh && o.material?.map?.image && !mesh) mesh = o;
  });
  if (!mesh || !legs.headBone) return null;
  const image = mesh.material.map.image;
  const SIZE = 512;
  let pixels;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, SIZE, SIZE);
    pixels = ctx.getImageData(0, 0, SIZE, SIZE).data;
  } catch {
    return null;
  }

  // 머리 뼈(와 그 아래 뼈들)에 붙은 점만 봐요.
  const bones = mesh.skeleton.bones;
  const headSet = new Set();
  bones.forEach((b, i) => {
    for (let p = b; p; p = p.parent) {
      if (p === legs.headBone) {
        headSet.add(i);
        break;
      }
    }
  });
  const g = mesh.geometry;
  const uv = g.attributes.uv;
  const joints = g.attributes.skinIndex;
  const weights = g.attributes.skinWeight;
  if (!uv) return null;
  const head = [];
  const v = new THREE.Vector3();
  for (let i = 0; i < g.attributes.position.count; i++) {
    let main = 0;
    for (let k = 1; k < 4; k++) if (weights.getComponent(i, k) > weights.getComponent(i, main)) main = k;
    const bone = joints.getComponent(i, main);
    if (!headSet.has(bone)) continue;
    mesh.getVertexPosition(i, v);
    mesh.localToWorld(v);
    const x = Math.min(SIZE - 1, Math.floor(uv.getX(i) * SIZE));
    const y = Math.min(SIZE - 1, Math.floor(uv.getY(i) * SIZE));
    const o = (y * SIZE + x) * 4;
    const rgb = [pixels[o], pixels[o + 1], pixels[o + 2]];
    head.push({ p: v.clone(), rgb, lum: 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2], bone });
  }
  if (head.length < 50) return null;
  const headCenter = head.reduce((a, h) => a.add(h.p), new THREE.Vector3()).divideScalar(head.length);
  const box = new THREE.Box3().setFromPoints(head.map((h) => h.p));
  const headSize = box.getSize(new THREE.Vector3()).length();

  // 까만 점들을 가까운 것끼리 묶어요.
  const clusterDark = (threshold) => {
    const dark = head.filter((h) => h.lum < threshold);
    const link = headSize * 0.032; // 눈과 코가 한 덩어리로 묶이지 않을 만큼 가깝게
    const used = new Uint8Array(dark.length);
    const clusters = [];
    for (let i = 0; i < dark.length; i++) {
      if (used[i]) continue;
      used[i] = 1;
      const group = [dark[i]];
      for (let q = 0; q < group.length; q++) {
        for (let j = 0; j < dark.length; j++) {
          if (!used[j] && group[q].p.distanceTo(dark[j].p) < link) {
            used[j] = 1;
            group.push(dark[j]);
          }
        }
      }
      if (group.length >= 4) {
        const c = group.reduce((a, h) => a.add(h.p), new THREE.Vector3()).divideScalar(group.length);
        // 튀는 점에 흔들리지 않게 평균 거리로 크기를 재요 (원판이면 반지름 = 평균제곱거리 × √2).
        const radius = Math.sqrt((2 * group.reduce((a, h) => a + h.p.distanceToSquared(c), 0)) / group.length);
        clusters.push({ center: c, radius, count: group.length, members: group });
      }
    }
    return clusters.sort((a, b) => b.count - a.count).slice(0, 6);
  };

  let clusters = clusterDark(45);
  if (clusters.length < 3) clusters = clusterDark(65);
  if (clusters.length < 3) return null;

  // 눈 2개 + 코 1개 조합 중에서 가장 그럴듯한 것을 골라요.
  const up = legs.up;
  let best = null;
  for (let n = 0; n < clusters.length; n++) {
    for (let a = 0; a < clusters.length; a++) {
      for (let b = a + 1; b < clusters.length; b++) {
        if (a === n || b === n) continue;
        const e1 = clusters[a];
        const e2 = clusters[b];
        const nose = clusters[n];
        const eyeLine = e2.center.clone().sub(e1.center).setY(0);
        const gap = eyeLine.length();
        if (gap < headSize * 0.12 || gap > headSize * 0.8) continue;
        const middle = e1.center.clone().add(e2.center).multiplyScalar(0.5);
        const toNose = nose.center.clone().sub(middle);
        if (toNose.y > headSize * 0.02) continue; // 코는 눈보다 아래에 있어요
        const flat = toNose.clone().setY(0);
        if (flat.length() < 1e-6) continue;
        const perpendicular = Math.abs(eyeLine.clone().normalize().dot(flat.normalize()));
        const level = Math.abs(e1.center.y - e2.center.y) / headSize;
        const alike = Math.min(e1.count, e2.count) / Math.max(e1.count, e2.count);
        if (alike < 0.3) continue;
        const score = perpendicular + level * 2 + (1 - alike) * 0.3;
        if (!best || score < best.score) best = { score, e1, e2, nose, middle, eyeLine };
      }
    }
  }
  if (!best || best.score > 0.45) return null;

  // 얼굴 방향: 두 눈을 잇는 선에 직각이고 코 쪽을 향해요.
  const faceDir = new THREE.Vector3().crossVectors(up, best.eyeLine).normalize();
  if (faceDir.dot(best.nose.center.clone().sub(best.middle)) < 0) faceDir.negate();
  const cross = new THREE.Vector3().crossVectors(faceDir, legs.forward);
  const turn = Math.atan2(cross.dot(up), faceDir.dot(legs.forward));

  // 눈 둘레의 털색을 골라 눈꺼풀 색으로 써요. 눈꺼풀 크기는 두 눈 사이 거리를 넘지 않게 해요.
  const gap = best.eyeLine.length();
  const eyes = [best.e1, best.e2].map((eye) => {
    eye.radius = Math.min(eye.radius, gap * 0.3);
    const ring = head.filter((h) => {
      const d = h.p.distanceTo(eye.center);
      return d > eye.radius * 1.4 && d < eye.radius * 2.8 && h.lum > 70;
    });
    const fur = ring.length
      ? ring.reduce((a, h) => [a[0] + h.rgb[0], a[1] + h.rgb[1], a[2] + h.rgb[2]], [0, 0, 0]).map((c) => c / ring.length)
      : [200, 160, 110];
    const counts = {};
    let bone = legs.headBone;
    let most = 0;
    for (const m of eye.members) {
      counts[m.bone] = (counts[m.bone] || 0) + 1;
      if (counts[m.bone] > most) {
        most = counts[m.bone];
        bone = bones[m.bone];
      }
    }
    const outward = eye.center.clone().sub(headCenter).setY(0).normalize();
    const normal = faceDir.clone().multiplyScalar(0.75).addScaledVector(outward, 0.5).normalize();
    return { center: eye.center, radius: eye.radius, normal, fur, bone };
  });
  return { eyes, middle: best.middle, faceDir, turn, up };
}

// 눈꺼풀: 털색 반구를 눈 위쪽에 매달아 두고, 위에서 아래로 늘려서 눈을 덮어요.
function makeEyelids(face) {
  return face.eyes.map((eye) => {
    const r = eye.radius * 1.15;
    const z = eye.normal;
    const y = face.up.clone().addScaledVector(z, -face.up.dot(z)).normalize();
    const x = new THREE.Vector3().crossVectors(y, z);
    const pivot = new THREE.Object3D();
    pivot.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    pivot.position.copy(eye.center).addScaledVector(y, r).addScaledVector(z, r * 0.05);
    pivot.updateMatrixWorld();
    const geo = new THREE.SphereGeometry(r, 16, 10);
    geo.scale(1, 1, 0.42);
    geo.translate(0, -r, 0);
    const shade = 0.9 / 255; // 눈 둘레 털보다 살짝 어둡게 해서 눈두덩처럼 보이게 해요
    const color = new THREE.Color().setRGB(eye.fur[0] * shade, eye.fur[1] * shade, eye.fur[2] * shade, THREE.SRGBColorSpace);
    pivot.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 1 })));
    eye.bone.attach(pivot);
    pivot.scale.y = 0.001;
    pivot.visible = false;
    return pivot;
  });
}

/* ---------- 임시 강아지 (도형으로 만든 강아지) ---------- */

const HIP_Y = 0.33; // 다리가 몸에 붙는 높이
const HIP_Z = 0.24; // 앞다리·뒷다리 위치 (앞뒤)
const SIT_TILT = 0.45; // 앉을 때 몸을 세우는 각도
const SIT_DROP = 0.217; // 앉을 때 엉덩이가 내려가는 정도
const BACK_LEG_SIT = -0.73; // 앉을 때 뒷다리를 앞으로 접는 각도
const LIE_DROP = 0.285; // 엎드릴 때 몸이 내려가는 정도 (배가 땅에 닿아요)
const LIE_FRONT = -1.45; // 엎드릴 때 앞다리를 앞으로 뻗는 각도
const LIE_BACK = -1.4; // 엎드릴 때 뒷다리를 접는 각도

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
  const unit = config.bodyLength / unitLength;
  dog.scale.setScalar(unit);

  let phase = 0;
  let wagPhase = 0;
  let time = 0;

  return {
    object: dog,
    headPosition: new THREE.Vector3(0, 0.8 * unit, 0.45 * unit),
    isPlaceholder: true,
    update(dt, motion, expression) {
      time += dt;
      const walk = clamp01(motion.speed / motion.walkSpeed);
      const s = smooth(motion.sit);
      const l = smooth(motion.lie);
      const z = smooth(motion.sleep);
      const sn = smooth(motion.sniff);
      phase += dt * motion.speed * 13;

      // 대각선 다리끼리 같이 움직이는 종종걸음 + 자세에 맞춰 다리 접기
      const swing = Math.sin(phase) * 0.6 * walk * (1 - Math.max(s, l));
      legs.fl.rotation.x = swing + SIT_TILT * s + LIE_FRONT * l;
      legs.fr.rotation.x = -swing + SIT_TILT * s + LIE_FRONT * l;
      legs.br.rotation.x = swing + BACK_LEG_SIT * s + LIE_BACK * l;
      legs.bl.rotation.x = -swing + BACK_LEG_SIT * s + LIE_BACK * l;
      legs.bl.rotation.z = 0.35 * l; // 엎드리면 뒷다리를 옆으로 살짝 벌려요
      legs.br.rotation.z = -0.35 * l;

      // 몸: 걸을 때 통통, 앉으면 엉덩이를 내리고 세우고, 엎드리면 배를 땅에 대요. 쉴 때는 숨쉬기
      torso.position.y = HIP_Y - SIT_DROP * s - LIE_DROP * l + Math.abs(Math.cos(phase)) * 0.018 * walk;
      torso.rotation.x = -SIT_TILT * s + 0.06 * sn;
      torso.rotation.z = Math.sin(phase) * 0.03 * walk;
      body.scale.y = 0.92 * (1 + Math.sin(time * (2.4 - 1.2 * z)) * (0.015 + 0.015 * z));

      // 머리: 시선 + 킁킁(코를 땅에 대고 끄덕) + 낮잠(고개를 떨궈요)
      const sniffNod = sn * (0.65 + Math.sin(time * 14) * 0.06);
      head.rotation.x =
        SIT_TILT * 0.6 * s + sniffNod + 0.5 * z - 0.1 * l * (1 - z) + expression.pitch * (1 - sn) + Math.sin(phase * 2) * 0.04 * walk;
      head.rotation.y = expression.yaw * (1 - 0.6 * sn) + sn * Math.sin(time * 3) * 0.25 + 0.35 * z;

      // 꼬리 살랑살랑, 귀 팔랑팔랑
      wagPhase += dt * (5 + 6 * walk) * (1 - 0.6 * z);
      tailWag.rotation.y = Math.sin(wagPhase) * 0.45 * (1 - 0.85 * z);
      tailTilt.rotation.x = -0.8 - 0.75 * s - 0.85 * l;
      earL.rotation.z = 0.3 + Math.sin(phase * 2) * 0.12 * walk;
      earR.rotation.z = -earL.rotation.z;

      // 눈 깜빡
      eyes.scale.y = 1 - 0.85 * expression.closed;
    },
  };
}
