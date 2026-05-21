import { db } from './db.js';

export interface TopicStats {
  attempts: number;
  mastered: boolean;
  /** 개념 중 3점 이상 달성한 개수 (가장 잘한 세션 기준). */
  bestCleared: number;
  /** 위 세션의 총 개념 수. */
  bestTotal: number;
  lastAttemptedAt: number | null;
}

export interface WeakPointRow {
  topicId: string;
  concept: string;
  bestScore: number;
  lastSeenAt: number;
}

interface SessionAggRow {
  topic_id: string;
  mastered: number;
  updated_at: number;
  total: number;
  cleared: number;
}

// 세션 단위로 (총 개념 수 · 3점 이상 달성 수) 를 집계합니다.
const sessionAggStmt = db.prepare(`
  SELECT
    s.topic_id AS topic_id,
    s.mastered AS mastered,
    s.updated_at AS updated_at,
    COUNT(c.concept_id) AS total,
    COALESCE(SUM(CASE WHEN c.best_score >= 3 THEN 1 ELSE 0 END), 0) AS cleared
  FROM sessions s
  LEFT JOIN concepts c ON c.session_id = s.id
  GROUP BY s.id
`);

export function getTopicStatsMap(): Map<string, TopicStats> {
  const rows = sessionAggStmt.all() as SessionAggRow[];
  const map = new Map<string, TopicStats>();
  for (const r of rows) {
    const prev = map.get(r.topic_id);
    if (!prev) {
      map.set(r.topic_id, {
        attempts: 1,
        mastered: r.mastered === 1,
        bestCleared: r.cleared,
        bestTotal: r.total,
        lastAttemptedAt: r.updated_at,
      });
      continue;
    }
    prev.attempts += 1;
    prev.mastered = prev.mastered || r.mastered === 1;
    prev.lastAttemptedAt = Math.max(prev.lastAttemptedAt ?? 0, r.updated_at);
    // "가장 잘한 세션" = 달성 개념 수가 가장 많은 세션 (동률이면 총 개념 수가 많은 쪽).
    if (r.cleared > prev.bestCleared || (r.cleared === prev.bestCleared && r.total > prev.bestTotal)) {
      prev.bestCleared = r.cleared;
      prev.bestTotal = r.total;
    }
  }
  return map;
}

// 전역 약점 — 아직 3점 미만인 개념을 토픽·개념명으로 묶어 약한 순으로 보여줍니다.
const weakPointsStmt = db.prepare(`
  SELECT
    s.topic_id AS topic_id,
    c.name AS concept,
    MIN(c.best_score) AS best_score,
    MAX(s.updated_at) AS last_seen_at
  FROM concepts c
  JOIN sessions s ON s.id = c.session_id
  WHERE c.best_score < 3
  GROUP BY s.topic_id, c.name
  ORDER BY best_score ASC, last_seen_at DESC
  LIMIT ?
`);

interface WeakPointSqlRow {
  topic_id: string;
  concept: string;
  best_score: number;
  last_seen_at: number;
}

export function getWeakPoints(limit = 10): WeakPointRow[] {
  const rows = weakPointsStmt.all(limit) as WeakPointSqlRow[];
  return rows.map((r) => ({
    topicId: r.topic_id,
    concept: r.concept,
    bestScore: r.best_score,
    lastSeenAt: r.last_seen_at,
  }));
}
