import { useEffect, useId, useState } from "react";
import { useT } from "@shared/i18n";
import type { ImproveGoal } from "@shared/types";

const GOAL_ORDER: ImproveGoal[] = ["general", "clarity", "structure", "concise", "persuasive"];

interface PromptFormProps {
  original: string;
  improved: string;
  improvements: string[];
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
  improvements,
  goal,
  loading,
  onGoalChange,
  onOriginalChange,
  onImprove,
}: PromptFormProps) {
  const t = useT();
  const goalGroupName = useId();
  const [isImprovementsOpen, setIsImprovementsOpen] = useState(true);
  const goalLabels: Record<ImproveGoal, string> = {
    general: t.goalGeneral,
    clarity: t.goalClarity,
    structure: t.goalStructure,
    concise: t.goalConcise,
    persuasive: t.goalPersuasive,
  };

  useEffect(() => {
    if (improvements.length > 0) {
      setIsImprovementsOpen(true);
    }
  }, [improvements]);

  return (
    <div className="prompt-form">
      <span className="section-label">{t.labelOriginalPrompt}</span>
      <textarea
        value={original}
        onChange={(e) => onOriginalChange(e.target.value)}
        placeholder={t.placeholderOriginal}
        rows={4}
      />
      <fieldset className="goal-pills">
        <legend className="sr-only">{t.goalLabel}</legend>
        {GOAL_ORDER.map((option) => {
          const isActive = goal === option;
          return (
            <label key={option} className={`goal-pill${isActive ? " active" : ""}`}>
              <input
                className="goal-pill-input"
                type="radio"
                name={goalGroupName}
                value={option}
                checked={isActive}
                onChange={() => onGoalChange(option)}
                disabled={loading}
              />
              <span className="goal-pill-text">{goalLabels[option]}</span>
            </label>
          );
        })}
      </fieldset>
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
          {improvements.length > 0 && (
            <details
              className="improvements-details"
              open={isImprovementsOpen}
              onToggle={(event) => setIsImprovementsOpen(event.currentTarget.open)}
            >
              <summary>{t.whatWasImproved}</summary>
              <ul className="improvements-list">
                {improvements.map((line, index) => (
                  <li key={`${index}-${line}`}>{line}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
