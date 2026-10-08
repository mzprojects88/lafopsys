"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowRight, Sparkles, Users, PenLine, UserX, Search } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { SectionCard } from "@/components/patterns/section-card";
import { EmptyState } from "@/components/patterns/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useDonorsData } from "@/lib/hooks/use-donors-collection";
import { useDonorSuggestions, type DonorSuggestion } from "@/lib/hooks/use-donor-suggestions";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import type { Donor, DonorType } from "@/lib/types/donor";
import { findDonorSuggestions } from "./actions";

const TYPES: DonorType[] = ["individual", "corporate", "foundation", "government", "anonymous"];
const typeLabel = (t: string) => t[0]!.toUpperCase() + t.slice(1);

function SourceBadge({ source }: { source: DonorSuggestion["source"] }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${source === "ai" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
      {source === "ai" ? <Sparkles className="size-3" /> : null}
      {source === "ai" ? "AI" : "Rule"}
    </span>
  );
}

/** Donors › Clean-up: suggestions from the rules and the AI, each approved or rejected by a donors editor (0083). */
export default function DonorCleanupPage() {
  const { donors } = useDonorsData();
  const { suggestions, loading, apply, reject, merge } = useDonorSuggestions();
  const { canEdit } = useModuleAccess();
  const editor = canEdit("donors");
  const [finding, startFinding] = React.useTransition();
  const byId = React.useMemo(() => new Map(donors.map((d) => [d.id, d])), [donors]);
  const live = suggestions.filter((s) => byId.has(s.donorId) && (s.kind !== "merge" || byId.has(s.proposed.merge ?? "")));
  const merges = live.filter((s) => s.kind === "merge");
  const incomplete = live.filter((s) => s.kind === "incomplete");
  const formats = live.filter((s) => s.kind === "format");

  const done = (r: { ok: boolean; error?: string }, ok: string) => (r.ok ? toast.success(ok) : toast.error(r.error ?? "That didn't work."));

  function find() {
    startFinding(async () => {
      const r = await findDonorSuggestions();
      if (!r.ok) return void toast.error(r.error);
      const n = r.added.format + r.added.merge + r.added.incomplete;
      toast.success(n ? `${n} new suggestion${n === 1 ? "" : "s"}: ${r.added.merge} merge, ${r.added.format} name/type, ${r.added.incomplete} full name` : "No new suggestions.");
      if (r.aiError) toast.warning(`The AI didn't answer (${r.aiError}); rule suggestions only.`);
    });
  }

  async function applyAllRules() {
    let okCount = 0;
    for (const s of formats.filter((x) => x.source === "rule")) {
      const r = await apply(s.id);
      if (r.ok) okCount++;
    }
    toast.success(`${okCount} name${okCount === 1 ? "" : "s"} tidied.`);
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Donor clean-up"
        description="Suggestions to write donor names the LAF way, set the right donor type and merge duplicates. Nothing changes until an editor approves it."
        action={
          <>
            <Button variant="outline" asChild>
              <Link href="/donors">All donors</Link>
            </Button>
            {editor && (
              <Button onClick={find} disabled={finding}>
                <Search />
                {finding ? "Looking… (up to a minute)" : "Find suggestions"}
              </Button>
            )}
          </>
        }
      />

      {!loading && live.length === 0 && (
        <EmptyState title="Nothing to review" description={editor ? "Run Find suggestions to check every donor's name, type and duplicates." : "No suggestions are waiting."} />
      )}

      {merges.length > 0 && (
        <SectionCard title={<span className="flex items-center gap-2"><Users className="size-4 text-muted-foreground" />Same donor? ({merges.length})</span>}>
          <ul className="flex flex-col divide-y divide-border">
            {merges.map((s) => (
              <MergeRow key={s.id} s={s} keep={byId.get(s.donorId)!} other={byId.get(s.proposed.merge!)!} editor={editor} merge={merge} reject={reject} done={done} />
            ))}
          </ul>
        </SectionCard>
      )}

      {incomplete.length > 0 && (
        <SectionCard title={<span className="flex items-center gap-2"><UserX className="size-4 text-muted-foreground" />Needs a full name ({incomplete.length})</span>}>
          <ul className="flex flex-col divide-y divide-border">
            {incomplete.map((s) => (
              <FullNameRow key={s.id} s={s} donor={byId.get(s.donorId)!} editor={editor} apply={apply} reject={reject} done={done} />
            ))}
          </ul>
        </SectionCard>
      )}

      {formats.length > 0 && (
        <SectionCard
          title={<span className="flex items-center gap-2"><PenLine className="size-4 text-muted-foreground" />Names &amp; types ({formats.length})</span>}
          actions={
            editor && formats.some((s) => s.source === "rule") ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="outline">Apply all rule suggestions</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Apply {formats.filter((s) => s.source === "rule").length} rule suggestions?</AlertDialogTitle>
                    <AlertDialogDescription>Capitals, spacing, titles and plain type fixes. AI suggestions stay for you to check one by one.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Not now</AlertDialogCancel>
                    <AlertDialogAction onClick={applyAllRules}>Apply them</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : null
          }
        >
          <ul className="flex flex-col divide-y divide-border">
            {formats.map((s) => (
              <FormatRow key={s.id} s={s} donor={byId.get(s.donorId)!} editor={editor} apply={apply} reject={reject} done={done} />
            ))}
          </ul>
        </SectionCard>
      )}
    </div>
  );
}

type Done = (r: { ok: boolean; error?: string }, ok: string) => unknown;
type Result = Promise<{ ok: true } | { ok: false; error: string }>;

function MergeRow({ s, keep, other, editor, merge, reject, done }: { s: DonorSuggestion; keep: Donor; other: Donor; editor: boolean; merge: (k: string, d: string, r: string) => Result; reject: (id: string) => Result; done: Done }) {
  const line = (d: Donor) => `${d.name} · ${d.giftCount} gift${d.giftCount === 1 ? "" : "s"}${d.email ? ` · ${d.email}` : ""}`;
  return (
    <li className="flex flex-col gap-2 py-3 text-theme-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/donors/${keep.id}`} className="font-medium hover:underline">{line(keep)}</Link>
        <span className="text-muted-foreground">and</span>
        <Link href={`/donors/${other.id}`} className="font-medium hover:underline">{line(other)}</Link>
        <SourceBadge source={s.source} />
      </div>
      <p className="text-theme-xs text-muted-foreground">{s.reason}</p>
      {editor && (
        <div className="flex flex-wrap gap-2">
          <ConfirmMerge label={`Merge into "${keep.name}"`} keep={keep} drop={other} onConfirm={() => merge(keep.id, other.id, s.reason || "Same donor").then((r) => done(r, "Merged."))} />
          <ConfirmMerge label={`Keep "${other.name}" instead`} keep={other} drop={keep} variant="outline" onConfirm={() => merge(other.id, keep.id, s.reason || "Same donor").then((r) => done(r, "Merged."))} />
          <Button size="sm" variant="ghost" onClick={() => reject(s.id).then((r) => done(r, "Kept as two donors."))}>Not the same</Button>
        </div>
      )}
    </li>
  );
}

function ConfirmMerge({ label, keep, drop, onConfirm, variant = "default" }: { label: string; keep: Donor; drop: Donor; onConfirm: () => void; variant?: "default" | "outline" }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant={variant}>{label}</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Merge into &ldquo;{keep.name}&rdquo;?</AlertDialogTitle>
          <AlertDialogDescription>
            &ldquo;{drop.name}&rdquo;&apos;s {drop.giftCount} gift{drop.giftCount === 1 ? "" : "s"}, pledges, receipts and portal account move to &ldquo;{keep.name}&rdquo;, and &ldquo;{drop.name}&rdquo; is removed. The merge is logged with a copy of the removed record.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Merge</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function FullNameRow({ s, donor, editor, apply, reject, done }: { s: DonorSuggestion; donor: Donor; editor: boolean; apply: (id: string, e?: { name?: string; salutation?: string | null }) => Result; reject: (id: string) => Result; done: Done }) {
  const [name, setName] = React.useState("");
  return (
    <li className="flex flex-col gap-2 py-3 text-theme-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/donors/${donor.id}`} className="font-medium hover:underline">{donor.name}</Link>
        <span className="text-theme-xs text-muted-foreground">· {donor.giftCount} gift{donor.giftCount === 1 ? "" : "s"}</span>
        <SourceBadge source={s.source} />
      </div>
      {editor && (
        <div className="flex flex-wrap gap-2">
          <Input className="max-w-xs" placeholder="Full name, e.g. Grace Santos" value={name} onChange={(e) => setName(e.target.value)} aria-label={`Full name for ${donor.name}`} />
          <Button size="sm" disabled={name.trim().length < 4} onClick={() => apply(s.id, { name: name.trim(), salutation: s.proposed.salutation ?? null }).then((r) => done(r, "Full name saved."))}>Save</Button>
          <Button size="sm" variant="ghost" onClick={() => reject(s.id).then((r) => done(r, "Left as it is."))}>Leave as is</Button>
        </div>
      )}
    </li>
  );
}

function FormatRow({ s, donor, editor, apply, reject, done }: { s: DonorSuggestion; donor: Donor; editor: boolean; apply: (id: string, e?: { name?: string; salutation?: string | null; type?: DonorType }) => Result; reject: (id: string) => Result; done: Done }) {
  const [name, setName] = React.useState(s.proposed.name ?? donor.name);
  const [type, setType] = React.useState<DonorType>(s.proposed.type ?? donor.type);
  const salutation = s.proposed.salutation ?? null;
  return (
    <li className="flex flex-col gap-2 py-3 text-theme-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/donors/${donor.id}`} className="text-muted-foreground line-through decoration-muted-foreground/40 hover:underline">{donor.name}</Link>
        <span className="text-theme-xs text-muted-foreground">({typeLabel(donor.type)})</span>
        <ArrowRight className="size-3.5 text-muted-foreground" />
        <span className="font-medium">{salutation ? `${salutation} ` : ""}{s.proposed.name}</span>
        <span className="text-theme-xs text-muted-foreground">({typeLabel(s.proposed.type ?? donor.type)})</span>
        <SourceBadge source={s.source} />
      </div>
      {s.reason && <p className="text-theme-xs text-muted-foreground">{s.reason}</p>}
      {editor && (
        <div className="flex flex-wrap items-center gap-2">
          <Input className="max-w-sm" value={name} onChange={(e) => setName(e.target.value)} aria-label={`Name for ${donor.name}`} />
          <Select value={type} onValueChange={(v) => setType(v as DonorType)}>
            <SelectTrigger className="w-36" aria-label="Donor type"><SelectValue /></SelectTrigger>
            <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{typeLabel(t)}</SelectItem>)}</SelectContent>
          </Select>
          <Button size="sm" disabled={name.trim().length < 2} onClick={() => apply(s.id, { name: name.trim(), salutation, type }).then((r) => done(r, "Saved."))}>Apply</Button>
          <Button size="sm" variant="ghost" onClick={() => reject(s.id).then((r) => done(r, "Kept as it was."))}>Keep as is</Button>
        </div>
      )}
    </li>
  );
}
