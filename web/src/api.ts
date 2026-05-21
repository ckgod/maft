export type TopicKind = 'category' | 'question' | 'detail' | 'extra';

export interface TopicStats {
  attempts: number;
  mastered: boolean;
  /** 3점 이상 달성한 개념 수 (가장 잘한 세션 기준). */
  bestCleared: number;
  /** 그 세션의 총 개념 수. */
  bestTotal: number;
}

export interface Topic {
  id: string;
  title: string;
  kind: TopicKind;
  depth: number;
  parentId: string | null;
  stats: TopicStats;
}

export interface Category {
  id: string;
  title: string;
  depth: number;
  parentId: string | null;
}

export interface TopicsResponse {
  topics: Topic[];
  categories: Category[];
}

/** 세션의 핵심 개념 한 건. best_score 가 누적 최고 점수 (0 = 미착수). */
export interface SessionConcept {
  id: string;
  ordinal: number;
  name: string;
  criterion: string;
  bestScore: number;
}

export interface SessionTurn {
  role: 'assistant' | 'user';
  text: string;
  turnScore: number | null;
  ts: number;
}

export interface SessionStartResponse {
  sessionId: string;
  topicId: string;
  topicTitle: string;
  message: string;
  concepts: SessionConcept[];
  integrationScore: number | null;
  nextFocus: string;
  mastered: boolean;
  /** 재개일 때만 채워집니다 (opening 메시지 포함 누적 turn). */
  turns?: SessionTurn[];
}

export interface SessionMessageResponse {
  sessionId: string;
  topicId: string;
  message: string;
  concepts: SessionConcept[];
  integrationScore: number | null;
  nextFocus: string;
  mastered: boolean;
}

async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}${text ? `: ${text}` : ''}`);
  }
  return res.json() as Promise<T>;
}

export async function listTopics(): Promise<TopicsResponse> {
  return fetchJson<TopicsResponse>('/api/topics');
}

export interface WeakPoint {
  topicId: string;
  topicTitle: string;
  concept: string;
  /** 그 개념의 누적 최고 점수 (3 미만이라 약점으로 노출됨). */
  bestScore: number;
  lastSeenAt: number;
}

export interface WeakPointsResponse {
  weakPoints: WeakPoint[];
}

export async function listWeakPoints(limit = 8): Promise<WeakPointsResponse> {
  return fetchJson<WeakPointsResponse>(`/api/weak-points?limit=${limit}`);
}

export async function startSession(topicId: string): Promise<SessionStartResponse> {
  return fetchJson<SessionStartResponse>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ topicId }),
  });
}

export interface TopicResetResponse {
  topicId: string;
  deleted: { sessions: number };
}

/**
 * 토픽 단위 학습 데이터(세션·개념·turns)를 모두 삭제합니다.
 * "새 세션" 흐름에서 깨끗한 상태로 다시 시작할 때 호출합니다.
 */
export async function resetTopic(topicId: string): Promise<TopicResetResponse> {
  return fetchJson<TopicResetResponse>(`/api/topics/${encodeURIComponent(topicId)}/data`, {
    method: 'DELETE',
  });
}

/**
 * 해당 토픽의 직전 세션을 가져옵니다. 없으면 null 을 돌려줍니다 (404 를 정상 흐름으로 흡수).
 */
export async function getLastSessionForTopic(
  topicId: string,
): Promise<SessionStartResponse | null> {
  const res = await fetch(`/api/topics/${encodeURIComponent(topicId)}/last-session`, {
    headers: { 'Content-Type': 'application/json' },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}${text ? `: ${text}` : ''}`);
  }
  return res.json() as Promise<SessionStartResponse>;
}

export async function sendMessage(
  sessionId: string,
  message: string,
): Promise<SessionMessageResponse> {
  return fetchJson<SessionMessageResponse>(`/api/sessions/${sessionId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
}
