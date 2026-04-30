import { useMemo } from 'react';
import type { Message } from './SessionView';
import { colorForScore } from './ScoreBadge';

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
    <aside className="rubric-figure">
      <div className="rubric-head">
        <span className="eyebrow">Figure 01 · Rubric</span>
        <span className="eyebrow rubric-head-meta">
          n = {String(stats.turns).padStart(2, '0')}
        </span>
      </div>

      <div className="rubric-grid">
        <div className="rubric-stat">
          <span className="stat-label">Turns</span>
          <span className="stat-value">{stats.turns}</span>
        </div>
        <div className="rubric-stat">
          <span className="stat-label">Latest</span>
          <span className="stat-value" style={{ color: colorForScore(stats.latest) }}>
            {stats.latest}
            <span className="stat-trend">{trendIndicator(stats.scores)}</span>
          </span>
        </div>
        <div className="rubric-stat">
          <span className="stat-label">Average</span>
          <span
            className="stat-value"
            style={{ color: colorForScore(Math.round(stats.avg)) }}
          >
            {stats.avg.toFixed(1)}
          </span>
        </div>
        <div className="rubric-stat">
          <span className="stat-label">Best</span>
          <span className="stat-value" style={{ color: colorForScore(stats.best) }}>
            {stats.best}
          </span>
        </div>

        <div className="rubric-trend" aria-label="턴별 점수 추이">
          <div className="trend-rule">
            <span className="trend-axis-label">5</span>
            <span className="trend-axis-label">0</span>
          </div>
          <div className="trend-track">
            {stats.scores.map((s, i) => (
              <div
                key={i}
                className="trend-bar"
                style={{
                  height: `${Math.max((s / 5) * 100, 6)}%`,
                  background: colorForScore(s),
                }}
                title={`Turn ${i + 1}: ${s}/5`}
              />
            ))}
          </div>
        </div>
      </div>

      {stats.topMissed.length > 0 && (
        <div className="rubric-weak">
          <span className="eyebrow rubric-weak-label">Recurring gaps</span>
          <ul>
            {stats.topMissed.map((m) => (
              <li key={m.concept}>
                <span className="weak-count">×{String(m.count).padStart(2, '0')}</span>
                <span className="weak-concept">{m.concept}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
