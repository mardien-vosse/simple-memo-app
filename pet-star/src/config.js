// 이 파일만 고쳐도 아이 이름, 3D 파일 위치, 행동 확률을 바꿀 수 있어요.

export const PET = {
  name: '별이',                // 화면 위 이름표와 집 문패에 보이는 아이 이름
  modelUrl: 'models/dog.glb',  // 우리 아이 3D 파일 위치 (없으면 임시 강아지가 나와요)
  modelTurnDegrees: 0,         // 아이가 옆이나 뒤로 걸으면 90, 180, -90 중 하나로 바꿔 보세요
  bodyLength: 1.4,             // 별 위에서의 몸 길이
  walkSpeed: 0.75,             // 걷는 속도 (1초에 움직이는 거리)
};

// 다음에 무엇을 할지 고르는 확률표예요. chance 숫자가 클수록 자주 해요.
// seconds는 그 행동을 이어 가는 시간(최소, 최대 초)이에요.
// 나중에는 성격 태그(활발함, 겁이 많음 등)에 따라 이 표가 달라지게 만들 거예요.
export const BEHAVIORS = {
  walk: { chance: 30, seconds: [7, 14], label: '천천히 산책하는 중' },
  sniff: { chance: 12, seconds: [3, 6], label: '킁킁 냄새 맡는 중' },
  look: { chance: 10, seconds: [3, 6], label: '두리번거리는 중' },
  sit: { chance: 14, seconds: [5, 9], label: '앉아서 쉬는 중' },
  lie: { chance: 12, seconds: [7, 12], label: '엎드려 쉬는 중' },
  nap: { chance: 8, seconds: [10, 18], label: '새근새근 낮잠 자는 중' },
  home: { chance: 14, seconds: [12, 20], label: '집 앞에서 쉬는 중', travelLabel: '집으로 가는 중' },
};

export const WORLD = {
  planetRadius: 24, // 별의 반지름. 24면 아이 300마리가 넉넉하게 지내요 (한 마리당 약 24㎡)
  seed: 20261104,   // 나무와 꽃 배치를 정하는 숫자. 바꾸면 별 모습이 달라져요
  // 함께 사는 이웃 아이 수. 지금은 연습용으로 만든 아이들이고,
  // 2단계에서 실시간 서버가 생기면 실제로 접속한 집사들의 아이로 바뀌어요. 0이면 별이 혼자 지내요.
  neighbors: 299,
};
