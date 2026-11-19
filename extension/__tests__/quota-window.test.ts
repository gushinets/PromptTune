import { beforeEach, afterEach, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { openQuotaWindow } from "../shared/quota-window";
import {
  setPopupSessionDraft,
  getPopupSessionDraft,
  type PopupSessionDraft,
} from "../shared/storage";
import { loadSelectionSession } from "../shared/selection";

let state: Record<string, unknown>;
beforeEach(() => {
  vi.clearAllMocks();
  state = {};
  vi.mocked(browser.storage.local.get).mockImplementation(async () => ({ ...state }));
  vi.mocked(browser.storage.local.set).mockImplementation(async (values) => {
    Object.assign(state, values);
  });
  vi.mocked(browser.storage.local.remove).mockImplementation(async (keys) => {
    for (const key of [keys].flat()) delete state[key];
  });
  vi.mocked(browser.storage.session.get).mockResolvedValue({
    optimizer_browser_session: "test-session",
  });
  vi.mocked(browser.windows.create).mockResolvedValue({ id: 7 } as never);
});
afterEach(() => vi.restoreAllMocks());
it("keeps the last result and its source in quota and toolbar restores after a rejected hotkey from another tab", async () => {
  const draft: PopupSessionDraft = {
    draftSessionId: "previous",
    draftCreatedAt: Date.now() - 1000,
    sourceTabId: 42,
    sourceSessionId: "test-session",
    audienceMode: "ai",
    activeTab: "improve",
    optimizer_screen: "result",
    original: "Old prompt",
    improved: "Last successful result",
    changes: [],
    goal: "general",
    result_context: { mode: "ai", goal: "general" },
    lastRequestId: "result",
    lastRequestContextKey: "ai|general|Old prompt",
    lastModel: null,
    lastLatencyMs: null,
    attemptN: 1,
  };
  await setPopupSessionDraft(draft);
  await setPopupSessionDraft({
    ...draft,
    draftSessionId: "new-input",
    draftCreatedAt: Date.now(),
    optimizer_screen: "input",
    improved: "",
    original: "Unsuccessful input",
  });
  await openQuotaWindow("Rejected hotkey prompt", undefined, { id: 99 } as never);
  const options = vi.mocked(browser.windows.create).mock.calls.at(-1)![0]!;
  const standalone = await loadSelectionSession(
    new URL(String(options.url), "https://extension.test").search,
  );
  expect(standalone.initialDraft).toMatchObject({
    improved: "Last successful result",
    sourceTabId: 42,
    original: "Old prompt",
    optimizer_screen: "result",
  });
  expect(await getPopupSessionDraft(false, { independent: true })).toMatchObject({
    improved: "Last successful result",
    sourceTabId: 42,
    optimizer_screen: "result",
  });
});
