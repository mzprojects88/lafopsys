"use client";

import * as React from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { saveAiConsentText, setAiConsentApproved } from "@/app/(app)/settings/actions";

interface Consent { text: string; familyText: string; approved: boolean; version: number }

/** The AI use statement (0132): kept here while legal approves it. Nobody is asked until it is marked approved. */
export function AiConsentCard() {
  const [saved, setSaved] = React.useState<Consent | null>(null);
  const [text, setText] = React.useState("");
  const [familyText, setFamilyText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [accepted, setAccepted] = React.useState<number | null>(null);

  const load = React.useCallback(async () => {
    const db = createClient().schema("shared");
    const { data } = await db.from("app_settings").select("ai_consent_text, ai_consent_family_text, ai_consent_approved, ai_consent_version").eq("id", true).maybeSingle();
    if (!data) return;
    const c: Consent = { text: data.ai_consent_text as string, familyText: data.ai_consent_family_text as string, approved: data.ai_consent_approved === true, version: Number(data.ai_consent_version) };
    setSaved(c);
    setText(c.text);
    setFamilyText(c.familyText);
    const { count } = await db.from("ai_consents").select("staff_id", { count: "exact", head: true }).eq("version", c.version);
    setAccepted(count ?? 0);
  }, []);
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loaded once on mount
    void load();
  }, [load]);

  if (!saved) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const changed = text !== saved.text || familyText !== saved.familyText;

  async function save() {
    setBusy(true);
    const r = await saveAiConsentText(text, familyText);
    setBusy(false);
    if (!r.ok) return void toast.error(r.error ?? "Couldn't save the statement.");
    toast.success("Statement saved.");
    await load();
  }
  async function approve(next: boolean) {
    setBusy(true);
    const r = await setAiConsentApproved(next);
    setBusy(false);
    if (!r.ok) return void toast.error(r.error ?? "Couldn't update this setting.");
    toast.success(next ? "Approved: staff are asked to accept at their next page load." : "Back to pending: nobody is asked.");
    await load();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">Status</p>
            <Badge variant={saved.approved ? "default" : "outline"}>{saved.approved ? "Approved" : "Pending legal approval"}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {saved.approved
              ? `Staff accept version ${saved.version} once, in either app. ${accepted ?? 0} accepted so far.`
              : "Until legal approves it, nobody is asked. Turn this on when it is approved."}
          </p>
        </div>
        <Switch checked={saved.approved} disabled={busy || changed} onCheckedChange={approve} aria-label="Approved by legal: ask staff to accept" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ai-consent-text">Statement staff accept</Label>
        <Textarea id="ai-consent-text" rows={12} value={text} onChange={(e) => setText(e.target.value)} maxLength={6000} />
        <p className="text-xs text-muted-foreground">Changing this text raises the version, so everyone is asked again.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ai-consent-family">Statement families sign at admission</Label>
        <Textarea id="ai-consent-family" rows={12} value={familyText} onChange={(e) => setFamilyText(e.target.value)} maxLength={6000} />
        <p className="text-xs text-muted-foreground">The social worker records the date signed on the intake form.</p>
      </div>
      <div>
        <Button onClick={save} disabled={busy || !changed}>Save statement</Button>
      </div>
    </div>
  );
}
