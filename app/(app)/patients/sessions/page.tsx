"use client";

import Link from "next/link";
import { CalendarClock, ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { PatientsSubNav } from "@/components/modules/patients/patients-subnav";
import { Badge } from "@/components/ui/badge";
import { useRole } from "@/lib/rbac/use-role";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";
import { canReadCaseFiles, useOpenCaseRecords, type CaseRecord } from "@/lib/hooks/use-case-files";
import { FORMS } from "@/lib/case-files/forms";
import { CasePeriodReport } from "@/components/modules/patients/case-file/case-period-report";
import { formatDate, todayIso } from "@/lib/utils/date";
import { useNow } from "@/lib/hooks/use-now";

/** Manila's day of a timestamp. */
const manilaDay = (iso: string) => new Date(new Date(iso).getTime() + 8 * 3600_000).toISOString().slice(0, 10);

/**
 * The social worker's sessions (0124): booked casework, counseling, home visits and monitoring --
 * today's, the ones coming, and the ones that took place but aren't written up -- plus drafts
 * waiting for approval and approved records waiting for the CEO's signature. Each opens the child's
 * Case file. The Super Admin and the CEO see it read-only.
 */
export default function CaseSessionsPage() {
  const { roles } = useRole();
  const canSee = canReadCaseFiles(roles);
  const { open, loading } = useOpenCaseRecords(canSee);
  const { patients } = usePatientsData();
  const now = useNow();
  const today = todayIso();
  const nameOf = (id: string) => {
    const p = patients.find((x) => x.id === id);
    return p ? `${p.firstName} ${p.lastName}` : "A child";
  };

  if (!canSee) {
    return (
      <div className="flex flex-1 flex-col gap-6">
        <PatientsSubNav except="/patients/sessions" />
        <EmptyState icon={ShieldAlert} title="Case files are for the social worker" description="Only the social worker, the Super Admin and the CEO can see case sessions and records." />
      </div>
    );
  }

  const booked = open.filter((r) => r.status === "scheduled" && r.scheduledAt);
  const groups: { title: string; items: CaseRecord[] }[] = [
    { title: "Today", items: booked.filter((r) => manilaDay(r.scheduledAt!) === today) },
    { title: "Coming up", items: booked.filter((r) => manilaDay(r.scheduledAt!) > today) },
    { title: "Took place, not written up", items: booked.filter((r) => manilaDay(r.scheduledAt!) < today || (manilaDay(r.scheduledAt!) === today && new Date(r.scheduledAt!).getTime() < now.getTime() - 3600_000)) },
    { title: "Drafts waiting for approval", items: open.filter((r) => r.status === "draft") },
    { title: "Approved, waiting for the CEO's signature", items: open.filter((r) => r.status === "approved" && !r.ceoSignedOn) },
  ];

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PatientsSubNav except="/patients/sessions" />
      <PageHeader title="Case sessions" description="Sessions booked with the children and their carers, and records still to write up or approve." />
      {!loading && open.length === 0 ? <EmptyState icon={CalendarClock} title="Nothing waiting" description="Book a session from a child's Case file." /> : null}
      {groups
        .filter((g) => g.items.length)
        .map((g) => (
          <section key={g.title} id={g.title.startsWith("Approved") ? "to-sign" : undefined} className="flex scroll-mt-24 flex-col gap-2">
            <h2 className="text-theme-sm font-semibold">
              {g.title} ({g.items.length})
            </h2>
            <div className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-card">
              {g.items.map((r) => (
                <Link key={r.id} href={`/patients/${r.patientId}?tab=case-file`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-theme-sm hover:bg-muted/60">
                  <span className="font-medium">{nameOf(r.patientId)}</span>
                  <span>{FORMS[r.form].title}</span>
                  <span className="text-muted-foreground">
                    {r.status === "scheduled" && r.scheduledAt ? `${formatDate(r.scheduledAt, "EEE, MMM d · h:mm a")}${r.venue ? ` · ${r.venue}` : ""}` : r.heldOn ? formatDate(r.heldOn) : "No date yet"}
                  </span>
                  <Badge variant="outline" className="ml-auto">
                    {r.status === "scheduled" ? "Booked" : r.status === "draft" ? "Draft" : "To sign"}
                  </Badge>
                </Link>
              ))}
            </div>
          </section>
        ))}
      <CasePeriodReport />
    </div>
  );
}
