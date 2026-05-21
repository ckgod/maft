import type { SessionConcept } from './api';
import { colorForScore } from './ScoreBadge';

interface ScorePanelProps {
  concepts: SessionConcept[];
  integrationScore: number | null;
  mastered: boolean;
  /** 좁은 viewport 에서 사용자가 접기/펼치기를 제어할 수 있는 모드 */
  collapsible?: boolean;
  /** collapsible=true 일 때 펼침 여부 (기본 접힘) */
  open?: boolean;
  onToggle?: () => void;
}

const CLEARED_THRESHOLD = 3;
const INTEGRATION_TARGET = 4;

function statusOf(score: number): { label: string; cls: string } {
  if (score >= CLEARED_THRESHOLD) return { label: 'cleared', cls: 'is-cleared' };
  if (score > 0) return { label: 'in progress', cls: 'is-progress' };
  return { label: 'pending', cls: 'is-pending' };
}

function Meter({ score }: { score: number }) {
  const color = colorForScore(score);
  return (
    <span className="concept-meter" aria-label={`${score} / 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className="concept-seg"
          style={n <= score ? { background: color, borderColor: color } : undefined}
        />
      ))}
    </span>
  );
}

export function ScorePanel({
  concepts,
  integrationScore,
  mastered,
  collapsible = false,
  open = true,
  onToggle,
}: ScorePanelProps) {
  if (concepts.length === 0) return null;

  const cleared = concepts.filter((c) => c.bestScore >= CLEARED_THRESHOLD).length;
  const collapsedNow = collapsible && !open;
  const integLabel = integrationScore === null ? '—' : String(integrationScore);
  const integColor =
    integrationScore === null ? 'var(--ink-4)' : colorForScore(integrationScore);

  return (
    <aside className={`rubric-figure${collapsedNow ? ' is-collapsed' : ''}`}>
      <div className="rubric-head">
        <span className="eyebrow">Figure 01 · Concepts</span>
        <div className="rubric-head-actions">
          <span className="eyebrow rubric-head-meta">
            {cleared}/{concepts.length} cleared
          </span>
          {collapsible && (
            <button
              type="button"
              className="rubric-toggle"
              onClick={onToggle}
              aria-expanded={open}
            >
              {open ? '접기' : '펼치기'}
            </button>
          )}
        </div>
      </div>

      {collapsedNow ? (
        <div className="rubric-summary" role="group" aria-label="개념 진척 요약">
          <span className="rubric-summary-item">
            <span className="rubric-summary-label">concepts</span>
            <b>
              {cleared}/{concepts.length}
            </b>
          </span>
          <span className="rubric-summary-item">
            <span className="rubric-summary-label">integration</span>
            <b style={{ color: integColor }}>{integLabel}</b>
          </span>
          {mastered && (
            <span className="rubric-summary-item">
              <b style={{ color: 'var(--moss)' }}>★ mastered</b>
            </span>
          )}
        </div>
      ) : (
        <>
          <ol className="concept-list">
            {concepts.map((c) => {
              const st = statusOf(c.bestScore);
              return (
                <li key={c.id} className={`concept-row ${st.cls}`} title={c.criterion}>
                  <span className="concept-name">{c.name}</span>
                  <Meter score={c.bestScore} />
                  <span
                    className="concept-score"
                    style={{ color: colorForScore(c.bestScore) }}
                  >
                    {c.bestScore}
                  </span>
                  <span className="concept-status">{st.label}</span>
                </li>
              );
            })}
          </ol>
          <div className="concept-integration">
            <span className="eyebrow">Integration</span>
            <span className="concept-integration-score" style={{ color: integColor }}>
              {integLabel}
              <span className="concept-integration-max">/5</span>
            </span>
            <span className="concept-integration-hint">
              {mastered
                ? '★ 마스터 도달'
                : `통합 답변 ${INTEGRATION_TARGET}점 이상이면 마스터`}
            </span>
          </div>
        </>
      )}
    </aside>
  );
}
