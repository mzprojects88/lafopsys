"use client";

import * as React from "react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

/**
 * Once the AI use statement is approved (Settings, 0132), staff accept its current version once. Before that this
 * renders nothing. A failed read asks nothing: this must never lock anyone out of work because of a bad connection.
 */
export function AiConsentGate() {
  const [ask, setAsk] = React.useState<{ version: number; text: string } | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    void (async () => {
      const client = createClient();
      const db = client.schema("shared");
      const { data } = await db.from("app_settings").select("ai_consent_approved, ai_consent_version, ai_consent_text").eq("id", true).maybeSingle();
      if (!live || !data || data.ai_consent_approved !== true) return;
      const version = Number(data.ai_consent_version);
      const {
        data: { user },
      } = await client.auth.getUser();
      if (!user) return;
      const { data: mine, error } = await db.from("ai_consents").select("version").eq("staff_id", user.id).eq("version", version).maybeSingle();
      if (live && !error && !mine) setAsk({ version, text: data.ai_consent_text as string });
    })();
    return () => {
      live = false;
    };
  }, []);

  if (!ask) return null;
  async function accept() {
    setBusy(true);
    const { error } = await createClient().schema("shared").from("ai_consents").insert({ version: ask!.version });
    setBusy(false);
    if (error) return void toast.error(`Couldn't record this: ${error.message}`);
    setAsk(null);
  }
  const [title, ...rest] = ask.text.split("\n\n");
  return (
    <AlertDialog open>
      <AlertDialogContent className="max-h-[85vh] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription className="whitespace-pre-line text-left">{rest.join("\n\n")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button onClick={accept} disabled={busy}>{busy ? "Saving…" : "I understand and agree"}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
