import { db } from './db.js';
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

interface SessionRow {
  id: string;
  topic_id: string;
  created_at: number;
  updated_at: number;
  last_score: number | null;
  last_missed: string | null;
  last_next_focus: string | null;
  mastered: number;
}

interface TurnRow {
  id: number;
  session_id: string;
  role: string;
  text: string;
  score: number | null;
  missed_concepts: string | null;
  next_focus: string | null;
  mastered: number | null;
  ts: number;
}

const insertSessionStmt = db.prepare(`
  INSERT INTO sessions (id, topic_id, created_at, updated_at, last_score, last_missed, last_next_focus, mastered)
  VALUES (@id, @topic_id, @created_at, @updated_at, @last_score, @last_missed, @last_next_focus, @mastered)
`);

const updateSessionStmt = db.prepare(`
  UPDATE sessions
  SET updated_at = @updated_at,
      last_score = @last_score,
      last_missed = @last_missed,
      last_next_focus = @last_next_focus,
      mastered = @mastered
  WHERE id = @id
`);

const insertTurnStmt = db.prepare(`
  INSERT INTO turns (session_id, role, text, score, missed_concepts, next_focus, mastered, ts)
  VALUES (@session_id, @role, @text, @score, @missed_concepts, @next_focus, @mastered, @ts)
`);

const selectSessionStmt = db.prepare(`SELECT * FROM sessions WHERE id = ?`);

const selectTurnsStmt = db.prepare(
  `SELECT * FROM turns WHERE session_id = ? ORDER BY ts ASC, id ASC`,
);

const listSessionsStmt = db.prepare(`SELECT * FROM sessions ORDER BY created_at DESC`);

const latestSessionByTopicStmt = db.prepare(
  `SELECT * FROM sessions WHERE topic_id = ? ORDER BY updated_at DESC, created_at DESC LIMIT 1`,
);

const deleteSessionsByTopicStmt = db.prepare(`DELETE FROM sessions WHERE topic_id = ?`);

function rubricFromColumns(
  score: number | null,
  missedJson: string | null,
  nextFocus: string | null,
  mastered: number | null,
): RubricResult | null {
  if (score === null) return null;
  let missed: string[] = [];
  if (missedJson) {
    try {
      const parsed = JSON.parse(missedJson) as unknown;
      if (Array.isArray(parsed)) missed = parsed.filter((x): x is string => typeof x === 'string');
    } catch {
      // ignore
    }
  }
  return {
    score,
    missedConcepts: missed,
    nextFocus: nextFocus ?? '',
    mastered: mastered === 1,
  };
}

function rowToSession(row: SessionRow): Session {
  const turns = selectTurnsStmt.all(row.id) as TurnRow[];
  const history: SessionTurn[] = turns.map((t) => ({
    role: t.role === 'user' ? 'user' : 'assistant',
    text: t.text,
    rubric: rubricFromColumns(t.score, t.missed_concepts, t.next_focus, t.mastered),
    ts: t.ts,
  }));
  return {
    id: row.id,
    topicId: row.topic_id,
    createdAt: row.created_at,
    history,
    lastRubric: rubricFromColumns(row.last_score, row.last_missed, row.last_next_focus, row.mastered),
    mastered: row.mastered === 1,
  };
}

export function getSession(id: string): Session | undefined {
  const row = selectSessionStmt.get(id) as SessionRow | undefined;
  if (!row) return undefined;
  return rowToSession(row);
}

export function listSessions(): Session[] {
  const rows = listSessionsStmt.all() as SessionRow[];
  return rows.map(rowToSession);
}

export function getLatestSessionByTopic(topicId: string): Session | undefined {
  const row = latestSessionByTopicStmt.get(topicId) as SessionRow | undefined;
  if (!row) return undefined;
  return rowToSession(row);
}

/**
 * 토픽에 속한 모든 세션 행을 삭제합니다. turns 는 FK CASCADE 로 함께 정리됩니다.
 * 호출자가 트랜잭션으로 묶어 다른 토픽 단위 데이터(concept_misses 등)와 함께 일괄 처리하는 것을 권장합니다.
 */
export function deleteSessionsByTopic(topicId: string): number {
  const info = deleteSessionsByTopicStmt.run(topicId);
  return Number(info.changes);
}

export interface NewSessionParams {
  id: string;
  topicId: string;
  createdAt: number;
  initialAssistantText: string;
}

export function createSession(p: NewSessionParams): Session {
  const tx = db.transaction(() => {
    insertSessionStmt.run({
      id: p.id,
      topic_id: p.topicId,
      created_at: p.createdAt,
      updated_at: p.createdAt,
      last_score: null,
      last_missed: null,
      last_next_focus: null,
      mastered: 0,
    });
    insertTurnStmt.run({
      session_id: p.id,
      role: 'assistant',
      text: p.initialAssistantText,
      score: null,
      missed_concepts: null,
      next_focus: null,
      mastered: null,
      ts: p.createdAt,
    });
  });
  tx();
  const created = getSession(p.id);
  if (!created) throw new Error(`createSession: failed to read back ${p.id}`);
  return created;
}

export function appendTurn(sessionId: string, turn: SessionTurn): void {
  const rubric = turn.rubric;
  insertTurnStmt.run({
    session_id: sessionId,
    role: turn.role,
    text: turn.text,
    score: rubric?.score ?? null,
    missed_concepts: rubric ? JSON.stringify(rubric.missedConcepts) : null,
    next_focus: rubric?.nextFocus ?? null,
    mastered: rubric ? (rubric.mastered ? 1 : 0) : null,
    ts: turn.ts,
  });
}

export interface SessionMetaUpdate {
  updatedAt: number;
  lastRubric?: RubricResult | null;
  mastered?: boolean;
}

export function updateSessionMeta(sessionId: string, opts: SessionMetaUpdate): void {
  const row = selectSessionStmt.get(sessionId) as SessionRow | undefined;
  if (!row) return;
  const lastScore =
    opts.lastRubric === undefined ? row.last_score : (opts.lastRubric?.score ?? null);
  const lastMissed =
    opts.lastRubric === undefined
      ? row.last_missed
      : opts.lastRubric
        ? JSON.stringify(opts.lastRubric.missedConcepts)
        : null;
  const lastNextFocus =
    opts.lastRubric === undefined ? row.last_next_focus : (opts.lastRubric?.nextFocus ?? null);
  const masteredFlag =
    opts.mastered === undefined ? row.mastered : opts.mastered ? 1 : 0;
  updateSessionStmt.run({
    id: sessionId,
    updated_at: opts.updatedAt,
    last_score: lastScore,
    last_missed: lastMissed,
    last_next_focus: lastNextFocus,
    mastered: masteredFlag,
  });
}
