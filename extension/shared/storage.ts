import browser from "webextension-polyfill";
import { ensureBrowserSessionId, getBrowserSessionId } from "./browser-target";
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

export const POPUP_DRAFT_PREFIX = "optimizer_draft_";
export const POPUP_HANDOFF_KEY = "optimizer_popup_handoff";
export function popupHandoffKey(windowId: number): string {
  return `${POPUP_HANDOFF_KEY}_${windowId}`;
}

export interface PopupSessionDraft {
  audienceMode?: AudienceMode | null;
  draftSessionId?: string;
  draftCreatedAt?: number;
  sourceTabId?: number;
  sourceSessionId?: string;
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

/** Validate a draft before accepting a session from another extension surface. */
export function isPopupSessionDraft(value: unknown): value is PopupSessionDraft {
  if (!value || typeof value !== "object") return false;

  const draft = value as Record<string, unknown>;
  return (
    (draft.audienceMode === undefined ||
      draft.audienceMode === null ||
      draft.audienceMode === "ai" ||
      draft.audienceMode === "content") &&
    (draft.draftSessionId === undefined || typeof draft.draftSessionId === "string") &&
    (draft.draftCreatedAt === undefined ||
      (typeof draft.draftCreatedAt === "number" && Number.isFinite(draft.draftCreatedAt))) &&
    (draft.sourceSessionId === undefined || typeof draft.sourceSessionId === "string") &&
    (draft.sourceTabId === undefined ||
      (Number.isSafeInteger(draft.sourceTabId) && (draft.sourceTabId as number) >= 0)) &&
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

export async function getPopupSessionDraft(
  consumePopupHandoff = true,
): Promise<PopupSessionDraft | null> {
  const data = await browser.storage.local.get(null);
  if (
    consumePopupHandoff &&
    Object.keys(data).some((key) => key.startsWith(`${POPUP_HANDOFF_KEY}_`))
  ) {
    const window = await browser.windows.getCurrent();
    const key = typeof window.id === "number" ? popupHandoffKey(window.id) : undefined;
    if (key && data[key]) {
      const preferred = await withOptimizerStorageLock(async () => {
        // Re-read under the lock: only this window may consume its one-shot snapshot.
        const latest = await browser.storage.local.get(key);
        const handoff = latest[key] as
          | { windowId?: number; browserSessionId?: string; draft?: unknown; expiresAt?: number }
          | undefined;
        if (!handoff || handoff.windowId !== window.id) return null;
        const browserSessionId = await getBrowserSessionId();
        await browser.storage.local.remove(key).catch(() => undefined);
        return !!browserSessionId &&
          handoff.browserSessionId === browserSessionId &&
          typeof handoff.expiresAt === "number" &&
          Number.isFinite(handoff.expiresAt) &&
          handoff.expiresAt > Date.now() &&
          isPopupSessionDraft(handoff.draft)
          ? handoff.draft
          : null;
      });
      if (preferred) return preferred;
    }
  }
  const now = Date.now();
  const candidates = Object.entries(data)
    .filter(([key, value]) => {
      const draft = value as Partial<StoredPopupSessionDraft> | null;
      const updatedAt = draft?.updatedAt;
      return (
        key.startsWith(POPUP_DRAFT_PREFIX) &&
        isPopupSessionDraft(draft) &&
        typeof updatedAt === "number" &&
        Number.isFinite(updatedAt) &&
        now - updatedAt <= LIMITS.POPUP_SESSION_TTL_MS &&
        typeof draft.draftCreatedAt === "number" &&
        Number.isFinite(draft.draftCreatedAt)
      );
    })
    .sort(
      (a, b) =>
        (b[1] as StoredPopupSessionDraft).draftCreatedAt! -
        (a[1] as StoredPopupSessionDraft).draftCreatedAt!,
    );
  const key = candidates[0]?.[0] ?? STORAGE_KEYS.POPUP_SESSION_DRAFT;
  const draft = data[key] as
    | StoredPopupSessionDraft
    | PopupSessionDraft
    | string
    | number
    | boolean
    | undefined;
  if (!draft) return null;

  if (typeof draft !== "object") {
    await browser.storage.local.remove(key);
    return null;
  }

  if (!("updatedAt" in draft)) {
    if (!isPopupSessionDraft(draft)) {
      await browser.storage.local.remove(key);
      return null;
    }

    await withOptimizerStorageLock(() => migrateLegacyPopupDraft({ [key]: draft }));
    return draft;
  }

  if (typeof draft.updatedAt !== "number" || !Number.isFinite(draft.updatedAt)) {
    await browser.storage.local.remove(key);
    return null;
  }

  if (Date.now() - draft.updatedAt > LIMITS.POPUP_SESSION_TTL_MS) {
    await browser.storage.local.remove(key);
    return null;
  }

  const { updatedAt: _updatedAt, ...sessionDraft } = draft;
  return sessionDraft;
}

/** Restore only the live draft addressed by a standalone optimizer URL. */
export async function getPopupSessionDraftById(id: string): Promise<PopupSessionDraft | null> {
  if (!id) return null;
  const key = `${POPUP_DRAFT_PREFIX}${id}`;
  const data = await browser.storage.local.get(key);
  const draft = data[key] as Partial<StoredPopupSessionDraft> | undefined;
  const updatedAt = draft?.updatedAt;
  if (
    !isPopupSessionDraft(draft) ||
    draft.draftSessionId !== id ||
    typeof updatedAt !== "number" ||
    !Number.isFinite(updatedAt) ||
    Date.now() - updatedAt > LIMITS.POPUP_SESSION_TTL_MS
  )
    return null;
  const { updatedAt: _updatedAt, ...session } = draft as StoredPopupSessionDraft;
  return session;
}

let draftQueue: Promise<unknown> = Promise.resolve();

/** Serialize quota decisions across extension surfaces, with a per-context fallback. */
export async function withOptimizerStorageLock<T>(operation: () => Promise<T>): Promise<T> {
  if (navigator.locks) return navigator.locks.request("prompttune-drafts", operation);
  const result = draftQueue.then(operation);
  draftQueue = result.catch(() => undefined);
  return result;
}

/** Called under the draft lock; timestamp old valid drafts once before any TTL cleanup. */
export async function migrateLegacyPopupDraft(data: Record<string, unknown>): Promise<void> {
  const legacy = data[STORAGE_KEYS.POPUP_SESSION_DRAFT];
  if (isPopupSessionDraft(legacy) && !("updatedAt" in legacy)) {
    const migrated = { ...legacy, updatedAt: Date.now() } satisfies StoredPopupSessionDraft;
    await browser.storage.local.set({ [STORAGE_KEYS.POPUP_SESSION_DRAFT]: migrated });
    data[STORAGE_KEYS.POPUP_SESSION_DRAFT] = migrated;
  }
}

/** Read selected records without transferring unrelated values; retain an older-browser fallback. */
export async function readLocalEntries(
  matchesKey: (key: string) => boolean,
): Promise<Record<string, unknown>> {
  if (typeof browser.storage.local.getKeys !== "function") return browser.storage.local.get(null);
  const keys = (await browser.storage.local.getKeys()).filter(matchesKey);
  return keys.length ? browser.storage.local.get(keys) : {};
}

async function readDrafts(): Promise<Record<string, unknown>> {
  return readLocalEntries(
    (key) => key.startsWith(POPUP_DRAFT_PREFIX) || key === STORAGE_KEYS.POPUP_SESSION_DRAFT,
  );
}

/** Called under the draft lock before writes, including the first write on upgrade. */
async function planDraftEvictions(
  currentKey?: string,
  currentValue?: StoredPopupSessionDraft,
): Promise<Record<string, unknown>> {
  const incomingBytes = currentKey ? storedBytes(currentKey, currentValue) : 0;
  if (incomingBytes > LIMITS.MAX_POPUP_DRAFT_BYTES) throw new Error("Draft exceeds storage budget");
  const data = await readDrafts();
  await migrateLegacyPopupDraft(data);
  const candidates = Object.entries(data)
    .filter(
      ([key]) => key.startsWith(POPUP_DRAFT_PREFIX) || key === STORAGE_KEYS.POPUP_SESSION_DRAFT,
    )
    .sort(
      (a, b) =>
        ((b[1] as StoredPopupSessionDraft)?.updatedAt ?? 0) -
          ((a[1] as StoredPopupSessionDraft)?.updatedAt ?? 0) ||
        ((b[1] as StoredPopupSessionDraft)?.draftCreatedAt ?? 0) -
          ((a[1] as StoredPopupSessionDraft)?.draftCreatedAt ?? 0) ||
        b[0].localeCompare(a[0]),
    );
  let bytes = incomingBytes;
  let count = currentKey ? 1 : 0;
  const evicted: string[] = [];
  for (const [key, value] of candidates) {
    if (key === currentKey) continue;
    const updatedAt = (value as StoredPopupSessionDraft | null)?.updatedAt;
    const size = storedBytes(key, value);
    if (
      !isPopupSessionDraft(value) ||
      typeof updatedAt !== "number" ||
      !Number.isFinite(updatedAt) ||
      Date.now() - updatedAt > LIMITS.POPUP_SESSION_TTL_MS ||
      count >= LIMITS.MAX_POPUP_DRAFTS ||
      bytes + size > LIMITS.MAX_POPUP_DRAFT_BYTES
    ) {
      evicted.push(key);
    } else {
      bytes += size;
      count++;
    }
  }
  return Object.fromEntries(evicted.map((key) => [key, data[key]]));
}

/** Preserve recoverable drafts on write failures; release quota only when a retry needs it. */
async function writeWithDraftBudget(
  key: string,
  value: unknown,
  draft?: StoredPopupSessionDraft,
): Promise<void> {
  const evicted = await planDraftEvictions(draft ? key : undefined, draft);
  const keys = Object.keys(evicted);
  try {
    await browser.storage.local.set({ [key]: value });
  } catch (error) {
    const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
    if (!keys.length || !/quota/i.test(message)) throw error;
    // A full store cannot hold both snapshots. Keep the old records for rollback.
    await browser.storage.local.remove(keys);
    try {
      await browser.storage.local.set({ [key]: value });
    } catch (writeError) {
      // The rejected write has not occupied the released space, so the original data fits again.
      await browser.storage.local.set(evicted);
      throw writeError;
    }
    return;
  }
  // The new value is committed. Cleanup must not turn success into a failed transfer.
  // A later save retries any remaining budget evictions.
  if (keys.length) await browser.storage.local.remove(keys).catch(() => undefined);
}

export async function setPopupSessionDraft(draft: PopupSessionDraft): Promise<void> {
  const key = draft.draftSessionId
    ? `${POPUP_DRAFT_PREFIX}${draft.draftSessionId}`
    : STORAGE_KEYS.POPUP_SESSION_DRAFT;
  const value = { ...draft, updatedAt: Date.now() } satisfies StoredPopupSessionDraft;
  await withOptimizerStorageLock(async () => {
    await writeWithDraftBudget(key, value, value);
  });
}

/** Keep draft growth from blocking selection/panel handoffs, including after an upgrade. */
export async function setOptimizerHandoff(key: string, value: unknown): Promise<void> {
  await withOptimizerStorageLock(async () => {
    await writeWithDraftBudget(key, value);
  });
}

/** One-shot snapshot for the next toolbar popup; independent launches do not consume it. */
export async function preferPopupSessionDraft(draft: PopupSessionDraft): Promise<void> {
  const window = await browser.windows.getCurrent();
  if (typeof window.id !== "number") throw new Error("Popup window unavailable");
  const key = popupHandoffKey(window.id);
  const browserSessionId = await ensureBrowserSessionId();
  const value = {
    windowId: window.id,
    browserSessionId,
    draft,
    expiresAt: Date.now() + LIMITS.HANDOFF_TTL_MS,
  };
  if (storedBytes(key, value) > LIMITS.MAX_POPUP_DRAFT_BYTES)
    throw new Error("Draft exceeds storage budget");
  await setOptimizerHandoff(key, value);
}
