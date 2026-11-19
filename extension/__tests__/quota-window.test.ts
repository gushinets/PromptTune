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

it("recovers by improvement completion time while generic restoration keeps editor creation order", async () => {
  const now = Date.now();
  const older: PopupSessionDraft & { resultCompletedAt: number } = {
    draftSessionId: "older-editor",
    draftCreatedAt: now - 4000,
    resultCompletedAt: now - 1000,
    sourceTabId: 42,
    sourceSessionId: "test-session",
    audienceMode: "ai",
    activeTab: "improve",
    optimizer_screen: "result",
    original: "Earlier editor prompt",
    improved: "Most recent success",
    changes: [],
    goal: "general",
    result_context: { mode: "ai", goal: "general" },
    lastRequestId: "latest-success",
    lastRequestContextKey: "ai|general|Earlier editor prompt",
    lastModel: null,
    lastLatencyMs: null,
    attemptN: 1,
  };
  await setPopupSessionDraft(older);
  await setPopupSessionDraft({
    ...older,
    draftSessionId: "newer-editor",
    draftCreatedAt: now - 3000,
    resultCompletedAt: now - 2000,
    sourceTabId: 99,
    improved: "Earlier success",
  });
  expect(await getPopupSessionDraft(false)).toMatchObject({ improved: "Earlier success" });
  expect(await getPopupSessionDraft(false, { resultOnly: true })).toMatchObject({
    improved: "Most recent success",
    sourceTabId: 42,
  });
  await openQuotaWindow("Rejected hotkey", undefined, { id: 77 } as never);
  const options = vi.mocked(browser.windows.create).mock.calls.at(-1)![0]!;
  expect(
    (await loadSelectionSession(new URL(String(options.url), "https://extension.test").search))
      .initialDraft,
  ).toMatchObject({
    improved: "Most recent success",
    sourceTabId: 42,
    resultCompletedAt: now - 1000,
  });
  expect(await getPopupSessionDraft(false)).toMatchObject({
    improved: "Most recent success",
    sourceTabId: 42,
  });
});

it("freezes a legacy result's last known success time before later editor autosaves", async () => {
  vi.useFakeTimers();
  const now = Date.now();
  try {
    const legacy: PopupSessionDraft = {
      draftSessionId: "legacy",
      draftCreatedAt: now,
      sourceTabId: 42,
      sourceSessionId: "test-session",
      audienceMode: "ai",
      activeTab: "improve",
      optimizer_screen: "result",
      original: "Legacy prompt",
      improved: "Legacy result",
      changes: [],
      goal: "general",
      lastRequestId: "legacy",
      lastRequestContextKey: "ai|general|Legacy prompt",
      lastModel: null,
      lastLatencyMs: null,
      attemptN: 1,
    };
    await setPopupSessionDraft(legacy);
    const restored = (await getPopupSessionDraft(false))!;
    vi.advanceTimersByTime(1000);
    await setPopupSessionDraft({
      ...legacy,
      draftSessionId: "new-result",
      draftCreatedAt: now - 1000,
      resultCompletedAt: Date.now(),
      improved: "Latest success",
    });
    vi.advanceTimersByTime(1000);
    await setPopupSessionDraft({ ...restored, original: "Edited legacy prompt" });
    expect(await getPopupSessionDraft(false, { resultOnly: true })).toMatchObject({
      improved: "Latest success",
    });
  } finally {
    vi.useRealTimers();
  }
});
