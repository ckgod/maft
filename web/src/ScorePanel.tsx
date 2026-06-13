import type { SessionConcept } from './api';
import { colorForScore } from './ScoreBadge';

interface ScorePanelProps {
  concepts: SessionConcept[];
  integrationScore: number | null;
  mastered: boolean;
  /** 좁은 viewport 에서 우측 슬라이드 drawer 로 동작하는 모드.
   *  false(데스크탑)이면 thread 우측에 상주하는 사이드 레일이다. */
  drawer?: boolean;
  /** drawer=true 일 때 열림 여부 (기본 닫힘) */
  open?: boolean;
  /** drawer 헤더의 닫기 버튼 핸들러 */
  onClose?: () => void;
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
  drawer = false,
  open = false,
  onClose,
}: ScorePanelProps) {
  if (concepts.length === 0) return null;

  const cleared = concepts.filter((c) => c.bestScore >= CLEARED_THRESHOLD).length;
  const integLabel = integrationScore === null ? '—' : String(integrationScore);
  const integColor =
    integrationScore === null ? 'var(--ink-4)' : colorForScore(integrationScore);
  // 데스크탑: 상주 레일(rubric-rail). 좁은 화면: 우측 drawer(rubric-drawer).
  const modeClass = drawer ? ' rubric-drawer' : ' rubric-rail';
  const openClass = drawer && open ? ' is-open' : '';

  return (
    <aside
      className={`rubric-figure${modeClass}${openClass}`}
      aria-hidden={drawer && !open}
    >
      <div className="rubric-head">
        <span className="eyebrow">Figure 01 · Concepts</span>
        <div className="rubric-head-actions">
          <span className="eyebrow rubric-head-meta">
            {cleared}/{concepts.length} cleared
          </span>
          {drawer && (
            <button
              type="button"
              className="rubric-toggle"
              onClick={onClose}
              aria-label="개념 점수판 닫기"
            >
              닫기
            </button>
          )}
        </div>
      </div>

      <ol className="concept-list">
        {concepts.map((c) => {
          const st = statusOf(c.bestScore);
          return (
            <li key={c.id} className={`concept-row ${st.cls}`} title={c.criterion}>
              <span className="concept-name">{c.name}</span>
              <div className="concept-metrics">
                <Meter score={c.bestScore} />
                <span
                  className="concept-score"
                  style={{ color: colorForScore(c.bestScore) }}
                >
                  {c.bestScore}
                </span>
                <span className="concept-status">{st.label}</span>
              </div>
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
    </aside>
  );
}
