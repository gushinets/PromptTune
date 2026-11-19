import { useEffect, useRef, useState } from "react";
import browser from "webextension-polyfill";
import { resolveBrowserTarget } from "@shared/browser-target";
import { extractRateLimitResponse } from "@shared/response-utils";
import { useT } from "@shared/i18n";
import type { RateLimitInfo } from "@shared/types";
import { EmailBonusModal } from "./components/EmailBonusModal";

/** Private hotkey results stay in their source page; this surface never mounts an editor. */
export function QuotaOnlyWindow({
  initialQuota,
  returnTarget,
}: {
  initialQuota?: RateLimitInfo;
  returnTarget?: { tabId: number; sessionId: string };
}) {
  const t = useT();
  const [quota, setQuota] = useState(initialQuota);
  const [offer, setOffer] = useState(
    Boolean(
      initialQuota &&
      !initialQuota.bonus_claimed &&
      !initialQuota.pending_improvements &&
      (initialQuota.remaining ?? initialQuota.per_day_remaining) === 0,
    ),
  );
  const [alreadyClaimed, setAlreadyClaimed] = useState(false);
  const revision = useRef(0);
  useEffect(() => {
    let active = true;
    let initial = !initialQuota;
    const refresh = async () => {
      const request = ++revision.current;
      try {
        const info = extractRateLimitResponse(
          await browser.runtime.sendMessage({ type: "GET_LIMITS" }),
        );
        if (!active || request !== revision.current || !info) return;
        setQuota(info);
        if (
          info.bonus_claimed ||
          (info.remaining ?? info.per_day_remaining) > 0 ||
          info.pending_improvements
        ) {
          setOffer(false);
        } else if (
          initial &&
          !info.bonus_claimed &&
          !info.pending_improvements &&
          (info.remaining ?? info.per_day_remaining) === 0
        )
          setOffer(true);
        initial = false;
      } catch {
        /* Retain the one-shot quota snapshot while offline. */
      }
    };
    void refresh();
    window.addEventListener("focus", refresh);
    const timer = setInterval(refresh, 60_000);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [initialQuota]);
  const applyQuota = (info: RateLimitInfo) => {
    revision.current += 1;
    setQuota(info);
  };
  const returnToSource = async () => {
    try {
      if (returnTarget) {
        const tab = await resolveBrowserTarget(returnTarget.tabId, returnTarget.sessionId);
        if (tab?.id !== undefined) await browser.tabs.update(tab.id, { active: true });
        if (tab?.windowId !== undefined)
          await browser.windows.update(tab.windowId, { focused: true });
      }
    } catch {
      /* The source may have closed; the quota window can still be dismissed. */
    } finally {
      window.close();
    }
  };
  const remaining = quota?.remaining ?? quota?.per_day_remaining ?? 0;
  return (
    <main className="popup-container popup">
      {offer && (
        <EmailBonusModal
          initialQuota={quota}
          closeLabel={t.quotaReturnToTab}
          onPending={applyQuota}
          onClose={() => void returnToSource()}
          onConfirmed={(info) => {
            applyQuota(info);
            setOffer(false);
            setAlreadyClaimed(info.email_bonus_outcome === "already_claimed");
          }}
        />
      )}
      <div className="upgrade-banner">
        <h3>{t.appName}</h3>
        {quota && (
          <p>
            {quota.pending_improvements
              ? t.quotaPending
              : remaining > 0
                ? t.quotaAvailable(remaining)
                : t.exhaustedTitle}
          </p>
        )}
        {alreadyClaimed && <p role="status">{t.emailBonusAlreadyClaimed}</p>}
        {quota?.next_reset_at && (
          <p>{t.quotaRenewal(new Date(quota.next_reset_at).toLocaleDateString())}</p>
        )}
        {quota && !quota.bonus_claimed && !quota.pending_improvements && remaining === 0 && (
          <button className="btn-upgrade" onClick={() => setOffer(true)}>
            {t.emailBonusTitle}
          </button>
        )}
        <button className="btn-secondary" onClick={() => void returnToSource()}>
          {t.quotaReturnToTab}
        </button>
      </div>
    </main>
  );
}
