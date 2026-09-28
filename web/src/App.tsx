import { useEffect, useMemo, useState } from 'react';
import {
  getLastSessionForTopic,
  listTopics,
  type Category,
  type Topic,
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

/** "1.2 Kotlin 표준 라이브러리" → "1.2". 번호가 없으면 빈 문자열. */
function categoryNumber(title: string): string {
  const m = title.match(/^([\d.]+)/);
  return m ? m[1].replace(/\.$/, '') : '';
}

function categoryLabel(title: string): string {
  const cleaned = title.replace(/^[\d.\)\s-]+/, '').trim();
  return cleaned || title;
}

/** mi.tree 의 depth 1 = 책(Android Manifest Notes / Kotlin Deep Dive), depth 2 = 챕터. */
const BOOK_DEPTH = 1;
const SECTION_DEPTH = 2;

/** 책마다 짧은 태그 — 사이드바 접두어와 행의 출처 표시에 씁니다. */
function bookTag(bookId: string | null): string {
  if (!bookId) return '';
  if (/^android/i.test(bookId)) return 'AND';
  if (/^kotlin/i.test(bookId)) return 'KT';
  return bookId.replace(/\.md$/, '').slice(0, 3).toUpperCase();
}

interface TopicGroup {
  bookId: string | null;
  sectionId: string | null;
  topics: Topic[];
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

  function loadTopics() {
    listTopics()
      .then((res) => {
        setTopics(res.topics);
        setCategories(res.categories);
      })
      .catch((e) => setTopicsError(e instanceof Error ? e.message : String(e)));
  }

  useEffect(() => {
    loadTopics();
  }, []);

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  /** 토픽의 조상 카테고리 id 목록 (가까운 순). 토픽은 챕터 아래 몇 단계든 중첩될 수 있습니다. */
  const ancestorsOf = useMemo(() => {
    return (parentId: string | null): Category[] => {
      const out: Category[] = [];
      let cur = parentId ? catById.get(parentId) : undefined;
      while (cur) {
        out.push(cur);
        cur = cur.parentId ? catById.get(cur.parentId) : undefined;
      }
      return out;
    };
  }, [catById]);

  const placement = useMemo(() => {
    const map = new Map<string, { bookId: string | null; sectionId: string | null; ancestors: string[] }>();
    for (const t of topics ?? []) {
      const anc = ancestorsOf(t.parentId);
      map.set(t.id, {
        bookId: anc.find((c) => c.depth === BOOK_DEPTH)?.id ?? null,
        sectionId: anc.find((c) => c.depth === SECTION_DEPTH)?.id ?? null,
        ancestors: anc.map((c) => c.id),
      });
    }
    return map;
  }, [topics, ancestorsOf]);

  const books = useMemo(
    () =>
      categories
        .filter((c) => c.depth === BOOK_DEPTH)
        .map((b) => ({
          book: b,
          sections: categories.filter((c) => c.depth === SECTION_DEPTH && c.parentId === b.id),
        })),
    [categories],
  );

  /** 카테고리별 하위 토픽 수 (자손 전체). */
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of placement.values()) {
      for (const id of p.ancestors) map.set(id, (map.get(id) ?? 0) + 1);
    }
    return map;
  }, [placement]);

  const activeCategory = activeCat ? catById.get(activeCat) : undefined;

  const activeCategoryTitle = activeCategory ? categoryLabel(activeCategory.title) : 'All topics';

  /** 챕터를 보고 있을 때 그 챕터가 속한 책 이름 — 제목 위 eyebrow 에 씁니다. */
  const activeBookTitle =
    activeCategory && activeCategory.depth === SECTION_DEPTH && activeCategory.parentId
      ? catById.get(activeCategory.parentId)?.title ?? null
      : null;

  const filtered = useMemo(() => {
    if (!topics) return [];
    let list = topics;
    if (activeCat) {
      list = list.filter((t) => placement.get(t.id)?.ancestors.includes(activeCat));
    }
    const q = filter.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (t) => t.id.toLowerCase().includes(q) || t.title.toLowerCase().includes(q),
      );
    }
    return list;
  }, [topics, activeCat, filter, placement]);

  /** 책 → 챕터 순으로 연속된 토픽을 묶습니다. 서버가 mi.tree 순서를 보존하므로 인접 묶음이면 충분합니다. */
  const groups = useMemo(() => {
    const out: TopicGroup[] = [];
    for (const t of filtered) {
      const p = placement.get(t.id);
      const bookId = p?.bookId ?? null;
      const sectionId = p?.sectionId ?? null;
      const last = out[out.length - 1];
      if (last && last.bookId === bookId && last.sectionId === sectionId) {
        last.topics.push(t);
      } else {
        out.push({ bookId, sectionId, topics: [t] });
      }
    }
    return out;
  }, [filtered, placement]);

  const showBookHeaders = !activeCategory || activeCategory.depth < BOOK_DEPTH;
  const showSectionHeaders = !activeCategory || activeCategory.depth < SECTION_DEPTH;

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
          </ul>
          {books.map(({ book, sections }) => (
            <div key={book.id} className="nav-book">
              <div
                className={`nav-item nav-book-head${activeCat === book.id ? ' is-active' : ''}`}
                onClick={() => setActiveCat(book.id)}
              >
                <span className="nav-prefix nav-book-tag">{bookTag(book.id)}</span>
                <span className="nav-label">{book.title}</span>
                <span className="nav-count">{counts.get(book.id) ?? 0}</span>
              </div>
              <ul className="nav-list nav-sections">
                {sections.map((c) => (
                  <li
                    key={c.id}
                    className={`nav-item nav-section${activeCat === c.id ? ' is-active' : ''}`}
                    onClick={() => setActiveCat(c.id)}
                  >
                    <span className="nav-prefix">{categoryNumber(c.title)}</span>
                    <span className="nav-label">{categoryLabel(c.title)}</span>
                    <span className="nav-count">{counts.get(c.id) ?? 0}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

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
              <span className="eyebrow">
                {activeBookTitle ? `// ${activeBookTitle}` : '// table of contents'}
              </span>
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
              <div className="index-groups">
                {groups.map((g, gi) => {
                  const prev = groups[gi - 1];
                  const newBook = showBookHeaders && (!prev || prev.bookId !== g.bookId);
                  const section = g.sectionId ? catById.get(g.sectionId) : undefined;
                  const book = g.bookId ? catById.get(g.bookId) : undefined;
                  return (
                    <section key={`${g.bookId}::${g.sectionId}::${gi}`} className="index-group">
                      {newBook && book && (
                        <h3 className="group-book">
                          <span className="group-book-tag">{bookTag(book.id)}</span>
                          {book.title}
                          <span className="group-count">{counts.get(book.id) ?? 0}</span>
                        </h3>
                      )}
                      {showSectionHeaders && section && (
                        <h4 className="group-section">
                          <span className="group-section-num">{categoryNumber(section.title)}</span>
                          {categoryLabel(section.title)}
                        </h4>
                      )}
                      <ol className="index-list">
                        {g.topics.map((t, i) => {
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
                    </section>
                  );
                })}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
