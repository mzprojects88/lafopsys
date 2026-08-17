"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import type { OrientationTopic, PatientOrientationCheck } from "@/lib/types/patient";

export type MutationResult = { ok: true } | { ok: false; error: string };

interface OrientationTopicRow {
  id: string;
  topic: string;
  sort_order: number;
}

interface PatientOrientationCheckRow {
  patient_id: string;
  topic_id: string;
  covered_at: string;
  covered_by_staff_id: string | null;
}

function toTopic(row: OrientationTopicRow): OrientationTopic {
  return { id: row.id, topic: row.topic, sortOrder: row.sort_order };
}

function toCheck(row: PatientOrientationCheckRow): PatientOrientationCheck {
  return {
    patientId: row.patient_id,
    topicId: row.topic_id,
    coveredAt: row.covered_at,
    coveredByStaffId: row.covered_by_staff_id ?? undefined,
  };
}

/** Org-wide, staff-editable orientation-topic list (`ops.orientation_topics`), starting
 * empty by design -- see the type's own doc comment for why. Also exposes per-patient
 * coverage against `ops.patient_orientation_checks`. */
export function useOrientationTopics(patientId?: string) {
  const [topics, setTopics] = React.useState<OrientationTopic[]>([]);
  const [checks, setChecks] = React.useState<PatientOrientationCheck[]>([]);
  const [loading, setLoading] = React.useState(true);

  const refetch = React.useCallback(async () => {
    const supabase = createClient();
    const topicsRes = await supabase.schema("ops").from("orientation_topics").select("*").order("sort_order");
    setTopics((topicsRes.data ?? []).map(toTopic));

    if (patientId) {
      const checksRes = await supabase
        .schema("ops")
        .from("patient_orientation_checks")
        .select("*")
        .eq("patient_id", patientId);
      setChecks((checksRes.data ?? []).map(toCheck));
    }
    setLoading(false);
  }, [patientId]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from Supabase, an external system
    refetch();
  }, [refetch]);

  async function addTopic(topic: string): Promise<MutationResult> {
    const supabase = createClient();
    const sortOrder = topics.length > 0 ? Math.max(...topics.map((t) => t.sortOrder)) + 1 : 0;
    const { error } = await supabase.schema("ops").from("orientation_topics").insert({ topic, sort_order: sortOrder });
    if (error) return { ok: false, error: error.message };
    await refetch();
    return { ok: true };
  }

  async function removeTopic(id: string): Promise<MutationResult> {
    const supabase = createClient();
    const { error } = await supabase.schema("ops").from("orientation_topics").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    await refetch();
    return { ok: true };
  }

  async function toggleCheck(topicId: string, covered: boolean): Promise<MutationResult> {
    if (!patientId) return { ok: false, error: "No patient selected" };
    const supabase = createClient();
    if (!covered) {
      const { error } = await supabase
        .schema("ops")
        .from("patient_orientation_checks")
        .delete()
        .eq("patient_id", patientId)
        .eq("topic_id", topicId);
      if (error) return { ok: false, error: error.message };
      await refetch();
      return { ok: true };
    }
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase.schema("ops").from("patient_orientation_checks").upsert(
      {
        patient_id: patientId,
        topic_id: topicId,
        covered_at: new Date().toISOString(),
        covered_by_staff_id: userData.user?.id ?? null,
      },
      { onConflict: "patient_id,topic_id" }
    );
    if (error) return { ok: false, error: error.message };
    await refetch();
    return { ok: true };
  }

  return { topics, checks, loading, addTopic, removeTopic, toggleCheck, refetch };
}
