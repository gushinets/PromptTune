import { useId, useMemo } from "react";
import { useT } from "@shared/i18n";
import { countPromptCharacters, formatCharacterCount } from "@shared/prompt-length";
import { AI_GOALS, CONTENT_GOALS, goalLabel } from "@shared/goal-options";
import type { AudienceMode, ImproveGoal } from "@shared/types";

interface PromptFormProps {
  original: string;
  maxInputChars: number | null;
  mode: AudienceMode;
  goal: ImproveGoal;
  loading: boolean;
  hidden?: boolean;
  onGoalChange: (goal: ImproveGoal) => void;
  onOriginalChange: (text: string) => void;
  onImprove: () => void;
}

export function PromptForm({
  original,
  maxInputChars,
  mode,
  goal,
  loading,
  hidden,
  onGoalChange,
  onOriginalChange,
  onImprove,
}: PromptFormProps) {
  const t = useT();
  const group = useId();
  const inputId = useId();
  const descriptionId = useId();
  const characters = useMemo(() => countPromptCharacters(original), [original]);
  const overLimit = maxInputChars !== null && characters > maxInputChars;
  return (
    <div className="prompt-form input-screen" hidden={hidden}>
      <fieldset className="goal-pills">
        <legend className="sr-only">{t.goalLabel}</legend>
        {(mode === "ai" ? AI_GOALS : CONTENT_GOALS).map((option) => (
          <label
            className={`goal-pill${goal === option ? " active" : ""}`}
            key={option}
            title={goalLabel(t, option)}
          >
            <input
              type="radio"
              className="goal-pill-input"
              name={group}
              value={option}
              checked={goal === option}
              disabled={loading}
              onChange={() => onGoalChange(option)}
            />
            <span className="goal-pill-text">{goalLabel(t, option)}</span>
          </label>
        ))}
      </fieldset>
      <div className="input-heading">
        <label className="section-label" htmlFor={inputId}>
          {t.labelOriginalPrompt}
        </label>
        {maxInputChars !== null && (
          <span className={`prompt-length${overLimit ? " is-over-limit" : ""}`}>
            <span className="prompt-length-counter">
              {formatCharacterCount(characters)} / {formatCharacterCount(maxInputChars)}
            </span>
          </span>
        )}
      </div>
      <div className="prompt-textarea-shell original-textarea-shell">
        <textarea
          id={inputId}
          className="prompt-textarea original-textarea"
          value={original}
          onChange={(event) => onOriginalChange(event.target.value)}
          placeholder={t.placeholderOriginal}
          aria-invalid={overLimit}
          aria-describedby={descriptionId}
          spellCheck={false}
        />
      </div>
      <div id={descriptionId} className={`input-description${overLimit ? " is-over-limit" : ""}`}>
        {overLimit && maxInputChars !== null ? (
          <p className="prompt-length-error" role="alert">
            {t.errorInputTooLong(maxInputChars)}
          </p>
        ) : (
          <p className="goal-hint">{t.goalHint(goal)}</p>
        )}
      </div>
      <div className="input-submit">
        <button
          className="btn-improve"
          onClick={onImprove}
          disabled={overLimit || !original.trim() || loading}
        >
          {t.btnImprove}
        </button>
      </div>
    </div>
  );
}
