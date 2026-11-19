const DATABASE = "prompttune-installation";
const STORE = "registration";
const KEY = "installed_at";

/** Separate from storage.local so its failed writes cannot lose the install anchor. */
async function journal<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open(DATABASE, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = operation(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Installation journal write failed"));
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export async function readInstallationJournal(): Promise<string | null> {
  const value = await journal("readonly", (store) => store.get(KEY));
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

export async function writeInstallationJournal(installedAt: string): Promise<void> {
  await journal("readwrite", (store) => store.put(installedAt, KEY));
}

export async function clearInstallationJournal(): Promise<void> {
  await journal("readwrite", (store) => store.delete(KEY));
}
