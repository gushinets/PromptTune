import { beforeEach, afterEach, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { apiClient } from "../shared/api-client";
import {
  createInstallationRegistrar,
  INSTALLATION_REGISTRATION_ALARM,
} from "../shared/installation-registration";

vi.mock("@shared/constants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@shared/constants")>()),
  ANALYTICS_ENABLED: false,
}));
let state: Record<string, unknown>;
beforeEach(() => {
  vi.clearAllMocks();
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
