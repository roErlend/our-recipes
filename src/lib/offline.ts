/**
 * Offline support for the shopping list ("in-store mode"). Two pieces, both
 * client-only and dependency-free:
 *
 *  1. **Query snapshot cache** ({@link withOfflineCache}) — wraps a query fn so a
 *     successful result is stashed in IndexedDB and, when the network is down, the
 *     last stashed result is returned instead of throwing. This lets the shopping
 *     page open and render with no signal (combined with the service worker
 *     caching the HTML/JS).
 *
 *  2. **A durable mutation outbox** — check toggles and quantity edits are
 *     enqueued (coalesced per item) into IndexedDB and replayed by {@link
 *     flushOutbox} when connectivity returns. The pending ops double as the
 *     optimistic overlay (see {@link useOutbox}), so a queued change keeps showing
 *     until it has actually synced — even across a reload while offline.
 *
 * Writes never block the UI: the optimistic state is the outbox itself.
 */
import { useSyncExternalStore } from 'react'

/* ----------------------------- IndexedDB KV ----------------------------- */

const DB_NAME = 'ourrecipes-offline'
const DB_VERSION = 1
const STORES = ['cache', 'outbox'] as const
type Store = (typeof STORES)[number]

const hasIdb = () => typeof indexedDB !== 'undefined'

let dbPromise: Promise<IDBDatabase> | null = null
function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        for (const s of STORES) {
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s)
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
}

function idbRequest<T>(
  store: Store,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = run(db.transaction(store, mode).objectStore(store))
        req.onsuccess = () => resolve(req.result as T)
        req.onerror = () => reject(req.error)
      }),
  )
}

async function idbGet<T>(store: Store, key: string): Promise<T | undefined> {
  if (!hasIdb()) return undefined
  try {
    return await idbRequest<T>(store, 'readonly', (s) => s.get(key))
  } catch {
    return undefined
  }
}
async function idbSet(store: Store, key: string, value: unknown): Promise<void> {
  if (!hasIdb()) return
  try {
    await idbRequest(store, 'readwrite', (s) => s.put(value, key))
  } catch {
    /* best-effort; ignore quota/availability errors */
  }
}
async function idbDelete(store: Store, key: string): Promise<void> {
  if (!hasIdb()) return
  try {
    await idbRequest(store, 'readwrite', (s) => s.delete(key))
  } catch {
    /* ignore */
  }
}
async function idbGetAll<T>(store: Store): Promise<T[]> {
  if (!hasIdb()) return []
  try {
    return (await idbRequest<T[]>(store, 'readonly', (s) => s.getAll())) ?? []
  } catch {
    return []
  }
}

/* --------------------------- query snapshot cache ----------------------- */

/**
 * Wrap a query fn so its last successful result survives offline. On success the
 * result is cached under `key`; on failure the cached result (if any) is returned
 * instead of throwing. SSR just calls through (no cache, no window).
 */
export function withOfflineCache<T>(
  key: string,
  fn: () => Promise<T>,
): () => Promise<T> {
  return async () => {
    if (typeof window === 'undefined') return fn()
    try {
      const result = await fn()
      void idbSet('cache', key, result)
      return result
    } catch (err) {
      const cached = await idbGet<T>('cache', key)
      if (cached !== undefined) return cached
      throw err
    }
  }
}

/* ------------------------------- the outbox ----------------------------- */

export type OutboxOp =
  | { id: string; type: 'check'; key: string; value: boolean; seq: number }
  | { id: string; type: 'quantity'; key: string; value: number | null; seq: number }

/** Coalescing id: one pending op per (kind, item) — a re-toggle replaces it. */
const opId = (type: OutboxOp['type'], key: string) => `${type}:${key}`

let outbox: OutboxOp[] = []
// Monotonic per-enqueue sequence: orders the queue and uniquely identifies an op
// instance, so a re-toggle mid-flush is never mistaken for the one we just sent
// (a wall clock can collide at sub-ms speed; a counter can't). Continued past the
// max persisted value on hydrate so ordering survives a reload.
let seqCounter = 0
let hydrated = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

async function hydrate() {
  if (hydrated || typeof window === 'undefined') return
  hydrated = true
  const rows = await idbGetAll<OutboxOp>('outbox')
  // Merge anything enqueued before hydration finished, newest-seq wins.
  const merged = new Map<string, OutboxOp>()
  for (const op of [...rows, ...outbox]) {
    const prev = merged.get(op.id)
    if (!prev || op.seq >= prev.seq) merged.set(op.id, op)
    seqCounter = Math.max(seqCounter, op.seq)
  }
  outbox = [...merged.values()].sort((a, b) => a.seq - b.seq)
  emit()
}
if (typeof window !== 'undefined') void hydrate()

const EMPTY: OutboxOp[] = []
/** Current pending ops (oldest-first by ts). Also the React store snapshot. */
export const getOutboxSnapshot = () => outbox
const subscribe = (cb: () => void) => {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Queue (or replace) a pending check/quantity op and persist it. */
export function enqueueOp(
  op:
    | { type: 'check'; key: string; value: boolean }
    | { type: 'quantity'; key: string; value: number | null },
): void {
  const id = opId(op.type, op.key)
  const next = { ...op, id, seq: ++seqCounter } as OutboxOp
  outbox = [...outbox.filter((o) => o.id !== id), next]
  void idbSet('outbox', id, next)
  emit()
}

function removeOp(id: string) {
  outbox = outbox.filter((o) => o.id !== id)
  void idbDelete('outbox', id)
  emit()
}

let flushing = false
/**
 * Replay queued ops oldest-first via `execute`. Stops at the first failure (we're
 * likely offline) and retries on the next trigger. An op is only dropped if it
 * still holds the value we just sent — so a re-toggle mid-flight isn't lost.
 */
export async function flushOutbox(
  execute: (op: OutboxOp) => Promise<void>,
): Promise<void> {
  if (flushing || typeof window === 'undefined') return
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  flushing = true
  try {
    for (const op of [...outbox].sort((a, b) => a.seq - b.seq)) {
      try {
        await execute(op)
      } catch {
        break
      }
      const current = outbox.find((o) => o.id === op.id)
      if (current && current.seq === op.seq) removeOp(op.id)
    }
  } finally {
    flushing = false
  }
}

/* -------------------------------- hooks --------------------------------- */

/** Live `navigator.onLine`, SSR-safe (assumes online). */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('online', cb)
      window.addEventListener('offline', cb)
      return () => {
        window.removeEventListener('online', cb)
        window.removeEventListener('offline', cb)
      }
    },
    () => navigator.onLine,
    () => true,
  )
}

export interface OutboxView {
  ops: OutboxOp[]
  /** Pending checked overrides by item key (latest queued value). */
  pendingChecked: Map<string, boolean>
  /** Pending quantity overrides by item key (null = cleared back to the sum). */
  pendingOverride: Map<string, number | null>
  count: number
}

/** Subscribe to the outbox; derives the optimistic overlay maps for the list. */
export function useOutbox(): OutboxView {
  const ops = useSyncExternalStore(subscribe, getOutboxSnapshot, () => EMPTY)
  const pendingChecked = new Map<string, boolean>()
  const pendingOverride = new Map<string, number | null>()
  for (const op of ops) {
    if (op.type === 'check') pendingChecked.set(op.key, op.value)
    else pendingOverride.set(op.key, op.value)
  }
  return { ops, pendingChecked, pendingOverride, count: ops.length }
}
