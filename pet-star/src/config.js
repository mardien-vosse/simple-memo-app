// 이 파일만 고쳐도 아이 이름, 3D 파일 위치, 행동 확률을 바꿀 수 있어요.

export const PET = {
  name: '별이',                // 화면 위에 보이는 아이 이름
  modelUrl: 'models/dog.glb',  // 우리 아이 3D 파일 위치 (없으면 임시 강아지가 나와요)
  modelTurnDegrees: 0,         // 아이가 옆이나 뒤로 걸으면 90, 180, -90 중 하나로 바꿔 보세요
  bodyLength: 1.4,             // 별 위에서의 몸 길이 (별 반지름이 8이에요)
  walkSpeed: 0.75,             // 걷는 속도 (1초에 움직이는 거리)
};

// 다음에 무엇을 할지 고르는 확률표예요. chance 숫자가 클수록 자주 해요.
// seconds는 그 행동을 이어 가는 시간(최소, 최대 초)이에요.
// 1단계에서는 성격 태그(활발함, 겁이 많음 등)에 따라 이 표가 달라지게 만들 거예요.
export const BEHAVIORS = {
  walk: { chance: 65, seconds: [7, 15], label: '천천히 산책하는 중' },
  sit: { chance: 35, seconds: [4, 9], label: '앉아서 쉬는 중' },
};

export const WORLD = {
  planetRadius: 8, // 별의 반지름
  seed: 20261104,  // 나무와 꽃 배치를 정하는 숫자. 바꾸면 별 모습이 달라져요
};
