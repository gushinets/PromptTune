import browser from "webextension-polyfill";
import { isPopupSessionDraft, type PopupSessionDraft } from "./storage";

export const PANEL_HANDOFF_PREFIX = "optimizer_panel_handoff_";

export function panelHandoffPrefix(windowId: number): string {
  return `${PANEL_HANDOFF_PREFIX}${windowId}_`;
}

export function panelHandoffKey(windowId: number, transferId: string): string {
  return `${panelHandoffPrefix(windowId)}${transferId}`;
}

export interface PanelHandoff {
  id: string;
  expiresAt: number;
  draft: PopupSessionDraft;
}

/** Reject malformed, expired, and legacy transfers before replacing an open session. */
export function isPanelHandoff(value: unknown): value is PanelHandoff {
  if (!value || typeof value !== "object") return false;
  const handoff = value as Partial<PanelHandoff>;
  return (
    typeof handoff.id === "string" &&
    typeof handoff.expiresAt === "number" &&
    Number.isFinite(handoff.expiresAt) &&
    handoff.expiresAt > Date.now() &&
    isPopupSessionDraft(handoff.draft)
  );
}

/** Keep a failed-transfer rollback pending until an older browser's panel subscribes. */
export function requestPanelRollback(windowId: number, openedAfter: number): () => void {
  const requestId = crypto.randomUUID();
  let active = true;
  const cleanup = () => {
    active = false;
    browser.runtime.onMessage.removeListener(onReady);
  };
  const sendClose = async () => {
    try {
      const response = await browser.runtime.sendMessage({
        type: "PANEL_HANDOFF_FAILED",
        windowId,
        requestId,
        openedAfter,
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
    )
      cleanup();
    if (active && msg?.type === "PANEL_READY" && msg.windowId === windowId) void sendClose();
  };
  browser.runtime.onMessage.addListener(onReady);
  void sendClose();
  return cleanup;
}
