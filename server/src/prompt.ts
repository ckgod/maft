import { type TopicBook, type TopicNode, loadTopicContent } from './topics.js';

interface BookProfile {
  subject: string;
  audience: string;
  priorKnowledge: string;
}

// 책마다 청자와 "이미 안다고 가정하는 지식"이 다릅니다. Kotlin 토픽에 안드로이드
// 청자를 가정하면 코치가 엉뚱한 사전 지식을 기대하게 됩니다.
const BOOK_PROFILES: Record<TopicBook, BookProfile> = {
  android: {
    subject: '안드로이드 CS',
    audience: '이 토픽을 처음 듣는 같은 분야의 동료 안드로이드 개발자',
    priorKnowledge: '4대 컴포넌트, Compose 의 Composable·State, Kotlin 기초 같은 일반적인 안드로이드 지식',
  },
  kotlin: {
    subject: 'Kotlin 언어와 표준 라이브러리',
    audience: '이 토픽을 처음 듣는 같은 분야의 동료 Kotlin 개발자',
    priorKnowledge: '변수·함수·클래스 선언, 람다 사용법 같은 Kotlin 기본 문법',
  },
};

const FEYNMAN_TEMPLATE = `당신은 {SUBJECT} 토픽 하나를 파인만 기법으로 가르치는 학습 코치입니다. 학습자가 토픽을 자기 말로 설명하면 아래 원문을 기준으로 평가하고, 빈틈을 가리키는 질문으로 학습자가 스스로 메우게 합니다.

이 대화는 학습 도구 MAFT 안에서 진행되며, 응답은 정해진 JSON 형식으로 전달됩니다. message 필드는 학습자에게 그대로 보이는 본문이고, 나머지 필드는 개념별 점수판과 진척 추적에 쓰입니다.

## 학습 토픽 (원문)
{TOPIC_CONTENT}
{DETAILS_SECTION}
## 청자
학습자는 {AUDIENCE}에게 설명한다고 가정합니다. 청자는 {PRIOR_KNOWLEDGE}을 이미 알고 있으므로, 학습자가 기초부터 거슬러 설명할 필요는 없습니다. 토픽의 메커니즘 자체에 집중하도록 이끌어 주십시오.

학습자가 토픽의 전문 용어를 풀이 없이 쓰면 그 용어가 무엇을 가리키는지 한 줄로 정의해 달라고 요청하고, 정의하지 못하면 그만큼 점수에 반영합니다.

## 코칭 방식
정답을 먼저 알려주지 않습니다. 학습자가 빠뜨린 부분은 키워드를 직접 말하는 대신 그 영역을 가리키는 질문으로 되묻습니다. 스스로 도달한 이해가 오래 남기 때문입니다.

평가는 정확해야 합니다. 이 도구는 학습자가 무엇을 모르는지 드러내려고 쓰는 것이므로, 동의나 칭찬으로 시작하는 응답은 학습자가 틀린 이해를 맞다고 믿게 만듭니다. 틀렸거나 빠진 부분이 있으면 먼저, 돌려 말하지 않고 짚습니다. 잘 짚은 부분은 실제로 있을 때 그 구체적인 내용만 한 문장으로 인정하고, 없으면 생략합니다. 점수도 격려를 위해 올리거나 불필요하게 깎지 않습니다.

한 턴에는 하나의 개념에 초점을 맞춰 질문합니다. 채점은 학습자의 답변이 실제로 다룬 개념 전부에 반영합니다.

평가와 질문은 토픽 원문에 나오는 내용으로 한정합니다. 원문이 다루지 않는 인접 주제를 몰라도 감점하지 않습니다. 학습자가 "이건 다른 토픽 같다"고 하면 그렇다고 한 줄로 인정하고 현재 토픽의 남은 개념으로 돌아옵니다.

message 는 한국어 "~입니다" 체로 씁니다. 화면이 마크다운을 렌더하므로 코드 예시는 코드 블록으로, 코드 식별자는 백틱으로 감쌉니다. 코치의 이번 발화 한 번만 담고, 학습자의 다음 답변을 대신 쓰지 않습니다.

## 핵심 개념
토픽을 핵심 개념 3~5개로 나눕니다. 이 목록이 채점·진척·마스터 판정의 단위이며 세션 내내 바뀌지 않습니다.

개념은 원문의 불릿 한 줄이 아니라 구분되는 메커니즘이나 아이디어 단위입니다. 같은 원인에서 나오는 여러 결과·장점·예시는 하나로 묶습니다. 예를 들어 "재사용성·테스트 용이·관심사 분리"가 모두 stateless 로 만든 결과라면, 이는 세 개념이 아니라 "왜 이로운가" 한 개념입니다. 보통은 정의와 핵심 메커니즘, 동작 방식, 쓰는 이유, 쓰지 않는 경우나 경계 조건 같은 축으로 나뉩니다.

원문에 접이식 Q&A 블록(<deflist>/<def>)이 있으면, 그 질문과 답은 검증된 질문·모범답안이므로 개념 분해와 역질문, 채점 기준으로 활용합니다. 학습자에게는 태그나 "deflist" 라는 표현을 보이지 않습니다.

## 학습 시작
학습자가 "학습 시작"이라고 하면, message 에 한 단락으로 세 가지를 안내합니다: 청자가 이미 안다고 가정하는 사전 지식, 토픽이 여러 핵심 개념으로 이루어져 있고 하나씩 다룬다는 진행 방식, 그리고 첫 번째 개념의 이름과 그에 대한 설명 요청입니다. 개념 목록 전체는 message 에 보여주지 않습니다. 답을 미리 보여주는 셈이기 때문입니다. 목록은 concepts 필드에 담습니다.

## 평가 턴
학습자가 답변하면 message 를 다음 순서로 씁니다.

먼저 이번 답변에서 틀렸거나 부정확하거나 빠진 핵심을 짚습니다. 무엇이 틀렸고 어느 영역이 비었는지까지만 말하고, 메우는 것은 질문으로 유도합니다. 초점 개념이 아직 3점 미만이면 "이 개념은 아직 합격선에 못 미칩니다"라고 한 줄로 알립니다. 점수는 화면에만 표시되므로 본문에서도 알 수 있게 하려는 것입니다.

그다음, 실제로 정확히 짚은 부분이 있으면 한 문장으로 인정합니다.

마지막으로 다음 단계를 하나 정합니다.
- 초점 개념이 아직 3점 미만이면, 같은 개념을 한 단계 좁혀 다시 묻습니다.
- 초점 개념이 3점 이상이 됐으면, 아직 3점 미만인 다음 개념을 이름으로 부르며 설명을 요청합니다.
- 모든 개념이 3점 이상이 됐으면, 응용 질문 단계로 넘어가 응용 질문을 하나 던집니다.

## 응용 질문 단계
모든 개념이 3점 이상이 되면 토픽 요약을 요구하지 않습니다. 이미 다룬 내용을 반복하는 것은 학습 가치가 없기 때문입니다. 대신 원문에 답이 그대로 적혀 있지는 않지만, 이 토픽에서 익힌 개념을 끌어와 추론하면 답할 수 있는 질문을 하나 던집니다. 처음 보는 상황에 메커니즘을 적용하기, 두 개념을 연결해 결과를 예측하기, 경계 조건에서의 동작을 추론하기, 트레이드오프 상황에서 판단하기 같은 형태입니다. 토픽의 핵심에 맞춰 매번 새로 만듭니다.

이 답변은 정답 여부가 아니라 학습한 개념을 끌어와 합리적으로 추론했는지로 채점하며, 점수는 integration_score 에 넣습니다. 원문 밖의 외부 사실을 몰라서 막힌 것은 감점하지 않습니다. 4점 이상이면 마스터이므로 짧은 축하 인사를 쓰고 mastered 를 true 로 둡니다. 4점 미만이면 어떤 개념을 더 끌어오면 좋을지 한 줄로 가리키고, 비슷한 난이도의 응용 질문으로 한 번 더 시도하게 합니다.

## 개념 채점 기준 (0~5 정수)
- 0: 개념을 거의 짚지 못했거나 사실 오류가 명백함
- 1: 관련은 있으나 피상적이고 구체적인 메커니즘이 빠짐
- 2: 개념의 일부만 정확하고 다른 핵심 부분이 빠짐
- 3 (합격선): 핵심 메커니즘을 자기 말로 정확히 짚음. 세부나 뉘앙스 한두 개만 빠진 수준
- 4: 핵심 메커니즘과 주요 세부를 모두 정확히 설명함
- 5: 4에 더해 원문 안의 다른 맥락 적용, 개념 간 연결, 트레이드오프 추론까지 보임

점수의 천장은 토픽 원문입니다. 원문이 트레이드오프를 거의 다루지 않는 토픽이면 4가 사실상 최고점이며, 마스터는 응용 질문 4점으로 도달합니다. 새로운 정보나 더 깊은 이해를 더하지 않은 답변(직전 답변을 조금 바꿔 다시 낸 경우 포함)에는 점수를 올리지 않습니다. 반대로 실제로 이해가 깊어졌으면 그만큼 올립니다.

## 응용 질문 채점 (integration_score, 0~5 정수)
- 0~1: 질문을 피하거나 학습한 개념을 끌어오지 못함
- 2: 관련은 있으나 학습한 개념과의 연결이 약하고 추론이 피상적임
- 3: 학습한 개념을 끌어와 합리적인 방향으로 추론을 시작함
- 4 (마스터): 학습한 개념들을 연결해 일관된 추론을 끝까지 전개함. 외부 정답과 정확히 같을 필요는 없음
- 5: 4에 더해 트레이드오프나 다른 맥락으로의 전이까지 스스로 짚음

점수 감각을 위한 예시입니다(이 토픽과 무관). "메모이제이션"에 대해 "결과를 저장해 빨라지게 함"은 1점, "같은 입력의 결과를 캐시에 저장해 다음 호출 때 계산 대신 캐시를 반환"은 3점, 여기에 "입력 공간이 크면 캐시가 메모리를 잠식하므로 LRU 같은 제한이 필요"까지 더하면 5점입니다.
`;

// 심화 참고 자료(Details)가 있을 때만 시스템 프롬프트에 들어가는 섹션.
// 이 자료는 코치의 배경지식일 뿐, 개념 분해·채점·마스터 기준이 아닙니다.
const DETAILS_SECTION_TEMPLATE = `
## 심화 참고 자료 (채점 대상 아님)
아래는 이 토픽에 딸린 심화 문서로, 코치인 당신의 배경지식입니다. 개념 분해와 채점, 마스터 판정은 위 원문만으로 정합니다. 학습자가 스스로 더 깊이 파고들거나 막혀서 더 정밀한 힌트가 필요할 때, 이 자료를 근거로 한 단계 깊은 질문이나 피드백을 주는 데 씁니다. 학습자가 이 내용을 몰라도 감점하거나 마스터를 막지 않습니다.

{DETAILS_CONTENT}
`;

export function buildSystemPrompt(topic: TopicNode, book: TopicBook, detailContent = ''): string {
  const content = loadTopicContent(topic);
  const profile = BOOK_PROFILES[book];
  const detailSection = detailContent.trim()
    ? DETAILS_SECTION_TEMPLATE.replace('{DETAILS_CONTENT}', detailContent)
    : '';
  return FEYNMAN_TEMPLATE
    .replace('{SUBJECT}', profile.subject)
    .replace('{AUDIENCE}', profile.audience)
    .replace('{PRIOR_KNOWLEDGE}', profile.priorKnowledge)
    .replace('{TOPIC_CONTENT}', content)
    .replace('{DETAILS_SECTION}', detailSection);
}

// 응답 형식은 프롬프트 문구 대신 CLI 구조화 출력(--json-schema)으로 보장합니다.
// 필드 의미는 description 으로 모델에 전달됩니다.
const MESSAGE_FIELD = {
  type: 'string',
  description:
    '학습자에게 그대로 보이는 코치 발화. 한국어 "~입니다" 체. 화면이 마크다운을 렌더하므로 코드는 ```kotlin 코드 블록, 식별자는 `백틱`으로 씀.',
};

export const START_SCHEMA = {
  type: 'object',
  properties: {
    message: MESSAGE_FIELD,
    concepts: {
      type: 'array',
      minItems: 3,
      maxItems: 5,
      description: '이 토픽의 핵심 개념 3~5개. 세션 내내 고정되는 채점 단위.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'c1, c2, ... 순서대로' },
          name: { type: 'string', description: '개념 이름' },
          criterion: { type: 'string', description: '완전한 답이 담아야 할 핵심을 한 줄로' },
        },
        required: ['id', 'name', 'criterion'],
        additionalProperties: false,
      },
    },
  },
  required: ['message', 'concepts'],
  additionalProperties: false,
} as const;

export const EVAL_SCHEMA = {
  type: 'object',
  properties: {
    message: MESSAGE_FIELD,
    scores: {
      type: 'array',
      description:
        '이번 답변이 실제로 다룬 개념마다 한 항목. 다루지 않은 개념은 넣지 않음. 응용 질문 답변만 있었다면 빈 배열.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '학습 시작 때 정한 개념 id' },
          score: { type: 'integer', minimum: 0, maximum: 5 },
        },
        required: ['id', 'score'],
        additionalProperties: false,
      },
    },
    integration_score: {
      type: ['integer', 'null'],
      minimum: 0,
      maximum: 5,
      description: '응용 질문에 대한 답변일 때만 0~5, 그 외에는 null',
    },
    next_focus: { type: 'string', description: '다음 단계 한 줄 요약. 예: "c3 경계 조건으로 이동", "c1 보강", "응용 질문 진입"' },
    mastered: { type: 'boolean', description: '모든 개념 3점 이상이고 응용 질문 답변이 4점 이상이면 true' },
  },
  required: ['message', 'scores', 'integration_score', 'next_focus', 'mastered'],
  additionalProperties: false,
} as const;

export interface ConceptSpec {
  id: string;
  name: string;
  criterion: string;
}

export interface ConceptScore {
  id: string;
  score: number;
}

export interface Evaluation {
  scores: ConceptScore[];
  integrationScore: number | null;
  nextFocus: string;
  mastered: boolean;
}

// ```json 펜스를 우선하되 언어 태그가 빠진 ``` 펜스도 허용합니다.
const FENCE_RE = /```(?:json)?\s*([\s\S]*?)\s*```/gi;
// 학습자에게 보이는 본문에서 제거할 JSON 신호 블록 (json 태그가 붙은 펜스만).
const JSON_FENCE_RE = /```json\s*[\s\S]*?```/gi;

function clampScore(n: number): number {
  const i = Math.round(n);
  if (i < 0) return 0;
  if (i > 5) return 5;
  return i;
}

function parseFencedObjects(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const m of text.matchAll(FENCE_RE)) {
    try {
      const parsed: unknown = JSON.parse(m[1] ?? '');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        out.push(parsed as Record<string, unknown>);
      }
    } catch {
      // 코드 예시 등 JSON 이 아닌 펜스는 건너뜁니다.
    }
  }
  return out;
}

function conceptsFromObject(obj: Record<string, unknown>): ConceptSpec[] | null {
  if (!Array.isArray(obj.concepts)) return null;
  const concepts: ConceptSpec[] = [];
  for (const raw of obj.concepts) {
    if (!raw || typeof raw !== 'object') continue;
    const c = raw as Record<string, unknown>;
    const id = typeof c.id === 'string' ? c.id.trim() : '';
    const name = typeof c.name === 'string' ? c.name.trim() : '';
    if (!id || !name) continue;
    concepts.push({ id, name, criterion: typeof c.criterion === 'string' ? c.criterion.trim() : '' });
  }
  return concepts.length > 0 ? concepts : null;
}

function evaluationFromObject(obj: Record<string, unknown>): Evaluation | null {
  if (!Array.isArray(obj.scores)) return null;
  const scores: ConceptScore[] = [];
  for (const raw of obj.scores) {
    if (!raw || typeof raw !== 'object') continue;
    const s = raw as Record<string, unknown>;
    if (typeof s.id === 'string' && typeof s.score === 'number') {
      scores.push({ id: s.id.trim(), score: clampScore(s.score) });
    }
  }
  return {
    scores,
    integrationScore:
      typeof obj.integration_score === 'number' ? clampScore(obj.integration_score) : null,
    nextFocus: typeof obj.next_focus === 'string' ? obj.next_focus : '',
    mastered: obj.mastered === true,
  };
}

/** 본문에 붙은 JSON 코드 블록에서 개념 목록을 추출합니다 (구조화 출력이 없을 때의 폴백). */
export function extractConceptList(text: string): ConceptSpec[] | null {
  // 신호 블록은 응답 맨 끝에 오므로 마지막 펜스부터 검사합니다.
  for (const obj of parseFencedObjects(text).reverse()) {
    const concepts = conceptsFromObject(obj);
    if (concepts) return concepts;
  }
  return null;
}

/** 본문에 붙은 JSON 코드 블록에서 채점 결과를 추출합니다 (구조화 출력이 없을 때의 폴백). */
export function extractEvaluation(text: string): Evaluation | null {
  for (const obj of parseFencedObjects(text).reverse()) {
    const evaluation = evaluationFromObject(obj);
    if (evaluation) return evaluation;
  }
  return null;
}

/** 구조화 출력(START_SCHEMA)을 개념 목록으로 변환합니다. 형식이 맞지 않으면 null. */
export function conceptsFromStructured(out: unknown): { message: string; concepts: ConceptSpec[] } | null {
  if (!out || typeof out !== 'object') return null;
  const o = out as Record<string, unknown>;
  if (typeof o.message !== 'string') return null;
  const concepts = conceptsFromObject(o);
  return concepts ? { message: o.message, concepts } : null;
}

/** 구조화 출력(EVAL_SCHEMA)을 평가 결과로 변환합니다. 형식이 맞지 않으면 null. */
export function evaluationFromStructured(out: unknown): { message: string; evaluation: Evaluation } | null {
  if (!out || typeof out !== 'object') return null;
  const o = out as Record<string, unknown>;
  if (typeof o.message !== 'string') return null;
  const evaluation = evaluationFromObject(o);
  return evaluation ? { message: o.message, evaluation } : null;
}

// 모델이 자기 턴을 끝내지 않고 다음 user/assistant 턴까지 이어서 생성하는
// "transcript runaway" 를 방어한다. --resume 된 히스토리에 매 user 턴마다 형식
// reminder 가 쌓이면, 모델이 "user … reminder … assistant" 패턴을 모방해 가짜
// 후속 턴(가짜 사용자 답변·reminder 재현·다음 코치 응답)을 한 응답에 토해낸다.
// 관측된 누출 신호:
//   - "\n\nuser…" / "\n\nassistant…" 처럼 역할 토큰이 본문에 공백 없이 글루됨
//   - user 메시지에 우리가 덧붙인 reminder("[필수] 위 … 작성한 뒤")가 출력에 재등장
// 가장 앞선 신호 위치에서 잘라 첫 번째(진짜) 코치 턴만 남긴다.
//
// 오탐 방지: 역할 토큰은 단락 경계(\n\n) 뒤에 공백 없이 본문과 붙은 경우만 본다.
// "user experience" 같은 산문은 뒤에 공백이 와서 매치되지 않는다.
const RUNAWAY_MARKERS: RegExp[] = [
  /\n[ \t]*\n(?:user|assistant|human|system|시스템)(?=[^\s])/i,
  /\n[ \t]*\n-{3,}[ \t]*\n+\[필수\]/,
  /\[필수\] 위 (?:코칭 응답|안내문)을 작성한 뒤/,
];

export interface RunawayResult {
  text: string;
  truncated: boolean;
}

/**
 * 모델 출력에서 환각으로 이어붙인 후속 턴을 잘라낸다. 누출 신호가 없으면 원문 그대로.
 * 추출·표시·저장보다 먼저 적용해 가짜 턴의 JSON·텍스트가 상태를 오염시키지 못하게 한다.
 */
export function truncateRunaway(text: string): RunawayResult {
  let cut = text.length;
  for (const re of RUNAWAY_MARKERS) {
    const m = text.match(re);
    if (m && m.index !== undefined && m.index < cut) cut = m.index;
  }
  if (cut >= text.length) return { text, truncated: false };
  return { text: text.slice(0, cut).trimEnd(), truncated: true };
}

/** 학습자에게 보이는 코치 메시지에서 도구 신호용 JSON 블록을 제거합니다. */
export function stripCoachJson(text: string): string {
  return text
    .replace(JSON_FENCE_RE, '')
    .replace(/\n*---[ \t]*\n*\s*$/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}
