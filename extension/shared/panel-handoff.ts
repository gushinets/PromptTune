import { isPopupSessionDraft, type PopupSessionDraft } from "./storage";

export function panelHandoffKey(windowId: number): string {
  return `optimizer_panel_handoff_${windowId}`;
}

export interface PanelHandoff {
  id: string;
  draft: PopupSessionDraft;
}

/** Reject malformed transfers before replacing an open panel's optimizer session. */
export function isPanelHandoff(value: unknown): value is PanelHandoff {
  if (!value || typeof value !== "object") return false;
  const handoff = value as Partial<PanelHandoff>;
  return typeof handoff.id === "string" && isPopupSessionDraft(handoff.draft);
}
