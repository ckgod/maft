export type TopicKind = 'category' | 'question' | 'detail' | 'extra';

export interface Topic {
  id: string;
  title: string;
  kind: TopicKind;
  depth: number;
  parentId: string | null;
}

export interface Rubric {
  score: number;
  missedConcepts: string[];
  nextFocus: string;
  mastered: boolean;
}

export interface SessionTurn {
  role: 'assistant' | 'user';
  text: string;
  rubric: Rubric | null;
  ts: number;
}

export interface SessionStartResponse {
  sessionId: string;
  topicId: string;
  topicTitle: string;
  message: string;
  rubric: Rubric | null;
  mastered: boolean;
}

export interface SessionMessageResponse {
  sessionId: string;
  topicId: string;
  message: string;
  rubric: Rubric | null;
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

export async function listTopics(): Promise<Topic[]> {
  const r = await fetchJson<{ topics: Topic[] }>('/api/topics');
  return r.topics;
}

export async function startSession(topicId: string): Promise<SessionStartResponse> {
  return fetchJson<SessionStartResponse>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ topicId }),
  });
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
