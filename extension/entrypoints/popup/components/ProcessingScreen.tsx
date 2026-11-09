import { useEffect, useState } from "react";
import { useT } from "@shared/i18n";
import { goalLabel } from "@shared/goal-options";
import type { AudienceMode, ImproveGoal } from "@shared/types";

export function ProcessingScreen({
  mode,
  goal,
  onCancel,
}: {
  mode: AudienceMode;
  goal: ImproveGoal;
  onCancel: () => void;
}) {
  const t = useT();
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setStep((value) => Math.min(value + 1, 3)), 1400);
    return () => clearInterval(timer);
  }, []);
  const steps = [
    t.processingStepIntent,
    t.processingStepContext,
    t.processingStepStructure,
    t.processingStepConstraints,
  ];
  return (
    <section className="processing-screen" aria-label={t.btnImproving}>
      <div className="processing-spinner" aria-hidden="true" />
      <h2>{t.processingTitle}</h2>
      <p className="processing-context">
        {goalLabel(t, goal)} · {mode === "ai" ? t.modeBadgeAi : t.modeBadgeContent}
      </p>
      <div className="processing-track" role="progressbar" aria-label={t.processingWaiting}>
        <span style={{ width: `${step * 25}%` }} />
      </div>
      <ol className="processing-steps" aria-hidden="true">
        {steps.map((label, index) => (
          <li className={index < step ? "done" : index === step ? "current" : ""} key={label}>
            <span className="step-dot">{index < step ? "✓" : ""}</span>
            {label}
          </li>
        ))}
      </ol>
      <p className="sr-only" role="status">
        {t.processingWaiting}
      </p>
      <button className="btn-cancel" onClick={onCancel}>
        {t.btnCancel}
      </button>
    </section>
  );
}
