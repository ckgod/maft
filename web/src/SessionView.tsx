import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  resetTopic,
  sendMessage,
  startSession,
  type SessionConcept,
  type SessionStartResponse,
  type SessionTurn,
} from './api';
import { ScorePanel } from './ScorePanel';

export interface Message {
  role: 'assistant' | 'user';
  text: string;
}

/**
 * SessionView 진입 형태:
 * - resume: 직전 세션을 이미 받아온 상태 (App 이 빠른 조회로 확보).
 * - fresh: 기록이 없어 새로 시작 — 느린 startSession 을 SessionView 안에서 기다립니다.
 *   (인덱스에서 멈춰 기다리지 않고 세션 화면으로 먼저 넘어오기 위함.)
 */
export type SessionInit =
  | { kind: 'resume'; data: SessionStartResponse }
  | { kind: 'fresh'; topicId: string; topicTitle: string };

interface SessionViewProps {
  initial: SessionInit;
  onExit: () => void;
}

function turnsToMessages(turns: SessionTurn[]): Message[] {
  return turns.map((t) => ({ role: t.role, text: t.text }));
}

function buildInitialMessages(start: SessionStartResponse): Message[] {
  if (start.turns && start.turns.length > 0) {
    return turnsToMessages(start.turns);
  }
  return [{ role: 'assistant', text: start.message }];
}

const Q_RE = /^Q(\d+)/;
const E_RE = /^E(\d+)/;

function topicNumber(id: string): string {
  const q = id.match(Q_RE);
  if (q) return `Q${q[1]}`;
  const e = id.match(E_RE);
  if (e) return `E${e[1]}`;
  return id.slice(0, 8);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// CONCEPTS 패널은 데스크탑에선 thread 우측에 상주하는 사이드 레일이다.
// 가로가 좁으면(태블릿/모바일) 레일을 띄울 공간이 없으므로, 우측에서
// 슬라이드되는 drawer 로 전환한다. 우측 레일은 thread 의 세로 높이를 전혀
// 잠식하지 않으므로 (이전과 달리) 세로 길이(max-height) 는 판정에서 뺀다.
const NARROW_QUERY = '(max-width: 920px)';

function readInitialNarrow(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia(NARROW_QUERY).matches;
}

export function SessionView({ initial, onExit }: SessionViewProps) {
  const resumed = initial.kind === 'resume' ? initial.data : null;

  const [session, setSession] = useState<SessionStartResponse | null>(resumed);
  const [messages, setMessages] = useState<Message[]>(() =>
    resumed ? buildInitialMessages(resumed) : [],
  );
  const [concepts, setConcepts] = useState<SessionConcept[]>(resumed?.concepts ?? []);
  const [integrationScore, setIntegrationScore] = useState<number | null>(
    resumed?.integrationScore ?? null,
  );
  const [mastered, setMastered] = useState(resumed?.mastered ?? false);
  const [starting, setStarting] = useState(initial.kind === 'fresh');
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isNarrow, setIsNarrow] = useState<boolean>(readInitialNarrow);
  const [panelOpen, setPanelOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  const topicId = initial.kind === 'resume' ? initial.data.topicId : initial.topicId;
  const topicTitle = initial.kind === 'resume' ? initial.data.topicTitle : initial.topicTitle;
  const isResuming =
    !restarting &&
    initial.kind === 'resume' &&
    !!(initial.data.turns && initial.data.turns.length > 1);
  // 새 세션 준비 또는 재시작 — 둘 다 thread 에 로딩 엔트리를 띄웁니다.
  const booting = starting || restarting;

  // fresh 진입이면 화면 전환 직후 startSession 을 호출합니다. ref 가드로 StrictMode
  // 의 effect 이중 호출에도 한 번만 spawn 합니다.
  useEffect(() => {
    if (initial.kind !== 'fresh' || startedRef.current) return;
    startedRef.current = true;
    startSession(initial.topicId)
      .then((fresh) => {
        setSession(fresh);
        setMessages(buildInitialMessages(fresh));
        setConcepts(fresh.concepts);
        setIntegrationScore(fresh.integrationScore);
        setMastered(fresh.mastered);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setStarting(false));
  }, [initial]);

  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY);
    const handler = (e: MediaQueryListEvent) => setIsNarrow(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, sending, booting]);

  async function handleSend() {
    const text = input.trim();
    if (!text || sending || !session) return;
    setError(null);
    setSending(true);
    setMessages((prev) => [...prev, { role: 'user', text }]);
    setInput('');
    try {
      const res = await sendMessage(session.sessionId, text);
      setMessages((prev) => [...prev, { role: 'assistant', text: res.message }]);
      setConcepts(res.concepts);
      setIntegrationScore(res.integrationScore);
      setMastered(res.mastered);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  async function handleRestart() {
    if (restarting || sending || starting) return;
    const ok = window.confirm(
      '새 세션을 시작합니다. 이 토픽의 모든 학습 기록(이전 세션, 개념별 점수, 시도 횟수·마스터 상태)이 삭제되고 처음부터 다시 시작합니다. 계속하시겠습니까?',
    );
    if (!ok) return;
    setError(null);
    setRestarting(true);
    // claude spawn 이 10~30s 걸리므로 thread 영역을 즉시 비워 시작 신호를 명확히 만듭니다.
    setMessages([]);
    setConcepts([]);
    setIntegrationScore(null);
    setMastered(false);
    try {
      await resetTopic(topicId);
      const fresh = await startSession(topicId);
      setSession(fresh);
      setMessages(buildInitialMessages(fresh));
      setConcepts(fresh.concepts);
      setIntegrationScore(fresh.integrationScore);
      setMastered(fresh.mastered);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRestarting(false);
    }
  }

  let userTurn = 0;
  let coachTurn = 0;

  // 좁은 화면 drawer 토글 버튼에 진척을 요약해 보여준다 (ScorePanel 과 동일 임계값).
  const clearedCount = concepts.filter((c) => c.bestScore >= 3).length;
  const hasConcepts = concepts.length > 0;

  return (
    <div className="session">
      <header className="session-head">
        <button className="link-back" onClick={onExit}>
          ← Index
        </button>
        <div className="session-meta">
          <span className="eyebrow">
            Topic · {topicNumber(topicId)}
            {isResuming && <span className="session-resume-tag"> · resumed</span>}
          </span>
          <h2 className="session-h2">{topicTitle}</h2>
        </div>
        <div className="session-actions">
          {isNarrow && hasConcepts && (
            <button
              type="button"
              className="link-concepts"
              onClick={() => setPanelOpen((o) => !o)}
              aria-expanded={panelOpen}
              title="개념 점수판 열기/닫기"
            >
              Concepts {clearedCount}/{concepts.length}
            </button>
          )}
          {mastered ? (
            <span className="mastered-pill">Mastered</span>
          ) : (
            <span className="eyebrow session-state">In session</span>
          )}
          <button
            type="button"
            className="link-restart"
            onClick={() => void handleRestart()}
            disabled={restarting || sending || starting}
            title="이 토픽을 새 세션으로 다시 시작합니다"
          >
            {restarting ? 'starting…' : '새 세션'}
          </button>
        </div>
      </header>

      <div className="session-body">
        <div className="thread" ref={scrollRef}>
        {booting && (
          <article className="entry entry-coach entry-restart">
            <span className="eyebrow entry-tag">
              Coach · {starting ? '세션 준비 중' : '새 세션 준비 중'}
            </span>
            <div className="entry-body">
              <p className="typing">
                {starting ? '학습 세션을 준비하는 중입니다.' : '새 세션을 시작하는 중입니다.'}{' '}
                코치의 첫 안내가 도착할 때까지 10~30초 정도 걸릴 수 있습니다.
              </p>
              <span className="row-loading" aria-label="준비 중">
                <span />
                <span />
                <span />
              </span>
            </div>
          </article>
        )}
        {messages.map((m, i) => {
          if (m.role === 'user') {
            userTurn += 1;
            return (
              <article key={i} className="entry entry-user">
                <span className="eyebrow entry-tag">Response · No. {pad2(userTurn)}</span>
                <div className="entry-body">
                  <p>{m.text}</p>
                </div>
              </article>
            );
          }
          coachTurn += 1;
          const isOpening = i === 0;
          return (
            <article
              key={i}
              className={`entry entry-coach${isOpening ? ' entry-opening' : ''}`}
            >
              <div className="entry-tag-row">
                <span className="eyebrow entry-tag">
                  {isOpening ? 'Coach · Opening' : `Coach · No. ${pad2(coachTurn - 1)}`}
                </span>
              </div>
              <div className="entry-body">
                <ReactMarkdown>{m.text}</ReactMarkdown>
              </div>
            </article>
          );
        })}
        {sending && (
          <article className="entry entry-coach entry-pending">
            <span className="eyebrow entry-tag">Coach · evaluating…</span>
            <div className="entry-body">
              <p className="typing">평가 중입니다.</p>
              <span className="row-loading" aria-label="평가 중">
                <span />
                <span />
                <span />
              </span>
            </div>
          </article>
        )}
        </div>

        <ScorePanel
          concepts={concepts}
          integrationScore={integrationScore}
          mastered={mastered}
          drawer={isNarrow}
          open={panelOpen}
          onClose={() => setPanelOpen(false)}
        />
      </div>

      {isNarrow && panelOpen && hasConcepts && (
        <div
          className="session-backdrop"
          role="presentation"
          onClick={() => setPanelOpen(false)}
        />
      )}

      {error && (
        <div className="status status-error">
          <span className="eyebrow status-tag">응답 실패</span>
          <p>{error}</p>
        </div>
      )}

      <div className="composer">
        <span className="eyebrow composer-tag">
          Respond — ⌘/Ctrl + Enter to submit
        </span>
        <textarea
          rows={3}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            booting
              ? '세션을 준비하는 중입니다…'
              : mastered
                ? '이 토픽은 마스터에 도달했습니다. 더 깊은 후속 질문을 던져도 좋습니다.'
                : '자기 말로 풀어 설명해 보세요…'
          }
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              void handleSend();
            }
          }}
          disabled={sending || restarting || starting}
        />
        <button
          onClick={() => void handleSend()}
          disabled={sending || restarting || starting || !input.trim()}
        >
          {sending ? 'Sending' : 'Submit'}
        </button>
      </div>
    </div>
  );
}
