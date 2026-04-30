import { useT } from "@shared/i18n";
import type { ImproveGoal } from "@shared/types";

const GOAL_ORDER: ImproveGoal[] = ["general", "clarity", "structure", "concise", "persuasive"];

interface PromptFormProps {
  original: string;
  improved: string;
  goal: ImproveGoal;
  loading: boolean;
  onGoalChange: (goal: ImproveGoal) => void;
  onOriginalChange: (text: string) => void;
  onImprove: () => void;
}

function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5z" />
      <path d="M19 14l.75 2.25L22 17l-2.25.75L19 20l-.75-2.25L16 17l2.25-.75z" />
    </svg>
  );
}

export function PromptForm({
  original,
  improved,
  goal,
  loading,
  onGoalChange,
  onOriginalChange,
  onImprove,
}: PromptFormProps) {
  const t = useT();
  const goalLabels: Record<ImproveGoal, string> = {
    general: t.goalGeneral,
    clarity: t.goalClarity,
    structure: t.goalStructure,
    concise: t.goalConcise,
    persuasive: t.goalPersuasive,
  };

  return (
    <div className="prompt-form">
      <span className="section-label">{t.labelOriginalPrompt}</span>
      <textarea
        value={original}
        onChange={(e) => onOriginalChange(e.target.value)}
        placeholder={t.placeholderOriginal}
        rows={4}
      />
      <div className="goal-pills" role="radiogroup" aria-label={t.goalLabel}>
        {GOAL_ORDER.map((option) => {
          const isActive = goal === option;
          return (
            <button
              key={option}
              type="button"
              className={`goal-pill${isActive ? " active" : ""}`}
              onClick={() => onGoalChange(option)}
              aria-pressed={isActive}
              disabled={loading}
            >
              {goalLabels[option]}
            </button>
          );
        })}
      </div>
      <button className="btn-improve" onClick={onImprove} disabled={!original.trim() || loading}>
        {loading ? (
          <>
            <span className="spinner" />
            {t.btnImproving}
          </>
        ) : (
          <>
            <SparkleIcon className="btn-icon" />
            {t.btnImprove}
          </>
        )}
      </button>
      <span className="section-label">{t.labelImprovedPrompt}</span>
      {loading ? (
        <div className="skeleton-loader">
          <div className="skeleton-line" />
          <div className="skeleton-line" />
          <div className="skeleton-line" />
          <div className="skeleton-line" />
        </div>
      ) : (
        <>
          <textarea
            className="improved-textarea"
            value={improved}
            readOnly
            placeholder={t.placeholderImproved}
            rows={4}
          />
          {improved && <p className="improve-hint">{t.improveHint}</p>}
        </>
      )}
    </div>
  );
}
