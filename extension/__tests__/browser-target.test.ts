import { afterEach, beforeEach, expect, it, vi } from "vitest";
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

it("reports a closed bound tab as an ended source session", async () => {
  const { resolveBrowserTarget, SourceSessionEndedError } =
    await import("../shared/browser-target");
  vi.mocked(browser.tabs.get).mockRejectedValueOnce(new Error("No tab with id: 42"));
  await expect(resolveBrowserTarget(42, "current-session")).rejects.toBeInstanceOf(
    SourceSessionEndedError,
  );
  expect(browser.tabs.query).not.toHaveBeenCalled();
});

it("preserves unbound active-tab query errors", async () => {
  const { resolveBrowserTarget } = await import("../shared/browser-target");
  const failure = new Error("Query unavailable");
  vi.mocked(browser.tabs.query).mockRejectedValueOnce(failure);
  await expect(resolveBrowserTarget()).rejects.toBe(failure);
});

afterEach(() => vi.unstubAllGlobals());

it("refreshes the nonce after session storage clears without reloading the module", async () => {
  let session: Record<string, unknown> = {};
  vi.mocked(browser.storage.session.get).mockImplementation(async () => ({ ...session }));
  vi.mocked(browser.storage.session.set).mockImplementation(async (values) => {
    Object.assign(session, values);
  });
  const producer = await import("../shared/browser-target");
  const original = await producer.ensureBrowserSessionId();
  session = {};
  expect(await producer.ensureBrowserSessionId()).not.toBe(original);
});

it("shares the first nonce across independently loaded surfaces using the same Web Lock", async () => {
  const queues = new Map<string, Promise<unknown>>();
  vi.stubGlobal("navigator", {
    locks: {
      request: <T>(name: string, operation: () => Promise<T>) => {
        const result = (queues.get(name) ?? Promise.resolve()).then(operation);
        queues.set(
          name,
          result.catch(() => undefined),
        );
        return result;
      },
    },
  });
  const session: Record<string, unknown> = {};
  vi.mocked(browser.storage.session.get).mockImplementation(async () => ({ ...session }));
  vi.mocked(browser.storage.session.set).mockImplementation(async (values) => {
    Object.assign(session, values);
  });
  const popup = await import("../shared/browser-target");
  vi.resetModules();
  const panel = await import("../shared/browser-target");
  const [a, b] = await Promise.all([
    popup.ensureBrowserSessionId(),
    panel.ensureBrowserSessionId(),
  ]);
  expect(a).toBe(b);
  expect(session.optimizer_browser_session).toBe(a);
  expect(browser.storage.session.set).toHaveBeenCalledOnce();
});
