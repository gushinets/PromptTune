import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import browser from "webextension-polyfill";
import { useT } from "@shared/i18n";
import { extractRateLimitResponse } from "@shared/response-utils";
import type { RateLimitInfo } from "@shared/types";

export function EmailBonusModal({
  onClose,
  onConfirmed,
  initialQuota,
  onPending,
}: {
  onClose: () => void;
  onConfirmed: (info: RateLimitInfo) => void;
  initialQuota?: RateLimitInfo | null;
  onPending?: (info: RateLimitInfo) => void;
}) {
  const t = useT();
  const dialog = useRef<HTMLDivElement>(null);
  const [email, setEmail] = useState(initialQuota?.email ?? "");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">(
    initialQuota?.verification_pending ? "code" : "email",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [resendAt, setResendAt] = useState(
    initialQuota?.verification_resend_at ? Date.parse(initialQuota.verification_resend_at) : 0,
  );
  const [clock, setClock] = useState(Date.now());
  const inFlight = useRef(false);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLInputElement>("input")?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => {
    dialog.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, [stage]);
  useEffect(() => {
    if (stage !== "code") return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [stage]);
  const send = async () => {
    const response = await browser.runtime.sendMessage({ type: "REQUEST_EMAIL_BONUS", email });
    const pending = extractRateLimitResponse(response);
    if (pending) onPending?.(pending);
    setStage("code");
    setCode("");
    setResendAt(Date.now() + 60_000);
    setClock(Date.now());
  };
  const run = async (action: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.errorGenericFallback);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      if (stage === "email") return send();
      const response = await browser.runtime.sendMessage({ type: "CONFIRM_EMAIL_BONUS", code });
      const info = extractRateLimitResponse(response);
      if (!info || !info.email_verified || !info.bonus_claimed)
        throw new Error(t.errorGenericFallback);
      onConfirmed(info);
    });
  };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
    if (event.key !== "Tab") return;
    const elements = dialog.current?.querySelectorAll<HTMLElement>(
      "button:not(:disabled), input:not(:disabled)",
    );
    if (!elements?.length) return;
    const first = elements[0],
      last = elements[elements.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  return (
    <div className="email-bonus-overlay" onKeyDown={keyDown}>
      <div
        ref={dialog}
        className="email-bonus-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="email-bonus-heading"
        aria-describedby="email-bonus-description"
      >
        <button
          data-close
          type="button"
          className="email-bonus-close"
          onClick={onClose}
          aria-label={t.emailBonusClose}
        >
          ×
        </button>
        <div className="email-bonus-icon" aria-hidden="true">
          ✉
        </div>
        <h2 id="email-bonus-heading">
          {stage === "email" ? t.emailBonusTitle : t.emailBonusCodeTitle}
        </h2>
        <p id="email-bonus-description">
          {stage === "email" ? t.emailBonusDescription : t.emailBonusCodeDescription}
        </p>
        <form onSubmit={submit}>
          {stage === "email" ? (
            <input
              autoComplete="email"
              type="email"
              required
              maxLength={254}
              aria-label="Email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
            />
          ) : (
            <>
              <p className="email-bonus-address">{email}</p>
              <input
                type="text"
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                required
                maxLength={6}
                aria-label={t.emailBonusCodeLabel}
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={busy}
              />
            </>
          )}
          {error && (
            <p className="email-bonus-error" role="alert">
              {error}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
          <button type="submit" className="email-bonus-submit" disabled={busy}>
            {busy
              ? t.emailBonusPending
              : stage === "email"
                ? t.emailBonusRequest
                : t.emailBonusConfirm}
          </button>
        </form>
        {stage === "code" && (
          <div className="email-bonus-secondary">
            <button
              type="button"
              disabled={busy || clock < resendAt}
              onClick={() =>
                void run(async () => {
                  await send();
                  setNotice(t.emailBonusSent);
                })
              }
            >
              {t.emailBonusResend}
              {clock < resendAt ? ` (${Math.ceil((resendAt - clock) / 1000)})` : ""}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setStage("email");
                setError("");
              }}
            >
              {t.emailBonusChange}
            </button>
          </div>
        )}
        <button type="button" className="email-bonus-return" onClick={onClose}>
          {t.emailBonusClose}
        </button>
      </div>
    </div>
  );
}
