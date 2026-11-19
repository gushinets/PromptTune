import { beforeEach, afterEach, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { apiClient } from "../shared/api-client";
import { getInstallationId } from "../shared/storage";
import {
  createInstallationRegistrar,
  INSTALLATION_REGISTRATION_ALARM,
} from "../shared/installation-registration";

vi.mock("@shared/constants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@shared/constants")>()),
  ANALYTICS_ENABLED: false,
}));
let state: Record<string, unknown>;
let alarms: Map<string, browser.Alarms.Alarm>;
beforeEach(() => {
  vi.clearAllMocks();
  alarms = new Map();
  vi.mocked(browser.alarms.create).mockImplementation(async (name) => {
    if (typeof name !== "string") throw new Error("Named alarm required");
    alarms.set(name, { name, scheduledTime: Date.now(), periodInMinutes: 5 });
  });
  vi.mocked(browser.alarms.getAll).mockImplementation(async () => [...alarms.values()]);
  vi.mocked(browser.alarms.clear).mockImplementation(async (name) => alarms.delete(name!));
  vi.mocked(browser.tabs.create).mockResolvedValue({ id: 1 } as never);
  state = { installation_id: "installed", install_at: "2026-01-05T10:00:00.000Z" };
  vi.mocked(browser.storage.local.get).mockImplementation(async () => ({ ...state }));
  vi.mocked(browser.storage.local.set).mockImplementation(async (value) => {
    Object.assign(state, value);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("retries an offline registration with the original install timestamp and marks success", async () => {
  const request = vi
    .spyOn(apiClient, "registerInstallation")
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ registered: true });
  const register = createInstallationRegistrar();
  await expect(register()).rejects.toThrow("offline");
  expect(browser.alarms.create).toHaveBeenCalledWith(INSTALLATION_REGISTRATION_ALARM, {
    periodInMinutes: 5,
  });
  await register();
  expect(request).toHaveBeenLastCalledWith("installed", "2026-01-05T10:00:00.000Z");
  await createInstallationRegistrar()();
  expect(request).toHaveBeenCalledTimes(2);
  expect(browser.alarms.clear).toHaveBeenCalledWith(INSTALLATION_REGISTRATION_ALARM);
});
it("shares an in-flight registration between quota callers", async () => {
  let finish!: (value: { registered: boolean }) => void;
  const request = vi.spyOn(apiClient, "registerInstallation").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const register = createInstallationRegistrar();
  const first = register(),
    second = register();
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  finish({ registered: true });
  await Promise.all([first, second]);
});

it("registers from onInstalled and retries its original timestamp from the alarm", async () => {
  state = { installation_id: "installed" };
  vi.stubGlobal("defineBackground", (main: () => void) => main);
  Object.assign(browser, { permissions: { onRemoved: { addListener: vi.fn() } } });
  Object.assign(browser.runtime, { onInstalled: { addListener: vi.fn() } });
  vi.mocked(browser.runtime.getManifest).mockReturnValue({ version: "0.1.0" } as never);
  const request = vi
    .spyOn(apiClient, "registerInstallation")
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ registered: true });
  const { default: main } = await import("../entrypoints/background/index");
  (main as unknown as () => void)();
  const installed = vi.mocked(browser.runtime.onInstalled.addListener).mock.calls.at(-1)![0];
  await installed({ reason: "install" } as never);
  expect(request).toHaveBeenCalledTimes(1);
  const timestamp = request.mock.calls[0][1];
  const alarm = vi.mocked(browser.alarms.onAlarm.addListener).mock.calls.at(-1)![0];
  await alarm({ name: INSTALLATION_REGISTRATION_ALARM } as never);
  expect(request).toHaveBeenLastCalledWith("installed", timestamp);
  expect(request).toHaveBeenCalledTimes(2);
});

it("waits for installation registration before the first quota lookup", async () => {
  vi.stubGlobal("defineBackground", (main: () => void) => main);
  Object.assign(browser, { permissions: { onRemoved: { addListener: vi.fn() } } });
  Object.assign(browser.runtime, { onInstalled: { addListener: vi.fn() } });
  vi.mocked(browser.runtime.getManifest).mockReturnValue({ version: "0.1.0" } as never);
  let finish!: (value: { registered: boolean }) => void;
  const request = vi.spyOn(apiClient, "registerInstallation").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const limits = vi.spyOn(apiClient, "limits").mockResolvedValue({
    per_day_remaining: 50,
    per_day_total: 50,
    per_minute_remaining: 10,
    per_minute_total: 10,
  });
  const { default: main } = await import("../entrypoints/background/index");
  (main as unknown as () => void)();
  const handle = vi.mocked(browser.runtime.onMessage.addListener).mock.calls.at(-1)![0];
  const result = handle({ type: "GET_LIMITS" }, {}, vi.fn());
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  expect(limits).not.toHaveBeenCalled();
  finish({ registered: true });
  await result;
  expect(limits).toHaveBeenCalledWith("installed");
});

it("keeps registration and first quota access on the same ID during a concurrent analytics lookup", async () => {
  state = { install_at: "2026-01-31T20:59:59.000Z" };
  vi.stubGlobal("defineBackground", (main: () => void) => main);
  Object.assign(browser, { permissions: { onRemoved: { addListener: vi.fn() } } });
  Object.assign(browser.runtime, { onInstalled: { addListener: vi.fn() } });
  vi.mocked(browser.runtime.getManifest).mockReturnValue({ version: "0.1.0" } as never);
  const request = vi
    .spyOn(apiClient, "registerInstallation")
    .mockResolvedValue({ registered: true });
  const limits = vi.spyOn(apiClient, "limits").mockResolvedValue({
    per_day_remaining: 50,
    per_day_total: 50,
    per_minute_remaining: 10,
    per_minute_total: 10,
  });
  const { default: main } = await import("../entrypoints/background/index");
  (main as unknown as () => void)();
  let analyticsId: Promise<string> | undefined;
  let raced = false;
  vi.mocked(browser.storage.local.get).mockImplementation(async (keys) => {
    const snapshot = { ...state };
    if (keys === "installation_id" && !raced) {
      raced = true;
      queueMicrotask(() => {
        analyticsId = getInstallationId();
      });
    }
    return snapshot;
  });
  const handle = vi.mocked(browser.runtime.onMessage.addListener).mock.calls.at(-1)![0];
  await handle({ type: "GET_LIMITS" }, {}, vi.fn());
  expect(raced).toBe(true);
  const id = await analyticsId;
  expect(id).toEqual(expect.any(String));
  expect(request).toHaveBeenCalledWith(id, "2026-01-31T20:59:59.000Z");
  expect(limits).toHaveBeenCalledWith(id);
  expect(state.installation_id).toBe(id);
});

it("uses the install timestamp when the first quota lookup overtakes slow install cleanup at midnight", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-31T20:59:59.000Z"));
  state = { installation_id: "installed" };
  vi.stubGlobal("defineBackground", (main: () => void) => main);
  Object.assign(browser, { permissions: { onRemoved: { addListener: vi.fn() } } });
  Object.assign(browser.runtime, { onInstalled: { addListener: vi.fn() } });
  vi.mocked(browser.runtime.getManifest).mockReturnValue({ version: "0.1.0" } as never);
  vi.mocked(browser.alarms.get).mockResolvedValue({ name: "optimizer-selection-cleanup" } as never);
  const request = vi
    .spyOn(apiClient, "registerInstallation")
    .mockResolvedValue({ registered: true });
  const limits = vi.spyOn(apiClient, "limits").mockResolvedValue({
    per_day_remaining: 50,
    per_day_total: 50,
    per_minute_remaining: 10,
    per_minute_total: 10,
  });
  const { default: main } = await import("../entrypoints/background/index");
  (main as unknown as () => void)();
  await Promise.resolve();
  await Promise.resolve();
  let releaseCleanup!: (value: never) => void;
  vi.mocked(browser.alarms.get).mockImplementation(
    () =>
      new Promise((resolve) => {
        releaseCleanup = resolve;
      }),
  );
  const installed = vi.mocked(browser.runtime.onInstalled.addListener).mock.calls.at(-1)![0];
  const installing = installed({ reason: "install" } as never);
  vi.setSystemTime(new Date("2026-01-31T21:00:01.000Z"));
  try {
    const handle = vi.mocked(browser.runtime.onMessage.addListener).mock.calls.at(-1)![0];
    await handle({ type: "GET_LIMITS" }, {}, vi.fn());
    expect(request).toHaveBeenCalledWith("installed", "2026-01-31T20:59:59.000Z");
    expect(request.mock.invocationCallOrder[0]).toBeLessThan(limits.mock.invocationCallOrder[0]);
  } finally {
    releaseCleanup({ name: "optimizer-selection-cleanup" } as never);
    await installing;
    vi.useRealTimers();
  }
});

it("does not join a pre-install lookup that already read an empty timestamp", async () => {
  state = { installation_id: "installed" };
  let releaseOld!: (value: Record<string, unknown>) => void;
  vi.mocked(browser.storage.local.get).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        releaseOld = resolve;
      }),
  );
  const request = vi
    .spyOn(apiClient, "registerInstallation")
    .mockResolvedValue({ registered: true });
  const register = createInstallationRegistrar();
  const old = register();
  await vi.waitFor(() => expect(browser.storage.local.get).toHaveBeenCalled());
  await register.initialize("2026-01-31T20:59:59.000Z");
  const fresh = register();
  releaseOld({ installation_id: "installed" });
  await Promise.all([old, fresh]);
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith("installed", "2026-01-31T20:59:59.000Z");
});

it("retries persisting the original install timestamp after storage recovers", async () => {
  state = { installation_id: "installed" };
  const request = vi
    .spyOn(apiClient, "registerInstallation")
    .mockResolvedValue({ registered: true });
  vi.mocked(browser.storage.local.set).mockRejectedValueOnce(new Error("storage unavailable"));
  const register = createInstallationRegistrar();
  const installedAt = "2026-01-31T20:59:59.000Z";
  await expect(register.initialize(installedAt)).rejects.toThrow("storage unavailable");
  expect(request).not.toHaveBeenCalled();
  await Promise.all([register(), register()]);
  expect(state.install_at).toBe(installedAt);
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith("installed", installedAt);
});

it("blocks registration until retrying the install-date write succeeds", async () => {
  state = { installation_id: "installed" };
  const request = vi
    .spyOn(apiClient, "registerInstallation")
    .mockResolvedValue({ registered: true });
  vi.mocked(browser.storage.local.set)
    .mockRejectedValueOnce(new Error("initial failure"))
    .mockRejectedValueOnce(new Error("still unavailable"));
  const register = createInstallationRegistrar();
  await expect(register.initialize("2026-01-31T20:59:59.000Z")).rejects.toThrow("initial failure");
  await expect(register()).rejects.toThrow("still unavailable");
  expect(request).not.toHaveBeenCalled();
  await register();
  expect(request).toHaveBeenCalledWith("installed", "2026-01-31T20:59:59.000Z");
});

it("recovers the captured install date after the registrar is recreated following a failed write", async () => {
  state = { installation_id: "installed" };
  const request = vi
    .spyOn(apiClient, "registerInstallation")
    .mockResolvedValue({ registered: true });
  vi.mocked(browser.storage.local.set).mockRejectedValueOnce(new Error("storage unavailable"));
  await expect(
    createInstallationRegistrar().initialize("2026-01-31T20:59:59.000Z"),
  ).rejects.toThrow("storage unavailable");
  await createInstallationRegistrar()();
  expect(state.install_at).toBe("2026-01-31T20:59:59.000Z");
  expect(request).toHaveBeenCalledWith("installed", "2026-01-31T20:59:59.000Z");
  expect(alarms.size).toBe(0);
});

it("retains the original installation date after a browser restart clears every alarm", async () => {
  state = { installation_id: "installed" };
  const request = vi
    .spyOn(apiClient, "registerInstallation")
    .mockResolvedValue({ registered: true });
  vi.mocked(browser.storage.local.set)
    .mockRejectedValueOnce(new Error("storage unavailable"))
    .mockRejectedValueOnce(new Error("storage unavailable"));
  const register = createInstallationRegistrar();
  await expect(register.initialize("2026-01-31T20:59:59.000Z")).rejects.toThrow(
    "storage unavailable",
  );
  await expect(register()).rejects.toThrow("storage unavailable");
  alarms.clear();
  await createInstallationRegistrar()();
  expect(request).toHaveBeenCalledWith("installed", "2026-01-31T20:59:59.000Z");
  expect(state.install_at).toBe("2026-01-31T20:59:59.000Z");
});

it("opens welcome despite install-date storage failure and recovers from a durable alarm in a new background", async () => {
  state = { installation_id: "installed" };
  vi.stubGlobal("defineBackground", (main: () => void) => main);
  Object.assign(browser, { permissions: { onRemoved: { addListener: vi.fn() } } });
  Object.assign(browser.runtime, { onInstalled: { addListener: vi.fn() } });
  vi.mocked(browser.runtime.getManifest).mockReturnValue({ version: "0.1.0" } as never);
  const request = vi
    .spyOn(apiClient, "registerInstallation")
    .mockResolvedValue({ registered: true });
  vi.mocked(browser.storage.local.set).mockImplementation(async (value) => {
    if ("install_at" in value) throw new Error("storage unavailable");
    Object.assign(state, value);
  });
  const { default: main } = await import("../entrypoints/background/index");
  (main as unknown as () => void)();
  const installed = vi.mocked(browser.runtime.onInstalled.addListener).mock.calls.at(-1)![0];
  await installed({ reason: "install" } as never);
  expect(browser.tabs.create).toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
  const retry = [...alarms.values()].find((alarm) =>
    alarm.name.startsWith(INSTALLATION_REGISTRATION_ALARM),
  )!;
  expect(retry).toBeDefined();
  vi.mocked(browser.storage.local.set).mockImplementation(async (value) => {
    Object.assign(state, value);
  });
  (main as unknown as () => void)();
  const onAlarm = vi.mocked(browser.alarms.onAlarm.addListener).mock.calls.at(-1)![0];
  await onAlarm(retry);
  expect(state.install_at).toEqual(expect.any(String));
  expect(request).toHaveBeenCalledWith("installed", state.install_at);
  expect(
    [...alarms.keys()].filter((name) => name.startsWith(INSTALLATION_REGISTRATION_ALARM)),
  ).toEqual([]);
});
