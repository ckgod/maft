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

interface SessionViewProps {
  initial: SessionStartResponse;
  onExit: () => void;
}

function turnsToMessages(turns: SessionTurn[]): Message[] {
  return turns.map((t) => ({ role: t.role, text: t.text }));
}

function buildInitialMessages(initial: SessionStartResponse): Message[] {
  if (initial.turns && initial.turns.length > 0) {
    return turnsToMessages(initial.turns);
  }
  return [{ role: 'assistant', text: initial.message }];
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

const NARROW_QUERY = '(max-width: 920px)';

function readInitialNarrow(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia(NARROW_QUERY).matches;
}

export function SessionView({ initial, onExit }: SessionViewProps) {
  // initial.turns 가 채워져 있으면 hydration, 없으면 opening 메시지만으로 시작.
  const [activeInitial, setActiveInitial] = useState<SessionStartResponse>(initial);
  const [messages, setMessages] = useState<Message[]>(() => buildInitialMessages(initial));
  const [concepts, setConcepts] = useState<SessionConcept[]>(initial.concepts);
  const [integrationScore, setIntegrationScore] = useState<number | null>(
    initial.integrationScore,
  );
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mastered, setMastered] = useState(initial.mastered);
  const [isNarrow, setIsNarrow] = useState<boolean>(readInitialNarrow);
  const [panelOpen, setPanelOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const isResuming =
    !restarting && !!(activeInitial.turns && activeInitial.turns.length > 1);

  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY);
    const handler = (e: MediaQueryListEvent) => setIsNarrow(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;
    setError(null);
    setSending(true);
    setMessages((prev) => [...prev, { role: 'user', text }]);
    setInput('');
    try {
      const res = await sendMessage(activeInitial.sessionId, text);
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
    if (restarting || sending) return;
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
      await resetTopic(activeInitial.topicId);
      const fresh = await startSession(activeInitial.topicId);
      setActiveInitial(fresh);
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

  return (
    <div className="session">
      <header className="session-head">
        <button className="link-back" onClick={onExit}>
          ← Index
        </button>
        <div className="session-meta">
          <span className="eyebrow">
            Topic · {topicNumber(activeInitial.topicId)}
            {isResuming && <span className="session-resume-tag"> · resumed</span>}
          </span>
          <h2 className="session-h2">{activeInitial.topicTitle}</h2>
        </div>
        <div className="session-actions">
          {mastered ? (
            <span className="mastered-pill">Mastered</span>
          ) : (
            <span className="eyebrow session-state">In session</span>
          )}
          <button
            type="button"
            className="link-restart"
            onClick={() => void handleRestart()}
            disabled={restarting || sending}
            title="이 토픽을 새 세션으로 다시 시작합니다"
          >
            {restarting ? 'starting…' : '새 세션'}
          </button>
        </div>
      </header>

      <ScorePanel
        concepts={concepts}
        integrationScore={integrationScore}
        mastered={mastered}
        collapsible={isNarrow}
        open={panelOpen}
        onToggle={() => setPanelOpen((o) => !o)}
      />

      <div className="thread" ref={scrollRef}>
        {restarting && (
          <article className="entry entry-coach entry-restart">
            <span className="eyebrow entry-tag">Coach · 새 세션 준비 중</span>
            <div className="entry-body">
              <p className="typing">
                새 세션을 시작하는 중입니다. claude 와의 첫 인사가 도착할 때까지 10~30초 정도 걸릴 수 있습니다.
              </p>
              <span className="row-loading" aria-label="시작 중">
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
            mastered
              ? '이 토픽은 마스터에 도달했습니다. 더 깊은 후속 질문을 던져도 좋습니다.'
              : '자기 말로 풀어 설명해 보세요…'
          }
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              void handleSend();
            }
          }}
          disabled={sending || restarting}
        />
        <button
          onClick={() => void handleSend()}
          disabled={sending || restarting || !input.trim()}
        >
          {sending ? 'Sending' : 'Submit'}
        </button>
      </div>
    </div>
  );
}
