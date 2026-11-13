import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { locale, useT } from "@shared/i18n";
import { goalLabel } from "@shared/goal-options";
import { CHANGE_LINE_TRANSLATIONS_RU } from "@shared/change-translations";
import type { ImproveGoal } from "@shared/types";

interface ResultProps {
  improved: string;
  changes: string[];
  goal: ImproveGoal;
  hidden: boolean;
  actions: ReactNode;
  onEdit: () => void;
  onNew: () => void;
  lengthWarning?: string;
  disabled?: boolean;
}
export function OptimizerResult({
  improved,
  changes,
  goal,
  hidden,
  actions,
  onEdit,
  onNew,
  lengthWarning,
  disabled = false,
}: ResultProps) {
  const t = useT();
  const outputId = useId();
  const output = useRef<HTMLTextAreaElement>(null);
  const details = useRef<HTMLDetailsElement>(null);
  const [expanded, setExpanded] = useState(false);
  const localized = useMemo(
    () =>
      changes.map((line) => (locale === "ru" ? (CHANGE_LINE_TRANSLATIONS_RU[line] ?? line) : line)),
    [changes],
  );
  useEffect(() => {
    if (hidden || !output.current) return;
    const field = output.current;
    const resize = () => {
      field.style.height = "auto";
      field.style.height = `${Math.min(200, Math.max(120, field.scrollHeight))}px`;
    };
    resize();
    if (typeof ResizeObserver === "undefined") return;
    let width = field.clientWidth;
    const observer = new ResizeObserver(() => {
      if (field.clientWidth === width) return;
      width = field.clientWidth;
      resize();
    });
    observer.observe(field);
    return () => observer.disconnect();
  }, [improved, hidden]);
  useEffect(() => {
    if (expanded) details.current?.scrollIntoView?.({ block: "nearest" });
  }, [expanded]);
  return (
    <section className="result-screen" hidden={hidden}>
      <div className="result-meta">
        <span className="goal-badge">{goalLabel(t, goal)}</span>
      </div>
      <div className="result-scroll">
        <label htmlFor={outputId} className="section-label">
          {t.labelImprovedPrompt}
        </label>
        <textarea
          id={outputId}
          className="prompt-textarea improved-textarea"
          ref={output}
          readOnly
          value={improved}
        />
        {lengthWarning && (
          <p className="prompt-length-error" role="alert">
            {lengthWarning}
          </p>
        )}
        {actions}
        {localized.length > 0 && (
          <details
            ref={details}
            className="improvements-details"
            onToggle={(event) => setExpanded(event.currentTarget.open)}
          >
            <summary>
              <span>
                {t.whyItChanged}
                <span className="change-count">{localized.length}</span>
              </span>
              <span className="changes-chevron" aria-hidden="true">
                ▾
              </span>
            </summary>
            <ol className="improvements-list">
              {localized.map((line, index) => (
                <li key={`${index}-${line}`}>
                  <span className="change-number" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <p>{line}</p>
                </li>
              ))}
            </ol>
          </details>
        )}
      </div>
      <div className="result-navigation">
        <button className="btn-edit" disabled={disabled} onClick={onEdit}>
          {t.btnEditOriginal}
        </button>
        <button className="btn-new" disabled={disabled} onClick={onNew}>
          {t.btnNew}
        </button>
      </div>
    </section>
  );
}
