import browser from "webextension-polyfill";
import { STORAGE_KEYS, LIMITS } from "./constants";
import type { AudienceMode, ImproveGoal, OptimizerRequestContext } from "./types";
import { isOptimizerRequestContext } from "./goal-options";

export interface LibraryEntry {
  id: string;
  createdAt: number;
  original: string;
  improved: string;
  site?: string;
  title?: string;
  tags?: string[];
}

export interface PopupSessionDraft {
  optimizer_screen?: "input" | "result";
  result_context?: OptimizerRequestContext | null;
  activeTab: "improve" | "library";
  original: string;
  improved: string;
  changes: string[];
  goal: ImproveGoal | null;
  lastRequestId: string | null;
  lastRequestContextKey: string | null;
  lastModel: string | null;
  lastLatencyMs: number | null;
  attemptN: number;
}

interface StoredPopupSessionDraft extends PopupSessionDraft {
  updatedAt: number;
}

function isPopupSessionDraft(value: unknown): value is PopupSessionDraft {
  if (!value || typeof value !== "object") return false;

  const draft = value as Record<string, unknown>;
  return (
    (draft.result_context === undefined ||
      draft.result_context === null ||
      isOptimizerRequestContext(draft.result_context)) &&
    (draft.optimizer_screen === undefined ||
      draft.optimizer_screen === "input" ||
      draft.optimizer_screen === "result") &&
    (draft.activeTab === "improve" || draft.activeTab === "library") &&
    typeof draft.original === "string" &&
    typeof draft.improved === "string" &&
    Array.isArray(draft.changes) &&
    draft.changes.every((change) => typeof change === "string") &&
    (draft.goal === null || typeof draft.goal === "string") &&
    (draft.lastRequestId === null || typeof draft.lastRequestId === "string") &&
    (draft.lastRequestContextKey === null || typeof draft.lastRequestContextKey === "string") &&
    (draft.lastModel === null || typeof draft.lastModel === "string") &&
    (draft.lastLatencyMs === null ||
      (typeof draft.lastLatencyMs === "number" && Number.isFinite(draft.lastLatencyMs))) &&
    typeof draft.attemptN === "number" &&
    Number.isFinite(draft.attemptN)
  );
}

export async function getInstallationId(): Promise<string> {
  const data = await browser.storage.local.get(STORAGE_KEYS.INSTALLATION_ID);
  if (data[STORAGE_KEYS.INSTALLATION_ID]) {
    return data[STORAGE_KEYS.INSTALLATION_ID] as string;
  }
  const id = crypto.randomUUID();
  await browser.storage.local.set({ [STORAGE_KEYS.INSTALLATION_ID]: id });
  return id;
}

export async function getAll(): Promise<LibraryEntry[]> {
  const data = await browser.storage.local.get(STORAGE_KEYS.LIBRARY);
  return (data[STORAGE_KEYS.LIBRARY] as LibraryEntry[]) ?? [];
}

export class LibraryStorageError extends Error {
  constructor() {
    super("Unable to persist the local prompt library.");
    this.name = "LibraryStorageError";
  }
}

let libraryQueue: Promise<unknown> = Promise.resolve();

async function withLibraryLock<T>(operation: () => Promise<T>): Promise<T> {
  if (navigator.locks) return navigator.locks.request("prompttune-library", operation);
  // Serialize callers within a context on older browsers without Web Locks.
  const result = libraryQueue.then(operation);
  libraryQueue = result.catch(() => undefined);
  return result;
}

const SAVE_LEASE_PREFIX = "prompttune-library-save:";
const activeSaveIds = new Set<string>();
const PENDING_SAVE_TTL_MS = 30 * 60 * 1000;

function storedBytes(key: string, value: unknown): number {
  return key.length + new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function boundedLibrary(entries: LibraryEntry[]): LibraryEntry[] {
  const updated: LibraryEntry[] = [];
  const encoder = new TextEncoder();
  let bytes = STORAGE_KEYS.LIBRARY.length + 2;
  for (const entry of entries.slice(0, LIMITS.MAX_LIBRARY_ENTRIES)) {
    const size = encoder.encode(JSON.stringify(entry)).byteLength + (updated.length ? 1 : 0);
    if (bytes + size > LIMITS.MAX_LIBRARY_BYTES) break;
    updated.push(entry);
    bytes += size;
  }
  return updated;
}

async function pendingSaves(): Promise<LibraryEntry[]> {
  const data = await browser.storage.local.get(STORAGE_KEYS.PENDING_LIBRARY_SAVES);
  return (data[STORAGE_KEYS.PENDING_LIBRARY_SAVES] as LibraryEntry[] | undefined) ?? [];
}

async function livePendingSaves(): Promise<LibraryEntry[]> {
  const pending = await pendingSaves();
  if (navigator.locks?.query) {
    const { held = [] } = await navigator.locks.query();
    const names = new Set(held.map((lock) => lock.name));
    return pending.filter((entry) => names.has(`${SAVE_LEASE_PREFIX}${entry.id}`));
  }
  return pending.filter(
    (entry) => activeSaveIds.has(entry.id) || Date.now() - entry.createdAt < PENDING_SAVE_TTL_MS,
  );
}

async function withSaveLease<T>(id: string, operation: () => Promise<T>): Promise<T> {
  activeSaveIds.add(id);
  try {
    return navigator.locks
      ? await navigator.locks.request(`${SAVE_LEASE_PREFIX}${id}`, operation)
      : await operation();
  } finally {
    activeSaveIds.delete(id);
  }
}

export async function save(
  entry: Omit<LibraryEntry, "id" | "createdAt">,
  persistRemote?: () => Promise<unknown>,
): Promise<LibraryEntry> {
  const newEntry: LibraryEntry = { ...entry, id: crypto.randomUUID(), createdAt: Date.now() };
  if (!boundedLibrary([newEntry]).length) throw new LibraryStorageError();
  if (!persistRemote) {
    await withLibraryLock(async () => {
      const updated = boundedLibrary([newEntry, ...(await getAll())]);
      try {
        await browser.storage.local.set({ [STORAGE_KEYS.LIBRARY]: updated });
      } catch {
        throw new LibraryStorageError();
      }
    });
    return newEntry;
  }
  return withSaveLease(newEntry.id, async () => {
    await withLibraryLock(async () => {
      const pending = [...(await livePendingSaves()), newEntry];
      if (
        storedBytes(STORAGE_KEYS.PENDING_LIBRARY_SAVES, pending) > LIMITS.MAX_PENDING_LIBRARY_BYTES
      )
        throw new LibraryStorageError();
      try {
        // Reserve the full payload before POST without pruning committed entries.
        await browser.storage.local.set({ [STORAGE_KEYS.PENDING_LIBRARY_SAVES]: pending });
      } catch {
        throw new LibraryStorageError();
      }
    });
    try {
      await persistRemote();
    } catch (remoteError) {
      try {
        await withLibraryLock(async () => {
          const pending = (await pendingSaves()).filter((item) => item.id !== newEntry.id);
          await browser.storage.local.set({ [STORAGE_KEYS.PENDING_LIBRARY_SAVES]: pending });
        });
      } catch {
        throw new LibraryStorageError();
      }
      throw remoteError;
    }
    try {
      await withLibraryLock(async () => {
        const pending = await pendingSaves();
        if (!pending.some((item) => item.id === newEntry.id)) throw new LibraryStorageError();
        const updated = boundedLibrary([newEntry, ...(await getAll())]);
        // Move reserved data into the library atomically; pruning happens only now.
        await browser.storage.local.set({
          [STORAGE_KEYS.LIBRARY]: updated,
          [STORAGE_KEYS.PENDING_LIBRARY_SAVES]: pending.filter((item) => item.id !== newEntry.id),
        });
      });
    } catch {
      throw new LibraryStorageError();
    }
    return newEntry;
  });
}

export async function remove(id: string): Promise<void> {
  await withLibraryLock(async () => {
    const entries = await getAll();
    await browser.storage.local.set({ [STORAGE_KEYS.LIBRARY]: entries.filter((e) => e.id !== id) });
  });
}

export async function getAudienceMode(): Promise<AudienceMode | null> {
  const data = await browser.storage.local.get(STORAGE_KEYS.AUDIENCE_MODE);
  const mode = data[STORAGE_KEYS.AUDIENCE_MODE];
  if (mode === "ai" || mode === "content") {
    return mode;
  }
  return null;
}

export async function setAudienceMode(mode: AudienceMode): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEYS.AUDIENCE_MODE]: mode });
}

export async function getPopupSessionDraft(): Promise<PopupSessionDraft | null> {
  const data = await browser.storage.local.get(STORAGE_KEYS.POPUP_SESSION_DRAFT);
  const draft = data[STORAGE_KEYS.POPUP_SESSION_DRAFT] as
    | StoredPopupSessionDraft
    | PopupSessionDraft
    | string
    | number
    | boolean
    | undefined;
  if (!draft) return null;

  if (typeof draft !== "object") {
    await browser.storage.local.remove(STORAGE_KEYS.POPUP_SESSION_DRAFT);
    return null;
  }

  if (!("updatedAt" in draft)) {
    if (!isPopupSessionDraft(draft)) {
      await browser.storage.local.remove(STORAGE_KEYS.POPUP_SESSION_DRAFT);
      return null;
    }

    await setPopupSessionDraft(draft);
    return draft;
  }

  if (typeof draft.updatedAt !== "number" || !Number.isFinite(draft.updatedAt)) {
    await browser.storage.local.remove(STORAGE_KEYS.POPUP_SESSION_DRAFT);
    return null;
  }

  if (Date.now() - draft.updatedAt > LIMITS.POPUP_SESSION_TTL_MS) {
    await browser.storage.local.remove(STORAGE_KEYS.POPUP_SESSION_DRAFT);
    return null;
  }

  const { updatedAt: _updatedAt, ...sessionDraft } = draft;
  return sessionDraft;
}

export async function setPopupSessionDraft(draft: PopupSessionDraft): Promise<void> {
  await browser.storage.local.set({
    [STORAGE_KEYS.POPUP_SESSION_DRAFT]: {
      ...draft,
      updatedAt: Date.now(),
    } satisfies StoredPopupSessionDraft,
  });
}
