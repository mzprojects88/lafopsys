"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, createCollectionFamily, useCollection } from "@/lib/data/collection-store";
import type { OrientationTopic, StayOrientationCheck } from "@/lib/types/patient";

export type MutationResult = { ok: true } | { ok: false; error: string };

interface OrientationTopicRow {
  id: string;
  topic: string;
  topic_en: string | null;
  sort_order: number;
  returnee_too: boolean;
}

interface CheckRow {
  stay_id: string;
  topic_id: string;
  covered_at: string;
  covered_by_staff_id: string | null;
}

function toTopic(row: OrientationTopicRow): OrientationTopic {
  return { id: row.id, topic: row.topic, topicEn: row.topic_en ?? undefined, sortOrder: row.sort_order, returneeToo: row.returnee_too };
}

/** The org's own arrival-day topics (`ops.orientation_topics`, empty by design
 * until staff write their real list). Each says whether a returning family is
 * taken through it again (0054). */
export const orientationTopicsStore = createCollection<OrientationTopic[]>({
  key: "ops.orientation_topics",
  empty: [],
  tables: [{ schema: "ops", table: "orientation_topics" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("ops").from("orientation_topics").select("*").order("sort_order");
    if (error) throw new Error(error.message);
    return ((data ?? []) as OrientationTopicRow[]).map(toTopic);
  },
});

/** Ticks belong to the stay: a family is oriented again each admission (0054). */
const orientationChecks = createCollectionFamily<StayOrientationCheck[]>({
  key: "ops.stay_orientation_checks",
  empty: [],
  tables: () => [{ schema: "ops", table: "stay_orientation_checks" }],
  fetch: async (stayId) => {
    const { data, error } = await createClient().schema("ops").from("stay_orientation_checks").select("*").eq("stay_id", stayId);
    if (error) throw new Error(error.message);
    return ((data ?? []) as CheckRow[]).map((r) => ({
      stayId: r.stay_id,
      topicId: r.topic_id,
      coveredAt: r.covered_at,
      coveredByStaffId: r.covered_by_staff_id ?? undefined,
    }));
  },
});

/** Every tick in the house, for the "tasks left" counts on the day's boards. */
export const allOrientationChecksStore = createCollection<StayOrientationCheck[]>({
  key: "ops.stay_orientation_checks.all",
  empty: [],
  tables: [{ schema: "ops", table: "stay_orientation_checks" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("ops").from("stay_orientation_checks").select("stay_id, topic_id, covered_at, covered_by_staff_id");
    if (error) throw new Error(error.message);
    return ((data ?? []) as CheckRow[]).map((r) => ({
      stayId: r.stay_id,
      topicId: r.topic_id,
      coveredAt: r.covered_at,
      coveredByStaffId: r.covered_by_staff_id ?? undefined,
    }));
  },
});

export function useAllOrientationChecks() {
  const { data: topics } = useCollection(orientationTopicsStore);
  const { data: checks } = useCollection(allOrientationChecksStore);
  return { topics, checks };
}

/** `firstStay` decides the list: everything the first time, the shorter set for a returning family. */
export function useOrientationTopics(stayId?: string, firstStay = true) {
  const { data: allTopics, loading: topicsLoading } = useCollection(orientationTopicsStore);
  const checksStore = stayId ? orientationChecks.get(stayId) : null;
  const { data: checks, loading: checksLoading } = useCollection(checksStore);
  const topics = firstStay ? allTopics : allTopics.filter((t) => t.returneeToo);

  async function addTopic(topic: string, topicEn?: string): Promise<MutationResult> {
    const sortOrder = allTopics.length > 0 ? Math.max(...allTopics.map((t) => t.sortOrder)) + 1 : 0;
    const { error } = await createClient()
      .schema("ops")
      .from("orientation_topics")
      .insert({ topic, topic_en: topicEn?.trim() || null, sort_order: sortOrder });
    if (error) return { ok: false, error: error.message };
    await orientationTopicsStore.refetch();
    return { ok: true };
  }

  async function removeTopic(id: string): Promise<MutationResult> {
    const { error } = await createClient().schema("ops").from("orientation_topics").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    await orientationTopicsStore.refetch();
    return { ok: true };
  }

  /** Whether a returning family is taken through this topic again. */
  async function setReturneeToo(id: string, returneeToo: boolean): Promise<MutationResult> {
    const { error } = await createClient().schema("ops").from("orientation_topics").update({ returnee_too: returneeToo }).eq("id", id);
    if (error) return { ok: false, error: error.message };
    await orientationTopicsStore.refetch();
    return { ok: true };
  }

  async function toggleCheck(topicId: string, covered: boolean): Promise<MutationResult> {
    if (!stayId || !checksStore) return { ok: false, error: "This patient has no stay to tick against yet." };
    const table = createClient().schema("ops").from("stay_orientation_checks");
    // The database stamps who and when.
    const { error } = covered
      ? await table.upsert({ stay_id: stayId, topic_id: topicId }, { onConflict: "stay_id,topic_id" })
      : await table.delete().eq("stay_id", stayId).eq("topic_id", topicId);
    if (error) return { ok: false, error: error.message };
    await checksStore.refetch();
    return { ok: true };
  }

  return {
    topics,
    allTopics,
    checks,
    loading: topicsLoading || (checksStore !== null && checksLoading),
    addTopic,
    removeTopic,
    setReturneeToo,
    toggleCheck,
    refetch: async () => {
      await Promise.all([orientationTopicsStore.refetch(), checksStore?.refetch()]);
    },
  };
}
