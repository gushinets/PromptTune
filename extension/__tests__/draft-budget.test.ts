import { beforeEach, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import {
  getPopupSessionDraft,
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
  state = {};
  vi.mocked(browser.storage.local.get).mockImplementation(async () => ({ ...state }));
  vi.mocked(browser.storage.local.remove).mockImplementation(async (keys) => {
    for (const key of [keys].flat()) delete state[key];
  });
  vi.mocked(browser.storage.local.set).mockImplementation(async (values) => {
    if (bytes({ ...state, ...values }) > 10 * 1024 * 1024) throw new Error("QUOTA_BYTES");
    Object.assign(state, values);
  });
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
  state.optimizer_popup_handoff = { draft: draft("1", "expired"), expiresAt: Date.now() - 1 };
  state.optimizer_draft_2 = { ...draft("2", "live"), updatedAt: Date.now() };
  expect(await getPopupSessionDraft()).toMatchObject({ original: "live" });
  expect(state.optimizer_popup_handoff).toBeUndefined();
});
