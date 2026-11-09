import { afterEach, beforeEach, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { createPortPair } from "./port-mock";
vi.mock("@shared/constants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@shared/constants")>()),
  ANALYTICS_ENABLED: false,
}));
let handle: (message: unknown) => Promise<unknown>;
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal("defineBackground", (main: () => void) => main);
  Object.assign(browser, { permissions: { onRemoved: { addListener: vi.fn() } } });
  Object.assign(browser.runtime, {
    onInstalled: { addListener: vi.fn() },
    onConnect: { addListener: vi.fn() },
  });
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

async function claimOwner(id: string) {
  const { client, server } = createPortPair();
  const connect = vi.mocked(browser.runtime.onConnect.addListener).mock.calls.at(-1)?.[0];
  expect(connect).toBeTypeOf("function");
  connect!(server);
  client.postMessage({ client_request_id: id });
  await Promise.resolve();
  return client;
}

it("rejects an owned request if its document disconnected before submission", async () => {
  const port = await claimOwner("gone");
  port.disconnect();
  await Promise.resolve();
  global.fetch = vi.fn();
  await expect(
    handle({
      type: "IMPROVE_REQUEST",
      payload: { text: "short", client_request_id: "gone", owner_required: true },
    }),
  ).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});

it("aborts the actual HTTP request when the owner disconnects without React cleanup", async () => {
  const port = await claimOwner("owned");
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
    payload: { text: "short", client_request_id: "owned", owner_required: true },
  }).catch((error) => error);
  await posted;
  port.disconnect();
  expect(await work).toMatchObject({ name: "AbortError" });
  expect(signal?.aborted).toBe(true);
});

it("does not POST if the owner disconnects during configuration lookup", async () => {
  const port = await claimOwner("config-owner");
  let finish!: (value: unknown) => void;
  global.fetch = vi.fn().mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const work = handle({
    type: "IMPROVE_REQUEST",
    payload: { text: "short", client_request_id: "config-owner", owner_required: true },
  }).catch((error) => error);
  port.disconnect();
  await Promise.resolve();
  finish({ ok: true, json: async () => ({ prompt_input_max_chars: 30000 }) });
  expect(await work).toMatchObject({ name: "AbortError" });
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith("/v1/improve"))).toBe(
    false,
  );
});
it("disconnecting one surface does not cancel another surface's request", async () => {
  const first = await claimOwner("first");
  const second = await claimOwner("second");
  const signals = new Map<string, AbortSignal>();
  let started!: () => void;
  const posted = new Promise<void>((resolve) => {
    started = resolve;
  });
  global.fetch = vi.fn().mockImplementation(async (url, options?: RequestInit) => {
    if (String(url).endsWith("/v1/config"))
      return { ok: true, json: async () => ({ prompt_input_max_chars: 30000 }) };
    const signal = options!.signal!;
    signals.set(JSON.parse(String(options!.body)).text, signal);
    if (signals.size === 2) started();
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    });
  });
  const run = (id: string) =>
    handle({
      type: "IMPROVE_REQUEST",
      payload: { text: id, client_request_id: id, owner_required: true },
    }).catch((error) => error);
  const workA = run("first");
  const workB = run("second");
  await posted;
  first.disconnect();
  expect(await workA).toMatchObject({ name: "AbortError" });
  expect(signals.get("second")?.aborted).toBe(false);
  second.disconnect();
  expect(await workB).toMatchObject({ name: "AbortError" });
});

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
