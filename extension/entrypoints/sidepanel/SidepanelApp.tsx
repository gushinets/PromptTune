import { useEffect, useState, useRef } from "react";
import browser from "webextension-polyfill";
import {
  isPanelHandoff,
  panelHandoffPrefix,
  expectedPanelHandoffs,
  clearPanelHandoffIntents,
  panelHandoffIntentKey,
  panelHandoffCommitKey,
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
  const editorReady = useRef(false);
  useEffect(() => {
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
        // The native panel can mount before storage.session.set(intent) finishes.
        // Query after the storage snapshot so a completed attempt is recovered by
        // the later local read, and an active opening or rollback blocks restore.
        const backgroundPending = (await browser.runtime.sendMessage({
          type: "GET_PENDING_PANEL_HANDOFFS",
          windowId: window.id,
        })) as { intents?: Array<{ key: string; expiresAt: number }> } | undefined;
        if (backgroundPending?.intents) intents.push(...backgroundPending.intents);
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
        const confirmingKeys = new Set<string>();
        const unavailableKeys = new Set<string>();
        const accept = (key: string, value: unknown) => {
          if (
            !active ||
            !isPanelHandoff(value, browserSessionId) ||
            retiredHandoffs.current.has(value.id)
          )
            return false;
          received = true;
          // A newer confirmed publication supersedes older unavailable candidates.
          for (const unavailableKey of unavailableKeys) {
            if (unavailableKey !== key)
              void browser.storage.local.remove(unavailableKey).catch(() => undefined);
            confirmingKeys.delete(unavailableKey);
          }
          unavailableKeys.clear();
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
          editorReady.current = true;
          setReady(true);
          void browser.storage.local.remove(key).catch(() => undefined);
          if (value.requiresConfirmation)
            void clearPanelHandoffIntents([panelHandoffCommitKey(window.id!, value.id)]);
          return true;
        };
        let acceptanceQueue = Promise.resolve(false);
        const receive = (key: string, value: PanelHandoff): Promise<boolean> => {
          // Protect the queued publication before startup snapshot cleanup can run.
          if (value.requiresConfirmation) confirmingKeys.add(key);
          const next = acceptanceQueue.then(async () => {
            if (!active) return false;
            try {
              if (value.requiresConfirmation) {
                hadStartupFailure.current = true;
                const result = await browser.runtime.sendMessage({
                  type: "CONFIRM_PANEL_HANDOFF",
                  windowId: window.id,
                  id: value.id,
                });
                if (!active) return false;
                const committed = (result as { committed?: unknown } | undefined)?.committed;
                if (typeof committed !== "boolean")
                  throw new Error("Handoff confirmation unavailable");
                confirmingKeys.delete(key);
                unavailableKeys.delete(key);
                if (!committed) {
                  void browser.storage.local.remove(key).catch(() => undefined);
                  return false;
                }
              }
              return accept(key, value);
            } catch (error) {
              if (active) {
                unavailableKeys.add(key);
                hadStartupFailure.current = true;
                setFailed(true);
              }
              throw error;
            }
          });
          // A transient failure must not poison subsequent live publications.
          acceptanceQueue = next.catch(() => false);
          return next;
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
            void receive(key, change.newValue)
              .then((accepted) => {
                if (active && !accepted && !editorReady.current && confirmingKeys.size === 0)
                  setFailed(true);
              })
              .catch(() => undefined);
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
                      editorReady.current = true;
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
            if (await receive(...newest)) acceptedKey = newest[0];
          }
        }
        // Unique keys let us retire this snapshot without deleting a concurrent transfer.
        const obsolete = pending
          .map(([key]) => key)
          .filter((key) => key !== acceptedKey && !confirmingKeys.has(key));
        if (obsolete.length) await browser.storage.local.remove(obsolete).catch(() => undefined);
        if (active) {
          if (confirmingKeys.size > 0) {
            if (unavailableKeys.size > 0) setFailed(true);
          } else if (recoveryDeadline.current > Date.now() && !received) {
            hadStartupFailure.current = true;
            setFailed(true);
          } else {
            if (
              hadStartupFailure.current &&
              !received &&
              !preservedFreshEditor &&
              !editorReady.current
            )
              setFreshDraft(emptyDraft());
            editorReady.current = true;
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
  if (failed && !ready)
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
      {failed && (
        <aside role="alert" className="mode-onboarding">
          <p>{t.errorPanelReadMessage}</p>
          <button className="btn-secondary" onClick={() => setAttempt((value) => value + 1)}>
            {t.btnRetry}
          </button>
        </aside>
      )}
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
