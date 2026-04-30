import { useEffect, useMemo, useState } from 'react';
import {
  listTopics,
  startSession,
  type SessionStartResponse,
  type Topic,
} from './api';
import { SessionView } from './SessionView';
import './App.css';

function shortId(id: string): string {
  return id.replace(/\.md$/, '');
}

type AppMode =
  | { kind: 'list' }
  | { kind: 'starting'; topicId: string }
  | { kind: 'session'; data: SessionStartResponse };

export default function App() {
  const [topics, setTopics] = useState<Topic[] | null>(null);
  const [topicsError, setTopicsError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [mode, setMode] = useState<AppMode>({ kind: 'list' });
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    listTopics()
      .then((ts) => setTopics(ts))
      .catch((e) => setTopicsError(e instanceof Error ? e.message : String(e)));
  }, []);

  const filtered = useMemo(() => {
    if (!topics) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return topics;
    return topics.filter((t) => t.id.toLowerCase().includes(q) || t.title.toLowerCase().includes(q));
  }, [topics, filter]);

  async function handleSelectTopic(topicId: string) {
    if (mode.kind === 'starting') return;
    setStartError(null);
    setMode({ kind: 'starting', topicId });
    try {
      const data = await startSession(topicId);
      setMode({ kind: 'session', data });
    } catch (e) {
      setStartError(e instanceof Error ? e.message : String(e));
      setMode({ kind: 'list' });
    }
  }

  if (mode.kind === 'session') {
    return (
      <div className="app app-session">
        <SessionView initial={mode.data} onExit={() => setMode({ kind: 'list' })} />
      </div>
    );
  }

  return (
    <div className="app">
      <header className="masthead">
        <div className="masthead-row">
          <span className="eyebrow">Vol. 01 · Phase 1</span>
          <span className="eyebrow">Feynman Coach</span>
        </div>
        <div className="masthead-body">
          <h1 className="masthead-title">
            M<em>A</em>FT
          </h1>
          <p className="masthead-lede">
            <span className="masthead-fullname">Manifest Android Feynman Trainer</span>
            <span className="masthead-sep">·</span>
            토픽을 자기 말로 풀어내며 코치의 소크라테스식 역질문으로 이해의 격차를 메우는 학습 도구.
          </p>
        </div>
      </header>

      <main className="main">
        {topicsError ? (
          <div className="status status-error">
            <span className="eyebrow status-tag">Connection error</span>
            <p>{topicsError}</p>
            <p className="hint">server 패키지가 실행 중인지 확인하십시오 (포트 3001).</p>
          </div>
        ) : !topics ? (
          <div className="status">
            <span className="eyebrow status-tag">Indexing</span>
            <p>토픽 목록을 불러오는 중입니다…</p>
          </div>
        ) : (
          <section className="index-view">
            <div className="index-head">
              <span className="eyebrow">Table of contents</span>
              <h2 className="index-title">학습할 토픽을 선택하세요</h2>
              <div className="index-meta">
                <span className="index-count">
                  <em>{topics.length}</em> entries
                </span>
                <input
                  className="index-search"
                  placeholder="검색 — Context, Compose, Coroutine…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </div>
            </div>

            {startError && (
              <div className="status status-error">
                <span className="eyebrow status-tag">세션 시작 실패</span>
                <p>{startError}</p>
              </div>
            )}

            {filtered.length === 0 ? (
              <p className="status">검색 결과가 없습니다.</p>
            ) : (
              <ol className="index-list">
                {filtered.map((t, i) => {
                  const starting = mode.kind === 'starting' && mode.topicId === t.id;
                  const num = String(i + 1).padStart(2, '0');
                  return (
                    <li
                      key={t.id}
                      className={`index-row kind-${t.kind}${starting ? ' is-starting' : ''}`}
                      onClick={() => handleSelectTopic(t.id)}
                    >
                      <span className="row-num">{num}</span>
                      <span className="row-id">{shortId(t.id)}</span>
                      <span className="row-title">{t.title}</span>
                      <span className="row-status">
                        {starting ? 'Starting…' : t.kind === 'extra' ? 'Extra' : 'Question'}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
