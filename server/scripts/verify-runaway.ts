// truncateRunaway 회귀 테스트 — 실제 관측된 transcript runaway 패턴을 임베드.
// DB 상태에 의존하지 않는 자립형. `npm run test:runaway` 로 실행.
import { truncateRunaway } from '../src/prompt.js';

// 잘라낸 결과에 화자 라벨/reminder 흔적이 남았는지 검사
const LEAK = /\n[ \t]*\n(?:user|assistant)(?=[^\s])|\[필수\] 위/;

interface Case {
  name: string;
  input: string;
  expectTruncated: boolean;
  // 잘린 뒤 본문이 이 문자열로 끝나야 함 (정상 보존 케이스는 생략)
  endsWith?: string;
}

const REMINDER = '\n\n---\n[필수] 위 코칭 응답을 작성한 뒤, 응답 맨 마지막에 채점 JSON 코드 블록을 첨부하십시오.';

const cases: Case[] = [
  {
    // 194형: 코치 질문 → 가짜 user 답변(글루) → reminder
    name: 'user 턴 글루 + reminder 재현',
    input:
      '`SupervisorJob`이 무엇을 막고 무엇은 그대로 두는지 설명해 주시겠습니까?' +
      '\n\nuserSupervisorJob은 자식 실패가 부모로 전파되지 않게 막아줍니다.' +
      REMINDER,
    expectTruncated: true,
    endsWith: '설명해 주시겠습니까?',
  },
  {
    // 196형: 코치 → 가짜 user → reminder → 가짜 assistant 턴까지
    name: 'user + assistant 후속 턴 연쇄',
    input:
      '`childA`가 실패하면 `childB`는 어떻게 될까요? 그리고 그 이유는요?' +
      '\n\nuserchildA가 실패하면 childB도 같이 취소됩니다.' +
      REMINDER +
      '\n\nassistant정확합니다. 이제 응용 질문을 드리겠습니다…',
    expectTruncated: true,
    endsWith: '그리고 그 이유는요?',
  },
  {
    // 정상 평가 턴: 코치 본문 + 채점 JSON. 변형되면 안 됨.
    name: '정상 턴 보존',
    input:
      '핵심 메커니즘을 정확히 짚으셨습니다. 다음은 경계 조건으로 넘어가 볼까요?' +
      '\n\n```json\n{"scores":[{"id":"c1","score":3}],"integration_score":null,"next_focus":"c2","mastered":false}\n```',
    expectTruncated: false,
  },
  {
    name: '오탐 방지 — "user experience" 산문',
    input: '코루틴에서 user experience 가 중요합니다.\n\n계속 이어지는 설명입니다.',
    expectTruncated: false,
  },
  {
    name: '오탐 방지 — 줄바꿈 뒤 공백 동반 role 단어',
    input: 'assistant 라는 단어를 본문에 써도\n\n됩니다. 멈추지 않습니다.',
    expectTruncated: false,
  },
];

let fail = 0;
for (const c of cases) {
  const r = truncateRunaway(c.input);
  const okTrunc = r.truncated === c.expectTruncated;
  const okLeak = !r.truncated || !LEAK.test(r.text);
  const okEnds = !c.endsWith || r.text.endsWith(c.endsWith);
  const okPreserve = c.expectTruncated || r.text === c.input;
  const ok = okTrunc && okLeak && okEnds && okPreserve;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}`);
  if (!ok) {
    console.log(`   truncated=${r.truncated}(기대 ${c.expectTruncated}) 잔여누출=${LEAK.test(r.text)} endsOk=${okEnds} preserveOk=${okPreserve}`);
    console.log(`   결과: ${JSON.stringify(r.text.slice(-80))}`);
  }
}

console.log(fail === 0 ? '\n✅ 전체 통과' : `\n❌ ${fail}건 실패`);
process.exit(fail === 0 ? 0 : 1);
