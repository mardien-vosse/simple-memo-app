// 시작점: 화면, 별, 아이, 행동 두뇌, 카메라를 한데 모아 매 순간 그려요.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { PET, BEHAVIORS, WORLD } from './config.js';
import { createWorld } from './world.js';
import { createPet } from './pet.js';
import { createBrain } from './brain.js';
import { createCameraRig } from './camera.js';

const canvas = document.getElementById('scene');
const nameEl = document.getElementById('pet-name');
const statusEl = document.getElementById('pet-status');
const viewButton = document.getElementById('view-toggle');
const toastEl = document.getElementById('toast');

let toastTimer = 0;
function showToast(text, ms = 7000) {
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), ms);
}
toastEl.addEventListener('click', () => (toastEl.hidden = true));

let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: window.devicePixelRatio < 2,
    powerPreference: 'high-performance',
  });
} catch (error) {
  statusEl.textContent = '3D 화면을 열 수 없어요';
  showToast('이 브라우저에서는 3D 화면(WebGL)을 쓸 수 없어요. 크롬이나 사파리 최신 버전으로 열어 주세요.', 60000);
  throw error;
}
// 휴대폰 화면은 아주 촘촘해서, 2배까지만 그려도 충분히 선명하고 훨씬 가벼워요.
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
// 사진으로 만든 3D 모델에만 은은하게 퍼지는 빛이에요. 털색이 사진처럼 밝고 자연스럽게 보여요.
// (별·나무·임시 강아지는 다른 재질이라 영향을 받지 않아요.)
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.9;
pmrem.dispose();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
// 처음에는 멀리서 시작해서 아이 곁으로 천천히 날아가요.
camera.position.set(0, 26, 20);

const world = createWorld(scene, { radius: WORLD.planetRadius, seed: WORLD.seed, petName: PET.name });
const brain = createBrain({
  behaviors: BEHAVIORS,
  walkSpeed: PET.walkSpeed,
  radius: WORLD.planetRadius,
  obstacles: world.obstacles,
  home: world.home,
});
const cameraRig = createCameraRig(camera, canvas, {
  planetRadius: WORLD.planetRadius,
  startForward: brain.forward,
});

nameEl.textContent = PET.name;
document.title = `${PET.name}의 별`;

let pet = null;
createPet(PET).then((loaded) => {
  pet = loaded;
  scene.add(pet.root);
  brain.applyTo(pet.root);
  if (loaded.notice) showToast(loaded.notice);
});

const VIEW_LABELS = { pet: '별 전체 보기', planet: `${PET.name} 곁으로` };
viewButton.textContent = VIEW_LABELS.pet;
viewButton.addEventListener('click', () => {
  cameraRig.setMode(cameraRig.mode === 'pet' ? 'planet' : 'pet');
  viewButton.textContent = VIEW_LABELS[cameraRig.mode];
  viewButton.setAttribute('aria-pressed', String(cameraRig.mode === 'planet'));
});

function resize() {
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

let shownLabel = '';
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  // 다른 탭에 다녀와도 아이가 순간이동하지 않게 한 번에 0.1초까지만 진행해요.
  const dt = Math.min(clock.getDelta(), 0.1);

  if (pet) {
    brain.update(dt);
    brain.applyTo(pet.root);
    pet.update(dt, brain.motion, camera.position);
    if (brain.label !== shownLabel) {
      shownLabel = brain.label;
      statusEl.textContent = shownLabel;
    }
  }
  cameraRig.update(dt, brain.normal, world.home);
  world.update(dt, camera);
  renderer.render(scene, camera);
});

// 개발자 도구에서 살펴볼 수 있게 열어 둬요. (예: petStar.brain.motion)
window.petStar = { renderer, scene, camera, brain, cameraRig, get pet() { return pet; } };
