import browser from "webextension-polyfill";
import { isPopupSessionDraft, setOptimizerHandoff, type PopupSessionDraft } from "./storage";
import { ensureBrowserSessionId } from "./browser-target";
import { LIMITS } from "./constants";

export const PANEL_HANDOFF_PREFIX = "optimizer_panel_handoff_";

export function panelHandoffPrefix(windowId: number): string {
  return `${PANEL_HANDOFF_PREFIX}${windowId}_`;
}

export function panelHandoffKey(windowId: number, transferId: string): string {
  return `${panelHandoffPrefix(windowId)}${transferId}`;
}

const PANEL_INTENT_PREFIX = "optimizer_panel_intent_";
// Allow a little extra time for a handoff still being published.
const PANEL_INTENT_LIFETIME_MS = LIMITS.HANDOFF_TTL_MS + 60_000;
export function panelHandoffIntentPrefix(windowId: number): string {
  return `${PANEL_INTENT_PREFIX}${windowId}_`;
}

/** Queue intent before open() without awaiting away its user gesture. */
export function expectPanelHandoff(windowId: number, id: string): Promise<void> {
  return browser.storage.session.set({
    [panelHandoffIntentKey(windowId, id)]: { createdAt: Date.now() },
  });
}
export async function expectedPanelHandoffs(
  windowId: number,
): Promise<Array<{ key: string; expiresAt: number }>> {
  const data = await browser.storage.session.get(null);
  const now = Date.now();
  const pending: Array<{ key: string; expiresAt: number }> = [];
  const obsolete: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (!key.startsWith(panelHandoffIntentPrefix(windowId))) continue;
    const createdAt = (value as { createdAt?: unknown } | null)?.createdAt;
    if (
      typeof createdAt === "number" &&
      Number.isFinite(createdAt) &&
      createdAt <= now &&
      createdAt + PANEL_INTENT_LIFETIME_MS > now
    )
      pending.push({ key, expiresAt: createdAt + PANEL_INTENT_LIFETIME_MS });
    else obsolete.push(key);
  }
  await clearPanelHandoffIntents(obsolete);
  return pending;
}
export async function clearPanelHandoffIntents(keys: string[]): Promise<void> {
  if (keys.length) await browser.storage.session.remove(keys).catch(() => undefined);
}
export function panelHandoffIntentKey(windowId: number, id: string): string {
  return `${panelHandoffIntentPrefix(windowId)}${id}`;
}

export interface PanelHandoff {
  browserSessionId: string;
  id: string;
  expiresAt: number;
  draft: PopupSessionDraft;
}

/** Reject malformed, expired, and legacy transfers before replacing an open session. */
export function isPanelHandoff(value: unknown, browserSessionId: string): value is PanelHandoff {
  if (!value || typeof value !== "object") return false;
  const handoff = value as Partial<PanelHandoff>;
  return (
    handoff.browserSessionId === browserSessionId &&
    typeof handoff.id === "string" &&
    typeof handoff.expiresAt === "number" &&
    Number.isFinite(handoff.expiresAt) &&
    handoff.expiresAt > Date.now() &&
    isPopupSessionDraft(handoff.draft)
  );
}

const PANEL_ROLLBACK_TTL_MS = 30_000;
const openingAttempts = new Map<number, string>();
const pendingRollbacks = new Map<
  number,
  {
    requestId: string;
    failedHandoffId: string;
    expiresAt: number;
    cleanup: () => void;
  }
>();

/** Checked in the background after the panel's asynchronous acknowledgement. */
export function isPanelRollbackCurrent(
  windowId: number,
  requestId?: string,
  failedHandoffId?: string,
): boolean {
  const pending = pendingRollbacks.get(windowId);
  return (
    !!pending &&
    pending.requestId === requestId &&
    pending.failedHandoffId === failedHandoffId &&
    pending.expiresAt > Date.now()
  );
}

/** Validate and submit native close together, before another opening can supersede it. */
export async function closePanelForRollback(
  windowId: number,
  requestId?: string,
  failedHandoffId?: string,
): Promise<{ closed: boolean; current: boolean }> {
  if (!isPanelRollbackCurrent(windowId, requestId, failedHandoffId))
    return { closed: false, current: false };
  const panel = (
    browser as typeof browser & {
      sidePanel?: { close?: (options: { windowId: number }) => Promise<void> };
    }
  ).sidePanel;
  try {
    if (!panel?.close) return { closed: false, current: true };
    await panel.close({ windowId });
    return { closed: true, current: true };
  } catch {
    return { closed: false, current: true };
  }
}

/** Keep a failed-transfer rollback pending until an older browser's panel subscribes. */
export function requestPanelRollback(
  windowId: number,
  openedAfter: number,
  failedHandoffId: string,
): () => void {
  pendingRollbacks.get(windowId)?.cleanup();
  const requestId = crypto.randomUUID();
  const expiresAt = Date.now() + PANEL_ROLLBACK_TTL_MS;
  let active = true;
  let listening = true;
  const cleanup = () => {
    active = false;
    clearTimeout(timer);
    browser.runtime.onMessage.removeListener(onReady);
    if (pendingRollbacks.get(windowId)?.requestId === requestId) pendingRollbacks.delete(windowId);
  };
  const sendClose = async () => {
    try {
      const response = await browser.runtime.sendMessage({
        type: "PANEL_HANDOFF_FAILED",
        windowId,
        requestId,
        openedAfter,
        failedHandoffId,
      });
      if (
        active &&
        ((response as { closed?: boolean } | undefined)?.closed ||
          (response as { preserved?: boolean } | undefined)?.preserved)
      )
        cleanup();
    } catch {
      // A panel that is still starting will announce readiness after subscribing.
    }
  };
  const onReady = (message: unknown) => {
    const msg = message as { type?: string; windowId?: number; requestId?: string } | null;
    if (
      active &&
      msg?.type === "PANEL_ROLLBACK_ACK" &&
      msg.windowId === windowId &&
      msg.requestId === requestId
    ) {
      // Stop retries, but retain validation until the receiver makes its decision.
      listening = false;
      browser.runtime.onMessage.removeListener(onReady);
    }
    if (active && listening && msg?.type === "PANEL_READY" && msg.windowId === windowId)
      void sendClose();
  };
  const timer = setTimeout(cleanup, PANEL_ROLLBACK_TTL_MS);
  pendingRollbacks.set(windowId, { requestId, failedHandoffId, expiresAt, cleanup });
  browser.runtime.onMessage.addListener(onReady);
  void sendClose();
  return cleanup;
}

export interface OpenOptimizerPanel {
  type: "OPEN_OPTIMIZER_PANEL";
  windowId: number;
  tabId: number;
  draft: PopupSessionDraft;
}

/** Run in the background: opening a panel can destroy the calling toolbar popup. */
export async function openOptimizerPanel(message: OpenOptimizerPanel): Promise<{ ok: true }> {
  if (
    !Number.isInteger(message.windowId) ||
    !Number.isInteger(message.tabId) ||
    !isPopupSessionDraft(message.draft)
  )
    throw new Error("Invalid panel transfer");
  const sidePanel = (
    browser as typeof browser & {
      sidePanel?: { open: (options: { windowId: number }) => Promise<void> };
    }
  ).sidePanel;
  if (!sidePanel) throw new Error("Side panel unavailable");
  const id = crypto.randomUUID();
  pendingRollbacks.get(message.windowId)?.cleanup();
  openingAttempts.set(message.windowId, id);
  const openedAfter = Date.now();
  let sourceChanged = false;
  const onRemoved = (tabId: number) => {
    if (tabId === message.tabId) sourceChanged = true;
  };
  const onAttached = (tabId: number, info: browser.Tabs.OnAttachedAttachInfoType) => {
    if (tabId === message.tabId && info.newWindowId !== message.windowId) sourceChanged = true;
  };
  browser.tabs.onRemoved.addListener(onRemoved);
  browser.tabs.onAttached.addListener(onAttached);
  const intent = expectPanelHandoff(message.windowId, id).then(
    () => null,
    (error: unknown) => ({ error }),
  );
  let opened = false;
  try {
    // Keep this call synchronous with the incoming user-gesture message.
    await sidePanel.open({ windowId: message.windowId });
    opened = true;
    const failure = await intent;
    if (failure) throw failure.error;
    const browserSessionId = await ensureBrowserSessionId();
    if (
      openingAttempts.get(message.windowId) !== id ||
      sourceChanged ||
      (message.draft.sourceTabId !== undefined &&
        message.draft.sourceSessionId !== browserSessionId)
    )
      throw new Error("Source changed while opening panel");
    if (message.draft.sourceTabId !== undefined) {
      const source = await browser.tabs.get(message.draft.sourceTabId);
      if (source.id !== message.tabId || source.windowId !== message.windowId || sourceChanged)
        throw new Error("Source tab no longer belongs to the target window");
    }
    if (openingAttempts.get(message.windowId) !== id) throw new Error("Panel attempt superseded");
    await setOptimizerHandoff(panelHandoffKey(message.windowId, id), {
      id,
      browserSessionId,
      draft: message.draft,
      expiresAt: Date.now() + LIMITS.HANDOFF_TTL_MS,
    });
    return { ok: true };
  } catch (error) {
    await intent;
    await clearPanelHandoffIntents([panelHandoffIntentKey(message.windowId, id)]);
    if (opened && openingAttempts.get(message.windowId) === id)
      requestPanelRollback(message.windowId, openedAfter, id);
    throw error;
  } finally {
    if (openingAttempts.get(message.windowId) === id) openingAttempts.delete(message.windowId);
    browser.tabs.onRemoved.removeListener(onRemoved);
    browser.tabs.onAttached.removeListener(onAttached);
  }
}
