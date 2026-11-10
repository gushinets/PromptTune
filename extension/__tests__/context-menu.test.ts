import { afterEach, beforeEach, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
vi.mock("@shared/constants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@shared/constants")>()),
  ANALYTICS_ENABLED: false,
}));
beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(browser.storage.local.get).mockResolvedValue({});
  vi.mocked(browser.storage.local.remove).mockResolvedValue(undefined);
  vi.stubGlobal("defineBackground", (main: () => void) => main);
  Object.assign(browser, { permissions: { onRemoved: { addListener: vi.fn() } } });
  Object.assign(browser.runtime, { onInstalled: { addListener: vi.fn() } });
  const { default: main } = await import("../entrypoints/background/index");
  (main as unknown as () => void)();
});
afterEach(() => vi.unstubAllGlobals());
it.each(["install", "update"])("registers the selection-only menu on %s", async (reason) => {
  const installed = vi.mocked(browser.runtime.onInstalled.addListener).mock.calls.at(-1)![0];
  await installed({ reason } as never);
  expect(browser.contextMenus.create).toHaveBeenCalledWith({
    id: "optimize-selection",
    title: "Prompt Optimizer",
    contexts: ["selection"],
  });
});
it("opens the optimizer with an isolated, exact selection payload", async () => {
  const clicked = vi.mocked(browser.contextMenus.onClicked.addListener).mock.calls.at(-1)?.[0];
  expect(clicked).toBeDefined();
  await clicked!(
    { menuItemId: "optimize-selection", selectionText: "  Привет 👋\nworld  " } as never,
    { id: 42 } as never,
  );
  const options = vi.mocked(browser.windows.create).mock.calls[0][0]!;
  expect(options.type).toBe("popup");
  const url = new URL(String(options.url), "https://extension.test");
  expect(url.pathname).toBe("/popup.html");
  const key = url.searchParams.get("selection");
  expect(key).toBeTruthy();
  expect(browser.storage.local.set).toHaveBeenCalledWith({
    [key!]: { text: "  Привет 👋\nworld  ", sourceTabId: 42, expiresAt: expect.any(Number) },
  });
  expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
});
it.each([undefined, "", " \n "])("ignores an empty selection (%s)", async (selectionText) => {
  const clicked = vi.mocked(browser.contextMenus.onClicked.addListener).mock.calls.at(-1)?.[0];
  expect(clicked).toBeDefined();
  await clicked!({ menuItemId: "optimize-selection", selectionText } as never, undefined);
  expect(browser.windows.create).not.toHaveBeenCalled();
});

it("consumes only the selection addressed to its window and removes the temporary text", async () => {
  const { takeSelection } = await import("../shared/selection");
  vi.mocked(browser.storage.local.get).mockResolvedValue({
    optimizer_selection_first: {
      text: "  First\n👋  ",
      sourceTabId: 10,
      expiresAt: Date.now() + 300000,
    },
    optimizer_selection_second: { text: "Second", sourceTabId: 20 },
  });
  await expect(takeSelection("?selection=optimizer_selection_first")).resolves.toEqual({
    text: "  First\n👋  ",
    sourceTabId: 10,
  });
  expect(browser.storage.local.get).toHaveBeenCalledWith("optimizer_selection_first");
  expect(browser.storage.local.remove).toHaveBeenCalledWith("optimizer_selection_first");
  expect(browser.storage.local.remove).not.toHaveBeenCalledWith("optimizer_selection_second");
});

it("does not consume unrelated storage keys from URL parameters", async () => {
  const { takeSelection } = await import("../shared/selection");
  await expect(takeSelection("?selection=library")).resolves.toBeUndefined();
  expect(browser.storage.local.remove).not.toHaveBeenCalled();
});

it("cleans up the selection if opening the window fails", async () => {
  const { openSelection } = await import("../shared/selection");
  vi.mocked(browser.windows.create).mockRejectedValueOnce(new Error("window failed"));
  await expect(openSelection("text", 1)).rejects.toThrow("window failed");
  const stored = vi.mocked(browser.storage.local.set).mock.calls.at(-1)![0];
  expect(browser.storage.local.remove).toHaveBeenCalledWith(Object.keys(stored)[0]);
});

it("still opens the normal popup flow if reading a selection fails and attempts cleanup", async () => {
  const { takeSelection } = await import("../shared/selection");
  vi.mocked(browser.storage.local.get).mockRejectedValueOnce(new Error("read failed"));
  await expect(takeSelection("?selection=optimizer_selection_failed")).resolves.toBeUndefined();
  expect(browser.storage.local.remove).toHaveBeenCalledWith("optimizer_selection_failed");
});

it("retains the retrieved selection if deleting its temporary entry fails", async () => {
  const { takeSelection } = await import("../shared/selection");
  vi.mocked(browser.storage.local.get).mockResolvedValueOnce({
    optimizer_selection_failed: {
      text: "Selected",
      sourceTabId: 42,
      expiresAt: Date.now() + 300000,
    },
  });
  vi.mocked(browser.storage.local.remove).mockRejectedValueOnce(new Error("remove failed"));
  await expect(takeSelection("?selection=optimizer_selection_failed")).resolves.toEqual({
    text: "Selected",
    sourceTabId: 42,
  });
});

it("rejects private selections without persisting or opening their text", async () => {
  const clicked = vi.mocked(browser.contextMenus.onClicked.addListener).mock.calls.at(-1)![0];
  await clicked(
    { menuItemId: "optimize-selection", selectionText: "Confidential private prompt" } as never,
    { id: 88, incognito: true } as never,
  );
  const stored = vi.mocked(browser.storage.local.set).mock.calls.map(([values]) => values);
  expect(JSON.stringify(stored)).not.toContain("Confidential private prompt");
  expect(
    stored.flatMap(Object.keys).filter((key) => key.startsWith("optimizer_selection_")),
  ).toEqual([]);
  expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
  expect(browser.windows.create).toHaveBeenCalledWith(
    expect.objectContaining({
      url: "popup.html?privateSelectionBlocked=1",
    }),
  );
});

it("refuses an expired selection and deletes the abandoned payload", async () => {
  const { takeSelection } = await import("../shared/selection");
  vi.mocked(browser.storage.local.get).mockResolvedValueOnce({
    optimizer_selection_expired: { text: "Abandoned", sourceTabId: 42, expiresAt: Date.now() - 1 },
  });
  await expect(takeSelection("?selection=optimizer_selection_expired")).resolves.toBeUndefined();
  expect(browser.storage.local.remove).toHaveBeenCalledWith("optimizer_selection_expired");
});

it("removes an unconsumed selection on the cleanup alarm without touching live selections or drafts", async () => {
  const onAlarm = vi.mocked(browser.alarms.onAlarm.addListener).mock.calls.at(-1)?.[0];
  expect(onAlarm).toBeDefined();
  vi.mocked(browser.storage.local.get).mockResolvedValue({
    optimizer_selection_abandoned: { text: "Never loaded", expiresAt: Date.now() - 1 },
    optimizer_selection_legacy: { text: "Old version without expiry" },
    optimizer_selection_live: { text: "Loading", expiresAt: Date.now() + 300000 },
    popup_session_draft: { original: "Keep draft" },
    library: [],
  });
  await onAlarm!({ name: "optimizer-selection-cleanup", scheduledTime: Date.now() });
  expect(browser.storage.local.remove).toHaveBeenCalledWith([
    "optimizer_selection_abandoned",
    "optimizer_selection_legacy",
  ]);
});

it("schedules cleanup and clears stale selections after browser startup", async () => {
  const onStartup = vi.mocked(browser.runtime.onStartup.addListener).mock.calls.at(-1)?.[0];
  expect(onStartup).toBeDefined();
  vi.mocked(browser.storage.local.get).mockResolvedValue({
    optimizer_selection_abandoned: { text: "Never loaded", expiresAt: Date.now() - 1 },
  });
  await onStartup!();
  expect(browser.alarms.create).toHaveBeenCalledWith("optimizer-selection-cleanup", {
    periodInMinutes: 1,
  });
  expect(browser.storage.local.remove).toHaveBeenCalledWith(["optimizer_selection_abandoned"]);
});

it("deletes a successfully opened window's payload after five minutes even if it never loads", async () => {
  const { openSelection } = await import("../shared/selection");
  const createdAt = Date.now();
  await openSelection("Abandoned prompt", 42);
  expect(browser.windows.create).toHaveBeenCalledOnce();
  const stored = vi
    .mocked(browser.storage.local.set)
    .mock.calls.map(([values]) => values)
    .find((values) => Object.keys(values).some((key) => key.startsWith("optimizer_selection_")))!;
  const key = Object.keys(stored)[0];
  const expiresAt = (stored[key] as { expiresAt: number }).expiresAt;
  expect(expiresAt).toBeGreaterThanOrEqual(createdAt + 300000);
  expect(expiresAt).toBeLessThanOrEqual(Date.now() + 300000);
  vi.mocked(browser.storage.local.get).mockResolvedValue(stored);
  const clock = vi.spyOn(Date, "now").mockReturnValue(expiresAt);
  try {
    const onAlarm = vi.mocked(browser.alarms.onAlarm.addListener).mock.calls.at(-1)![0];
    await onAlarm({ name: "optimizer-selection-cleanup", scheduledTime: expiresAt });
    expect(browser.storage.local.remove).toHaveBeenCalledWith([key]);
  } finally {
    clock.mockRestore();
  }
});
