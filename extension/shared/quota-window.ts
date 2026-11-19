import browser from "webextension-polyfill";
import { ensureBrowserSessionId } from "./browser-target";
import { initializePopupSessionDraft } from "./storage";
import type { ImproveGoal, ImproveResponse } from "./types";

/** Keep hotkey results in an extension-owned surface when its allowance runs out. */
export async function openQuotaWindow(
  original: string,
  result: ImproveResponse | undefined,
  source: browser.Tabs.Tab,
  goal: ImproveGoal = "general",
): Promise<void> {
  if (source.incognito) {
    // Private page text must never be written to shared extension draft storage.
    await browser.windows.create({
      url: `${browser.runtime.getURL("popup.html")}?quota=1`,
      type: "popup",
      width: 380,
      height: 660,
    });
    return;
  }
  const draftSessionId = crypto.randomUUID();
  const sourceSessionId = await ensureBrowserSessionId();
  await initializePopupSessionDraft({
    draftSessionId,
    draftCreatedAt: Date.now(),
    sourceTabId: source.id,
    sourceSessionId,
    standaloneTarget:
      source.id === undefined ? undefined : { tabId: source.id, sessionId: sourceSessionId },
    audienceMode: "ai",
    activeTab: "improve",
    optimizer_screen: result ? "result" : "input",
    original,
    improved: result?.improved_text ?? "",
    changes: result?.changes ?? [],
    goal,
    result_context: result ? { mode: "ai", goal } : undefined,
    lastRequestId: result?.request_id ?? null,
    lastRequestContextKey: result ? `ai|${goal}|${original.trim()}` : null,
    lastModel: result?.model ?? null,
    lastLatencyMs: result?.latency_ms ?? null,
    attemptN: result ? 1 : 0,
  });
  // loadSelectionSession restores an addressed committed draft before reading any selection payload.
  await browser.windows.create({
    url: `${browser.runtime.getURL("popup.html")}?selection=optimizer_selection_${draftSessionId}&session=${draftSessionId}&quota=1`,
    type: "popup",
    width: 380,
    height: 660,
  });
}
