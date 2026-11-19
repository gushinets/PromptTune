import browser from "webextension-polyfill";
import { apiClient } from "./api-client";
import { BACKEND_MODE, STORAGE_KEYS } from "./constants";
import { getInstallationId } from "./storage";

export const INSTALLATION_REGISTRATION_ALARM = "quota-installation-registration";

/** Register independently of analytics consent; retain the install timestamp across offline retries. */
export function createInstallationRegistrar(): () => Promise<void> {
  let inFlight: Promise<void> | null = null;
  return () => {
    if (BACKEND_MODE !== "fastapi") return Promise.resolve();
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const state = await browser.storage.local.get([
        STORAGE_KEYS.INSTALL_AT,
        STORAGE_KEYS.REGISTERED_INSTALLATION_ID,
      ]);
      const installedAt = state[STORAGE_KEYS.INSTALL_AT];
      if (typeof installedAt !== "string" || !Number.isFinite(Date.parse(installedAt))) return;
      const installationId = await getInstallationId();
      if (state[STORAGE_KEYS.REGISTERED_INSTALLATION_ID] === installationId) {
        await browser.alarms.clear(INSTALLATION_REGISTRATION_ALARM);
        return;
      }
      await browser.alarms.create(INSTALLATION_REGISTRATION_ALARM, { periodInMinutes: 5 });
      await apiClient.registerInstallation(installationId, installedAt);
      await browser.storage.local.set({
        [STORAGE_KEYS.REGISTERED_INSTALLATION_ID]: installationId,
      });
      await browser.alarms.clear(INSTALLATION_REGISTRATION_ALARM);
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
}
