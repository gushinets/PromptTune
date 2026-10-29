import { afterEach, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("blocks a direct background request before analytics or improve POST", async () => {
  vi.stubGlobal("defineBackground", (main: () => void) => main);
  Object.assign(browser, { permissions: { onRemoved: { addListener: vi.fn() } } });
  Object.assign(browser.runtime, { onInstalled: { addListener: vi.fn() } });
  vi.mocked(browser.storage.local.get).mockResolvedValue({});
  global.fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ prompt_input_max_chars: 30000 }) });
  const { default: main } = await import("../entrypoints/background/index");
  (main as unknown as () => void)();
  const listener = vi.mocked(browser.runtime.onMessage.addListener).mock.calls.at(-1)?.[0];
  expect(listener).toBeDefined();
  const handle = listener as unknown as (msg: unknown) => Promise<unknown>;
  await expect(
    handle({ type: "IMPROVE_REQUEST", payload: { text: "x".repeat(30001) } }),
  ).rejects.toThrow("maximum length of 30000");
  expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual([
    "https://api.anytoolai.store/v1/config",
  ]);
  expect(browser.storage.local.set).not.toHaveBeenCalled();
});
