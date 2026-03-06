interface PromptFormProps {
  original: string;
  improved: string;
  loading: boolean;
  error: string | null;
  onOriginalChange: (text: string) => void;
  onImprove: () => void;
}

export function PromptForm({
  original,
  improved,
  loading,
  error,
  onOriginalChange,
  onImprove,
}: PromptFormProps) {
  return (
    <div className="prompt-form">
      <label>
        Original prompt
        <textarea
          value={original}
          onChange={(e) => onOriginalChange(e.target.value)}
          placeholder="Enter your prompt here..."
          rows={4}
        />
      </label>

      <button onClick={onImprove} disabled={!original.trim() || loading}>
        {loading ? <span className="spinner" /> : "Improve"}
      </button>

      {error && <div className="error-toast">{error}</div>}

      <label>
        Improved prompt
        <textarea value={improved} readOnly placeholder="Improved version will appear here..." rows={4} />
      </label>
    </div>
  );
}
