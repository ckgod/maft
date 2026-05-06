import { db } from './db.js';

export interface TopicStats {
  attempts: number;
  bestScore: number | null;
  lastScore: number | null;
  mastered: boolean;
  lastAttemptedAt: number | null;
}

export interface WeakPointRow {
  topicId: string;
  concept: string;
  count: number;
  lastSeenAt: number;
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

const upsertConceptMissStmt = db.prepare(`
  INSERT INTO concept_misses (topic_id, concept, count, last_seen_at)
  VALUES (@topic_id, @concept, 1, @ts)
  ON CONFLICT(topic_id, concept) DO UPDATE SET
    count = count + 1,
    last_seen_at = excluded.last_seen_at
`);

const weakPointsStmt = db.prepare(`
  SELECT topic_id, concept, count, last_seen_at
  FROM concept_misses
  ORDER BY count DESC, last_seen_at DESC
  LIMIT ?
`);

interface WeakPointSqlRow {
  topic_id: string;
  concept: string;
  count: number;
  last_seen_at: number;
}

function normalizeConcept(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function recordMissedConcepts(
  topicId: string,
  concepts: string[],
  at: number,
): void {
  if (concepts.length === 0) return;
  const seen = new Set<string>();
  const tx = db.transaction(() => {
    for (const raw of concepts) {
      const concept = normalizeConcept(raw);
      if (!concept || seen.has(concept)) continue;
      seen.add(concept);
      upsertConceptMissStmt.run({ topic_id: topicId, concept, ts: at });
    }
  });
  tx();
}

export function getWeakPoints(limit = 10): WeakPointRow[] {
  const rows = weakPointsStmt.all(limit) as WeakPointSqlRow[];
  return rows.map((r) => ({
    topicId: r.topic_id,
    concept: r.concept,
    count: r.count,
    lastSeenAt: r.last_seen_at,
  }));
}

const topicMissedConceptsStmt = db.prepare(
  `SELECT topic_id, concept, count, last_seen_at
   FROM concept_misses
   WHERE topic_id = ?
   ORDER BY count DESC, last_seen_at DESC
   LIMIT ?`,
);

export function getMissedConceptsForTopic(
  topicId: string,
  limit = 5,
): WeakPointRow[] {
  const rows = topicMissedConceptsStmt.all(topicId, limit) as WeakPointSqlRow[];
  return rows.map((r) => ({
    topicId: r.topic_id,
    concept: r.concept,
    count: r.count,
    lastSeenAt: r.last_seen_at,
  }));
}
