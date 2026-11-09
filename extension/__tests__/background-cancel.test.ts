import { afterEach, beforeEach, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
vi.mock("@shared/constants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@shared/constants")>()),
  ANALYTICS_ENABLED: false,
}));
let handle: (message: unknown) => Promise<unknown>;
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal("defineBackground", (main: () => void) => main);
  Object.assign(browser, { permissions: { onRemoved: { addListener: vi.fn() } } });
  Object.assign(browser.runtime, { onInstalled: { addListener: vi.fn() } });
  vi.mocked(browser.storage.local.get).mockResolvedValue({ installation_id: "i" });
  vi.mocked(browser.storage.local.set).mockResolvedValue(undefined);
  vi.mocked(browser.storage.local.remove).mockResolvedValue(undefined);
  const { default: main } = await import("../entrypoints/background/index");
  (main as unknown as () => void)();
  handle = vi
    .mocked(browser.runtime.onMessage.addListener)
    .mock.calls.at(-1)?.[0] as unknown as typeof handle;
});
afterEach(() => vi.unstubAllGlobals());
it("aborts the actual improve HTTP request when the UI cancels", async () => {
  let started!: () => void;
  const posted = new Promise<void>((resolve) => {
    started = resolve;
  });
  let signal: AbortSignal | undefined;
  global.fetch = vi.fn().mockImplementation(async (url, options?: RequestInit) => {
    if (String(url).endsWith("/v1/config"))
      return { ok: true, json: async () => ({ prompt_input_max_chars: 30000 }) };
    signal = options?.signal ?? undefined;
    started();
    return new Promise((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    });
  });
  const work = handle({
    type: "IMPROVE_REQUEST",
    payload: { text: "short", client_request_id: "r1" },
  }).catch((error) => error);
  await posted;
  await handle({ type: "CANCEL_IMPROVE", payload: { client_request_id: "r1" } });
  expect(signal?.aborted).toBe(true);
  expect(await work).toMatchObject({ name: "AbortError" });
});
it("does not POST if cancellation arrives during configuration lookup", async () => {
  let finishConfig!: (value: unknown) => void;
  global.fetch = vi.fn().mockReturnValue(
    new Promise((resolve) => {
      finishConfig = resolve;
    }),
  );
  const work = handle({
    type: "IMPROVE_REQUEST",
    payload: { text: "short", client_request_id: "r2" },
  }).catch((error) => error);
  await handle({ type: "CANCEL_IMPROVE", payload: { client_request_id: "r2" } });
  finishConfig({ ok: true, json: async () => ({ prompt_input_max_chars: 30000 }) });
  expect(await work).toMatchObject({ name: "AbortError" });
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith("/v1/improve"))).toBe(
    false,
  );
});
