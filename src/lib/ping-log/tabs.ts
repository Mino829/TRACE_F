/**
 * /log open in more than one tab of the same browser. Every tab shows the one
 * participation kept in localStorage; work that sends something runs in one
 * tab at a time (withLock), and a tab that changed the participation or the
 * photos lets the others know (tellOtherTabs, onOtherTabs).
 */

import { t } from "@/lib/i18n";

const CHANNEL = "trace-log";

/** Another tab held the lock for longer than the caller would wait. */
export class LockTimeout extends Error {
  constructor() {
    super(t("別のタブで送信しています。少し待ってから、もう一度試してください。", "Another tab is sending. Please wait a moment and try again."));
    this.name = "LockTimeout";
  }
}

type Locks = Pick<LockManager, "request">;

function browserLocks(): Locks | null {
  // Web Locks need a secure context: an http page on the LAN has none.
  return typeof navigator !== "undefined" && navigator.locks ? navigator.locks : null;
}

/** Callers in this tab, in the order they asked; the stand-in when the browser has no Web Locks. */
const queues = new Map<string, Promise<void>>();

function inThisTab<T>(name: string, task: () => Promise<T>, waitMs?: number): Promise<T> {
  const before = queues.get(name) ?? Promise.resolve();
  const turn = new Promise<void>((resolve, reject) => {
    const timer = waitMs === undefined ? undefined : setTimeout(() => reject(new LockTimeout()), waitMs);
    void before.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
  const result = turn.then(task);
  // The next caller waits for this one's task or, when this one gave up, for the one before it.
  queues.set(name, Promise.allSettled([before, result]).then(() => undefined));
  return result;
}

/**
 * Runs task while holding name in every tab of this site: another caller,
 * here or in another tab, waits until it is done. A caller that would wait
 * longer than waitMs gives up with LockTimeout, and its task never runs.
 * Without Web Locks (an http page, an old browser) only this tab's callers
 * wait for each other.
 */
export async function withLock<T>(
  name: string,
  task: () => Promise<T>,
  { waitMs, locks = browserLocks() }: { waitMs?: number; locks?: Locks | null } = {},
): Promise<T> {
  if (!locks) return inThisTab(name, task, waitMs);
  const signal = waitMs === undefined ? undefined : AbortSignal.timeout(waitMs);
  let granted = false;
  try {
    return await locks.request(name, signal ? { signal } : {}, () => {
      granted = true;
      return task();
    });
  } catch (error) {
    throw !granted && signal?.aborted ? new LockTimeout() : error;
  }
}

let channel: BroadcastChannel | null | undefined;

/** One channel per tab: a BroadcastChannel never hears its own messages, so this tab never hears itself. */
function tabChannel(): BroadcastChannel | null {
  if (channel === undefined) channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL);
  return channel;
}

/** Tells the other tabs that the photos on the phone changed. What goes into localStorage reaches them by itself. */
export function tellOtherTabs(): void {
  tabChannel()?.postMessage("changed");
}

/**
 * Calls changed when another tab changed the participation or the consent
 * (localStorage, through storage events) or the photos (IndexedDB, through
 * tellOtherTabs). Returns the function that stops listening.
 */
export function onOtherTabs(changed: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith("trace-")) changed();
  };
  const current = tabChannel();
  window.addEventListener("storage", onStorage);
  current?.addEventListener("message", changed);
  return () => {
    window.removeEventListener("storage", onStorage);
    current?.removeEventListener("message", changed);
  };
}
