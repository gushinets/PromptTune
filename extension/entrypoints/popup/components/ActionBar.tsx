import { useState } from "react";
import { useT } from "@shared/i18n";

interface ActionBarProps {
  improved: string;
  disabled: boolean;
  onSave: () => Promise<boolean>;
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function BookmarkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

export function ActionBar({ improved, disabled, onSave }: ActionBarProps) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(improved);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleSave = async () => {
    const didSave = await onSave();
    if (!didSave) return;
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="action-bar">
      <button className="btn-secondary" onClick={handleCopy} disabled={disabled}>
        {copied ? <><CheckIcon className="btn-icon" />{t.btnCopied}</> : <><CopyIcon className="btn-icon" />{t.btnCopy}</>}
      </button>
      <button className="btn-secondary" onClick={handleSave} disabled={disabled || saved}>
        {saved ? <><CheckIcon className="btn-icon" />{t.btnSaved}</> : <><BookmarkIcon className="btn-icon" />{t.btnSaveToLibrary}</>}
      </button>
    </div>
  );
}
