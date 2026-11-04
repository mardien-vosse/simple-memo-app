// 카메라: '아이 곁에서 보기'와 '별 전체 보기' 두 가지.
// 한 손가락으로 끌면 둘러보고, 두 손가락(또는 마우스 휠)으로 가까이·멀리 볼 수 있어요.
import * as THREE from 'three';

const clamp = THREE.MathUtils.clamp;
const WORLD_UP = new THREE.Vector3(0, 1, 0);

export function createCameraRig(camera, dom, { planetRadius, startForward }) {
  const R = planetRadius;
  const views = {
    pet: { yaw: 2.5, pitch: 0.38, dist: 5.2, minDist: 2.6, maxDist: 8, minPitch: 0.12, maxPitch: 1.2 },
    planet: { yaw: 0, pitch: 0.4, dist: 27, minDist: 16, maxDist: 42, minPitch: -1.25, maxPitch: 1.25 },
  };
  let mode = 'pet';
  let lastInput = -Infinity;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // 아이를 따라가도 화면이 빙글빙글 돌지 않게 기준 방향을 조금씩 옮겨 가요.
  const ref = startForward.clone();
  const lookAt = new THREE.Vector3(0, R, 0);
  const desiredPos = new THREE.Vector3();
  const desiredLook = new THREE.Vector3();
  const desiredUp = new THREE.Vector3();
  const petPos = new THREE.Vector3();
  const h = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const axis = new THREE.Vector3();

  /* --- 손가락·마우스 입력 --- */
  const pointers = new Map();
  let pinch = 0;
  const pinchDistance = () => {
    const [p, q] = [...pointers.values()];
    return Math.hypot(p.x - q.x, p.y - q.y);
  };
  const touch = () => {
    lastInput = performance.now();
  };

  dom.addEventListener('pointerdown', (e) => {
    dom.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) pinch = pinchDistance();
    touch();
  });
  dom.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    const v = views[mode];
    if (pointers.size === 1) {
      v.yaw -= dx * 0.006;
      v.pitch = clamp(v.pitch + dy * 0.005, v.minPitch, v.maxPitch);
    } else if (pointers.size === 2) {
      const d = pinchDistance();
      if (pinch > 0 && d > 0) v.dist = clamp((v.dist * pinch) / d, v.minDist, v.maxDist);
      pinch = d;
    }
    touch();
  });
  const release = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = 0;
  };
  dom.addEventListener('pointerup', release);
  dom.addEventListener('pointercancel', release);
  dom.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const v = views[mode];
      v.dist = clamp(v.dist * Math.exp(e.deltaY * 0.001), v.minDist, v.maxDist);
      touch();
    },
    { passive: false }
  );

  // 별 중심을 기준으로 돌면서 다가가요. 그래서 화면이 바뀌어도 카메라가 별을 뚫고 지나가지 않아요.
  function moveAroundPlanet(target, k) {
    const r0 = camera.position.length();
    const r1 = target.length();
    a.copy(camera.position).divideScalar(r0);
    b.copy(target).divideScalar(r1);
    const angle = a.angleTo(b);
    if (angle > 1e-5) {
      axis.crossVectors(a, b);
      if (axis.lengthSq() < 1e-10) axis.set(1, 0, 0).cross(a);
      a.applyAxisAngle(axis.normalize(), angle * k);
    }
    camera.position.copy(a).multiplyScalar(Math.max(r0 + (r1 - r0) * k, R + 0.6));
  }

  function setMode(next) {
    if (next === mode) return;
    if (next === 'planet') {
      // 지금 카메라가 있는 쪽에서 그대로 멀어지게 시작해요.
      const d = camera.position.clone().normalize();
      views.planet.yaw = Math.atan2(d.x, d.z);
      views.planet.pitch = clamp(Math.asin(clamp(d.y, -1, 1)), -1.2, 1.2);
    }
    mode = next;
  }

  // home: 집 방향. 아이가 집 가까이 있으면 카메라가 집 반대편(아이 앞쪽)으로 천천히 돌아가서 벽에 가리지 않아요.
  function update(dt, petNormal, home = null) {
    const n = petNormal;
    petPos.copy(n).multiplyScalar(R);

    ref.addScaledVector(n, -ref.dot(n));
    if (ref.lengthSq() < 1e-6) ref.set(1, 0, 0).addScaledVector(n, -n.x);
    ref.normalize();

    if (mode === 'pet') {
      const v = views.pet;
      h.copy(ref).applyAxisAngle(n, v.yaw);
      const nearHome = home && n.angleTo(home.dir) * R < 4;
      if (nearHome && performance.now() - lastInput > 3000) {
        // h가 집 쪽을 향하면 카메라는 집 반대편에 서요. 살짝 비스듬히(0.5) 서서 집도 함께 보여요.
        a.copy(home.dir).addScaledVector(n, -home.dir.dot(n)).normalize().applyAxisAngle(n, 0.5);
        axis.crossVectors(h, a);
        const off = Math.atan2(axis.dot(n), h.dot(a));
        v.yaw += clamp(off, -1, 1) * dt * 0.9;
        h.copy(ref).applyAxisAngle(n, v.yaw);
      }
      desiredLook.copy(petPos).addScaledVector(n, 0.75);
      desiredPos
        .copy(desiredLook)
        .addScaledVector(n, Math.sin(v.pitch) * v.dist)
        .addScaledVector(h, -Math.cos(v.pitch) * v.dist);
      desiredUp.copy(n);
    } else {
      const v = views.planet;
      if (!reduceMotion && performance.now() - lastInput > 3000) v.yaw += dt * 0.06;
      desiredPos.set(
        Math.sin(v.yaw) * Math.cos(v.pitch),
        Math.sin(v.pitch),
        Math.cos(v.yaw) * Math.cos(v.pitch)
      ).multiplyScalar(v.dist);
      desiredLook.set(0, 0, 0);
      desiredUp.copy(WORLD_UP);
    }

    const k = 1 - Math.exp(-dt * 3.2);
    moveAroundPlanet(desiredPos, k);
    lookAt.lerp(desiredLook, k);
    camera.up.lerp(desiredUp, k).normalize();
    camera.lookAt(lookAt);
    camera.updateMatrixWorld();
  }

  return {
    update,
    setMode,
    get mode() {
      return mode;
    },
  };
}
