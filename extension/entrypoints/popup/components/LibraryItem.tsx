import { useState } from "react";
import { useT } from "@shared/i18n";
import type { LibraryEntry } from "@shared/storage";

interface LibraryItemProps {
  entry: LibraryEntry;
  onDelete: (id: string) => void;
}

const SITE_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  perplexity: "Perplexity",
  groq: "Groq",
  deepseek: "Deepseek",
};

function CopyIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

export function LibraryItem({ entry, onDelete }: LibraryItemProps) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  const siteKey = entry.site?.toLowerCase() ?? "";
  const siteLabel = SITE_LABELS[siteKey] ?? entry.site ?? t.siteGeneral;

  function relativeTime(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return t.timeJustNow;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return t.timeMinsAgo(minutes);
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t.timeHoursAgo(hours);
    const days = Math.floor(hours / 24);
    if (days === 1) return t.timeYesterday;
    if (days < 30) return t.timeDaysAgo(days);
    return t.timeMonthsAgo(Math.floor(days / 30));
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(entry.improved);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="library-item">
      <div className="library-item-header">
        <span className="library-item-site">
          <span className={`site-dot ${siteKey}`} />
          {siteLabel}
        </span>
        <span className="library-item-time">{relativeTime(entry.createdAt)}</span>
      </div>
      <div className="library-item-text">
        <strong>{t.labelOriginal}</strong> {entry.original}
      </div>
      <div className="library-item-improved">
        <strong>{t.labelImproved}</strong> {entry.improved}
      </div>
      <div className="library-item-actions">
        <button
          className="icon-btn"
          title={copied ? t.titleCopied : t.titleCopy}
          onClick={handleCopy}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>
        <button
          className="icon-btn btn-delete"
          title={t.titleDelete}
          onClick={() => onDelete(entry.id)}
        >
          <TrashIcon />
        </button>
      </div>
    </div>
  );
}
