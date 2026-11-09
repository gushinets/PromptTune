import { useState, useEffect, useRef } from "react";
import browser from "webextension-polyfill";
import { useT } from "@shared/i18n";
import { trackEvent } from "@shared/analytics";
import type { AnalyticsSource } from "@shared/analytics-types";

interface ActionBarProps {
  improved: string;
  disabled: boolean;
  saveDisabled?: boolean;
  onSave: () => Promise<boolean>;
  requestId: string | null;
  source: AnalyticsSource;
  model?: string | null;
  latencyMs?: number | null;
}

function CopyIcon({ className }: { className?: string }) {
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
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function BookmarkIcon({ className }: { className?: string }) {
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
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
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

function InsertIcon({ className }: { className?: string }) {
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
      <path d="M12 3v12" />
      <path d="M8 11l4 4 4-4" />
      <path d="M4 21h16" />
    </svg>
  );
}

export function ActionBar({
  improved,
  disabled,
  saveDisabled = false,
  onSave,
  requestId,
  source,
  model,
  latencyMs,
}: ActionBarProps) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [inserted, setInserted] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
    },
    [],
  );
  const later = (callback: () => void) => {
    timers.current.push(setTimeout(callback, 1500));
  };

  const handleCopy = async () => {
    setActionError(null);
    try {
      await navigator.clipboard.writeText(improved);
      if (requestId) {
        void trackEvent(
          "result_copied",
          {
            request_id: requestId,
            copy_method: "copy_button",
            model,
            latency_ms: latencyMs,
          },
          source,
        );
      }
      setCopied(true);
      later(() => setCopied(false));
    } catch {
      setActionError(t.errorCopyMessage);
    }
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setActionError(null);
    try {
      const didSave = await onSave();
      if (!didSave) return;
      setSaved(true);
      later(() => setSaved(false));
    } catch {
      setActionError(t.errorLibraryStorageMessage);
    } finally {
      setSaving(false);
    }
  };

  const handleInsert = async () => {
    setActionError(null);
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (typeof tab?.id !== "number") throw new Error("No active tab");
      const response = await browser.tabs.sendMessage(tab.id, {
        type: "PASTE_TEXT",
        payload: { text: improved },
      });
      if ((response as { success?: boolean } | undefined)?.success === false)
        throw new Error("No input field");
      if (requestId) {
        void trackEvent(
          "result_copied",
          {
            request_id: requestId,
            copy_method: "insert_button",
            model,
            latency_ms: latencyMs,
          },
          source,
        );
      }
      setInserted(true);
      later(() => setInserted(false));
    } catch {
      setActionError(t.errorNoEditableField);
    }
  };

  return (
    <div className="action-bar">
      <button className="btn-secondary" onClick={handleCopy} disabled={disabled}>
        {copied ? (
          <>
            <CheckIcon className="btn-icon" />
            {t.btnCopied}
          </>
        ) : (
          <>
            <CopyIcon className="btn-icon" />
            {t.btnCopy}
          </>
        )}
      </button>
      <button
        className="btn-secondary"
        onClick={handleInsert}
        title={t.insertHint}
        disabled={disabled || inserted}
      >
        {inserted ? (
          <>
            <CheckIcon className="btn-icon" />
            {t.btnInserted}
          </>
        ) : (
          <>
            <InsertIcon className="btn-icon" />
            {t.btnInsert}
          </>
        )}
      </button>
      <button
        className="btn-secondary"
        onClick={handleSave}
        title={t.btnSaveToLibrary}
        disabled={disabled || saveDisabled || saved || saving}
      >
        {saved ? (
          <>
            <CheckIcon className="btn-icon" />
            {t.btnSaved}
          </>
        ) : (
          <>
            <BookmarkIcon className="btn-icon" />
            <span aria-hidden="true">{t.btnSaveShort}</span>
            <span className="sr-only">{t.btnSaveToLibrary}</span>
          </>
        )}
      </button>
      {actionError && (
        <p className="action-feedback" role="alert">
          {actionError}
        </p>
      )}
    </div>
  );
}
