"use client";

import * as React from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/patterns/page-header";
import { SectionCard } from "@/components/patterns/section-card";
import { Checkbox } from "@/components/ui/checkbox";
import { SIGNATURE_DOCS } from "@/lib/signatures/docs";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { useStaffRoster } from "@/lib/hooks/use-staff-roster";
import { useRole } from "@/lib/rbac/use-role";

/** The Super Admin's list: whose signature is on file, to remove one (someone who has left); never to add one. */
function OnFile() {
  const { staff } = useStaffRoster();
  const [rows, setRows] = React.useState<{ staff_id: string; uploaded_at: string }[]>([]);
  const [version, setVersion] = React.useState(0);
  React.useEffect(() => {
    let live = true;
    void createClient().schema("shared").from("staff_signatures").select("staff_id, uploaded_at").order("uploaded_at", { ascending: false })
      .then(({ data }) => live && setRows((data ?? []) as { staff_id: string; uploaded_at: string }[]));
    return () => {
      live = false;
    };
  }, [version]);
  async function remove(id: string) {
    const r = (await (await fetch(`/api/signature?staff=${id}`, { method: "DELETE" })).json().catch(() => null)) as { ok: boolean; error?: string } | null;
    if (!r?.ok) return void toast.error(r?.error ?? "The signature couldn't be removed.");
    toast.success("Signature removed; the removal is logged");
    setVersion((n) => n + 1);
  }
  const name = (id: string) => ((p) => (p ? `${p.firstName} ${p.lastName}` : "Former staff"))(staff.find((x) => x.id === id));
  return (
    <SectionCard flush title="Signatures on file" description="Everyone who has uploaded a signature. Remove one for someone who has left; only the person can upload theirs.">
      <ul className="divide-y divide-border">
        {rows.length === 0 ? <li className="px-5 py-3 text-theme-sm text-muted-foreground">None yet.</li> : null}
        {rows.map((r) => (
          <li key={r.staff_id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-theme-sm">
            <span>{name(r.staff_id)} <span className="text-muted-foreground">· uploaded {new Date(r.uploaded_at).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}</span></span>
            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => void remove(r.staff_id)}>Remove</Button>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

/**
 * My signature (0149): each person files their own signature image once. It prints above their name on the
 * vouchers, only on the steps they did in ArkOS. Stored privately; only they and the Super Admin can see it here.
 */
export default function MySignaturePage() {
  const { roles } = useRole();
  const [url, setUrl] = React.useState<string | null | undefined>(undefined);
  // The kinds of document that may carry the signature: as saved, and as ticked now.
  const [saved, setSaved] = React.useState<string[]>([]);
  const [allowed, setAllowed] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);

  const [version, setVersion] = React.useState(0);
  const load = () => setVersion((n) => n + 1);
  React.useEffect(() => {
    let live = true;
    void fetch("/api/signature", { cache: "no-store" })
      .then((res) => res.json())
      .catch(() => null)
      .then((r: { ok: boolean; url?: string | null; allowedDocs?: string[] } | null) => {
        if (!live) return;
        setUrl(r?.ok ? (r.url ?? null) : null);
        setSaved(r?.allowedDocs ?? []);
        setAllowed(r?.allowedDocs ?? []);
      });
    return () => {
      live = false;
    };
  }, [version]);

  async function upload(file: File) {
    if (!["image/png", "image/jpeg"].includes(file.type) || file.size > 1024 * 1024) return void toast.error("Use a PNG or JPG of your signature, up to 1 MB.");
    setBusy(true);
    const data = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(file);
    });
    const r = (await (await fetch("/api/signature", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ data }) })).json().catch(() => null)) as { ok: boolean; error?: string } | null;
    setBusy(false);
    if (!r?.ok) return void toast.error(r?.error ?? "The signature couldn't be saved.");
    toast.success("Your signature is saved");
    load();
  }

  async function saveAllowed() {
    setBusy(true);
    const r = (await (await fetch("/api/signature", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ docs: allowed }) })).json().catch(() => null)) as { ok: boolean; error?: string } | null;
    setBusy(false);
    if (!r?.ok) return void toast.error(r?.error ?? "The choice couldn't be saved.");
    toast.success("Saved");
    load();
  }

  async function remove() {
    setBusy(true);
    const r = (await (await fetch("/api/signature", { method: "DELETE" })).json().catch(() => null)) as { ok: boolean; error?: string } | null;
    setBusy(false);
    if (!r?.ok) return void toast.error(r?.error ?? "The signature couldn't be removed.");
    toast.success("Your signature is removed");
    load();
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="My signature" description="Printed above your name on the documents you choose below, and nowhere else. Every time it is printed, the system records on which document and who generated it." />
      <SectionCard title="Your signature" description="A clear photo or scan of your signature on white paper: PNG or JPG, up to 1 MB. Only you and the Super Admin can see it here.">
        <div className="flex flex-col gap-4">
          <div className="flex h-32 w-full max-w-sm items-center justify-center rounded-xl border border-dashed border-border bg-white p-3">
            {url === undefined ? <span className="text-theme-sm text-muted-foreground">Loading…</span> : url ? (
              <img src={url} alt="Your signature" className="max-h-full max-w-full object-contain" />
            ) : (
              <span className="text-theme-sm text-muted-foreground">No signature yet</span>
            )}
          </div>
          <input ref={input} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => input.current?.click()}>{url ? "Replace" : "Upload"} signature</Button>
            {url ? <Button variant="outline" disabled={busy} onClick={() => void remove()}>Remove</Button> : null}
          </div>
        </div>
      </SectionCard>
      {url ? (
        <SectionCard title="Where your signature may print" description="Tick the kinds of document. On each, your signature appears only where your own name is printed as a signer. Untick one to stop it from then on.">
          <div className="flex flex-col gap-3">
            <ul className="flex flex-col gap-2">
              {SIGNATURE_DOCS.map((d) => (
                <li key={d.key}>
                  <label className="flex items-start gap-2 text-theme-sm">
                    <Checkbox className="mt-0.5" checked={allowed.includes(d.key)} onCheckedChange={(v) => setAllowed((a) => (v === true ? [...a, d.key] : a.filter((x) => x !== d.key)))} />
                    <span>
                      {d.label}
                      <span className="block text-theme-xs text-muted-foreground">{d.note}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={busy || [...allowed].sort().join() === [...saved].sort().join()} onClick={() => void saveAllowed()}>Save my choice</Button>
              <Button variant="outline" disabled={busy} onClick={() => setAllowed(SIGNATURE_DOCS.map((d) => d.key))}>Tick all</Button>
              <Button variant="ghost" disabled={busy} onClick={() => setAllowed([])}>Untick all</Button>
            </div>
          </div>
        </SectionCard>
      ) : null}
      {roles.includes("admin") ? <OnFile /> : null}
    </div>
  );
}
