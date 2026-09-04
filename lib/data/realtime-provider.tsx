"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import { allStores, storesForTable, type Collection, type Schema } from "@/lib/data/collection-store";

/** Changes arriving within this window are coalesced into one refetch pass. */
const DEBOUNCE_MS = 400;
/** A store refreshed this recently already reflects the write that produced
 * the event (almost always our own mutation's refetch) -- skip the echo. */
const SELF_ECHO_MS = 800;
/** Wake-up resyncs (tab visible again, back online, reconnect) at most this often. */
const RESYNC_THROTTLE_MS = 2000;

/**
 * Keeps every mounted collection store live. One Supabase Realtime channel
 * per mount with a schema-wide `postgres_changes` listener per schema; each
 * event is routed through the store registry (collection-store.ts) to the
 * stores that read the changed table, which refetch through their normal
 * RLS-gated SELECT. Mirrors laf-inventory's use-real-inventory-data.ts.
 *
 * Schema-wide listeners (not per-table) because a channel's bindings are
 * fixed at subscribe() time while family stores are created lazily, and so
 * a new table needs only the publication (supabase/migrations/0027), not
 * an app change. The topic is unique per mount: realtime-js hands back the
 * existing channel for a repeated topic and tears it down asynchronously,
 * so StrictMode's mount -> cleanup -> mount would otherwise resubscribe a
 * half-dead channel.
 *
 * Phones sleep and miss events, so the tab becoming visible, coming back
 * online, or the channel re-subscribing after a drop refetches everything
 * currently mounted.
 */
export function RealtimeProvider({ schemas, children }: { schemas: Schema[]; children: React.ReactNode }) {
  const schemasKey = schemas.join(",");

  React.useEffect(() => {
    const supabase = createClient();
    const pending = new Map<string, { schema: string; table: string }>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastResyncAt = 0;
    let subscribedOnce = false;

    function flush() {
      timer = null;
      const now = Date.now();
      const targets = new Set<Collection<unknown>>();
      for (const { schema, table } of pending.values()) {
        for (const store of storesForTable(schema, table)) targets.add(store);
      }
      pending.clear();
      for (const store of targets) {
        if (store.subscriberCount === 0) {
          store.markStale();
          continue;
        }
        const last = store.getSnapshot().lastFetchedAt;
        if (last != null && now - last < SELF_ECHO_MS) continue;
        void store.refetch();
      }
    }

    function onChange(payload: { schema: string; table: string }) {
      pending.set(`${payload.schema}.${payload.table}`, { schema: payload.schema, table: payload.table });
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, DEBOUNCE_MS);
    }

    function resyncMounted() {
      const now = Date.now();
      if (now - lastResyncAt < RESYNC_THROTTLE_MS) return;
      lastResyncAt = now;
      for (const store of allStores()) {
        if (store.subscriberCount > 0) void store.refetch();
        else store.markStale();
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === "visible") resyncMounted();
    };
    const onOnline = () => resyncMounted();

    let channel = supabase.channel(`lafopsys-live:${crypto.randomUUID()}`);
    for (const schema of schemasKey.split(",")) {
      channel = channel.on("postgres_changes", { event: "*", schema }, onChange);
    }
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        // A second SUBSCRIBED is a reconnect: anything that changed while the
        // socket was down was never delivered.
        if (subscribedOnce) resyncMounted();
        subscribedOnce = true;
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.warn(`Live updates channel ${status.toLowerCase()} -- relying on the client's own reconnect.`);
      }
    });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);

    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      void supabase.removeChannel(channel);
    };
  }, [schemasKey]);

  return <>{children}</>;
}
