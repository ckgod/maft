# Manifest Android Feynman Trainer

[ManifestAndroid](https://github.com/ckgod/ManifestAndroid) 토픽 기반 파인만 학습 코치.
Claude Code의 headless 모드를 백엔드로 활용해 별도 API 키 없이 구독 자격증명으로 동작합니다.

## 동기

ManifestAndroid의 안드로이드 CS 토픽 ~109개를 단순 읽기로는 머리에 잘 들어오지 않아,
파인만 학습 기법(자기 설명 → 평가 → 소크라테스식 역질문 → 재학습)으로
이해도가 일정 수준에 도달할 때까지 가르쳐주는 학습 도구.

## 구조

```
.
├── server/   Node.js + Express + TypeScript (Claude headless 래퍼, 토픽 인덱서, 세션 API)
└── web/      Vite + React + TypeScript (학습 UI)
```

## 인증

`claude` CLI의 OAuth 자격증명(Claude.ai 구독)을 그대로 사용합니다.
별도의 `ANTHROPIC_API_KEY` 환경변수를 설정하면 그쪽이 우선되어 사용량 과금이 발생할 수 있으므로 주의하십시오.

## 학습 콘텐츠 출처

콘텐츠 원본은 인접 디렉토리의 [ManifestAndroid](../ManifestAndroid) 프로젝트에 있으며,
원 저작권은 [skydoves/manifest-android-interview](https://github.com/skydoves/manifest-android-interview)에 있습니다.
