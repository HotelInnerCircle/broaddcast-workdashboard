"use client";

/**
 * Swipes a door device is holding until it can send them (A128).
 *
 * A tablet by a gate loses its connection - a router reboots, a site has one
 * bar, somebody unplugs the wrong thing. Before this the door simply stopped
 * working, which means people cannot clock in, which means an argument about
 * pay. Holding the swipe and sending it later is the whole point of the
 * feature.
 *
 * IndexedDB rather than localStorage, because a swipe carries a photograph and
 * a blob does not fit in a string store without base64 inflating it by a third.
 *
 * Everything here is bounded. A queue that grows without limit fills the
 * tablet's storage and then fails in a way nobody can diagnose, and a swipe
 * from three days ago is not worth recording anyway - by then somebody has
 * fixed the day by hand.
 */

const DB = "workpulse-door";
const STORE = "queued";
const VERSION = 1;

/** Older than this and it is somebody's problem to fix by hand, not ours to replay. */
export const MAX_AGE_MS = 24 * 3600_000;
/** Enough for a long outage at a busy door; far short of filling a tablet. */
export const MAX_QUEUED = 500;

export interface QueuedSwipe {
  /** The device's own id for it, so replaying cannot record it twice. */
  ref: string;
  takenAt: number;
  photo: Blob;
  descriptor: number[] | null;
  live: boolean;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "ref" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const run = <T>(store: IDBObjectStore, req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    void store;
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

/** A reference nothing else will produce, since two devices may queue at once. */
export function newRef(): string {
  const rand = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return rand;
}

/**
 * Put one by. Returns false when the queue is full rather than silently
 * dropping the oldest: somebody at the door should be told the device is not
 * coping, not left believing a swipe was taken.
 */
export async function enqueue(item: QueuedSwipe): Promise<boolean> {
  try {
    const db = await open();
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const count = await run(store, store.count());
    if (count >= MAX_QUEUED) { db.close(); return false; }
    await run(store, store.put(item));
    db.close();
    return true;
  } catch {
    // No IndexedDB - a private window, or storage refused. The screen has to
    // say the swipe did not happen rather than pretend it did.
    return false;
  }
}

/** Everything waiting, oldest first, with anything too old thrown away. */
export async function pending(): Promise<QueuedSwipe[]> {
  try {
    const db = await open();
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const all = (await run(store, store.getAll())) as QueuedSwipe[];
    const cutoff = Date.now() - MAX_AGE_MS;
    const fresh: QueuedSwipe[] = [];
    for (const item of all) {
      if (item.takenAt < cutoff) await run(store, store.delete(item.ref));
      else fresh.push(item);
    }
    db.close();
    // Oldest first, so a morning swipe is recorded before the evening one and
    // the on/off duty alternation comes out the way it happened.
    return fresh.sort((a, b) => a.takenAt - b.takenAt);
  } catch {
    return [];
  }
}

export async function forget(ref: string): Promise<void> {
  try {
    const db = await open();
    const tx = db.transaction(STORE, "readwrite");
    await run(tx.objectStore(STORE), tx.objectStore(STORE).delete(ref));
    db.close();
  } catch { /* it will be dropped on age instead */ }
}

export async function queuedCount(): Promise<number> {
  return (await pending()).length;
}

/**
 * Send what is waiting, oldest first, stopping at the first failure.
 *
 * Stopping matters: carrying on past a failure would send the evening before
 * the morning, and the direction of every swipe after it is worked out from
 * what came before. Better to send nothing more and try the whole run again.
 */
export async function flush(token: string): Promise<{ sent: number; left: number }> {
  const items = await pending();
  let sent = 0;
  for (const item of items) {
    const fd = new FormData();
    fd.append("photo", new File([item.photo], "door.jpg", { type: "image/jpeg" }));
    fd.append("faceDescriptor", JSON.stringify(item.descriptor));
    fd.append("live", item.live ? "true" : "false");
    fd.append("takenAt", new Date(item.takenAt).toISOString());
    fd.append("clientRef", item.ref);

    let res: Response;
    try {
      res = await fetch("/api/kiosk/swipe", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: fd });
    } catch {
      break; // still offline
    }

    /*
     * Anything the server has an opinion about is dealt with and dropped. Only
     * a network failure or a server that is down is worth keeping for: a swipe
     * the server refused will be refused again for ever, and retrying it would
     * block everything behind it in the queue.
     */
    if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) {
      await forget(item.ref);
      if (res.ok) sent++;
      continue;
    }
    break;
  }
  return { sent, left: await queuedCount() };
}
