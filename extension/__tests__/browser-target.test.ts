import { beforeEach, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.mocked(browser.storage.session.get).mockResolvedValue({
    optimizer_browser_session: "current-session",
  });
  vi.mocked(browser.storage.session.set).mockResolvedValue(undefined);
  vi.mocked(browser.tabs.get).mockResolvedValue({ id: 42 } as never);
});

it.each(["previous-session", undefined])(
  "refuses stale or unversioned tab bindings (%s)",
  async (sessionId) => {
    const { resolveBrowserTarget } = await import("../shared/browser-target");
    await expect(resolveBrowserTarget(42, sessionId)).rejects.toThrow(
      "original browser session has ended",
    );
    expect(browser.tabs.get).not.toHaveBeenCalled();
    expect(browser.tabs.query).not.toHaveBeenCalled();
  },
);

it("resolves a tab only while its browser session still matches", async () => {
  const { resolveBrowserTarget } = await import("../shared/browser-target");
  await expect(resolveBrowserTarget(42, "current-session")).resolves.toEqual({ id: 42 });
  vi.mocked(browser.tabs.get).mockClear();
  vi.mocked(browser.storage.session.get).mockResolvedValue({});
  await expect(resolveBrowserTarget(42, "current-session")).rejects.toThrow();
  expect(browser.tabs.get).not.toHaveBeenCalled();
});

it("keeps the nonce across worker restarts and changes it after session storage is cleared", async () => {
  let state: Record<string, unknown> = {};
  vi.mocked(browser.storage.session.get).mockImplementation(async () => ({ ...state }));
  vi.mocked(browser.storage.session.set).mockImplementation(async (values) => {
    Object.assign(state, values);
  });
  let producer = await import("../shared/browser-target");
  const original = await producer.ensureBrowserSessionId();
  vi.resetModules();
  producer = await import("../shared/browser-target");
  await expect(producer.ensureBrowserSessionId()).resolves.toBe(original);
  state = {};
  vi.resetModules();
  producer = await import("../shared/browser-target");
  expect(await producer.ensureBrowserSessionId()).not.toBe(original);
  expect(browser.storage.local.set).not.toHaveBeenCalled();
});
