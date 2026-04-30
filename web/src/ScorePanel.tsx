import { useMemo } from 'react';
import type { Message } from './SessionView';

interface ScorePanelProps {
  messages: Message[];
}

interface Stats {
  turns: number;
  avg: number;
  best: number;
  latest: number;
  scores: number[];
  topMissed: { concept: string; count: number }[];
}

function computeStats(messages: Message[]): Stats {
  const rubrics = messages
    .filter((m) => m.role === 'assistant' && m.rubric)
    .map((m) => m.rubric!);
  const scores = rubrics.map((r) => r.score);
  const turns = scores.length;
  const sum = scores.reduce((a, b) => a + b, 0);
  const avg = turns > 0 ? sum / turns : 0;
  const best = turns > 0 ? Math.max(...scores) : 0;
  const latest = turns > 0 ? scores[turns - 1]! : 0;

  const counts = new Map<string, number>();
  for (const r of rubrics) {
    for (const c of r.missedConcepts) {
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
  }
  const topMissed = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([concept, count]) => ({ concept, count }));

  return { turns, avg, best, latest, scores, topMissed };
}

function colorForScore(score: number): string {
  if (score <= 1) return 'var(--err)';
  if (score <= 2) return 'var(--warn)';
  if (score <= 3) return '#a3b8d8';
  return 'var(--ok)';
}

function trendIndicator(scores: number[]): string {
  if (scores.length < 2) return '';
  const last = scores[scores.length - 1]!;
  const prev = scores[scores.length - 2]!;
  if (last > prev) return '↑';
  if (last < prev) return '↓';
  return '→';
}

export function ScorePanel({ messages }: ScorePanelProps) {
  const stats = useMemo(() => computeStats(messages), [messages]);

  if (stats.turns === 0) return null;

  return (
    <aside className="score-panel">
      <div className="score-panel-row">
        <div className="stat">
          <span className="stat-label">턴</span>
          <span className="stat-value">{stats.turns}</span>
        </div>
        <div className="stat">
          <span className="stat-label">최근</span>
          <span className="stat-value" style={{ color: colorForScore(stats.latest) }}>
            {stats.latest}
            <span className="stat-trend">{trendIndicator(stats.scores)}</span>
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">평균</span>
          <span className="stat-value" style={{ color: colorForScore(Math.round(stats.avg)) }}>
            {stats.avg.toFixed(1)}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">최고</span>
          <span className="stat-value" style={{ color: colorForScore(stats.best) }}>
            {stats.best}
          </span>
        </div>

        <div className="score-trend" aria-label="턴별 점수 추이">
          {stats.scores.map((s, i) => (
            <div
              key={i}
              className="trend-bar"
              style={{
                height: `${Math.max((s / 5) * 100, 8)}%`,
                background: colorForScore(s),
              }}
              title={`턴 ${i + 1}: ${s}/5`}
            />
          ))}
        </div>
      </div>

      {stats.topMissed.length > 0 && (
        <div className="weak-points">
          <span className="weak-label">자주 빠진 개념</span>
          <ul>
            {stats.topMissed.map((m) => (
              <li key={m.concept}>
                <span className="weak-count">×{m.count}</span>
                <span className="weak-concept">{m.concept}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
