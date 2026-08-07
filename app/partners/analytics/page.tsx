"use client";

import { BarChart, Bar, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  Users,
  HeartPulse,
  Droplets,
  Inbox,
  CheckCircle2,
  Clock,
  XCircle,
  BedDouble,
  Moon,
  Timer,
  Activity,
  HeartHandshake,
  HeartCrack,
  Utensils,
  Car,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { PageHeader } from "@/components/patterns/page-header";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { diagnoses, referrals as seedReferrals, trips } from "@/lib/mock-data";
import { useLocalCollection } from "@/lib/store/use-mock-store";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";
import { useHospitalAuth } from "@/context/hospital-auth-provider";
import { computeAge, ageBracket } from "@/lib/utils/age";
import type { Referral, ReferralStatus } from "@/lib/types/patient";

const AGE_ORDER = ["0–1", "2–5", "6–9", "10–12", "13–15", "16–18"];
const FUNNEL: { id: ReferralStatus; label: string; icon: LucideIcon }[] = [
  { id: "submitted", label: "Submitted", icon: Inbox },
  { id: "approved", label: "Approved", icon: CheckCircle2 },
  { id: "waitlisted", label: "Waitlisted", icon: Clock },
  { id: "declined", label: "Declined", icon: XCircle },
  { id: "admitted", label: "Admitted", icon: BedDouble },
];

export default function PartnerAnalyticsPage() {
  const { session } = useHospitalAuth();
  const { patients, stays } = usePatientsData();
  const { items: allReferrals } = useLocalCollection<Referral>("referrals", seedReferrals);

  const ourPatients = patients.filter((p) => p.referringHospitalId === session?.hospitalId);
  const ourReferrals = allReferrals.filter((r) => r.hospitalId === session?.hospitalId);
  const ourPatientIds = new Set(ourPatients.map((p) => p.id));
  const ourStays = stays.filter((s) => ourPatientIds.has(s.patientId));

  const ageBrackets = AGE_ORDER.map((bracket) => ({
    bracket,
    count: ourPatients.filter((p) => p.birthDate && ageBracket(computeAge(p.birthDate)) === bracket).length,
  }));
  const illnessBreakdown = ["cancer", "thalassemia", "other"].map((cat) => ({
    category: cat,
    count: ourPatients.filter((p) => p.diagnosisIds.some((id) => diagnoses.find((d) => d.id === id)?.category === cat)).length,
  }));

  const funnelCounts = FUNNEL.map((f) => ({ ...f, count: ourReferrals.filter((r) => r.status === f.id).length }));

  const totalNights = ourStays.reduce((sum, s) => {
    const start = parseISO(s.checkInAt);
    const end = s.checkOutAt ? parseISO(s.checkOutAt) : new Date("2026-08-04T00:00:00Z");
    return sum + Math.max(0, differenceInCalendarDays(end, start));
  }, 0);
  const avgLengthOfStay = ourStays.length ? Math.round(totalNights / ourStays.length) : 0;

  const ongoingCount = ourPatients.filter((p) => p.status === "ongoing").length;
  const finishedCount = ourPatients.filter((p) => p.status === "completed").length;
  const deceasedCount = ourPatients.filter((p) => p.status === "expired").length;

  // Not tracked per-patient in the underlying meal-service data, so this is an
  // estimate derived from bed-nights (breakfast + lunch + dinner per night) --
  // labeled as such rather than presented as an exact count.
  const totalMealsServed = totalNights * 3;

  const totalTransportServed = trips.reduce(
    (sum, t) => sum + t.passengerPatientIds.filter((id) => ourPatientIds.has(id)).length,
    0
  );

  const chartConfig: ChartConfig = { count: { label: "Patients", color: "var(--chart-1)" } };

  return (
    <div className="flex flex-1 flex-col gap-8">
      <PageHeader
        title="Partnership Analytics"
        description={`How ${session?.hospitalName ?? "your hospital"}'s referrals to LAF House have played out, from submission to housing.`}
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Patient Overview</h2>
        <KpiGrid>
          <KpiCard label="Total Referred" value={ourPatients.length} icon={Users} color="purple" />
          <KpiCard label="Cancer" value={illnessBreakdown.find((i) => i.category === "cancer")?.count ?? 0} icon={HeartPulse} color="rose" />
          <KpiCard label="Thalassemia" value={illnessBreakdown.find((i) => i.category === "thalassemia")?.count ?? 0} icon={Droplets} color="red" />
          <KpiCard label="Other" value={illnessBreakdown.find((i) => i.category === "other")?.count ?? 0} icon={Users} color="slate" />
        </KpiGrid>
        <Card>
          <CardHeader><CardTitle className="text-sm">Age Brackets</CardTitle></CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-56 w-full">
              <BarChart data={ageBrackets}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="bracket" tickLine={false} axisLine={false} fontSize={11} />
                <YAxis hide />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="count" fill="var(--color-count)" radius={4} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Treatment Outcomes</h2>
        <KpiGrid>
          <KpiCard label="Ongoing Treatment" value={ongoingCount} icon={Activity} color="blue" />
          <KpiCard label="Survived / Finished Treatment" value={finishedCount} icon={HeartHandshake} color="green" />
          <KpiCard label="Deceased" value={deceasedCount} icon={HeartCrack} color="rose" />
        </KpiGrid>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Referral Funnel</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {funnelCounts.map((f) => (
            <Card key={f.id}>
              <CardContent className="flex flex-col items-center gap-1.5 py-5">
                <f.icon className="size-5 text-muted-foreground" />
                <span className="text-2xl font-bold tabular-nums">{f.count}</span>
                <Badge variant="secondary" className="text-[11px]">{f.label}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Impact Since the Partnership Began</h2>
        <KpiGrid>
          <KpiCard label="Total Days Stayed" value={totalNights.toLocaleString()} icon={Moon} color="blue" />
          <KpiCard label="Total Stays" value={ourStays.length} icon={BedDouble} color="indigo" />
          <KpiCard label="Avg. Length of Stay" value={`${avgLengthOfStay}d`} icon={Timer} color="green" />
          <KpiCard
            label="Total Meals Served"
            value={totalMealsServed.toLocaleString()}
            icon={Utensils}
            color="orange"
            sublabel="Est. 3 meals per day stayed"
          />
          <KpiCard label="Total Transportation Served" value={totalTransportServed.toLocaleString()} icon={Car} color="cyan" />
        </KpiGrid>
      </section>
    </div>
  );
}
