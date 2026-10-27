"use client";

import * as React from "react";
import { toast } from "sonner";
import { Mail, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { SectionCard } from "@/components/patterns/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import { useRole } from "@/lib/rbac/use-role";
import { holdsPower } from "@/lib/rbac/roles";
import { STATUS_TONE_CLASSES } from "@/lib/utils/status-colors";
import { formatDate } from "@/lib/utils/date";

type Report = "monthly_summary" | "programs" | "caf_billing";
interface Schedule {
  id: string;
  name: string;
  report: Report;
  recipients: string[];
  frequency: "monthly" | "weekly";
  day: number;
  active: boolean;
  last_sent_on: string | null;
}
interface OutboxRow {
  id: string;
  to_address: string;
  subject: string;
  status: "queued" | "held" | "sent" | "failed";
  error: string | null;
  created_at: string;
}

const REPORTS: Record<Report, string> = { monthly_summary: "Monthly Summary (last month)", programs: "Programs report (year to date)", caf_billing: "NCH bill (last month)" };
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const when = (s: Pick<Schedule, "frequency" | "day">) => (s.frequency === "monthly" ? `Monthly on the ${s.day}${s.day === 1 || s.day === 21 ? "st" : s.day === 2 || s.day === 22 ? "nd" : s.day === 3 || s.day === 23 ? "rd" : "th"}` : `Every ${WEEKDAYS[s.day - 1]}`);

const schedulesStore = createCollection<Schedule[]>({
  key: "ops.report_schedules",
  empty: [],
  tables: [{ schema: "ops", table: "report_schedules" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("ops").from("report_schedules").select("id, name, report, recipients, frequency, day, active, last_sent_on").order("created_at");
    if (error) throw new Error(error.message);
    return (data ?? []) as Schedule[];
  },
});

/**
 * Reports › Scheduled delivery (0118): which report is emailed to whom, and when (7:00 AM Manila
 * on the day). Emails go through the outbox and Resend; without the key on the hosting they wait.
 */
export default function ScheduledReportsPage() {
  const { data: schedules } = useCollection(schedulesStore);
  const { roles } = useRole();
  const isAdmin = roles.includes("admin");
  const canManage = isAdmin || holdsPower(roles, "finance_work");
  const [emailReady, setEmailReady] = React.useState<boolean | null>(null);
  const [outbox, setOutbox] = React.useState<OutboxRow[]>([]);
  const [editing, setEditing] = React.useState<(Omit<Schedule, "id" | "last_sent_on" | "recipients"> & { id: string | null; recipients: string }) | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const loadOutbox = React.useCallback(async () => {
    if (!isAdmin) return;
    const { data } = await createClient().schema("ops").from("outbox").select("id, to_address, subject, status, error, created_at").order("created_at", { ascending: false }).limit(20);
    setOutbox((data ?? []) as OutboxRow[]);
  }, [isAdmin]);
  React.useEffect(() => {
    void fetch("/api/reports/scheduled-run").then(async (r) => setEmailReady(((await r.json().catch(() => ({}))) as { emailReady?: boolean }).emailReady ?? null));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the outbox is read from the database
    void loadOutbox();
  }, [loadOutbox]);

  async function save() {
    if (!editing) return;
    const recipients = [...new Set(editing.recipients.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))];
    const bad = recipients.find((r) => !EMAIL.test(r));
    if (bad) return void toast.error(`${bad} isn't an email address.`);
    if (!editing.name.trim()) return void toast.error("Name the delivery.");
    const row = { name: editing.name.trim(), report: editing.report, recipients, frequency: editing.frequency, day: editing.day, active: editing.active };
    setBusy("save");
    const ops = createClient().schema("ops").from("report_schedules");
    const { error } = editing.id ? await ops.update(row).eq("id", editing.id) : await ops.insert(row);
    setBusy(null);
    if (error) return void toast.error(error.message);
    await schedulesStore.refetch();
    setEditing(null);
    toast.success("Delivery saved");
  }

  async function sendNow(s: Schedule) {
    setBusy(s.id);
    const r = (await (await fetch("/api/reports/scheduled-run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scheduleId: s.id }) })).json().catch(() => ({}))) as { ok?: boolean; error?: string; sent?: number; held?: number };
    setBusy(null);
    if (!r.ok) return void toast.error(r.error ?? "Couldn't send.");
    toast.success(r.sent ? `Sent to ${r.sent} address${r.sent === 1 ? "" : "es"}` : "Queued: email isn't set up yet, so it waits in the outbox");
    await Promise.all([schedulesStore.refetch(), loadOutbox()]);
  }

  async function remove(s: Schedule) {
    const { error } = await createClient().schema("ops").from("report_schedules").delete().eq("id", s.id);
    if (error) return void toast.error(error.message);
    await schedulesStore.refetch();
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Scheduled Delivery"
        description="Reports emailed on a schedule at 7:00 AM. Each report's own page has its filters, PDF and CSV for anything else."
        action={canManage ? <Button onClick={() => setEditing({ id: null, name: "", report: "monthly_summary", recipients: "", frequency: "monthly", day: 5, active: true })}><Plus /> Add delivery</Button> : null}
      />
      {emailReady === false ? (
        <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-theme-sm text-warning-foreground dark:text-warning">
          Email isn&apos;t connected yet: the Resend key isn&apos;t set on the hosting. Deliveries still run and wait in the outbox, and go out once it is set.
        </div>
      ) : null}

      <SectionCard flush className="overflow-hidden" title="Deliveries">
        {schedules.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted-foreground">No deliveries yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-theme-sm">
              <tbody>
                {schedules.map((s) => (
                  <tr key={s.id} className="border-b border-border last:border-0 align-top">
                    <td className="px-5 py-3">
                      <p className="font-medium">{s.name}</p>
                      <p className="text-theme-xs text-muted-foreground">{REPORTS[s.report]} · {when(s)}</p>
                    </td>
                    <td className="px-5 py-3 text-theme-xs text-muted-foreground">{s.recipients.length ? s.recipients.join(", ") : <span className="italic">No addresses yet</span>}</td>
                    <td className="px-5 py-3">
                      <Badge className={s.active && s.recipients.length ? STATUS_TONE_CLASSES.positive : STATUS_TONE_CLASSES.neutral}>{s.active && s.recipients.length ? "On" : "Off"}</Badge>
                      {s.last_sent_on ? <p className="mt-1 text-theme-xs text-muted-foreground">Last sent {formatDate(s.last_sent_on)}</p> : null}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {canManage ? (
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="outline" className="h-7 gap-1.5" disabled={busy === s.id || !s.recipients.length} onClick={() => void sendNow(s)}>
                            <Send className="size-3.5" /> {busy === s.id ? "Sending…" : "Send now"}
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7" aria-label={`Edit ${s.name}`} onClick={() => setEditing({ ...s, recipients: s.recipients.join("\n") })}>
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 text-destructive" aria-label={`Delete ${s.name}`} onClick={() => void remove(s)}>
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {isAdmin && outbox.length > 0 ? (
        <SectionCard flush className="overflow-hidden" title="Outbox" description="The last 20 emails the app sent or is holding.">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-theme-sm">
              <tbody>
                {outbox.map((o) => (
                  <tr key={o.id} className="border-b border-border last:border-0">
                    <td className="px-5 py-2.5 whitespace-nowrap text-muted-foreground">{formatDate(o.created_at.slice(0, 10))}</td>
                    <td className="px-5 py-2.5"><Mail className="mr-1.5 inline size-3.5 text-muted-foreground" />{o.to_address}</td>
                    <td className="px-5 py-2.5">{o.subject}</td>
                    <td className="px-5 py-2.5">
                      <Badge className={o.status === "sent" ? STATUS_TONE_CLASSES.positive : o.status === "failed" ? STATUS_TONE_CLASSES.negative : STATUS_TONE_CLASSES.warning} title={o.error ?? undefined}>
                        {o.status === "held" ? "Waiting for email setup" : o.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      ) : null}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit delivery" : "Add delivery"}</DialogTitle>
            <DialogDescription>Sent at 7:00 AM on the day. Staff accounts have no email address in the app, so type the addresses.</DialogDescription>
          </DialogHeader>
          {editing ? (
            <div className="flex flex-col gap-3">
              <Field>
                <FieldLabel htmlFor="sch-name">Name</FieldLabel>
                <Input id="sch-name" value={editing.name} maxLength={100} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="sch-report">Report</FieldLabel>
                <Select value={editing.report} onValueChange={(v) => setEditing({ ...editing, report: v as Report })}>
                  <SelectTrigger id="sch-report" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(REPORTS) as Report[]).map((r) => <SelectItem key={r} value={r}>{REPORTS[r]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel htmlFor="sch-freq">How often</FieldLabel>
                  <Select value={editing.frequency} onValueChange={(v) => setEditing({ ...editing, frequency: v as Schedule["frequency"], day: v === "weekly" ? 1 : 5 })}>
                    <SelectTrigger id="sch-freq" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="sch-day">{editing.frequency === "monthly" ? "Day of the month" : "Day"}</FieldLabel>
                  <Select value={String(editing.day)} onValueChange={(v) => setEditing({ ...editing, day: Number(v) })}>
                    <SelectTrigger id="sch-day" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {editing.frequency === "monthly"
                        ? Array.from({ length: 28 }, (_, i) => <SelectItem key={i + 1} value={String(i + 1)}>{i + 1}</SelectItem>)
                        : WEEKDAYS.map((w, i) => <SelectItem key={w} value={String(i + 1)}>{w}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="sch-to">Email addresses (one per line)</FieldLabel>
                <Textarea id="sch-to" rows={4} value={editing.recipients} onChange={(e) => setEditing({ ...editing, recipients: e.target.value })} placeholder="ceo@example.org" />
              </Field>
              <label htmlFor="sch-active" className="flex items-center justify-between gap-3 text-sm">
                On
                <Switch id="sch-active" checked={editing.active} onCheckedChange={(v) => setEditing({ ...editing, active: v })} />
              </label>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button disabled={busy === "save"} onClick={save}>{busy === "save" ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
