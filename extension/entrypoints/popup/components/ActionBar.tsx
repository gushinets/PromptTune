import { useState } from "react";

interface ActionBarProps {
  improved: string;
  disabled: boolean;
  onSave: () => void;
}

export function ActionBar({ improved, disabled, onSave }: ActionBarProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(improved);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="action-bar">
      <button onClick={handleCopy} disabled={disabled}>
        {copied ? "Copied!" : "Copy improved"}
      </button>
      <button onClick={onSave} disabled={disabled}>
        Save to Library
      </button>
    </div>
  );
}
