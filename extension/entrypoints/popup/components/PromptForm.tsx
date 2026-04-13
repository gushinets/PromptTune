import { useT } from "@shared/i18n";

interface PromptFormProps {
  original: string;
  improved: string;
  loading: boolean;
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
  loading,
  onOriginalChange,
  onImprove,
}: PromptFormProps) {
  const t = useT();

  return (
    <div className="prompt-form">
      <span className="section-label">{t.labelOriginalPrompt}</span>
      <textarea
        value={original}
        onChange={(e) => onOriginalChange(e.target.value)}
        placeholder={t.placeholderOriginal}
        rows={4}
      />
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
