# 이 저장소에서 작업할 때

- 강아지별·고양이별 메타버스 프로젝트는 `pet-star/` 폴더에 있어요.
  전체 계획은 `pet-star/PLAN.md`, 진행 상황은 `pet-star/README.md`의 체크리스트를 봐 주세요.
- 계획서의 현재 단계만, 한 번에 한 가지씩 진행해요.
- 사용자는 Claude Code 입문자예요. 무엇을 왜 하는지 한국어로 쉽게 설명해 주세요.
- 구조: 빌드 도구 없이 `index.html` + `src/*.js`(ES 모듈). Three.js는 importmap으로 CDN에서 불러와요(`three@0.170.0` 고정).
- 행동 확률표와 아이 설정은 `pet-star/src/config.js`에 모아 둬요.
- 이 저장소는 공개예요. 사진으로 만든 아이 3D 파일(`pet-star/models/*.glb`)은 `.gitignore`로 막아 두고, 비공개 미리보기(Artifact)에만 넣어요.
- 3D 모델은 Tripo 네발 리깅 뼈대(`…_Limb_0~4`, `Spine_*`, `Head_*`)를 `pet.js`가 찾아서 걷기·앉기를 코드로 움직여요.
