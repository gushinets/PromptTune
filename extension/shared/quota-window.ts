import browser from "webextension-polyfill";
import { ensureBrowserSessionId } from "./browser-target";
import { initializePopupSessionDraft, setOptimizerHandoff } from "./storage";
import { LIMITS } from "./constants";
import type { ImproveGoal, ImproveResponse } from "./types";

/** Keep hotkey results in an extension-owned surface when its allowance runs out. */
export async function openQuotaWindow(
  original: string,
  result: ImproveResponse | undefined,
  source: browser.Tabs.Tab,
  goal: ImproveGoal = "general",
): Promise<void> {
  if (source.incognito) {
    // Transfer only quota fields: private text and results never enter shared storage.
    const id = crypto.randomUUID();
    const key = `optimizer_selection_${id}`;
    const limits = result?.rate_limit;
    if (limits) {
      await setOptimizerHandoff(key, {
        quotaOnly: true,
        sourceSessionId: await ensureBrowserSessionId(),
        expiresAt: Date.now() + LIMITS.HANDOFF_TTL_MS,
        quota: {
          remaining: limits.remaining,
          total: limits.total,
          pending_improvements: limits.pending_improvements,
          exhausted: limits.exhausted,
          bonus_claimed: limits.bonus_claimed,
          email_verified: limits.email_verified,
          next_reset_at: limits.next_reset_at,
          per_day_remaining: limits.per_day_remaining,
          per_day_total: limits.per_day_total,
          per_minute_remaining: limits.per_minute_remaining,
          per_minute_total: limits.per_minute_total,
        },
      });
    }
    try {
      await browser.windows.create({
        url: `${browser.runtime.getURL("popup.html")}?quota=1${limits ? `&quotaHandoff=${key}` : ""}`,
        type: "popup",
        width: 380,
        height: 660,
      });
    } catch (error) {
      if (limits) await browser.storage.local.remove(key).catch(() => undefined);
      throw error;
    }
    return;
  }
  const draftSessionId = crypto.randomUUID();
  const sourceSessionId = await ensureBrowserSessionId();
  await initializePopupSessionDraft(
    {
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
      ...(result ? { resultCompletedAt: result.completed_at ?? Date.now() } : {}),
    },
    { restoreLatestResult: !result },
  );
  if (result?.rate_limit) {
    await setOptimizerHandoff(`optimizer_selection_${draftSessionId}`, {
      text: original,
      sourceTabId: source.id,
      sourceSessionId,
      draftSessionId,
      quota: result.rate_limit,
      expiresAt: Date.now() + LIMITS.HANDOFF_TTL_MS,
    });
  }
  // loadSelectionSession restores an addressed committed draft before reading any selection payload.
  await browser.windows.create({
    url: `${browser.runtime.getURL("popup.html")}?selection=optimizer_selection_${draftSessionId}&session=${draftSessionId}&quota=1`,
    type: "popup",
    width: 380,
    height: 660,
  });
}
