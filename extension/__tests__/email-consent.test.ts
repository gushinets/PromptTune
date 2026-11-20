import { afterEach, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { apiClient } from "../shared/api-client";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each([false, true])(
  "guards direct background email requests and revocation (native=%s)",
  async (native) => {
    vi.stubEnv("FIREFOX", "true");
    vi.stubGlobal("defineBackground", (main: () => void) => main);
    vi.mocked(browser.alarms.getAll).mockResolvedValue([]);
    let granted = false;
    Object.assign(browser, {
      permissions: {
        getAll: vi.fn(async () =>
          native ? { data_collection: granted ? ["personallyIdentifyingInfo"] : [] } : {},
        ),
        onRemoved: { addListener: vi.fn() },
        contains: vi.fn().mockResolvedValue(false),
      },
    });
    Object.assign(browser.runtime, { onInstalled: { addListener: vi.fn() } });
    vi.mocked(browser.runtime.getManifest).mockReturnValue({ version: "0.1.0" } as never);
    vi.mocked(browser.storage.local.get).mockImplementation(async () => ({
      installation_id: "installed",
      email_bonus_data_consent: granted,
    }));
    const request = vi.spyOn(apiClient, "requestEmailBonus").mockResolvedValue({ sent: true });
    const confirm = vi.spyOn(apiClient, "confirmEmailBonus").mockResolvedValue({
      per_day_remaining: 50,
      per_day_total: 100,
      per_minute_remaining: 10,
      per_minute_total: 10,
    });
    const { default: main } = await import("../entrypoints/background/index");
    (main as unknown as () => void)();
    const handle = vi.mocked(browser.runtime.onMessage.addListener).mock.calls.at(-1)![0];
    await expect(
      handle({ type: "REQUEST_EMAIL_BONUS", email: "a@example.com" }, {}, vi.fn()),
    ).rejects.toThrow("consent");
    expect(request).not.toHaveBeenCalled();
    granted = true;
    await handle({ type: "REQUEST_EMAIL_BONUS", email: "a@example.com" }, {}, vi.fn());
    expect(request).toHaveBeenCalledWith("installed", "a@example.com");
    granted = false;
    await expect(
      handle({ type: "CONFIRM_EMAIL_BONUS", code: "123456" }, {}, vi.fn()),
    ).rejects.toThrow("consent");
    expect(confirm).not.toHaveBeenCalled();
    // Permission can be revoked while an offline registration retry is in flight.
    granted = true;
    vi.mocked(browser.storage.local.get).mockImplementation(async () => ({
      installation_id: "installed",
      install_at: "2026-01-31T20:59:59.000Z",
      email_bonus_data_consent: granted,
    }));
    let finish!: () => void;
    const registering = vi.spyOn(apiClient, "registerInstallation").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ registered: true });
        }),
    );
    const sending = handle({ type: "REQUEST_EMAIL_BONUS", email: "a@example.com" }, {}, vi.fn());
    await vi.waitFor(() => expect(registering).toHaveBeenCalledOnce());
    granted = false;
    finish();
    await expect(sending).rejects.toThrow("consent");
    expect(request).toHaveBeenCalledTimes(1);
  },
);
