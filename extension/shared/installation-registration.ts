import browser from "webextension-polyfill";
import { apiClient } from "./api-client";
import { BACKEND_MODE, STORAGE_KEYS } from "./constants";
import { getInstallationId } from "./storage";

export const INSTALLATION_REGISTRATION_ALARM = "quota-installation-registration";

/** Register independently of analytics consent; retain the install timestamp across offline retries. */
export interface InstallationRegistrar {
  (): Promise<void>;
  initialize(installedAt: string): Promise<void>;
}

export function createInstallationRegistrar(): InstallationRegistrar {
  let initialization: Promise<void> | null = null;
  let pendingInstallAt: string | null = null;
  let epoch = 0;
  let inFlight: { epoch: number; promise: Promise<void> } | null = null;
  const persistInitialization = (): Promise<void> => {
    if (initialization) return initialization;
    if (pendingInstallAt === null) return Promise.resolve();
    const requestedEpoch = epoch;
    const promise = browser.storage.local
      .set({ [STORAGE_KEYS.INSTALL_AT]: pendingInstallAt })
      .then(() => {
        if (requestedEpoch === epoch) pendingInstallAt = null;
      })
      .finally(() => {
        if (initialization === promise) initialization = null;
      });
    initialization = promise;
    return promise;
  };
  const register = async (): Promise<void> => {
    if (BACKEND_MODE !== "fastapi") return;
    const requestedEpoch = epoch;
    await persistInitialization();
    if (requestedEpoch !== epoch) return register();
    if (inFlight?.epoch === epoch) return inFlight.promise;
    const promise = (async () => {
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
    })();
    const flight = { epoch, promise };
    inFlight = flight;
    try {
      await promise;
    } finally {
      if (inFlight === flight) inFlight = null;
    }
  };
  return Object.assign(register, {
    initialize(installedAt: string) {
      epoch += 1;
      pendingInstallAt = installedAt;
      initialization = null;
      return persistInitialization();
    },
  });
}
