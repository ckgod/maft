import { db } from './db.js';

export interface TopicStats {
  attempts: number;
  bestScore: number | null;
  lastScore: number | null;
  mastered: boolean;
  lastAttemptedAt: number | null;
}

interface TopicStatsRow {
  topic_id: string;
  attempts: number;
  best_score: number | null;
  last_score: number | null;
  mastered: number;
  last_attempted_at: number;
}

const topicStatsStmt = db.prepare(`
  WITH ranked AS (
    SELECT
      topic_id,
      last_score,
      mastered,
      updated_at,
      ROW_NUMBER() OVER (PARTITION BY topic_id ORDER BY updated_at DESC, id DESC) AS rn
    FROM sessions
  )
  SELECT
    s.topic_id AS topic_id,
    COUNT(*) AS attempts,
    MAX(s.last_score) AS best_score,
    (SELECT last_score FROM ranked r WHERE r.topic_id = s.topic_id AND r.rn = 1) AS last_score,
    MAX(s.mastered) AS mastered,
    MAX(s.updated_at) AS last_attempted_at
  FROM sessions s
  GROUP BY s.topic_id
`);

export function getTopicStatsMap(): Map<string, TopicStats> {
  const rows = topicStatsStmt.all() as TopicStatsRow[];
  const map = new Map<string, TopicStats>();
  for (const r of rows) {
    map.set(r.topic_id, {
      attempts: r.attempts,
      bestScore: r.best_score,
      lastScore: r.last_score,
      mastered: r.mastered === 1,
      lastAttemptedAt: r.last_attempted_at,
    });
  }
  return map;
}
