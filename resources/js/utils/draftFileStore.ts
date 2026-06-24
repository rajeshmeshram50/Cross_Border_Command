/**
 * draftFileStore — IndexedDB-backed persistence for Save-Draft attachments.
 *
 * The expense-claim / advance-request "Save Draft" feature parks form fields
 * in localStorage. Browser `File` objects, however, cannot survive JSON
 * serialisation, so attachments staged before Save Draft used to be dropped
 * (`files: []`) and the user had to re-attach everything on resume.
 *
 * IndexedDB stores `File` / `Blob` values natively via the structured-clone
 * algorithm (no base64 bloat, no 5 MB localStorage quota), so we keep the
 * field JSON in localStorage and the actual files here, keyed per draft.
 *
 * All operations are best-effort: any failure (private-mode, quota, no IDB)
 * resolves to a safe no-op / null so the draft's field data still saves and
 * the form never crashes — attachments just fall back to "re-attach on
 * resume", which is the prior behaviour.
 */

const DB_NAME = 'cbc_draft_files';
const STORE = 'files';
const VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Build the per-draft key from the draft's localStorage bucket + entry id. */
export function draftFilesKey(storageKey: string, entryId: string): string {
  return `${storageKey}::${entryId}`;
}

/** Persist a value (File[], File[][], etc.) under `key`. Best-effort. */
export async function saveDraftFiles(key: string, value: unknown): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* best-effort — field data is still saved in localStorage */
  }
}

/** Read the value stored under `key`, or null if absent / unavailable. */
export async function loadDraftFiles<T = unknown>(key: string): Promise<T | null> {
  try {
    const db = await openDb();
    const value = await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result ?? null) as T | null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return value;
  } catch {
    return null;
  }
}

/** Remove the files stored under `key` (draft submitted / discarded). */
export async function deleteDraftFiles(key: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* ignore — an orphaned blob is harmless */
  }
}
