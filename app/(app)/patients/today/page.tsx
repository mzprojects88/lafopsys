"use client";

import { useRouter } from "next/navigation";
import { PlaneLanding, PlaneTakeoff, Home, Clock } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { BoardColumns, type BoardColumn } from "@/components/patterns/board-columns";
import { Card, CardContent } from "@/components/ui/card";
import { PersonAvatar } from "@/components/patterns/person-avatar";
import { patients, stays, bedPositions, units } from "@/lib/mock-data";
import type { Stay } from "@/lib/types/patient";
import { TODAY_ISO } from "@/lib/utils/seeded-random";
import { formatDate } from "@/lib/utils/date";

export default function TodayBoardPage() {
  const router = useRouter();

  const arrivals = stays.filter((s) => s.checkInAt === TODAY_ISO);
  const departures = stays.filter((s) => s.checkOutAt === TODAY_ISO);
  const inHouse = stays.filter((s) => s.status === "in_house");
  const overdue = stays.filter((s) => s.status === "overdue");

  const columns: BoardColumn<Stay>[] = [
    { id: "arrivals", title: "Arrivals Today", color: "blue", icon: PlaneLanding, items: arrivals },
    { id: "departures", title: "Departures Today", color: "green", icon: PlaneTakeoff, items: departures },
    { id: "in-house", title: "In-House Now", color: "purple", icon: Home, items: inHouse },
    { id: "overdue", title: "Overdue Check-outs", color: "red", icon: Clock, items: overdue },
  ];

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Today Board" description={`${TODAY_ISO} — arrivals, departures, in-house, and overdue at a glance.`} />
      <BoardColumns
        columns={columns}
        getItemKey={(s) => s.id}
        renderItem={(stay) => {
          const patient = patients.find((p) => p.id === stay.patientId);
          const unit = units.find((u) => u.id === bedPositions.find((b) => b.id === stay.bedPositionId)?.unitId);
          const name = `${patient?.firstName} ${patient?.lastName}`;
          return (
            <Card className="cursor-pointer" onClick={() => router.push(`/patients/${stay.patientId}`)}>
              <CardContent className="flex items-center gap-2.5 p-2.5">
                <PersonAvatar name={name} size="sm" />
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{name}</span>
                  <span className="text-[11px] text-muted-foreground">
                    Bed {unit?.code ?? "—"} · Expected {stay.expectedCheckoutAt ? formatDate(stay.expectedCheckoutAt) : "—"}
                  </span>
                </div>
              </CardContent>
            </Card>
          );
        }}
      />
    </div>
  );
}
