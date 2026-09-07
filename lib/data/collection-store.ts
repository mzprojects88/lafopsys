"use client";

import * as React from "react";

/**
 * A tiny shared cache for the data every lib/hooks/use-*-collection.ts hook
 * reads. Before this, each hook call held its own useState copy fetched once
 * on mount: five components using usePatientsData meant five copies and 20
 * queries, and a mutation's refetch() reached only the instance that made
 * it -- the clock-in gate in the app shell never learned about a punch made
 * by the dialog on /staff.
 *
 * One store per collection, module-scoped. Every mount shares the snapshot;
 * the first subscriber (or a stale one) triggers the fetch; a refetch()
 * updates all of them at once. lib/data/realtime-provider.tsx calls refetch
 * on the stores whose tables changed, which is what makes the app live.
 *
 * Deliberately not TanStack Query: ~150 lines keeps every hook's exported
 * name and return shape byte-compatible for pages. The API is shaped so a
 * later swap would be a per-hook change, not a page change.
 */

export type Schema = "ops" | "shared" | "inventory" | "hr";

/** A table a collection reads. `table` omitted means "anything in the schema"
 * (used by the inventory views, which are computed over every inventory table). */
export interface TableRef {
  schema: Schema;
  table?: string;
}

export interface CollectionSnapshot<T> {
  data: T;
  /** True until the first successful fetch; never flips back afterwards, so a
   * live refetch doesn't blank a page that already has data. */
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
}

export interface Collection<T> {
  readonly key: string;
  readonly tables: TableRef[];
  readonly subscriberCount: number;
  getSnapshot(): CollectionSnapshot<T>;
  getServerSnapshot(): CollectionSnapshot<T>;
  subscribe(listener: () => void): () => void;
  /** Resolves once a fetch that started at or after this call has completed --
   * a mutation that awaits it never resolves with pre-write data. Concurrent
   * callers share one in-flight fetch plus at most one queued follow-up. */
  refetch(): Promise<void>;
  /** Next mount refetches immediately; existing data stays visible meanwhile. */
  markStale(): void;
  /** Back to empty + loading (used when the signed-in user changes). */
  reset(): void;
}

interface CreateOptions<T> {
  key: string;
  empty: T;
  fetch: () => Promise<T>;
  tables: TableRef[];
  /** Warm data older than this is refetched on the next mount. */
  staleMs?: number;
}

const DEFAULT_STALE_MS = 60_000;

// ---- registry: table -> stores that read it (consulted by the realtime provider) ----
const registry = new Set<Collection<unknown>>();

export function storesForTable(schema: string, table: string): Set<Collection<unknown>> {
  const out = new Set<Collection<unknown>>();
  for (const store of registry) {
    if (store.tables.some((t) => t.schema === schema && (t.table === undefined || t.table === table))) out.add(store);
  }
  return out;
}

export function allStores(): Collection<unknown>[] {
  return [...registry];
}

/** Mounted stores refetch now; unmounted ones refetch on their next mount. */
export async function invalidateTables(refs: TableRef[]): Promise<void> {
  const stores = new Set<Collection<unknown>>();
  for (const ref of refs) {
    for (const store of registry) {
      if (store.tables.some((t) => t.schema === ref.schema && (ref.table === undefined || t.table === undefined || t.table === ref.table))) {
        stores.add(store);
      }
    }
  }
  await Promise.all([...stores].map((s) => (s.subscriberCount > 0 ? s.refetch() : Promise.resolve(s.markStale()))));
}

/** Forget everything -- called when the auth user changes, so a soft-nav
 * logout/login never shows the previous person's rows. */
export function resetAllCollections(): void {
  for (const store of registry) store.reset();
}

export function createCollection<T>(opts: CreateOptions<T>): Collection<T> {
  const staleMs = opts.staleMs ?? DEFAULT_STALE_MS;
  const serverSnapshot: CollectionSnapshot<T> = { data: opts.empty, loading: true, error: null, lastFetchedAt: null };
  let snapshot: CollectionSnapshot<T> = serverSnapshot;
  let stale = true;
  const subscribers = new Set<() => void>();
  let inFlight: Promise<void> | null = null;
  let queued: Promise<void> | null = null;

  function emit(next: CollectionSnapshot<T>) {
    snapshot = next;
    for (const l of subscribers) l();
  }

  async function runFetch(): Promise<void> {
    try {
      const data = await opts.fetch();
      stale = false;
      emit({ data, loading: false, error: null, lastFetchedAt: Date.now() });
    } catch (e) {
      emit({ ...snapshot, error: e instanceof Error ? e.message : String(e) });
    }
  }

  function refetch(): Promise<void> {
    if (!inFlight) {
      inFlight = runFetch().finally(() => {
        inFlight = null;
      });
      return inFlight;
    }
    // A fetch is already running and may have started before the caller's
    // write landed -- queue exactly one follow-up and hand every waiter that.
    if (!queued) {
      queued = inFlight.then(() => {
        queued = null;
        return refetch();
      });
    }
    return queued;
  }

  const store: Collection<T> = {
    key: opts.key,
    tables: opts.tables,
    get subscriberCount() {
      return subscribers.size;
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => serverSnapshot,
    subscribe(listener) {
      subscribers.add(listener);
      const tooOld = snapshot.lastFetchedAt == null || Date.now() - snapshot.lastFetchedAt > staleMs;
      if (subscribers.size === 1 && (stale || tooOld)) void refetch();
      return () => {
        subscribers.delete(listener);
      };
    },
    refetch,
    markStale() {
      stale = true;
    },
    reset() {
      stale = true;
      emit(serverSnapshot);
      if (subscribers.size > 0) void refetch();
    },
  };

  registry.add(store as Collection<unknown>);
  return store;
}

interface FamilyOptions<T, K extends string> {
  key: string;
  empty: T;
  fetch: (k: K) => Promise<T>;
  tables: (k: K) => TableRef[];
  staleMs?: number;
}

/** Per-key stores for parameterised hooks (per patient, per reference table),
 * created lazily and cached for the life of the page. */
export function createCollectionFamily<T, K extends string = string>(opts: FamilyOptions<T, K>) {
  const members = new Map<K, Collection<T>>();
  return {
    get(k: K): Collection<T> {
      let store = members.get(k);
      if (!store) {
        store = createCollection<T>({
          key: `${opts.key}:${k}`,
          empty: opts.empty,
          fetch: () => opts.fetch(k),
          tables: opts.tables(k),
          staleMs: opts.staleMs,
        });
        members.set(k, store);
      }
      return store;
    },
  };
}

const NULL_SNAPSHOT: CollectionSnapshot<never[]> = { data: [], loading: true, error: null, lastFetchedAt: null };
const noopSubscribe = () => () => {};

/** Read a store from a component. `null` (e.g. "no patient id yet") yields a
 * constant empty/loading snapshot without subscribing to anything. */
export function useCollection<T>(store: Collection<T> | null): CollectionSnapshot<T> {
  const subscribe = store ? store.subscribe : noopSubscribe;
  const getSnapshot = store ? store.getSnapshot : () => NULL_SNAPSHOT as unknown as CollectionSnapshot<T>;
  const getServerSnapshot = store ? store.getServerSnapshot : () => NULL_SNAPSHOT as unknown as CollectionSnapshot<T>;
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
