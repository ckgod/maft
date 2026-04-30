import type { RubricResult } from './prompt.js';

export interface SessionTurn {
  role: 'assistant' | 'user';
  text: string;
  rubric: RubricResult | null;
  ts: number;
}

export interface Session {
  id: string;
  topicId: string;
  createdAt: number;
  history: SessionTurn[];
  lastRubric: RubricResult | null;
  mastered: boolean;
}

const sessions = new Map<string, Session>();

export function getSession(id: string): Session | undefined {
  return sessions.get(id);
}

export function saveSession(s: Session): void {
  sessions.set(s.id, s);
}

export function listSessions(): Session[] {
  return [...sessions.values()].sort((a, b) => b.createdAt - a.createdAt);
}
