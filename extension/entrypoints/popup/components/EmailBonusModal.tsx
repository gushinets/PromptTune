import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import browser from "webextension-polyfill";
import { useT } from "@shared/i18n";
import { extractRateLimitResponse } from "@shared/response-utils";
import type { RateLimitInfo } from "@shared/types";
import { changeEmailConsent, getEmailConsent, type EmailConsent } from "@shared/email-consent";

export function EmailBonusModal({
  onClose,
  onConfirmed,
  initialQuota,
  onPending,
  closeLabel,
}: {
  onClose: () => void;
  onConfirmed: (info: RateLimitInfo) => void;
  initialQuota?: RateLimitInfo | null;
  onPending?: (info: RateLimitInfo) => void;
  closeLabel?: string;
}) {
  const t = useT();
  const dialog = useRef<HTMLDivElement>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const close = () => {
    active.current = false;
    onClose();
  };
  const [email, setEmail] = useState(initialQuota?.email ?? "");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">(
    initialQuota?.verification_pending ? "code" : "email",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [consent, setConsent] = useState<EmailConsent | null>(
    import.meta.env.FIREFOX ? null : { native: false, granted: true },
  );
  const [consentBusy, setConsentBusy] = useState(false);
  useEffect(() => {
    if (!import.meta.env.FIREFOX) return;
    let active = true;
    getEmailConsent()
      .then((value) => {
        if (active) setConsent(value);
      })
      .catch(() => {
        if (active) setError(t.emailBonusConsentRequired);
      });
    return () => {
      active = false;
    };
  }, [t]);
  const [resendAt, setResendAt] = useState(
    initialQuota?.verification_resend_at ? Date.parse(initialQuota.verification_resend_at) : 0,
  );
  const [clock, setClock] = useState(Date.now());
  const inFlight = useRef(false);
  const interacted = useRef(false);
  useEffect(() => {
    if (interacted.current || !initialQuota?.verification_pending || !initialQuota.email) return;
    setEmail(initialQuota.email);
    setStage("code");
    setResendAt(
      initialQuota.verification_resend_at ? Date.parse(initialQuota.verification_resend_at) : 0,
    );
  }, [initialQuota]);
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
    if (!active.current) return;
    const pending = extractRateLimitResponse(response);
    if (pending) onPending?.(pending);
    setStage("code");
    setCode("");
    setResendAt(Date.now() + 60_000);
    setClock(Date.now());
  };
  const run = async (action: () => Promise<void>) => {
    if (!active.current || inFlight.current) return;
    if (!consent?.granted || consentBusy) {
      setError(t.emailBonusConsentRequired);
      return;
    }
    interacted.current = true;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (err) {
      if (active.current) setError(err instanceof Error ? err.message : t.errorGenericFallback);
    } finally {
      inFlight.current = false;
      if (active.current) setBusy(false);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      if (stage === "email") return send();
      const response = await browser.runtime.sendMessage({ type: "CONFIRM_EMAIL_BONUS", code });
      if (!active.current) return;
      const info = extractRateLimitResponse(response);
      if (!info || !info.email_verified || !info.bonus_claimed)
        throw new Error(t.errorGenericFallback);
      onConfirmed(info);
    });
  };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
    if (event.key !== "Tab") return;
    const elements = dialog.current?.querySelectorAll<HTMLElement>(
      "button:not(:disabled), input:not(:disabled)",
    );
    if (!elements?.length) return;
    const first = elements.item(0),
      last = elements.item(elements.length - 1);
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
          onClick={close}
          aria-label={closeLabel ?? t.emailBonusClose}
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
              type="text"
              inputMode="email"
              required
              maxLength={254}
              aria-label="Email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => {
                interacted.current = true;
                setEmail(e.target.value);
              }}
              readOnly={busy}
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
                onChange={(e) => {
                  interacted.current = true;
                  setCode(e.target.value);
                }}
                readOnly={busy}
              />
            </>
          )}
          {error && (
            <p className="email-bonus-error" role="alert">
              {error}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
          <button type="submit" className="email-bonus-submit" aria-disabled={busy}>
            {busy
              ? t.emailBonusPending
              : stage === "email"
                ? t.emailBonusRequest
                : t.emailBonusConfirm}
          </button>
        </form>
        {import.meta.env.FIREFOX && (
          <label className="email-bonus-consent">
            <input
              type="checkbox"
              checked={consent?.granted ?? false}
              aria-disabled={!consent || busy || consentBusy}
              onChange={(event) => {
                if (!consent || inFlight.current || consentBusy) return;
                setConsentBusy(true);
                void changeEmailConsent(event.target.checked, consent.native)
                  .then((granted) => {
                    setConsent({ ...consent, granted });
                    setError("");
                  })
                  .catch(() => setError(t.emailBonusConsentRequired))
                  .finally(() => setConsentBusy(false));
              }}
            />
            <span>{t.emailBonusConsent}</span>
          </label>
        )}
        {stage === "code" && (
          <div className="email-bonus-secondary">
            <button
              type="button"
              aria-disabled={busy || clock < resendAt}
              onClick={() => {
                if (clock < resendAt) return;
                void run(async () => {
                  await send();
                  if (active.current) setNotice(t.emailBonusSent);
                });
              }}
            >
              {t.emailBonusResend}
              {clock < resendAt ? ` (${Math.ceil((resendAt - clock) / 1000)})` : ""}
            </button>
            <button
              type="button"
              aria-disabled={busy}
              onClick={() => {
                if (inFlight.current) return;
                interacted.current = true;
                setStage("email");
                setError("");
              }}
            >
              {t.emailBonusChange}
            </button>
          </div>
        )}
        <button type="button" className="email-bonus-return" onClick={close}>
          {closeLabel ?? t.emailBonusClose}
        </button>
      </div>
    </div>
  );
}
