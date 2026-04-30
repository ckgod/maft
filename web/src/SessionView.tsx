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

function stripRubricBlock(text: string): string {
  return text.replace(RUBRIC_BLOCK_RE, '').trimEnd();
}

export function SessionView({ initial, onExit }: SessionViewProps) {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', text: initial.message, rubric: initial.rubric },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mastered, setMastered] = useState(initial.mastered);
  const scrollRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className="session-view">
      <header className="session-header">
        <button className="btn-secondary" onClick={onExit}>
          ← 토픽 목록
        </button>
        <div className="session-title">
          <span className="session-topic-id">{initial.topicId.replace(/\.md$/, '')}</span>
          <h2>{initial.topicTitle}</h2>
        </div>
        {mastered && <span className="mastered-badge">마스터 도달</span>}
      </header>

      <ScorePanel messages={messages} />

      <div className="message-list" ref={scrollRef}>
        {messages.map((m, i) => (
          <article key={i} className={`message message-${m.role}`}>
            {m.role === 'assistant' && m.rubric && (
              <div className="message-meta">
                <ScoreBadge score={m.rubric.score} />
              </div>
            )}
            <div className="message-body">
              {m.role === 'assistant' ? (
                <ReactMarkdown>{stripRubricBlock(m.text)}</ReactMarkdown>
              ) : (
                <p>{m.text}</p>
              )}
              {m.rubric && m.rubric.missedConcepts.length > 0 && (
                <ul className="missed-list">
                  {m.rubric.missedConcepts.map((c, j) => (
                    <li key={j}>{c}</li>
                  ))}
                </ul>
              )}
            </div>
          </article>
        ))}
        {sending && (
          <article className="message message-assistant message-pending">
            <div className="message-body">
              <p className="typing">평가 중입니다…</p>
            </div>
          </article>
        )}
      </div>

      {error && (
        <div className="status status-error">
          <strong>응답을 받지 못했습니다.</strong>
          <p>{error}</p>
        </div>
      )}

      <div className="input-bar">
        <textarea
          rows={3}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            mastered
              ? '이 토픽은 마스터에 도달했습니다. 더 깊은 후속 질문을 던져도 좋고, 토픽 목록으로 돌아가도 됩니다.'
              : '자기 말로 설명해 주세요... (⌘/Ctrl + Enter 로 전송)'
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
          {sending ? '전송 중…' : '제출'}
        </button>
      </div>
    </div>
  );
}
