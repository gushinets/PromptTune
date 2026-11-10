import { afterEach, beforeEach, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
vi.mock("@shared/constants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@shared/constants")>()),
  ANALYTICS_ENABLED: false,
}));
beforeEach(async () => {
  vi.clearAllMocks();
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
    [key!]: { text: "  Привет 👋\nworld  ", sourceTabId: 42 },
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
    optimizer_selection_first: { text: "  First\n👋  ", sourceTabId: 10 },
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
