// 행동 두뇌: 확률표(config.js의 BEHAVIORS)를 보고 다음 행동을 고르고,
// 둥근 별 표면을 따라 아이를 움직여요. 매 순간 AI를 부르지 않아서 비용이 들지 않아요.
import * as THREE from 'three';

const clamp01 = (v) => Math.min(1, Math.max(0, v));
// 값을 목표 쪽으로 부드럽게 옮겨요 (rate가 클수록 빨리)
const damp = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));
// 값을 목표 쪽으로 일정한 빠르기로 옮겨요 (seconds초 만에 0→1)
const approach = (current, target, seconds, dt) => {
  const step = dt / seconds;
  return current < target ? Math.min(target, current + step) : Math.max(target, current - step);
};

// 자세마다 바뀌는 데 걸리는 시간(초)
const POSE_SECONDS = { sit: 0.8, lie: 1.1, sleep: 1.6, sniff: 0.5, look: 0.4 };
const POSES = Object.keys(POSE_SECONDS);

// 행동마다 취하는 자세
const POSE_OF = {
  walk: {},
  sniff: { sniff: 1 },
  look: { look: 1 },
  sit: { sit: 1 },
  lie: { lie: 1 },
  nap: { lie: 1, sleep: 1 },
};

export function createBrain({ behaviors, walkSpeed, radius, obstacles, home = null, random = Math.random }) {
  // 아이의 위치(별 중심에서 바라본 방향)와 바라보는 방향
  const normal = new THREE.Vector3(0, 1, 0);
  const forward = new THREE.Vector3(0, 0, 1);
  const left = new THREE.Vector3();
  const axis = new THREE.Vector3();
  const toTarget = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const basis = new THREE.Matrix4();

  let state = 'walk';
  let timeLeft = 5;
  let homePhase = 'travel'; // 집에 갈 때: travel(가는 중) → turn(돌아서기) → rest(쉬기)
  let homeTimer = 0;
  let speed = 0;
  let turnRate = 0;
  let turnTarget = 0;
  let turnTimer = 0;
  const pose = { sit: 0, lie: 0, sleep: 0, sniff: 0, look: 0 };

  const between = ([min, max]) => min + random() * (max - min);
  const signedAngle = (from, to) => {
    axis.crossVectors(from, to);
    return Math.atan2(axis.dot(normal), from.dot(to));
  };
  // 아이 자리(목표 방향)를 지금 서 있는 곳의 바닥 방향으로 바꿔요.
  const tangentTo = (dir, out) => out.copy(dir).addScaledVector(normal, -dir.dot(normal)).normalize();

  function pickNext() {
    const entries = Object.entries(behaviors).filter(([name]) => name !== 'home' || home);
    const total = entries.reduce((sum, [, b]) => sum + b.chance, 0);
    let roll = random() * total;
    for (const [name, b] of entries) {
      roll -= b.chance;
      if (roll <= 0) return name;
    }
    return entries[0][0];
  }

  function startState(next) {
    state = next;
    timeLeft = between(behaviors[state].seconds);
    if (state === 'home') {
      homePhase = 'travel';
      homeTimer = 0;
    }
  }

  // 앞에 나무나 바위가 있으면 반대쪽으로 고개를 돌려요.
  function avoidance(ignoreHome) {
    let steer = 0;
    left.crossVectors(normal, forward);
    for (const o of obstacles) {
      if (ignoreHome && o.isHome) continue;
      // 멀리 있는 것은 각도 계산 없이 바로 건너뛰어요 (수백 마리가 함께 살아도 가볍게).
      o.cosReach ??= Math.cos((o.radius + 1.3) / radius);
      if (normal.dot(o.dir) < o.cosReach) continue;
      const distance = normal.angleTo(o.dir) * radius;
      const reach = o.radius + 1.3;
      if (distance > reach) continue;
      tangentTo(o.dir, toTarget);
      const ahead = toTarget.dot(forward);
      if (ahead < -0.25) continue;
      const side = Math.sign(left.dot(toTarget)) || 1;
      steer -= side * (1 - distance / reach) * 3 * (ahead + 0.25);
    }
    return steer;
  }

  // 지금 행동에서 바라는 자세(0~1)
  function poseTargets() {
    if (state === 'home') return homePhase === 'rest' ? { lie: 1, sleep: homeTimer > 4 ? 1 : 0 } : {};
    return POSE_OF[state] || {};
  }

  function updatePoses(dt) {
    const target = poseTargets();
    // 먼저 지금 자세를 풀고(일어나고), 그다음 새 자세를 해요. 낮잠은 엎드린 뒤에 자고, 깬 뒤에 일어나요.
    const releasing = POSES.some((p) => !target[p] && pose[p] > 0.02);
    for (const p of POSES) {
      const want = target[p] || 0;
      if (want < pose[p]) {
        if (p === 'lie' && pose.sleep > 0.02) continue;
        pose[p] = approach(pose[p], want, POSE_SECONDS[p], dt);
      } else if (want > pose[p]) {
        if (releasing || speed > 0.08) continue;
        if (p === 'sleep' && pose.lie < 0.95) continue;
        pose[p] = approach(pose[p], want, POSE_SECONDS[p], dt);
      }
    }
  }

  function update(dt) {
    // 행동 시간이 끝나면 다음 행동을 골라요. 집에 가는 중에는 도착할 때까지 시간을 세지 않아요.
    if (state !== 'home' || homePhase === 'rest') timeLeft -= dt;
    if (timeLeft <= 0) startState(pickNext());

    let wantsMove = state === 'walk';
    let steer = 0;
    let inPlaceTurn = 0;

    if (state === 'home') {
      homeTimer += dt;
      const distance = normal.angleTo(home.spot) * radius;
      if (homePhase === 'travel') {
        wantsMove = true;
        tangentTo(home.spot, toTarget);
        steer = THREE.MathUtils.clamp(signedAngle(forward, toTarget) * 1.8, -1.4, 1.4);
        if (distance < 0.3) homePhase = 'turn';
        if (homeTimer > 40) startState('walk'); // 길을 못 찾으면 그냥 산책해요
      } else if (homePhase === 'turn') {
        // 집을 등지고 바깥을 보도록 제자리에서 돌아요.
        tangentTo(home.dir, toTarget).negate();
        const angle = signedAngle(forward, toTarget);
        inPlaceTurn = THREE.MathUtils.clamp(angle * 3, -1.6, 1.6);
        if (Math.abs(angle) < 0.08 && speed < 0.05) {
          homePhase = 'rest';
          homeTimer = 0;
        }
      }
    }

    // 자세를 바꾸는 중이면 멈춰 있어요. 다 일어난 뒤에 걸어요.
    const settled = POSES.every((p) => pose[p] < 0.05);
    speed = damp(speed, wantsMove && settled ? walkSpeed : 0, 2.2, dt);
    updatePoses(dt);

    // 산책할 때는 이리저리 천천히 방향을 바꿔요.
    turnTimer -= dt;
    if (turnTimer <= 0) {
      turnTarget = (random() * 2 - 1) * 0.7;
      turnTimer = 1.5 + random() * 3;
    }
    const goingHome = state === 'home' && homePhase === 'travel';
    const nearHome = goingHome && normal.angleTo(home.spot) * radius < 2.2;
    const desiredTurn = (goingHome ? steer : turnTarget) + avoidance(nearHome);
    turnRate = damp(turnRate, desiredTurn, 3, dt);
    const moving = clamp01(speed / (walkSpeed * 0.5));
    forward.applyAxisAngle(normal, turnRate * moving * dt + inPlaceTurn * dt);

    // 둥근 별 위에서 앞으로 한 걸음: 별 중심을 축으로 조금 회전하는 것과 같아요.
    if (speed > 1e-4) {
      axis.crossVectors(normal, forward).normalize();
      q.setFromAxisAngle(axis, (speed * dt) / radius);
      normal.applyQuaternion(q).normalize();
      forward.applyQuaternion(q);
    }
    forward.addScaledVector(normal, -forward.dot(normal)).normalize();
  }

  // 3D 물체를 아이의 위치와 방향에 맞춰 세워요. (물체의 위쪽 = 별 바깥, 앞쪽 = +Z)
  function applyTo(object) {
    left.crossVectors(normal, forward);
    basis.makeBasis(left, normal, forward);
    object.quaternion.setFromRotationMatrix(basis);
    object.position.copy(normal).multiplyScalar(radius);
  }

  return {
    update,
    applyTo,
    normal,
    forward,
    get state() {
      return state;
    },
    get motion() {
      return { state, speed, walkSpeed, ...pose };
    },
    get label() {
      if (state === 'home' && homePhase !== 'rest') return behaviors.home.travelLabel;
      if (state === 'home' && pose.sleep > 0.5) return behaviors.nap.label;
      return behaviors[state].label;
    },
    // 개발자 도구에서 시험해 볼 때: petStar.brain.force('nap')
    force(next) {
      if (behaviors[next]) startState(next);
    },
  };
}
