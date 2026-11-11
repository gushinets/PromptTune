import browser from "webextension-polyfill";
import { ensureBrowserSessionId } from "./browser-target";
import { LIMITS } from "./constants";
import { PANEL_HANDOFF_PREFIX } from "./panel-handoff";

export const SELECTION_MENU_ID = "optimize-selection";
export const SELECTION_CLEANUP_ALARM = "optimizer-selection-cleanup";
const SELECTION_KEY_PREFIX = "optimizer_selection_";

export interface PromptSelection {
  text: string;
  sourceTabId?: number;
  sourceSessionId?: string;
}

/** Open an isolated optimizer window without placing selected text in its URL. */
export async function openSelection(
  text: string,
  sourceTabId?: number,
  incognito = false,
): Promise<void> {
  // The optimizer persists drafts in shared local storage, so private selections cannot enter it.
  if (incognito) {
    await browser.windows.create({
      url: `${browser.runtime.getURL("popup.html")}?privateSelectionBlocked=1`,
      incognito: false,
      type: "popup",
      width: 380,
      height: 320,
    });
    return;
  }
  const sourceSessionId = sourceTabId !== undefined ? await ensureBrowserSessionId() : undefined;
  const key = `${SELECTION_KEY_PREFIX}${crypto.randomUUID()}`;
  await browser.storage.local.set({
    [key]: { text, sourceTabId, sourceSessionId, expiresAt: Date.now() + LIMITS.HANDOFF_TTL_MS },
  });
  try {
    await browser.windows.create({
      url: `${browser.runtime.getURL("popup.html")}?selection=${key}`,
      type: "popup",
      width: 380,
      height: 660,
    });
  } catch (error) {
    await browser.storage.local.remove(key);
    throw error;
  }
}

/** Consume only the payload addressed to this window, never a shared pending draft. */
export async function takeSelection(search: string): Promise<PromptSelection | undefined> {
  const key = new URLSearchParams(search).get("selection");
  if (!key?.startsWith(SELECTION_KEY_PREFIX)) return;
  let value: (Partial<PromptSelection> & { expiresAt?: number }) | undefined;
  try {
    const data = await browser.storage.local.get(key);
    value = data[key] as typeof value;
  } catch {
    return;
  } finally {
    await browser.storage.local.remove(key).catch(() => undefined);
  }
  if (!isLiveHandoff(value, Date.now()) || typeof value?.text !== "string" || !value.text.trim())
    return;
  return {
    text: value.text,
    sourceTabId: typeof value.sourceTabId === "number" ? value.sourceTabId : undefined,
    ...(typeof value.sourceSessionId === "string"
      ? { sourceSessionId: value.sourceSessionId }
      : {}),
  };
}

/** Expired and legacy handoffs must never be restored or retained indefinitely. */
function isLiveHandoff(value: unknown, now: number): boolean {
  if (!value || typeof value !== "object") return false;
  const expiresAt = (value as { expiresAt?: unknown }).expiresAt;
  return typeof expiresAt === "number" && Number.isFinite(expiresAt) && expiresAt > now;
}

/** Remove abandoned handoffs without touching drafts, library entries, or live payloads. */
export async function cleanupExpiredHandoffs(): Promise<void> {
  const data = await browser.storage.local.get(null);
  const now = Date.now();
  const staleKeys = Object.keys(data).filter(
    (key) =>
      (key.startsWith(SELECTION_KEY_PREFIX) || key.startsWith(PANEL_HANDOFF_PREFIX)) &&
      !isLiveHandoff(data[key], now),
  );
  if (staleKeys.length) await browser.storage.local.remove(staleKeys);
}

/** Ensure cleanup survives background worker suspension without resetting an existing alarm. */
export async function ensureSelectionCleanupAlarm(): Promise<void> {
  if (!(await browser.alarms.get(SELECTION_CLEANUP_ALARM))) {
    await browser.alarms.create(SELECTION_CLEANUP_ALARM, { periodInMinutes: 1 });
  }
}
