import { useEffect, useState, useRef } from "react";
import browser from "webextension-polyfill";
import {
  isPanelHandoff,
  panelHandoffPrefix,
  expectedPanelHandoffs,
  clearPanelHandoffIntents,
  panelHandoffIntentKey,
  type PanelHandoff,
} from "@shared/panel-handoff";
import { useT } from "@shared/i18n";
import { readLocalEntries, type PopupSessionDraft } from "@shared/storage";
import { ensureBrowserSessionId } from "@shared/browser-target";
import { App } from "../popup/App";

function emptyDraft(): PopupSessionDraft {
  return {
    draftSessionId: crypto.randomUUID(),
    draftCreatedAt: Date.now(),
    saveOnEditOnly: true,
    activeTab: "improve",
    original: "",
    improved: "",
    changes: [],
    goal: null,
    lastRequestId: null,
    lastRequestContextKey: null,
    lastModel: null,
    lastLatencyMs: null,
    attemptN: 0,
  };
}

/** Receive sessions for this window, including when its side panel is already open. */
export function SidepanelApp() {
  const t = useT();
  const mountedAt = useRef(Date.now());
  const recoveryDeadline = useRef(0);
  const hadStartupFailure = useRef(false);
  const knownIntents = useRef(new Map<string, number>());
  const retiredHandoffs = useRef(new Set<string>());
  const [freshDraft, setFreshDraft] = useState<PopupSessionDraft>();
  const acceptedHandoffId = useRef<string | undefined>(undefined);
  const [transferWarning, setTransferWarning] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [session, setSession] = useState<PanelHandoff>();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(false);
    setFailed(false);
    let received = false;
    let preservedFreshEditor = false;
    let active = true;
    let unsubscribe = () => {};
    void (async () => {
      try {
        const window = await browser.windows.getCurrent();
        if (!active) return;
        if (window.id === undefined) throw new Error("Panel window unavailable");
        const browserSessionId = await ensureBrowserSessionId();
        if (!active) return;
        const intents = await expectedPanelHandoffs(window.id);
        for (const [key, deadline] of knownIntents.current)
          if (deadline <= Date.now()) knownIntents.current.delete(key);
        for (const intent of intents) {
          const retired = [...retiredHandoffs.current].some(
            (id) => panelHandoffIntentKey(window.id!, id) === intent.key,
          );
          if (!retired) knownIntents.current.set(intent.key, intent.expiresAt);
        }
        // An observed transfer must never fall back to another session, even if
        // its deadline passes during the initial storage read.
        if (intents.length) hadStartupFailure.current = true;
        // Retain the deadline even if another surface removes the marker before Retry.
        recoveryDeadline.current = Math.max(0, ...knownIntents.current.values());
        if (!active) return;
        const prefix = panelHandoffPrefix(window.id);
        let revision = 0;
        const accept = (key: string, value: unknown) => {
          if (
            !active ||
            !isPanelHandoff(value, browserSessionId) ||
            retiredHandoffs.current.has(value.id)
          )
            return;
          received = true;
          recoveryDeadline.current = 0;
          acceptedHandoffId.current = value.id;
          void clearPanelHandoffIntents([
            ...knownIntents.current.keys(),
            panelHandoffIntentKey(window.id!, value.id),
          ]);
          knownIntents.current.clear();
          setFreshDraft(undefined);
          setTransferWarning(false);
          setSession(value);
          setFailed(false);
          setReady(true);
          void browser.storage.local.remove(key).catch(() => undefined);
        };
        const onChanged = (
          changes: Record<string, browser.Storage.StorageChange>,
          area: string,
        ) => {
          if (area !== "local") return;
          for (const [key, change] of Object.entries(changes)) {
            if (!key.startsWith(prefix) || !isPanelHandoff(change.newValue, browserSessionId))
              continue;
            if (retiredHandoffs.current.has(change.newValue.id)) continue;
            revision++;
            accept(key, change.newValue);
          }
        };
        browser.storage.onChanged.addListener(onChanged);
        const onMessage = (message: unknown) => {
          const msg = message as {
            type?: string;
            windowId?: number;
            requestId?: string;
            openedAfter?: number;
            failedHandoffId?: string;
          } | null;
          if (active && msg?.type === "PANEL_HANDOFF_FAILED" && msg.windowId === window.id) {
            return (async () => {
              // Broadcast the acknowledgement: another extension listener may win the direct response.
              await browser.runtime
                .sendMessage({
                  type: "PANEL_ROLLBACK_ACK",
                  windowId: window.id,
                  requestId: msg.requestId,
                })
                .catch(() => undefined);
              if (!active) return { preserved: true };
              if (
                typeof msg.openedAfter === "number" &&
                mountedAt.current >= msg.openedAfter &&
                typeof msg.failedHandoffId === "string" &&
                (acceptedHandoffId.current === undefined ||
                  acceptedHandoffId.current === msg.failedHandoffId)
              ) {
                const response = await browser.runtime
                  .sendMessage({
                    type: "CLOSE_PANEL_FOR_ROLLBACK",
                    windowId: window.id,
                    requestId: msg.requestId,
                    failedHandoffId: msg.failedHandoffId,
                  })
                  .catch(() => undefined);
                const result = response as { closed?: boolean; current?: boolean } | undefined;
                if (result?.closed) return { closed: true };
                if (!active || result?.current === false) return { preserved: true };
                if (result?.current === true) {
                  const key = panelHandoffIntentKey(window.id!, msg.failedHandoffId);
                  retiredHandoffs.current.add(msg.failedHandoffId);
                  if (knownIntents.current.delete(key)) {
                    void clearPanelHandoffIntents([key]);
                    recoveryDeadline.current = Math.max(0, ...knownIntents.current.values());
                    if (
                      acceptedHandoffId.current === undefined &&
                      recoveryDeadline.current <= Date.now()
                    ) {
                      // Startup may still be reading; do not let its late result reset this editor.
                      preservedFreshEditor = true;
                      setFreshDraft(emptyDraft());
                      setFailed(false);
                      setReady(true);
                    }
                  }
                }
              }
              setTransferWarning(true);
              return { preserved: true };
            })();
          }
        };
        browser.runtime.onMessage.addListener(onMessage);
        unsubscribe = () => {
          browser.storage.onChanged.removeListener(onChanged);
          browser.runtime.onMessage.removeListener(onMessage);
        };
        void browser.runtime
          .sendMessage({ type: "PANEL_READY", windowId: window.id })
          .catch(() => undefined);
        const initialRevision = revision;
        let data: Record<string, unknown>;
        try {
          data = await readLocalEntries((key) => key.startsWith(prefix));
        } catch {
          data = await readLocalEntries((key) => key.startsWith(prefix));
        }
        const pending = Object.entries(data).filter(([key]) => key.startsWith(prefix));
        let acceptedKey: string | undefined;
        if (revision === initialRevision) {
          const newest = pending
            .filter(
              (entry): entry is [string, PanelHandoff] =>
                isPanelHandoff(entry[1], browserSessionId) &&
                !retiredHandoffs.current.has(entry[1].id),
            )
            .sort((a, b) => b[1].expiresAt - a[1].expiresAt)[0];
          if (newest) {
            acceptedKey = newest[0];
            accept(...newest);
          }
        }
        // Unique keys let us retire this snapshot without deleting a concurrent transfer.
        const obsolete = pending.map(([key]) => key).filter((key) => key !== acceptedKey);
        if (obsolete.length) await browser.storage.local.remove(obsolete).catch(() => undefined);
        if (active) {
          if (recoveryDeadline.current > Date.now() && !received) {
            hadStartupFailure.current = true;
            setFailed(true);
          } else {
            if (hadStartupFailure.current && !received && !preservedFreshEditor)
              setFreshDraft(emptyDraft());
            setReady(true);
          }
        }
      } catch {
        if (active && !received && !preservedFreshEditor) {
          hadStartupFailure.current = true;
          setFailed(true);
        }
      }
    })();
    return () => {
      active = false;
      unsubscribe();
    };
  }, [attempt]);
  if (failed)
    return (
      <main role="alert" className="mode-onboarding">
        <p>{t.errorPanelReadMessage}</p>
        <button className="btn-secondary" onClick={() => setAttempt((value) => value + 1)}>
          {t.btnRetry}
        </button>
      </main>
    );
  return ready ? (
    <>
      {transferWarning && (
        <aside role="alert" className="mode-onboarding">
          {t.errorPanelTransferPreserved}
        </aside>
      )}
      <App
        key={session?.id ?? freshDraft?.draftSessionId ?? "draft"}
        viewMode="sidepanel"
        initialDraft={session?.draft ?? freshDraft}
      />
    </>
  ) : null;
}
