# MAFT 고도화 체크리스트

> 직접 학습하면서 체감되는 항목에 우선순위를 매기기 위한 후보 리스트.
> 카테고리 안에서는 위에서 아래로 갈수록 가치 ↘, 비용 ↘ 또는 niche 화 됩니다.
> 비용 단위는 대략적인 **인터럽트 없는 작업 시간** 추정.

---

## 0. 최우선 개선점

- [x] **0.1** 가로 너비가 좁은 화면에서 토픽 리스트를 봤을 때 (사이드 바가 위로 배치 됐을 때) 각 토픽이 master 상태인지 확인 불가.
  - narrow 미디어쿼리에서 `.row-id` 만 숨기고 `.row-kind` 는 컴팩트하게 유지 → `★ mastered` / `best n/5 · ×k` 표시 복원
- [x] **0.2** 화면이 좁은 노트북에서 학습할 때 (대화 중 화면) 한 번 대답하면 점수판이 표시되는데 이 점수판이 모든 대화창을 가려버림. 대화 공간이 너무 좁아서 답변을 제대로 파악할 수 없음.
  - `ScorePanel` 에 `collapsible/open/onToggle` props 추가, narrow 시 기본 접힘
  - 접힌 상태: `latest · avg · best · turns · gaps` 1줄 summary + 펼치기 토글
  - desktop (≥920px) 은 항상 풀펼침 — 회귀 없음
  - 후속 (2026-05-22): 가로는 넓지만 세로가 짧은 노트북 창에서는 width 기반
    collapse 가 안 걸려 패널이 펼친 채로 thread 를 ~120px 까지 짓눌렀음
    (auto-scroll 로 첫 항목이 보이지 않아 "가려진" 것처럼 보임).
    해결: `NARROW_QUERY` 에 `(max-height: 820px)` 추가 → 세로 짧은 화면에서
    패널 기본 접힘. (head/rubric/composer 의 `flex-shrink:0` 는 앱 셸 의도
    명시용 — rubric 이 min-content 라 실측 차이는 없음. 정적 하니스로 확인)
- [x] **0.3** 세션을 클릭할 때마다 클로드 cli 실행하는 것으로 보임. 이미 학습한 내용일 때 클릭하면 이전 학습 대화 내용이 보여지고, 재시작 가능하게 수정했으면 좋겠음. 클로드 세션은 유지할 필요는 없으나. 학습 기록이 이미 있는 경우에 인풋을 넣었을 시 이전 채팅 기록들도 같이 인풋으로 넣어서 어느정도 context 유지에 도움되게 수정.
  - 서버: `GET /api/topics/:id/last-session` 추가 — 토픽의 가장 최근 세션을 hydration 형태로 반환 (mastered 무관)
  - 서버: `postMessage` 가 더 이상 `--resume sessionId` 를 사용하지 않고 매번 새 claude spawn. 시스템 프롬프트 뒤에 "이전 학습 맥락" preamble (마지막 3 turn 발췌 + 누적 약점 top 5) 동봉
  - 클라이언트: 토픽 클릭 시 last-session 우선 hydration → 없으면 새로 시작. 세션 헤더에 `resumed` 태그 + `새 세션` 버튼
  - 검증: Q1 resume (3 turn 복원), Q12-State mastered resume (7 turn + Mastered pill), 새 세션 버튼 → fresh, 메시지 제출 응답이 "이전 안내에서 말씀드렸듯이…" 로 이어가는 것 확인

---

## 0.5 Tier 2 — 채점 구조 개편: 개념별 점수 추적 (진행 중)

> 배경: `tasks/prompt-review.md` P2 — 마스터 조건은 "개념별 ≥3" 인데 시스템은 턴당 score
> 1개만 저장. 개념별 점수가 없어 진척 추적이 LLM 기억에 의존하던 구조적 결함을 해결.
> 기존 `progress.db` 는 폐기 (clean slate, 마이그레이션 없음).

### Phase 1 — 서버 + DB + 프롬프트 ✅
- [x] `db.ts` — 스키마 재설계: `sessions`(integration_score) / `concepts`(신규) / `turns`(turn_score·eval_json). `concept_misses` 폐기
- [x] `prompt.ts` — 시작 멘트에 개념 목록 JSON, 평가 턴에 개념별 점수 JSON. `extractConceptList`·`extractEvaluation` 파서
- [x] `sessions.ts` — 개념 영속화, 새 Session 모델, `applyEvaluation`
- [x] `stats.ts` — weak points·topic stats 를 `concepts` 기반으로 재도출
- [x] `routes.ts` — startSession 개념 파싱·저장, postMessage 개념별 best score 갱신, 마스터를 서버가 계산
- [x] 검증 — DB 폐기 후 새 세션 API 테스트. 한 답변이 c2·c3 동시 4점, 마스터 서버 계산 확인

### Phase 2 — 프론트엔드 ✅
- [x] `api.ts` — 응답 타입 갱신 (concepts/integrationScore, TopicStats, WeakPoint)
- [x] `ScorePanel.tsx` — 개념 체크리스트 (개념명 + 0~5 미터 + 상태 뱃지 + 통합 점수)
- [x] `App.tsx` / `SessionView.tsx` — 인덱스 진척 라벨(n/n 개념), 개념 상태 세션 추적
- [x] 검증 — tsc -b + vite build 통과, Playwright 로 인덱스·세션 렌더 확인

> 완료 (2026-05-21): Tier 2 양 Phase 모두 적용·검증·커밋. 채점 단위가 개념으로
> 바뀌어 진척·마스터가 실제 데이터로 계산됨. 남은 후속: prompt-review.md 의 P5
> (deflist 활용 심화)·P8 (README 갱신) 등은 별도 항목.

---

## 1. 응답 체감 속도

- [ ] **2.1 SSE 스트리밍** — `claude -p --output-format stream-json` + EventSource. 첫 글자 1~2초. (3~4h)
  - [ ] AbortController + 페이지 이탈 시 child SIGTERM
  - [ ] 자동 스크롤 lock (사용자가 위로 올렸을 때는 따라가지 않음)
  - [ ] 스트림 도중 ` ```json ` 블록 진입 감지 → 그 이후는 화면 hide

## 2. 학습 품질 / 정확도

- [ ] **모델 라우팅** — 평가는 Sonnet, 빠른 follow-up 은 Haiku. 학습 시작은 Sonnet 고정. (2h)
- [ ] **컨텍스트 관리** — 세션이 길어지면 토큰이 누적. 일정 길이 넘으면 system summary 만 남기고 중간 turn 압축. (3h)
- [ ] **청자 옵션** — "동료 개발자" 외에 "주니어" / "면접관" / "본인 미래의 자신" 등 학습자 선택. (1.5h)
- [ ] **시작 멘트 보강** — 토픽 길이/난이도에 따라 "이 토픽은 ~분 정도 풀어 설명하시면 충분합니다" 같은 가이드. (1h)
- [ ] **점수 일관성 회귀 테스트** — 동일 답변 재제출 시 점수 안 오르는지 자동 검증. (1.5h)

## 3. 누적 / 망각 곡선 / 추천

- [ ] **재학습 알림 (Spaced Repetition)** — 마스터 도달 후 1d/3d/7d/30d 뒤 다시 풀기. 사이드바 "Review due" 섹션. (3h)
- [ ] **마스터 후 다음 토픽 추천** — 같은 카테고리 / 자주 빠뜨린 개념 관련 토픽 우선. (2h)
- [ ] **Weak Points 정규화 개선** — 임베딩 또는 LLM batch 호출로 유사 concept 묶기, 또는 사용자 수동 병합 UI. (3h~)
- [ ] **세션 재개** — 이미 시도한 토픽 클릭 시 새 세션 vs 직전 세션 재개 선택. (2h)

## 4. UX / 워크플로

- [ ] **답변 수정 / 재시도** — 직전 답변을 다시 쓰고 재제출 (새 turn 추가 또는 기존 turn 교체). (2h)
- [ ] **즐겨찾기 / 핀** — 사이드바에 핀된 토픽 묶음. (1.5h)
- [ ] **트리 네비** — 카테고리 안 sub-category 까지 트리. (2h)
- [ ] **본문 검색** — Topic id/title 외에 .md 본문 검색. 인덱싱은 서버 부팅 시 1회. (3h)
- [ ] **키보드 단축키** — `J/K` 토픽 이동, `/` 검색, `Esc` 종료, `⌘+Enter` 제출 (이미 있음). (1h)
- [ ] **모바일 반응형** — 태블릿/폰 뷰포트 정리. (3h)
- [ ] **세션 화면 좌측 thread 폭** — 긴 답변 가독성. (0.5h)

## 5. 데이터 / 영속화 / 가시화

- [ ] **3.5 세션 markdown archive** — 마스터 시 자동 export `server/data/archive/{topicId}.md`. 데모/공유용. (1.5h)
- [ ] **JSON / CSV export** — 진척도 백업. (1h)
- [ ] **진척도 대시보드** — 별도 페이지: 카테고리별 마스터 비율, 평균 점수, 점수 추이. (4h)
- [ ] **DB 위치 옵션** — 현재 `server/data/`. `~/.maft/` 도 옵션 제공해 server 디렉토리 삭제 시에도 데이터 보호. (0.5h)
- [ ] **Export to Anki / Obsidian** — 마스터 시점 노트 생성. (2h)

## 6. 콘텐츠 / 빌드

- [ ] **토픽 인덱스 hot reload** — Writerside 변경을 chokidar 로 감시 → 인덱스 재구성. (1.5h)
- [ ] **Production 빌드 + 단일 실행** — `web` 빌드 산출물을 `server` 가 정적 서빙. `node server` 한 번으로 시작. (2h)
- [ ] **Docker compose** — `docker compose up` 한 번에 시작 (claude CLI 마운트 필요). (3h)
- [ ] **콘텐츠 missing 시 친화적 에러** — `MANIFEST_WRITERSIDE_DIR` 미존재 시 안내 페이지. (0.5h)

## 7. 운영 / 안정화

- [ ] **에러 회복** — claude spawn 실패 / timeout / 비정상 종료 시 사용자 친화적 메시지 + retry 버튼. (2h)
- [ ] **claude CLI 부재 감지** — 서버 시작 시 `claude --version` 확인, 부재 시 명확 에러. (0.5h)
- [ ] **요청 큐 / 동시성 제한** — 한 사용자가 빠르게 답변 여럿 제출 시 race condition 방지. (1.5h)
- [ ] **로깅** — 세션별 로그 파일 / 콘솔 구조화 + 비용/지연 메트릭. (2h)
- [ ] **Claude.ai 구독 한도 도달 시 graceful 처리** — 명확 안내 + 재시도 안내. (1h)

## 8. 테스트

- [ ] **JSON 추출 단위 테스트** — `extractRubric` 견고성 (vitest). (1h)
- [ ] **mi.tree 파싱 단위 테스트** — 실제 mi.tree fixture. (1h)
- [ ] **e2e 캡처 시나리오 정리** — 현재 `scripts/capture.ts` 를 그대로 활용해 회귀 테스트로 승격. (1.5h)
- [ ] **시스템 프롬프트 회귀 테스트** — 채점 변형 사례 fixture 로 LLM 변동성 측정. (3h~)

## 9. 포트폴리오 / 공개

- [ ] **Public 전환** — 충분히 다듬어졌다고 판단되면 private → public.
- [ ] **데모 GIF / 짧은 동영상** — `scripts/capture.ts` 확장으로 GIF 자동 생성. (2h)
- [ ] **README 영문 버전** — 글로벌 가독성. (2h)
- [ ] **블로그 포스트 / 발표 소재** — Claude Code headless OAuth 활용 사례. (별도)

---

## 다음 작업 후보 (다음 세션 시작 시 결정)

체감해보신 후, 위 항목 중 우선순위 1~3개를 골라주시면 그 순서대로 진행합니다.
직관적으로 가장 답답할 가능성이 높은 후보:

1. **2.1 SSE 스트리밍** — 매 답변마다 10~30초 멍하니 기다리는 게 가장 큰 마찰입니다.
2. **5.1 markdown archive** + **5.3 진척도 대시보드** — 공부 흔적이 가시화되는 즐거움.
3. **3.1 Spaced Repetition** — 일주일 뒤 자기 자신을 위한 시스템.

---

## 2026-06-13 · ScorePanel 사이드 레일 재배치

학습 세션에서 Concepts 점수판이 thread 위에 가로 띠로 얹혀 대화를 잠식하던 문제 해결.
접기/펼치기로는 못 풀던 근본 원인 = 세로 스택 배치였음.

- 진단: `.session` flex column 안에서 ScorePanel 이 header 와 thread 사이에 `flex-shrink:0` 가로 블록으로 끼어, 펼치면 개념 수만큼 thread 높이를 점유.
- 개선(레퍼런스: Copilot/Cursor/Claude Artifacts 의 우측 on-demand 패널 패턴): 세로 스택 → `.session-body` 가로 그리드(`1fr 288px`). 데스크탑은 우측 상주 레일, ≤920px 는 우측 slide drawer + backdrop + header 토글(`CONCEPTS n/m`).
- narrow 판정에서 `max-height` 제거 — 우측 레일은 세로를 잠식하지 않으므로 높이 짧은 노트북도 레일로 충분.
- 버그 잡음: `index.css` 의 진입 애니메이션 `rise-fade`(transform, `both` fill)가 `.rubric-figure` 에 걸려 drawer 의 `translateX(100%)` 를 덮어써 닫힌 drawer 가 화면에 잔존 → `.rubric-figure.rubric-drawer { animation:none }` 로 차단.
- 검증: tsc/vite build 통과, Playwright 로 데스크탑(레일 우측 비겹침) · narrow 닫힘(off-screen) · 열림(slide+backdrop) 좌표/스크린샷 확인, 콘솔 에러 0.
- 수정 파일: web/src/SessionView.tsx, web/src/ScorePanel.tsx, web/src/App.css

---

## 2026-06-13 · 코치 응답 transcript runaway 방어

E6-Coroutine-Cancellation 세션에서 코치 응답이 "예상 답변까지 질문으로 표시"되던 문제.

- 진단: 턴 194부터 코치 응답(`result.text`)에 모델이 자기 턴을 넘어 **다음 턴들까지 환각 생성**한 내용이 섞임 — `[진짜 코치] → \n\nuser[가짜 답변] → [필수] reminder 재현 → \n\nassistant[가짜 다음 응답]`. 길이 1003→1863→2552로 폭주. 매 user 메시지에 붙는 형식 reminder가 resume 히스토리에 쌓여 모델이 "user…reminder…assistant" 패턴을 모방한 것이 트리거. 턴 196의 가짜 user 답변 때문에 실제 사용자 답변과 desync 발생.
- 방어:
  1. `prompt.ts` `truncateRunaway()` — 출력에서 첫 환각 경계(글루된 user/assistant 역할 토큰, 출력에 재등장한 reminder)를 찾아 진짜 코치 턴만 남김. 산문 속 "user experience"는 오탐 안 함(공백 뒤따름).
  2. `routes.ts` startSession·postMessage — extract/strip/저장보다 **먼저** truncateRunaway 적용 → 환각 JSON이 점수·마스터·표시를 오염시키지 못함. truncated 시 warn 로그.
  3. `prompt.ts` 시스템 프롬프트 규칙 8 추가 — "당신의 한 턴만 작성, 다음 차례 생성 금지" (트리거 자체 억제, 방어 심층화).
- 기존 오염 데이터: turns 194/196/198 표시 텍스트 정리(점수/eval_json은 보존). DB 백업 `server/data/progress.db.bak-20260613-210304`.
- 테스트: `server/scripts/verify-runaway.ts` (`npm run test:runaway`) — 누출 패턴 임베드 5케이스 전부 통과. tsc 통과, 서버 정상.
- 한계: claude CLI 내부 --resume 히스토리는 우리가 못 고치므로 이 세션을 계속하면 runaway가 또 날 수 있음(이제 잘려서 표시는 정상이나 그 턴 점수는 미반영). 완전히 깨끗한 진행은 "새 세션" 권장.
