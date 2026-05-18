import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';

const DEFAULT_DB_PATH = resolve(import.meta.dirname, '../data/progress.db');
const DB_PATH = process.env.MAFT_DB_PATH ? resolve(process.env.MAFT_DB_PATH) : DEFAULT_DB_PATH;

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    topic_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_score INTEGER,
    last_missed TEXT,
    last_next_focus TEXT,
    mastered INTEGER NOT NULL DEFAULT 0,
    claude_session_id TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_topic_id ON sessions(topic_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at DESC);

  CREATE TABLE IF NOT EXISTS turns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    text TEXT NOT NULL,
    score INTEGER,
    missed_concepts TEXT,
    next_focus TEXT,
    mastered INTEGER,
    ts INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_turns_session_id ON turns(session_id);
  CREATE INDEX IF NOT EXISTS idx_turns_ts ON turns(ts);

  CREATE TABLE IF NOT EXISTS concept_misses (
    topic_id TEXT NOT NULL,
    concept TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    last_seen_at INTEGER NOT NULL,
    PRIMARY KEY (topic_id, concept)
  );

  CREATE INDEX IF NOT EXISTS idx_concept_misses_count ON concept_misses(count DESC);
`);

// 멱등 마이그레이션: 기존 DB 에 claude_session_id 컬럼이 없으면 추가하고 id 값으로 백필합니다.
// 새 DB 는 CREATE TABLE 단계에서 이미 컬럼이 들어가 있으므로 ALTER 가 도지 않습니다.
{
  const cols = db.prepare(`PRAGMA table_info(sessions)`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'claude_session_id')) {
    db.exec(`ALTER TABLE sessions ADD COLUMN claude_session_id TEXT`);
    db.exec(`UPDATE sessions SET claude_session_id = id WHERE claude_session_id IS NULL`);
  }
}

export function dbPath(): string {
  return DB_PATH;
}
