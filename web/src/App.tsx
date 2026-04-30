import { useEffect, useMemo, useState } from 'react';
import { listTopics, type Topic } from './api';
import './App.css';

function shortId(id: string): string {
  return id.replace(/\.md$/, '');
}

export default function App() {
  const [topics, setTopics] = useState<Topic[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    listTopics()
      .then((ts) => setTopics(ts))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const filtered = useMemo(() => {
    if (!topics) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return topics;
    return topics.filter((t) => t.id.toLowerCase().includes(q) || t.title.toLowerCase().includes(q));
  }, [topics, filter]);

  return (
    <div className="app">
      <header className="header">
        <h1>Manifest Android Feynman Trainer</h1>
        <p className="subtitle">파인만 기법으로 안드로이드 CS 토픽을 학습합니다.</p>
      </header>

      <main className="main">
        {error ? (
          <div className="status status-error">
            <strong>백엔드에 연결할 수 없습니다.</strong>
            <p>{error}</p>
            <p className="hint">server 패키지가 실행 중인지 확인하십시오 (포트 3001).</p>
          </div>
        ) : !topics ? (
          <div className="status">토픽 목록을 불러오는 중입니다...</div>
        ) : (
          <section className="topic-list-view">
            <div className="topic-list-head">
              <h2>학습할 토픽을 선택하세요</h2>
              <p className="hint">학습 가능한 토픽 {topics.length}개가 인덱싱되어 있습니다.</p>
              <input
                className="topic-search"
                placeholder="토픽 검색 (예: Context, Compose, Coroutine)"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>

            {filtered.length === 0 ? (
              <p className="status">검색 결과가 없습니다.</p>
            ) : (
              <ul className="topic-list">
                {filtered.map((t) => (
                  <li key={t.id} className={`topic-item kind-${t.kind}`}>
                    <span className="topic-id">{shortId(t.id)}</span>
                    <span className="topic-title">{t.title}</span>
                    <span className="topic-kind">{t.kind === 'extra' ? 'E' : 'Q'}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
