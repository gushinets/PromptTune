import { afterEach, beforeEach, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import {
  getPopupSessionDraft,
  setOptimizerHandoff,
  preferPopupSessionDraft,
  setPopupSessionDraft,
  type PopupSessionDraft,
} from "../shared/storage";
import { cleanupExpiredHandoffs, openSelection } from "../shared/selection";

let state: Record<string, unknown>;
const draft = (id: string, original = "prompt"): PopupSessionDraft => ({
  draftSessionId: id,
  draftCreatedAt: Number(id) || 1,
  activeTab: "improve",
  original,
  improved: "",
  changes: [],
  goal: "general",
  lastRequestId: null,
  lastRequestContextKey: null,
  lastModel: null,
  lastLatencyMs: null,
  attemptN: 0,
});
const bytes = (data: Record<string, unknown>) =>
  Object.entries(data).reduce(
    (total, [key, value]) =>
      total + key.length + new TextEncoder().encode(JSON.stringify(value)).length,
    0,
  );
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(browser.storage.session.get).mockResolvedValue({
    optimizer_browser_session: "test-session",
  });
  state = {};
  vi.mocked(browser.windows.getCurrent).mockResolvedValue({ id: 7 } as never);
  vi.mocked(browser.storage.local.get).mockImplementation(async () => ({ ...state }));
  vi.mocked(browser.storage.local.remove).mockImplementation(async (keys) => {
    for (const key of [keys].flat()) delete state[key];
  });
  vi.mocked(browser.storage.local.set).mockImplementation(async (values) => {
    if (bytes({ ...state, ...values }) > 10 * 1024 * 1024) throw new Error("QUOTA_BYTES");
    Object.assign(state, values);
  });
});
afterEach(() => {
  Reflect.deleteProperty(browser.storage.local, "getKeys");
});
it("evicts older drafts before a selection write near quota and leaves library headroom", async () => {
  state.library = "l".repeat(6 * 1024 * 1024 - 100);
  state.pending_library_saves = "p".repeat(1024 * 1024 - 100);
  for (let i = 1; i <= 10; i++)
    state[`optimizer_draft_${i}`] = {
      ...draft(String(i), "я".repeat(140000)),
      updatedAt: Date.now(),
    };
  // Old versions could occupy almost all remaining quota before this upgrade.
  expect(bytes(state)).toBeLessThan(10 * 1024 * 1024);
  const library = state.library;
  const pending = state.pending_library_saves;
  await expect(openSelection("я".repeat(250000))).resolves.toBeUndefined();
  expect(browser.windows.create).toHaveBeenCalled();
  expect(state.library).toBe(library);
  expect(state.pending_library_saves).toBe(pending);
  expect(
    bytes(
      Object.fromEntries(
        Object.entries(state).filter(([key]) => key.startsWith("optimizer_draft_")),
      ),
    ),
  ).toBeLessThanOrEqual(1024 * 1024);
  await setPopupSessionDraft(draft("11", "я".repeat(140000)));
  expect(state.optimizer_draft_11).toMatchObject({ draftSessionId: "11" });
  expect(state.optimizer_draft_1).toBeUndefined();
});
it("bounds small drafts too, including concurrent saves, and keeps the current session", async () => {
  await Promise.all(
    Array.from({ length: 25 }, (_, i) => setPopupSessionDraft(draft(String(i + 1)))),
  );
  expect(Object.keys(state).filter((key) => key.startsWith("optimizer_draft_"))).toHaveLength(10);
  expect(state.optimizer_draft_25).toMatchObject({ original: "prompt" });
  expect(state.optimizer_draft_1).toBeUndefined();
});
it("expires the legacy upgrade copy even while a newer draft wins restoration", async () => {
  state.popup_session_draft = {
    ...draft("legacy"),
    original: "Old private prompt",
    updatedAt: Date.now() - 3 * 60 * 60 * 1000 - 1,
  };
  state.optimizer_draft_2 = { ...draft("2"), updatedAt: Date.now() };
  expect(await getPopupSessionDraft()).toMatchObject({ draftSessionId: "2" });
  await cleanupExpiredHandoffs();
  expect(state.popup_session_draft).toBeUndefined();
  expect(state.optimizer_draft_2).toBeDefined();
});

it("retains a previously saved current draft when a replacement exceeds the byte budget", async () => {
  await setPopupSessionDraft(draft("1", "previous"));
  await expect(setPopupSessionDraft(draft("1", "я".repeat(600000)))).rejects.toThrow();
  expect(state.optimizer_draft_1).toMatchObject({ original: "previous" });
});
it("ignores and consumes an expired popup handoff", async () => {
  state.optimizer_popup_handoff_7 = {
    browserSessionId: "test-session",
    windowId: 7,
    draft: draft("1", "expired"),
    expiresAt: Date.now() - 1,
  };
  state.optimizer_draft_2 = { ...draft("2", "live"), updatedAt: Date.now() };
  expect(await getPopupSessionDraft()).toMatchObject({ original: "live" });
  expect(state.optimizer_popup_handoff_7).toBeUndefined();
});

it.each(["cleanup", "selection"])(
  "migrates a valid untimestamped legacy draft before %s pruning",
  async (path) => {
    const {
      draftSessionId: _id,
      draftCreatedAt: _created,
      ...legacy
    } = draft("legacy", "Keep on upgrade");
    state.popup_session_draft = legacy;
    if (path === "cleanup") await cleanupExpiredHandoffs();
    else await openSelection("New selection");
    expect(state.popup_session_draft).toMatchObject({
      original: "Keep on upgrade",
      updatedAt: expect.any(Number),
    });
    expect(await getPopupSessionDraft(false)).toMatchObject({ original: "Keep on upgrade" });
    const timestamp = (state.popup_session_draft as { updatedAt: number }).updatedAt;
    vi.spyOn(Date, "now").mockReturnValue(timestamp + 3 * 60 * 60 * 1000 + 1);
    try {
      await cleanupExpiredHandoffs();
      expect(state.popup_session_draft).toBeUndefined();
    } finally {
      vi.restoreAllMocks();
    }
  },
);
it("keeps reverse handoffs separate for two browser windows", async () => {
  state.optimizer_draft_3 = { ...draft("3", "Newest independent"), updatedAt: Date.now() };
  vi.mocked(browser.windows.getCurrent).mockResolvedValue({ id: 7 } as never);
  await preferPopupSessionDraft(draft("1", "Window seven"));
  vi.mocked(browser.windows.getCurrent).mockResolvedValue({ id: 8 } as never);
  expect(await getPopupSessionDraft()).toMatchObject({ original: "Newest independent" });
  await preferPopupSessionDraft(draft("2", "Window eight"));
  vi.mocked(browser.windows.getCurrent).mockResolvedValue({ id: 7 } as never);
  expect(await getPopupSessionDraft()).toMatchObject({ original: "Window seven" });
  vi.mocked(browser.windows.getCurrent).mockResolvedValue({ id: 8 } as never);
  expect(await getPopupSessionDraft()).toMatchObject({ original: "Window eight" });
  expect(await getPopupSessionDraft()).toMatchObject({ original: "Newest independent" });
});
it("does not load unrelated library payloads when saving a draft", async () => {
  state.library = "large library";
  state.optimizer_draft_1 = { ...draft("1"), updatedAt: Date.now() };
  // Modern storage can list keys without transferring their values.
  Object.assign(browser.storage.local, { getKeys: vi.fn(async () => Object.keys(state)) });
  vi.mocked(browser.storage.local.get).mockImplementation(async (keys) => {
    if (
      keys === null ||
      keys === undefined ||
      [keys].flat().some((key) => key === "library" || key === "pending_library_saves")
    )
      throw new Error("Unrelated library was read");
    return Object.fromEntries(
      [keys]
        .flat()
        .filter((key) => typeof key === "string" && key in state)
        .map((key) => [key, state[key as string]]),
    );
  });
  await expect(setPopupSessionDraft(draft("2"))).resolves.toBeUndefined();
  expect(state.optimizer_draft_2).toMatchObject({ original: "prompt" });
});

it("cleans only optimizer records without reading library, pending saves or analytics", async () => {
  state.library = "large library";
  state.pending_library_saves = "large pending save";
  state.analytics_queue = ["unrelated analytics"];
  state.optimizer_selection_expired = { text: "old", expiresAt: Date.now() - 1 };
  state.optimizer_panel_handoff_7_expired = { expiresAt: Date.now() - 1 };
  state.optimizer_popup_handoff_7 = { expiresAt: Date.now() - 1 };
  state.optimizer_draft_old = { ...draft("1"), updatedAt: Date.now() - 3 * 60 * 60 * 1000 - 1 };
  state.optimizer_draft_live = { ...draft("2"), updatedAt: Date.now() };
  state.popup_session_draft = {
    ...draft("legacy"),
    updatedAt: Date.now() - 3 * 60 * 60 * 1000 - 1,
  };
  Object.assign(browser.storage.local, { getKeys: vi.fn(async () => Object.keys(state)) });
  vi.mocked(browser.storage.local.get).mockImplementation(async (keys) => {
    if (
      !Array.isArray(keys) ||
      keys.some((key) => ["library", "pending_library_saves", "analytics_queue"].includes(key))
    )
      throw new Error("Unrelated values were loaded");
    return Object.fromEntries(keys.map((key) => [key, state[key]]));
  });
  await expect(cleanupExpiredHandoffs()).resolves.toBeUndefined();
  expect(Object.keys(state).sort()).toEqual([
    "analytics_queue",
    "library",
    "optimizer_draft_live",
    "pending_library_saves",
  ]);
});

it.each(["draft", "handoff"])(
  "keeps every recoverable draft when a %s replacement write fails at capacity",
  async (path) => {
    for (let i = 1; i <= 10; i++) await setPopupSessionDraft(draft(String(i)));
    if (path === "handoff") state.optimizer_draft_0 = { ...draft("0"), updatedAt: Date.now() - 1 };
    const original = structuredClone(state);
    vi.mocked(browser.storage.local.set).mockRejectedValueOnce(
      new Error("Transient storage failure"),
    );
    const write =
      path === "draft"
        ? setPopupSessionDraft(draft("11"))
        : setOptimizerHandoff("optimizer_selection_a", {
            text: "New",
            expiresAt: Date.now() + 1000,
          });
    await expect(write).rejects.toThrow("Transient storage failure");
    expect(Object.keys(state).sort()).toEqual(Object.keys(original).sort());
    for (const key of Object.keys(original))
      expect(JSON.stringify(state[key]) === JSON.stringify(original[key])).toBe(true);
  },
);
it("restores quota-pressure evictions if the retried replacement also fails", async () => {
  state.library = "l".repeat(7 * 1024 * 1024 - 100);
  for (let i = 1; i <= 10; i++)
    state[`optimizer_draft_${i}`] = {
      ...draft(String(i), "я".repeat(140000)),
      updatedAt: Date.now(),
    };
  const original = structuredClone(state);
  const persist = vi.mocked(browser.storage.local.set).getMockImplementation()!;
  vi.mocked(browser.storage.local.set).mockImplementation(async (values) => {
    if ("optimizer_selection_a" in values && bytes({ ...state, ...values }) <= 10 * 1024 * 1024)
      throw new Error("Retried write failed");
    return persist(values);
  });
  await expect(
    setOptimizerHandoff("optimizer_selection_a", { text: "я".repeat(250000) }),
  ).rejects.toThrow();
  expect(Object.keys(state).sort()).toEqual(Object.keys(original).sort());
  for (const key of Object.keys(original))
    expect(JSON.stringify(state[key]) === JSON.stringify(original[key])).toBe(true);
});

it("restores a validated popup handoff even when consuming its key fails", async () => {
  await preferPopupSessionDraft(draft("1", "Recover this panel"));
  vi.mocked(browser.storage.local.remove).mockRejectedValueOnce(new Error("Removal failed"));
  await expect(getPopupSessionDraft()).resolves.toMatchObject({ original: "Recover this panel" });
});

it("keeps a committed handoff successful when draft cleanup fails, then retries eviction on the next save", async () => {
  for (let i = 1; i <= 10; i++) await setPopupSessionDraft(draft(String(i)));
  state.optimizer_draft_0 = { ...draft("0"), updatedAt: Date.now() - 1 };
  vi.mocked(browser.storage.local.remove).mockRejectedValueOnce(new Error("Cleanup failed"));
  await expect(
    setOptimizerHandoff("optimizer_selection_a", { text: "Committed selection" }),
  ).resolves.toBeUndefined();
  expect(state.optimizer_selection_a).toEqual({ text: "Committed selection" });
  expect(state.optimizer_draft_0).toBeDefined();
  await setPopupSessionDraft(draft("11"));
  expect(Object.keys(state).filter((key) => key.startsWith("optimizer_draft_"))).toHaveLength(10);
  expect(state.optimizer_draft_0).toBeUndefined();
});

it.each(["new-browser", undefined])(
  "rejects a reverse handoff when its numeric window ID is reused (new nonce: %s)",
  async (nextSession) => {
    vi.mocked(browser.storage.session.get).mockResolvedValue({
      optimizer_browser_session: "old-browser",
    });
    state.optimizer_draft_2 = { ...draft("2", "Normal restore"), updatedAt: Date.now() };
    await preferPopupSessionDraft(draft("1", "Old browser transfer"));
    vi.mocked(browser.storage.session.get).mockResolvedValue(
      nextSession ? { optimizer_browser_session: nextSession } : {},
    );
    expect(await getPopupSessionDraft()).toMatchObject({ original: "Normal restore" });
  },
);

it.each(["draft", "handoff"])(
  "restores a %s without loading large unrelated storage entries",
  async (path) => {
    state.library = "l".repeat(6 * 1024 * 1024);
    state.pending_library_saves = "p".repeat(1024 * 1024);
    state.analytics_queue = ["unrelated"];
    state.optimizer_draft_1 = { ...draft("1", "Saved draft"), updatedAt: Date.now() };
    if (path === "handoff")
      state.optimizer_popup_handoff_7 = {
        windowId: 7,
        browserSessionId: "test-session",
        draft: draft("2", "Panel transfer"),
        expiresAt: Date.now() + 300000,
      };
    Object.assign(browser.storage.local, { getKeys: vi.fn(async () => Object.keys(state)) });
    vi.mocked(browser.storage.local.get).mockImplementation(async (keys) => {
      if (
        keys === null ||
        keys === undefined ||
        [keys]
          .flat()
          .some((key) =>
            ["library", "pending_library_saves", "analytics_queue"].includes(key as string),
          )
      )
        throw new Error("Unrelated payload was read during restore");
      return Object.fromEntries([keys].flat().map((key) => [key, state[key as string]]));
    });
    await expect(getPopupSessionDraft()).resolves.toMatchObject({
      original: path === "handoff" ? "Panel transfer" : "Saved draft",
    });
  },
);
