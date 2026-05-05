# Manifest Android Feynman Trainer

> 자기 말로 설명 → AI 코치의 평가 → 소크라테스식 역질문으로 빈틈을 메우는 **안드로이드 CS 학습 도구**.
> Claude Code headless 모드를 백엔드로 사용하므로 Claude.ai 구독 자격증명만으로 동작하며, 별도 API 과금이 없습니다.

> 약칭 **MAFT** (Manifest Android Feynman Trainer).

## 기획 의도

[skydoves/manifest-android-interview](https://github.com/skydoves/manifest-android-interview) 의 안드로이드 CS 토픽 약 109개를 그저 읽고 흘려보내는 대신,
**파인만 학습 기법**(자기 설명 → 평가 → 빈틈 역질문 → 재학습) 을 인터랙티브로 구현해 이해도가 일정 수준에 도달할 때까지 가르쳐 주는 학습 도구입니다.

학습자가 토픽을 자기 말로 풀어내면, AI 코치가 토픽 원문을 기준으로 채점하고 학습자가 빠뜨린 핵심 개념을 가리키는 역질문을 돌려줍니다.
모든 점수와 누적 약점이 SQLite 에 영속화되므로, 어떤 토픽을 얼마나 깊이 이해했는지가 인덱스와 사이드바에 그대로 드러납니다.

## 화면

토픽 인덱스 (사이드바에 누적 약점)

![](docs/img/index.png)

학습 세션 — 점수 패널과 Recurring Gaps, 코치의 마스터 안내

![](docs/img/session.png)

점수 패널 단독 — turns / latest / average / best + sparkline + recurring gaps

![](docs/img/rubric.png)

> 캡처는 `Q12-State-hoisting.md` 토픽으로 답변 3회를 진행해 mastered 도달까지 만든 시점입니다.
> 재현하려면 두 dev 서버를 띄운 뒤 `cd scripts && npm install && npx playwright install chromium && npm run capture` 를 실행합니다 (Playwright 자동화).

## 학습 사이클

```mermaid
sequenceDiagram
  autonumber
  actor U as 학습자
  participant W as Web (React)
  participant S as Server (Express)
  participant C as Claude Code (headless)

  U->>W: 토픽 선택
  W->>S: POST /api/sessions { topicId }
  S->>C: claude -p "학습 시작" --system-prompt 〈파인만 코치 + 토픽 원문〉
  C-->>S: 세션 ID · 청자/범위 안내
  S->>S: createSession · appendTurn(assistant)
  S-->>W: { sessionId, message }

  loop 코칭 사이클 (mastered = true 까지)
    U->>W: 자기 설명 입력
    W->>S: POST /api/sessions/:id/messages
    S->>C: claude -p --resume sessionId 〈+ 형식 reminder〉
    C-->>S: 평가문 + 다음 질문 + JSON 채점 블록
    S->>S: extractRubric · appendTurn · updateSessionMeta · recordMissedConcepts
    S-->>W: { message, rubric, mastered }
    W-->>U: 코치 메시지 · 점수 sparkline · 누적 약점
  end
```

## 아키텍처

```mermaid
flowchart LR
  subgraph Browser
    UI["React UI<br/>Vite dev :5173"]
  end

  subgraph LocalNode["Node.js · :3001"]
    API[Express REST]
    PR[Prompt Builder]
    CL[Claude Headless Wrapper]
    IDX["Topic Indexer<br/>(mi.tree 파싱)"]
    DB[("SQLite<br/>progress.db")]
  end

  ANT[("Claude Code CLI<br/>OAuth · claude.ai")]
  CONT[("ManifestAndroid<br/>Writerside .md")]

  UI -- "/api/*" --> API
  API --> PR
  API --> IDX
  API --> DB
  IDX -. read .-> CONT
  PR --> CL
  CL -. "spawn claude -p" .-> ANT
```

## 데이터 모델

```mermaid
erDiagram
  sessions ||--o{ turns : has
  sessions {
    TEXT id PK
    TEXT topic_id
    INTEGER created_at
    INTEGER updated_at
    INTEGER last_score
    TEXT last_missed
    TEXT last_next_focus
    INTEGER mastered
  }
  turns {
    INTEGER id PK
    TEXT session_id FK
    TEXT role
    TEXT text
    INTEGER score
    TEXT missed_concepts
    TEXT next_focus
    INTEGER mastered
    INTEGER ts
  }
  concept_misses {
    TEXT topic_id PK
    TEXT concept PK
    INTEGER count
    INTEGER last_seen_at
  }
```

토픽별 통계(베스트 점수 · 시도 횟수 · 마스터 여부)는 `sessions` 테이블 위의 집계 쿼리로 도출합니다(별도 머터리얼라이즈 테이블 없음). 누적 약점은 평가 응답마다 `missed_concepts` 를 정규화(trim · lowercase) 후 `concept_misses` 에 UPSERT 합니다.

## 빠른 시작

요구사항:

- Node.js 20+
- [Claude Code CLI](https://docs.claude.com/claude-code) 가 설치되어 있고 `claude.ai` 로그인이 완료되어 있어야 합니다
  (`claude auth status` 의 `authMethod` 가 `claude.ai` 여야 합니다)
- 인접 경로의 [ManifestAndroid](https://github.com/ckgod/ManifestAndroid) Writerside 컨텐츠가 필요합니다

설치:

```bash
cd server && npm install
cd ../web && npm install
```

실행 (백그라운드 일괄):

```bash
./scripts/dev-up.sh    # 두 서버를 띄우고 헬스 체크까지 마친 뒤 반환
./scripts/dev-down.sh  # 두 서버 종료
# 로그: scripts/.run/server.log, scripts/.run/web.log
```

> 직접 한 터미널씩 띄우고 싶다면 `cd server && npm run dev` / `cd web && npm run dev` 도 그대로 됩니다.

환경 변수:

| 변수 | 기본값 | 설명 |
|---|---|---|
| `MANIFEST_WRITERSIDE_DIR` | `../../ManifestAndroid/Writerside` | 토픽 콘텐츠 루트 |
| `MAFT_DB_PATH` | `server/data/progress.db` | SQLite 진행 상황 DB |
| `PORT` | `3001` | 서버 포트 |
| `ANTHROPIC_API_KEY` | (미설정 권장) | 설정 시 OAuth 대신 API 키로 동작해 사용량 과금이 발생합니다. **MAFT 의 의도와 어긋나므로 unset 을 권장합니다** |

## 핵심 설계 결정

- **Claude Code headless 로 LLM 호출** — `claude -p` 서브프로세스를 spawn 하고 `--output-format json` 을 파싱합니다. `--bare` 옵션을 사용하지 않으면 OAuth(claude.ai 구독) 자격증명이 자동으로 적용되므로 별도 API 키 없이 구독 한도 내에서 동작합니다.
- **시스템 프롬프트의 JSON 채점 블록 강제** — 모든 평가 응답 끝에 `{score, missed_concepts, next_focus, mastered}` JSON 블록을 코드블록으로 첨부하도록 강제하고, 후속 메시지마다 형식 reminder 를 자동으로 첨부합니다. 키 변형(`scores`, `missingConcepts` 등) 도 시스템 프롬프트에서 명시적으로 금지해 LLM 변동성을 흡수합니다.
- **점수 인플레이션 방지** — 같은 답변을 살짝 바꿔 재제출해도 새 정보가 없으면 점수가 오르지 않도록 시스템 프롬프트에 일관성 규칙을 두었습니다 (`score 2 → 2` 동결을 PoC 에서 확인했습니다).
- **청자 재정의** — 일반적 파인만의 "12살 청자" 가정은 안드로이드 학습엔 부적합해 (Compose 가 무엇인지부터 풀어 설명할지 학습자가 혼란을 겪습니다), **"이 토픽은 처음 듣지만 4대 컴포넌트 · Compose Composable/State · Kotlin 기초는 아는 동료 개발자"** 로 재정의했습니다.
- **SQLite 영속화 + 누적 약점 트래킹** — 매 메시지마다 turns 테이블에 incremental insert 하고, `missed_concepts` 를 `concept_misses` 에 UPSERT 로 누적해 사이드바 Top N Weak Points 로 노출합니다.

## 디렉토리

```
.
├── server/                  Node.js + Express + TypeScript
│   ├── src/
│   │   ├── claude.ts        headless 래퍼 (claude -p spawn)
│   │   ├── topics.ts        mi.tree 정규식 파싱 · 토픽 인덱스
│   │   ├── prompt.ts        파인만 시스템 프롬프트 + 채점 추출
│   │   ├── routes.ts        REST API
│   │   ├── sessions.ts      SQLite 세션 영속화
│   │   ├── stats.ts         토픽 통계 + Weak Points 집계
│   │   ├── db.ts            better-sqlite3 + 스키마 부트스트랩
│   │   ├── config.ts        Writerside 경로 해석
│   │   └── index.ts         부트스트랩
│   └── data/                progress.db (gitignore)
└── web/                     Vite + React + TypeScript
    └── src/
        ├── App.tsx          토픽 인덱스 + Weak Points 사이드바
        ├── SessionView.tsx  학습 세션 화면 (Coach / Response 엔트리)
        ├── ScorePanel.tsx   Figure 01 · Rubric (sparkline + recurring gaps)
        ├── api.ts           REST 클라이언트
        ├── App.css          Schematic Dark — layout / 세션
        └── index.css        디자인 토큰 + 진입 애니메이션
```

## 디자인 톤

차분한 학습 환경을 의도해 **Schematic Dark** 톤으로 정리했습니다. Geist + Pretendard Variable, paper `#0e1014`, 강조색 blueprint `#6b9ddb`, 점수 팔레트 (moss / amber / sienna / slate) 로 구성되어 있습니다. 게임화는 인플레이션을 피하고자 차분한 배지 (`best 3/5 · ×2`, `★ mastered`) 와 작은 sparkline 막대만으로 한정합니다.

## 한계 / 다음 단계

- **응답 스트리밍 미적용** — 첫 문자 도착까지 수 초가 걸립니다 (`--output-format stream-json` 으로 SSE 도입 예정입니다).
- **Weak Points 정규화는 단순 trim/lowercase** — "recomposition 트리거" / "리컴포지션 발생 조건" 이 별개 항목으로 누적될 수 있습니다.
- **테스트 미작성** — Phase 5 에서 핵심 경로(JSON 추출, 채점 일관성) 위주로 추가할 예정입니다.

## 라이선스 / 출처

학습 콘텐츠 원본 저작권은 [skydoves/manifest-android-interview](https://github.com/skydoves/manifest-android-interview) 에 있습니다 (Apache 2.0). 본 도구는 콘텐츠를 동봉하지 않고, 인접 디렉토리의 Writerside 파일을 읽어 사용합니다.
