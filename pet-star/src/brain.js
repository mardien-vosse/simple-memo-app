// 행동 두뇌: 확률표(config.js의 BEHAVIORS)를 보고 다음 행동을 고르고,
// 둥근 별 표면을 따라 아이를 움직여요. 매 순간 AI를 부르지 않아서 비용이 들지 않아요.
import * as THREE from 'three';

const clamp01 = (v) => Math.min(1, Math.max(0, v));
// 값을 목표 쪽으로 부드럽게 옮겨요 (rate가 클수록 빨리)
const damp = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));

export function createBrain({ behaviors, walkSpeed, radius, obstacles, random = Math.random }) {
  // 아이의 위치(별 중심에서 바라본 방향)와 바라보는 방향
  const normal = new THREE.Vector3(0, 1, 0);
  const forward = new THREE.Vector3(0, 0, 1);
  const left = new THREE.Vector3();
  const axis = new THREE.Vector3();
  const toObstacle = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const basis = new THREE.Matrix4();

  let state = 'walk';
  let timeLeft = 5;
  let speed = 0;
  let sit = 0; // 0 = 서 있음, 1 = 완전히 앉음
  let turnRate = 0;
  let turnTarget = 0;
  let turnTimer = 0;

  const between = ([min, max]) => min + random() * (max - min);

  function pickNext() {
    const entries = Object.entries(behaviors);
    const total = entries.reduce((sum, [, b]) => sum + b.chance, 0);
    let roll = random() * total;
    for (const [name, b] of entries) {
      roll -= b.chance;
      if (roll <= 0) return name;
    }
    return entries[0][0];
  }

  // 앞에 나무나 바위가 있으면 반대쪽으로 고개를 돌려요.
  function avoidance() {
    let steer = 0;
    left.crossVectors(normal, forward);
    for (const o of obstacles) {
      const distance = normal.angleTo(o.dir) * radius;
      const reach = o.radius + 1.3;
      if (distance > reach) continue;
      toObstacle.copy(o.dir).addScaledVector(normal, -o.dir.dot(normal)).normalize();
      const ahead = toObstacle.dot(forward);
      if (ahead < -0.25) continue;
      const side = Math.sign(left.dot(toObstacle)) || 1;
      steer -= side * (1 - distance / reach) * 3 * (ahead + 0.25);
    }
    return steer;
  }

  function update(dt) {
    timeLeft -= dt;
    if (timeLeft <= 0) {
      state = pickNext();
      timeLeft = between(behaviors[state].seconds);
    }

    // 앉으려면 먼저 멈추고, 걸으려면 먼저 일어나요.
    const wantsSit = state === 'sit';
    speed = damp(speed, !wantsSit && sit < 0.05 ? walkSpeed : 0, 2.2, dt);
    const sitTarget = wantsSit && speed < 0.08 ? 1 : 0;
    sit = clamp01(sit + Math.sign(sitTarget - sit) * (dt / 0.8));

    // 이리저리 천천히 방향을 바꾸며 걸어요.
    turnTimer -= dt;
    if (turnTimer <= 0) {
      turnTarget = (random() * 2 - 1) * 0.7;
      turnTimer = 1.5 + random() * 3;
    }
    turnRate = damp(turnRate, turnTarget + avoidance(), 3, dt);
    const moving = clamp01(speed / (walkSpeed * 0.5));
    forward.applyAxisAngle(normal, turnRate * moving * dt);

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
    get position() {
      return normal.clone().multiplyScalar(radius);
    },
    get motion() {
      return { state, speed, sit, walkSpeed };
    },
    get label() {
      return behaviors[state].label;
    },
  };
}
