import browser from "webextension-polyfill";
import { apiClient } from "./api-client";
import { BACKEND_MODE, STORAGE_KEYS } from "./constants";
import { getInstallationId } from "./storage";
import {
  readInstallationJournal,
  writeInstallationJournal,
  clearInstallationJournal,
} from "./installation-journal";

export const INSTALLATION_REGISTRATION_ALARM = "quota-installation-registration";
export const INSTALLATION_TIMESTAMP_ALARM_PREFIX = `${INSTALLATION_REGISTRATION_ALARM}:`;

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
    const requestedEpoch = epoch;
    const promise = (async () => {
      let installedAt = pendingInstallAt;
      if (installedAt === null) {
        const state = await browser.storage.local.get(STORAGE_KEYS.INSTALL_AT);
        const storedAt = state[STORAGE_KEYS.INSTALL_AT];
        if (typeof storedAt === "string" && Number.isFinite(Date.parse(storedAt))) return;
        installedAt = await readInstallationJournal().catch(() => null);
      }
      if (installedAt === null) {
        // Recover journals written by earlier versions during the current browser session.
        const alarms = await browser.alarms.getAll();
        installedAt =
          alarms
            .map((alarm) => alarm.name)
            .filter((name) => name.startsWith(INSTALLATION_TIMESTAMP_ALARM_PREFIX))
            .map((name) => name.slice(INSTALLATION_TIMESTAMP_ALARM_PREFIX.length))
            .filter((date) => Number.isFinite(Date.parse(date)))
            .sort()
            .at(-1) ?? null;
      }
      if (installedAt === null) return;
      if (requestedEpoch !== epoch) return;
      // Either persistent store can preserve the anchor. A denied journal must not prevent
      // the local write; if that also fails, retain pendingInstallAt and retry the original date.
      await writeInstallationJournal(installedAt).catch(() => undefined);
      const journal = `${INSTALLATION_TIMESTAMP_ALARM_PREFIX}${installedAt}`;
      await browser.alarms.create(journal, { periodInMinutes: 5 });
      if (BACKEND_MODE === "fastapi") {
        await browser.alarms.create(INSTALLATION_REGISTRATION_ALARM, { periodInMinutes: 5 });
      }
      await browser.storage.local.set({ [STORAGE_KEYS.INSTALL_AT]: installedAt });
      if (requestedEpoch === epoch) pendingInstallAt = null;
      // Keep the normal registration retry after the timestamp is durably committed.
      await browser.alarms.clear(journal).catch(() => undefined);
      if (BACKEND_MODE !== "fastapi") await clearInstallationJournal().catch(() => undefined);
    })().finally(() => {
      if (initialization === promise) initialization = null;
    });
    initialization = promise;
    return promise;
  };
  const register = async (): Promise<void> => {
    const requestedEpoch = epoch;
    if (pendingInstallAt === null && !initialization) {
      const state = await browser.storage.local.get([
        STORAGE_KEYS.INSTALLATION_ID,
        STORAGE_KEYS.REGISTERED_INSTALLATION_ID,
      ]);
      if (requestedEpoch !== epoch) return register();
      const id = state[STORAGE_KEYS.INSTALLATION_ID];
      if (
        typeof id === "string" &&
        id.trim() &&
        state[STORAGE_KEYS.REGISTERED_INSTALLATION_ID] === id
      ) {
        // The server anchor is already confirmed; recovery storage is no longer a prerequisite.
        void browser.alarms.clear(INSTALLATION_REGISTRATION_ALARM).catch(() => undefined);
        return;
      }
    }
    await persistInitialization();
    if (BACKEND_MODE !== "fastapi") return;
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
        await clearInstallationJournal().catch(() => undefined);
        await browser.alarms.clear(INSTALLATION_REGISTRATION_ALARM);
        return;
      }
      await browser.alarms.create(INSTALLATION_REGISTRATION_ALARM, { periodInMinutes: 5 });
      await apiClient.registerInstallation(installationId, installedAt);
      await browser.storage.local.set({
        [STORAGE_KEYS.REGISTERED_INSTALLATION_ID]: installationId,
      });
      await clearInstallationJournal().catch(() => undefined);
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
