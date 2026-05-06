import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  sendMessage,
  type Rubric,
  type SessionStartResponse,
} from './api';
import { ScoreBadge } from './ScoreBadge';
import { ScorePanel } from './ScorePanel';

export interface Message {
  role: 'assistant' | 'user';
  text: string;
  rubric: Rubric | null;
}

interface SessionViewProps {
  initial: SessionStartResponse;
  onExit: () => void;
}

const RUBRIC_BLOCK_RE = /```json\s*[\s\S]*?\s*```\s*$/m;
const Q_RE = /^Q(\d+)/;
const E_RE = /^E(\d+)/;

function stripRubricBlock(text: string): string {
  return text.replace(RUBRIC_BLOCK_RE, '').trimEnd();
}

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
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', text: initial.message, rubric: initial.rubric },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mastered, setMastered] = useState(initial.mastered);
  const [isNarrow, setIsNarrow] = useState<boolean>(readInitialNarrow);
  const [panelOpen, setPanelOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

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
    setMessages((prev) => [...prev, { role: 'user', text, rubric: null }]);
    setInput('');
    try {
      const res = await sendMessage(initial.sessionId, text);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: res.message, rubric: res.rubric },
      ]);
      if (res.mastered) setMastered(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
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
          <span className="eyebrow">Topic · {topicNumber(initial.topicId)}</span>
          <h2 className="session-h2">{initial.topicTitle}</h2>
        </div>
        {mastered ? (
          <span className="mastered-pill">Mastered</span>
        ) : (
          <span className="eyebrow session-state">In session</span>
        )}
      </header>

      <ScorePanel
        messages={messages}
        collapsible={isNarrow}
        open={panelOpen}
        onToggle={() => setPanelOpen((o) => !o)}
      />

      <div className="thread" ref={scrollRef}>
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
                {m.rubric && <ScoreBadge score={m.rubric.score} />}
              </div>
              <div className="entry-body">
                <ReactMarkdown>{stripRubricBlock(m.text)}</ReactMarkdown>
                {m.rubric && m.rubric.missedConcepts.length > 0 && (
                  <aside className="errata">
                    <span className="eyebrow">Missed concepts</span>
                    <ul>
                      {m.rubric.missedConcepts.map((c, j) => (
                        <li key={j}>{c}</li>
                      ))}
                    </ul>
                  </aside>
                )}
              </div>
            </article>
          );
        })}
        {sending && (
          <article className="entry entry-coach entry-pending">
            <span className="eyebrow entry-tag">Coach · evaluating…</span>
            <div className="entry-body">
              <p className="typing">평가 중입니다.</p>
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
          disabled={sending}
        />
        <button onClick={() => void handleSend()} disabled={sending || !input.trim()}>
          {sending ? 'Sending' : 'Submit'}
        </button>
      </div>
    </div>
  );
}
