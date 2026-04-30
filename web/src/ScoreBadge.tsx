interface ScoreBadgeProps {
  score: number;
  showMax?: boolean;
}

function colorForScore(score: number): string {
  if (score <= 1) return 'var(--err)';
  if (score <= 2) return 'var(--warn)';
  if (score <= 3) return '#a3b8d8';
  return 'var(--ok)';
}

export function ScoreBadge({ score, showMax = true }: ScoreBadgeProps) {
  const color = colorForScore(score);
  return (
    <div className="score-badge" style={{ borderColor: color, color }}>
      <span className="score-num">{score}</span>
      {showMax && <span className="score-max">/5</span>}
    </div>
  );
}
