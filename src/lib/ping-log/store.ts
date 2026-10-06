/**
 * Device-local store for the timed log (`/log`).
 *
 * Every record is written here first and sent to the push worker afterwards,
 * so one taken without signal is kept and sent later; `sentAt` marks the ones
 * the worker has acknowledged.
 */

import type { LogRecord } from "./record";

export type LogEntry = {
  id: string;
  record: LogRecord;
  /** The shrunk JPEG, when a photo was attached. */
  photo: Blob | null;
  sentAt: string | null;
};

const DB_NAME = "trace-ping-log";
const STORE_NAME = "entries";
/** 2: records replaced the photo-first entries of version 1, which are dropped. */
const VERSION = 2;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (db.objectStoreNames.contains(STORE_NAME)) db.deleteObjectStore(STORE_NAME);
      db.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDBを開けませんでした。"));
  });
}

export async function listEntries(): Promise<LogEntry[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve((request.result as LogEntry[]).sort((a, b) => b.record.takenAt.localeCompare(a.record.takenAt)));
    request.onerror = () => reject(request.error ?? new Error("記録を読み込めませんでした。"));
  });
}

export async function putEntry(entry: LogEntry): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("記録を保存できませんでした。"));
  });
}

export async function clearEntries(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("記録を削除できませんでした。"));
  });
}
