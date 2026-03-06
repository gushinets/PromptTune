import browser from "webextension-polyfill";
import { STORAGE_KEYS, LIMITS } from "./constants";

export interface LibraryEntry {
  id: string;
  createdAt: number;
  original: string;
  improved: string;
  site?: string;
  title?: string;
  tags?: string[];
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
