import { useEffect, useMemo, useState } from 'react';
import {
  getLastSessionForTopic,
  listTopics,
  listWeakPoints,
  type Category,
  type Topic,
  type WeakPoint,
} from './api';
import { SessionView, type SessionInit } from './SessionView';
import './App.css';

function shortId(id: string): string {
  return id.replace(/\.md$/, '');
}

function rowKindLabel(t: Topic, starting: boolean): string {
  if (starting) return 'starting';
  if (t.stats.mastered) return '★ mastered';
  if (t.stats.attempts > 0) {
    const progress =
      t.stats.bestTotal > 0 ? `${t.stats.bestCleared}/${t.stats.bestTotal} 개념 · ` : '';
    return `${progress}×${t.stats.attempts}`;
  }
  return t.kind === 'extra' ? 'extra' : 'question';
}

function rowKindClass(t: Topic, starting: boolean): string {
  if (starting) return '';
  if (t.stats.mastered) return ' is-mastered';
  if (t.stats.attempts > 0) return ' is-attempted';
  return '';
}

function categoryPrefix(id: string): string {
  const m = id.match(/^(\d+-\d+)/);
  return m ? m[1] : id.replace(/\.md$/, '').slice(0, 4);
}

function categoryLabel(title: string): string {
  const cleaned = title.replace(/^[\d.\)\s-]+/, '').trim();
  return cleaned || title;
}

type AppMode =
  | { kind: 'list' }
  | { kind: 'starting'; topicId: string }
  | { kind: 'session'; data: SessionInit };

export default function App() {
  const [topics, setTopics] = useState<Topic[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [topicsError, setTopicsError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [mode, setMode] = useState<AppMode>({ kind: 'list' });
  const [startError, setStartError] = useState<string | null>(null);
  const [weakPoints, setWeakPoints] = useState<WeakPoint[]>([]);

  function loadTopics() {
    listTopics()
      .then((res) => {
        setTopics(res.topics);
        setCategories(res.categories);
      })
      .catch((e) => setTopicsError(e instanceof Error ? e.message : String(e)));
  }

  function loadWeakPoints() {
    listWeakPoints(8)
      .then((res) => setWeakPoints(res.weakPoints))
      .catch(() => {
        // weak points are best-effort, ignore failures
      });
  }

  useEffect(() => {
    loadTopics();
    loadWeakPoints();
  }, []);

  const sideCategories = useMemo(
    () => categories.filter((c) => c.depth === 1),
    [categories],
  );

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    if (!topics) return map;
    for (const t of topics) {
      if (t.parentId) {
        map.set(t.parentId, (map.get(t.parentId) ?? 0) + 1);
      }
    }
    return map;
  }, [topics]);

  const activeCategoryTitle = useMemo(() => {
    if (!activeCat) return 'All topics';
    const c = categories.find((x) => x.id === activeCat);
    return c ? categoryLabel(c.title) : '';
  }, [activeCat, categories]);

  const filtered = useMemo(() => {
    if (!topics) return [];
    let list = topics;
    if (activeCat) {
      list = list.filter((t) => t.parentId === activeCat);
    }
    const q = filter.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (t) => t.id.toLowerCase().includes(q) || t.title.toLowerCase().includes(q),
      );
    }
    return list;
  }, [topics, activeCat, filter]);

  async function handleSelectTopic(topicId: string) {
    if (mode.kind === 'starting') return;
    setStartError(null);
    setMode({ kind: 'starting', topicId });
    try {
      // 직전 세션이 있으면 mastered 여부와 무관하게 그대로 이어갑니다 (빠른 조회).
      const resumed = await getLastSessionForTopic(topicId);
      if (resumed) {
        setMode({ kind: 'session', data: { kind: 'resume', data: resumed } });
        return;
      }
      // 기록이 없으면 — 느린 startSession 을 인덱스에서 기다리지 않고, 세션 화면으로
      // 먼저 전환한 뒤 SessionView 안에서 시작을 기다립니다.
      const topic = topics?.find((t) => t.id === topicId);
      setMode({
        kind: 'session',
        data: { kind: 'fresh', topicId, topicTitle: topic?.title ?? topicId },
      });
    } catch (e) {
      setStartError(e instanceof Error ? e.message : String(e));
      setMode({ kind: 'list' });
    }
  }

  if (mode.kind === 'session') {
    return (
      <div className="app app-session">
        <SessionView
          initial={mode.data}
          onExit={() => {
            setMode({ kind: 'list' });
            loadTopics();
            loadWeakPoints();
          }}
        />
      </div>
    );
  }

  return (
    <div className="app app-list">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <h1 className="brand-title">MAFT</h1>
          <span className="eyebrow brand-meta">v0.1 · schematic</span>
          <p className="brand-blurb">
            토픽을 자기 말로 풀어내며 코치의 소크라테스식 역질문으로 이해의 격차를 메우는 학습 도구.
          </p>
        </div>

        <nav className="sidebar-nav">
          <span className="eyebrow nav-section-label">// categories</span>
          <ul className="nav-list">
            <li
              className={`nav-item${activeCat === null ? ' is-active' : ''}`}
              onClick={() => setActiveCat(null)}
            >
              <span className="nav-prefix">all</span>
              <span className="nav-label">All topics</span>
              <span className="nav-count">{topics?.length ?? 0}</span>
            </li>
            {sideCategories.map((c) => (
              <li
                key={c.id}
                className={`nav-item${activeCat === c.id ? ' is-active' : ''}`}
                onClick={() => setActiveCat(c.id)}
              >
                <span className="nav-prefix">{categoryPrefix(c.id)}</span>
                <span className="nav-label">{categoryLabel(c.title)}</span>
                <span className="nav-count">{counts.get(c.id) ?? 0}</span>
              </li>
            ))}
          </ul>
        </nav>

        {weakPoints.length > 0 && (
          <section className="sidebar-weakpoints">
            <span className="eyebrow nav-section-label">// weak points</span>
            <ul className="weak-list">
              {weakPoints.map((w) => (
                <li
                  key={`${w.topicId}::${w.concept}`}
                  className="weak-item"
                  title={`${w.topicTitle} · best ${w.bestScore}/5`}
                >
                  <span className="weak-count">{w.bestScore}/5</span>
                  <span className="weak-concept">{w.concept}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </aside>

      <main className="main-area">
        {topicsError ? (
          <div className="status status-error">
            <span className="eyebrow status-tag">! Connection error</span>
            <p>{topicsError}</p>
            <p className="hint">server 패키지가 실행 중인지 확인하십시오 (포트 3001).</p>
          </div>
        ) : !topics ? (
          <div className="status">
            <span className="eyebrow status-tag">⋯ indexing</span>
            <p>토픽 목록을 불러오는 중입니다…</p>
          </div>
        ) : (
          <>
            <div className="main-head">
              <span className="eyebrow">// table of contents</span>
              <h2 className="main-title">{activeCategoryTitle}</h2>
              <div className="main-meta">
                <span className="main-count">
                  <span className="count-num">{filtered.length}</span>
                  <span className="count-label">
                    {activeCat ? 'topics in this section' : 'topics indexed'}
                  </span>
                </span>
                <input
                  className="main-search"
                  placeholder="검색 — Context, Compose, Coroutine…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </div>
            </div>

            {startError && (
              <div className="status status-error">
                <span className="eyebrow status-tag">! 세션 시작 실패</span>
                <p>{startError}</p>
              </div>
            )}

            {filtered.length === 0 ? (
              <p className="status">
                {filter
                  ? '검색 결과가 없습니다.'
                  : '이 섹션에 학습 가능한 토픽이 없습니다.'}
              </p>
            ) : (
              <ol className="index-list">
                {filtered.map((t, i) => {
                  const starting = mode.kind === 'starting' && mode.topicId === t.id;
                  const num = String(i + 1).padStart(2, '0');
                  return (
                    <li
                      key={t.id}
                      className={`index-row kind-${t.kind}${starting ? ' is-starting' : ''}${t.stats.mastered ? ' is-mastered' : ''}`}
                      onClick={() => handleSelectTopic(t.id)}
                    >
                      <span className="row-num">{num}</span>
                      <span className="row-id">{shortId(t.id)}</span>
                      <span className="row-title">{t.title}</span>
                      <span className={`row-kind${rowKindClass(t, starting)}`}>
                        {rowKindLabel(t, starting)}
                      </span>
                      {starting ? (
                        <span className="row-loading" aria-label="세션 시작 중">
                          <span />
                          <span />
                          <span />
                        </span>
                      ) : (
                        <span className="row-arrow" aria-hidden="true">
                          →
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </>
        )}
      </main>
    </div>
  );
}
