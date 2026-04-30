interface ScoreBadgeProps {
  score: number;
  showMax?: boolean;
}

function colorForScore(score: number): string {
  if (score <= 1) return 'var(--sienna)';
  if (score <= 2) return 'var(--amber)';
  if (score <= 3) return 'var(--slate)';
  return 'var(--moss)';
}

export function ScoreBadge({ score, showMax = true }: ScoreBadgeProps) {
  const color = colorForScore(score);
  return (
    <span className="score-badge" style={{ borderColor: color, color }}>
      <span className="score-num">{score}</span>
      {showMax && <span className="score-max">/5</span>}
    </span>
  );
}

export { colorForScore };
