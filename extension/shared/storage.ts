import browser from "webextension-polyfill";
import { STORAGE_KEYS, LIMITS } from "./constants";
import type { AudienceMode, ImproveGoal } from "./types";

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

export async function save(entry: Omit<LibraryEntry, "id" | "createdAt">): Promise<LibraryEntry> {
  const entries = await getAll();
  const newEntry: LibraryEntry = {
    ...entry,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
  };

  const updated = [newEntry, ...entries].slice(0, LIMITS.MAX_LIBRARY_ENTRIES);
  await browser.storage.local.set({ [STORAGE_KEYS.LIBRARY]: updated });
  return newEntry;
}

export async function remove(id: string): Promise<void> {
  const entries = await getAll();
  const updated = entries.filter((e) => e.id !== id);
  await browser.storage.local.set({ [STORAGE_KEYS.LIBRARY]: updated });
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
