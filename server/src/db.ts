import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';

const DEFAULT_DB_PATH = resolve(import.meta.dirname, '../data/progress.db');
const DB_PATH = process.env.MAFT_DB_PATH ? resolve(process.env.MAFT_DB_PATH) : DEFAULT_DB_PATH;

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Tier 2 스키마 — 채점 단위가 "턴" 이 아니라 "개념" 입니다.
// - sessions: 세션 메타 + 통합 단계 점수 + 마스터 여부 (마스터는 서버가 데이터로 계산)
// - concepts: 세션별 핵심 개념 체크리스트. best_score 가 그 개념의 누적 최고 점수.
// - turns: 대화 기록. turn_score 는 sparkline 용 대표 점수, eval_json 은 그 턴 평가 원본.
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    topic_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    claude_session_id TEXT,
    next_focus TEXT,
    integration_score INTEGER,
    mastered INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_topic_id ON sessions(topic_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at DESC);

  CREATE TABLE IF NOT EXISTS concepts (
    session_id TEXT NOT NULL,
    concept_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    name TEXT NOT NULL,
    criterion TEXT NOT NULL,
    best_score INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (session_id, concept_id),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_concepts_session ON concepts(session_id);

  CREATE TABLE IF NOT EXISTS turns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    text TEXT NOT NULL,
    turn_score INTEGER,
    eval_json TEXT,
    ts INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_turns_session_id ON turns(session_id);
  CREATE INDEX IF NOT EXISTS idx_turns_ts ON turns(ts);
`);

export function dbPath(): string {
  return DB_PATH;
}
