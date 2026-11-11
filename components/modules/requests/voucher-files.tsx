"use client";

import * as React from "react";
import { toast } from "sonner";
import { FileText, Paperclip, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCollection } from "@/lib/data/collection-store";
import { useRole } from "@/lib/rbac/use-role";
import { voucherFilesStore } from "@/lib/hooks/use-vouchers";
import { formatBytes } from "@/lib/utils/file-paths";

const KINDS = { receipt: "Receipt / OR", invoice: "Invoice / billing", quotation: "Quotation", proof: "Proof of payment", other: "Other" } as const;
type Kind = keyof typeof KINDS;
const MAX = 3 * 1024 * 1024;

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

/** A request's receipts, invoices and quotations: open one, add one (when allowed), remove one's own. */
export function VoucherFiles({ voucherId, canAttach }: { voucherId: string; canAttach: boolean }) {
  const { staffId } = useRole();
  const { data: all } = useCollection(voucherFilesStore);
  const files = all.filter((f) => f.voucherId === voucherId);
  const [kind, setKind] = React.useState<Kind>("receipt");
  const [busy, setBusy] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);

  async function open(id: string) {
    const res = await fetch(`/api/requests/file?id=${id}`);
    const body = (await res.json().catch(() => null)) as { ok?: boolean; url?: string; error?: string } | null;
    if (!body?.ok || !body.url) return void toast.error(body?.error ?? "The file couldn't be opened.");
    window.open(body.url, "_blank", "noopener");
  }

  async function add(file: File) {
    if (file.size > MAX) return void toast.error("Up to 3 MB: take the photo again at a smaller size, or scan the PDF lighter.");
    setBusy(true);
    const res = await fetch("/api/requests/file", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ voucherId, kind, fileName: file.name, data: await readAsDataUrl(file) }),
    });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    setBusy(false);
    if (!body?.ok) return void toast.error(body?.error ?? "The file couldn't be added.");
    await voucherFilesStore.refetch();
    toast.success("File added");
  }

  async function remove(id: string) {
    if (!confirm("Remove this file?")) return;
    const res = await fetch(`/api/requests/file?id=${id}`, { method: "DELETE" });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!body?.ok) return void toast.error(body?.error ?? "The file couldn't be removed.");
    await voucherFilesStore.refetch();
  }

  return (
    <div className="flex flex-col gap-3">
      {files.length === 0 ? <p className="text-theme-sm text-muted-foreground">No files yet.</p> : null}
      {files.map((f) => (
        <div key={f.id} className="flex items-center gap-3 rounded-xl border border-border px-3 py-2">
          <FileText className="size-4 shrink-0 text-muted-foreground" />
          <button type="button" className="min-w-0 flex-1 truncate text-left text-theme-sm text-primary hover:underline" onClick={() => void open(f.id)}>
            {f.fileName}
          </button>
          <span className="shrink-0 text-theme-xs text-muted-foreground">{KINDS[f.kind]} · {formatBytes(f.bytes)}</span>
          {canAttach && f.uploadedBy === staffId ? (
            <Button size="sm" variant="ghost" className="text-destructive" aria-label={`Remove ${f.fileName}`} onClick={() => void remove(f.id)}>
              <Trash2 />
            </Button>
          ) : null}
        </div>
      ))}
      {canAttach ? (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
            <SelectTrigger className="w-44" aria-label="What the file is"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(KINDS) as Kind[]).map((k) => (
                <SelectItem key={k} value={k}>{KINDS[k]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,application/pdf"

            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void add(file);
            }}
          />
          <Button variant="outline" disabled={busy} onClick={() => input.current?.click()}>
            <Paperclip /> {busy ? "Adding…" : "Add a photo or PDF"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
