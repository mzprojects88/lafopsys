"use client";

import * as React from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { SectionCard } from "@/components/patterns/section-card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { useCampaignsData, type CampaignInput } from "@/lib/hooks/use-campaigns-collection";
import { useDonorsData } from "@/lib/hooks/use-donors-collection";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import type { Campaign } from "@/lib/types/donor";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate, todayIso } from "@/lib/utils/date";

const EMPTY: CampaignInput = { name: "", description: "", targetAmount: 0, startDate: todayIso(), endDate: undefined };

/**
 * Campaigns (0086): a gift joins a campaign on the cash intake form or from the donor page;
 * the raised amount is the database's sum of finalized PHP gifts, so it can't drift. A
 * campaign with gifts is closed, never deleted.
 */
export default function CampaignsPage() {
  const { campaigns, addCampaign, updateCampaign, deleteCampaign } = useCampaignsData();
  const { donations } = useDonorsData();
  const { canEdit } = useModuleAccess();
  const editor = canEdit("donors");
  const [editing, setEditing] = React.useState<{ id?: string; form: CampaignInput } | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  async function save() {
    if (!editing || !editing.form.name.trim() || !(editing.form.targetAmount > 0)) return;
    setSubmitting(true);
    const result = editing.id ? await updateCampaign(editing.id, editing.form) : await addCampaign(editing.form);
    setSubmitting(false);
    if (!result.ok) return void toast.error(`Couldn't save the campaign: ${result.error}`);
    toast.success(editing.id ? "Campaign saved" : "Campaign created");
    setEditing(null);
  }

  async function setStatus(c: Campaign, status: Campaign["status"]) {
    const result = await updateCampaign(c.id, { name: c.name, description: c.description, targetAmount: c.targetAmount, startDate: c.startDate, endDate: c.endDate, status });
    if (!result.ok) return void toast.error(result.error);
    toast.success(status === "closed" ? `${c.name} closed` : `${c.name} reopened`);
  }

  async function remove(c: Campaign) {
    if (!window.confirm(`Delete "${c.name}"? Only a campaign without gifts can be deleted.`)) return;
    const result = await deleteCampaign(c.id);
    if (!result.ok) return void toast.error(result.error);
    toast.success("Campaign deleted");
  }

  const form = editing?.form;
  const setForm = (patch: Partial<CampaignInput>) => setEditing((e) => (e ? { ...e, form: { ...e.form, ...patch } } : e));

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Campaigns"
        description="Gifts grouped by appeal, tracked against a target. Raised = finalized peso gifts linked to the campaign; US-dollar gifts are listed but not summed."
        action={editor ? <Button onClick={() => setEditing({ form: EMPTY })}><Plus />New Campaign</Button> : undefined}
      />
      {campaigns.length === 0 ? (
        <EmptyState title="No campaigns yet" description="Create one to start tracking gifts against a target." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {campaigns.map((c) => {
            const pct = c.targetAmount > 0 ? Math.min(100, Math.round((c.raisedAmount / c.targetAmount) * 100)) : 0;
            const linked = donations.filter((d) => d.campaignId === c.id);
            const usd = linked.filter((d) => d.currency === "USD").reduce((s, d) => s + d.totalValue, 0);
            const pending = linked.filter((d) => d.status === "pending_review").length;
            return (
              <SectionCard
                key={c.id}
                title={
                  <span className="flex items-center gap-2">
                    {c.name}
                    {c.status === "closed" ? <Badge variant="outline">Closed</Badge> : null}
                  </span>
                }
                bodyClassName="flex flex-col gap-2"
              >
                {c.description ? <p className="text-theme-sm text-muted-foreground">{c.description}</p> : null}
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xl font-semibold tabular-nums text-foreground">{formatCurrency(c.raisedAmount)}</span>
                  <span className="text-theme-sm tabular-nums text-muted-foreground">of {formatCurrency(c.targetAmount)}</span>
                </div>
                <Progress value={pct} />
                <span className="text-theme-xs text-muted-foreground">
                  {pct}% of target · {linked.length} gift{linked.length === 1 ? "" : "s"} · {formatDate(c.startDate)}
                  {c.endDate ? ` – ${formatDate(c.endDate)}` : ""}
                  {usd > 0 ? ` · ${formatCurrency(usd, "USD")} in USD not counted` : ""}
                  {pending > 0 ? ` · ${pending} pending finance review` : ""}
                </span>
                {editor ? (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button size="sm" variant="outline" onClick={() => setEditing({ id: c.id, form: { name: c.name, description: c.description ?? "", targetAmount: c.targetAmount, startDate: c.startDate, endDate: c.endDate } })}>
                      <Pencil /> Edit
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setStatus(c, c.status === "closed" ? "active" : "closed")}>
                      {c.status === "closed" ? "Reopen" : "Close"}
                    </Button>
                    {linked.length === 0 ? (
                      <Button size="sm" variant="ghost" onClick={() => remove(c)}>
                        <Trash2 /> Delete
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </SectionCard>
            );
          })}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit campaign" : "New campaign"}</DialogTitle>
            <DialogDescription>Set a target amount to track gifts against.</DialogDescription>
          </DialogHeader>
          {form ? (
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="campaignName">Name</FieldLabel>
                <Input id="campaignName" value={form.name} maxLength={120} onChange={(e) => setForm({ name: e.target.value })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="campaignDescription">Description (optional)</FieldLabel>
                <Textarea id="campaignDescription" value={form.description ?? ""} maxLength={500} rows={2} onChange={(e) => setForm({ description: e.target.value })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="targetAmount">Target amount (₱)</FieldLabel>
                <Input id="targetAmount" type="number" min="0" step="0.01" value={form.targetAmount || ""} onChange={(e) => setForm({ targetAmount: Number(e.target.value) })} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel htmlFor="startDate">Starts</FieldLabel>
                  <Input id="startDate" type="date" value={form.startDate} onChange={(e) => setForm({ startDate: e.target.value })} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="endDate">Ends (optional)</FieldLabel>
                  <Input id="endDate" type="date" value={form.endDate ?? ""} onChange={(e) => setForm({ endDate: e.target.value || undefined })} />
                </Field>
              </div>
            </FieldGroup>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button disabled={!form?.name.trim() || !(form && form.targetAmount > 0) || !form?.startDate || submitting} onClick={save}>
              {submitting ? "Saving…" : editing?.id ? "Save" : "Create campaign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
