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
