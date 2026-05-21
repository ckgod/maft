import { db } from './db.js';
import type { ConceptSpec, Evaluation } from './prompt.js';

export interface SessionTurn {
  role: 'assistant' | 'user';
  text: string;
  /** sparkline 용 대표 점수 (그 턴 평가에서 가장 높은 개념 점수). user 턴·시작 멘트는 null. */
  turnScore: number | null;
  ts: number;
}

export interface SessionConcept {
  id: string;
  ordinal: number;
  name: string;
  criterion: string;
  /** 세션 누적 최고 점수. 0 = 아직 다뤄지지 않음. */
  bestScore: number;
}

export interface Session {
  id: string;
  topicId: string;
  createdAt: number;
  updatedAt: number;
  history: SessionTurn[];
  concepts: SessionConcept[];
  integrationScore: number | null;
  nextFocus: string;
  mastered: boolean;
  /** claude CLI 측 세션 ID. --resume 인자로 넘깁니다. 초기엔 id 와 같고, claude 가 새 ID 를 돌려주면 갱신됩니다. */
  claudeSessionId: string;
}

interface SessionRow {
  id: string;
  topic_id: string;
  created_at: number;
  updated_at: number;
  claude_session_id: string | null;
  next_focus: string | null;
  integration_score: number | null;
  mastered: number;
}

interface ConceptRow {
  concept_id: string;
  ordinal: number;
  name: string;
  criterion: string;
  best_score: number;
}

interface TurnRow {
  role: string;
  text: string;
  turn_score: number | null;
  ts: number;
}

const insertSessionStmt = db.prepare(`
  INSERT INTO sessions (id, topic_id, created_at, updated_at, claude_session_id, next_focus, integration_score, mastered)
  VALUES (@id, @topic_id, @created_at, @updated_at, @claude_session_id, NULL, NULL, 0)
`);

const insertConceptStmt = db.prepare(`
  INSERT INTO concepts (session_id, concept_id, ordinal, name, criterion, best_score)
  VALUES (@session_id, @concept_id, @ordinal, @name, @criterion, 0)
`);

const insertTurnStmt = db.prepare(`
  INSERT INTO turns (session_id, role, text, turn_score, eval_json, ts)
  VALUES (@session_id, @role, @text, @turn_score, @eval_json, @ts)
`);

const updateClaudeSessionIdStmt = db.prepare(
  `UPDATE sessions SET claude_session_id = @claude_session_id WHERE id = @id`,
);

const bumpConceptScoreStmt = db.prepare(`
  UPDATE concepts SET best_score = MAX(best_score, @score)
  WHERE session_id = @session_id AND concept_id = @concept_id
`);

const updateSessionProgressStmt = db.prepare(`
  UPDATE sessions
  SET updated_at = @updated_at,
      next_focus = @next_focus,
      integration_score = @integration_score,
      mastered = @mastered
  WHERE id = @id
`);

const selectSessionStmt = db.prepare(`SELECT * FROM sessions WHERE id = ?`);
const selectConceptsStmt = db.prepare(
  `SELECT concept_id, ordinal, name, criterion, best_score FROM concepts WHERE session_id = ? ORDER BY ordinal ASC`,
);
const selectTurnsStmt = db.prepare(
  `SELECT role, text, turn_score, ts FROM turns WHERE session_id = ? ORDER BY ts ASC, id ASC`,
);
const listSessionsStmt = db.prepare(`SELECT * FROM sessions ORDER BY created_at DESC`);
const latestSessionByTopicStmt = db.prepare(
  `SELECT * FROM sessions WHERE topic_id = ? ORDER BY updated_at DESC, created_at DESC LIMIT 1`,
);
const deleteSessionsByTopicStmt = db.prepare(`DELETE FROM sessions WHERE topic_id = ?`);

function rowToSession(row: SessionRow): Session {
  const conceptRows = selectConceptsStmt.all(row.id) as ConceptRow[];
  const turnRows = selectTurnsStmt.all(row.id) as TurnRow[];
  return {
    id: row.id,
    topicId: row.topic_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    history: turnRows.map((t) => ({
      role: t.role === 'user' ? 'user' : 'assistant',
      text: t.text,
      turnScore: t.turn_score,
      ts: t.ts,
    })),
    concepts: conceptRows.map((c) => ({
      id: c.concept_id,
      ordinal: c.ordinal,
      name: c.name,
      criterion: c.criterion,
      bestScore: c.best_score,
    })),
    integrationScore: row.integration_score,
    nextFocus: row.next_focus ?? '',
    mastered: row.mastered === 1,
    claudeSessionId: row.claude_session_id ?? row.id,
  };
}

export function getSession(id: string): Session | undefined {
  const row = selectSessionStmt.get(id) as SessionRow | undefined;
  return row ? rowToSession(row) : undefined;
}

export function listSessions(): Session[] {
  return (listSessionsStmt.all() as SessionRow[]).map(rowToSession);
}

export function getLatestSessionByTopic(topicId: string): Session | undefined {
  const row = latestSessionByTopicStmt.get(topicId) as SessionRow | undefined;
  return row ? rowToSession(row) : undefined;
}

/**
 * 토픽에 속한 모든 세션 행을 삭제합니다. concepts·turns 는 FK CASCADE 로 함께 정리됩니다.
 */
export function deleteSessionsByTopic(topicId: string): number {
  return Number(deleteSessionsByTopicStmt.run(topicId).changes);
}

export interface NewSessionParams {
  id: string;
  topicId: string;
  createdAt: number;
  initialAssistantText: string;
  claudeSessionId: string;
  concepts: ConceptSpec[];
}

export function createSession(p: NewSessionParams): Session {
  const tx = db.transaction(() => {
    insertSessionStmt.run({
      id: p.id,
      topic_id: p.topicId,
      created_at: p.createdAt,
      updated_at: p.createdAt,
      claude_session_id: p.claudeSessionId,
    });
    insertTurnStmt.run({
      session_id: p.id,
      role: 'assistant',
      text: p.initialAssistantText,
      turn_score: null,
      eval_json: null,
      ts: p.createdAt,
    });
    p.concepts.forEach((c, i) => {
      insertConceptStmt.run({
        session_id: p.id,
        concept_id: c.id,
        ordinal: i,
        name: c.name,
        criterion: c.criterion,
      });
    });
  });
  tx();
  const created = getSession(p.id);
  if (!created) throw new Error(`createSession: failed to read back ${p.id}`);
  return created;
}

/**
 * claude CLI 의 응답 session_id 가 우리가 보낸 값과 다를 때 갱신합니다.
 * 우리 DB 의 sessions.id (PK) 는 절대 바꾸지 않고 claude_session_id 컬럼만 동기화합니다.
 */
export function updateClaudeSessionId(sessionId: string, claudeSessionId: string): void {
  updateClaudeSessionIdStmt.run({ id: sessionId, claude_session_id: claudeSessionId });
}

export interface NewTurn {
  role: 'assistant' | 'user';
  text: string;
  turnScore: number | null;
  evalJson: string | null;
  ts: number;
}

export function appendTurn(sessionId: string, turn: NewTurn): void {
  insertTurnStmt.run({
    session_id: sessionId,
    role: turn.role,
    text: turn.text,
    turn_score: turn.turnScore,
    eval_json: turn.evalJson,
    ts: turn.ts,
  });
}

const MASTER_CONCEPT_THRESHOLD = 3;
const MASTER_INTEGRATION_THRESHOLD = 4;

/**
 * 평가 결과를 세션에 반영합니다 — 개념별 best_score 갱신, 통합 점수 누적,
 * next_focus 저장, 마스터 여부를 데이터로 재계산. 갱신된 Session 을 반환합니다.
 */
export function applyEvaluation(sessionId: string, evaluation: Evaluation, ts: number): Session {
  const tx = db.transaction(() => {
    for (const s of evaluation.scores) {
      bumpConceptScoreStmt.run({ session_id: sessionId, concept_id: s.id, score: s.score });
    }
    const row = selectSessionStmt.get(sessionId) as SessionRow | undefined;
    if (!row) return;
    // 통합 점수는 누적 최고치로 유지합니다 (재시도 시 떨어지지 않게).
    const integrationScore =
      evaluation.integrationScore === null
        ? row.integration_score
        : Math.max(row.integration_score ?? 0, evaluation.integrationScore);
    const concepts = selectConceptsStmt.all(sessionId) as ConceptRow[];
    const allConceptsCleared =
      concepts.length > 0 && concepts.every((c) => c.best_score >= MASTER_CONCEPT_THRESHOLD);
    const mastered =
      allConceptsCleared &&
      integrationScore !== null &&
      integrationScore >= MASTER_INTEGRATION_THRESHOLD;
    updateSessionProgressStmt.run({
      id: sessionId,
      updated_at: ts,
      next_focus: evaluation.nextFocus || row.next_focus,
      integration_score: integrationScore,
      mastered: mastered ? 1 : 0,
    });
  });
  tx();
  const updated = getSession(sessionId);
  if (!updated) throw new Error(`applyEvaluation: session ${sessionId} not found`);
  return updated;
}
