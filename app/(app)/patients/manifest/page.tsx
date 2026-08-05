import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { PersonAvatar } from "@/components/patterns/person-avatar";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { patients, appointments, carers } from "@/lib/mock-data";
import { makeRng } from "@/lib/utils/seeded-random";

const rng = makeRng(808);
const tomorrow = rng.daysFromNow(1);

export default function ManifestPage() {
  const manifestRows = appointments
    .filter((a) => a.date === tomorrow && a.needsTransport)
    .map((a) => {
      const patient = patients.find((p) => p.id === a.patientId);
      const carer = carers.find((c) => c.patientId === a.patientId);
      return { ...a, patient, carer };
    });

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Transport Manifest"
        description={`Auto-generated from tomorrow's appointments (${tomorrow}) — who needs a ride, what time, which direction.`}
      />

      {manifestRows.length === 0 ? (
        <EmptyState title="No transport needed tomorrow" description="No appointments requiring a ride were found for tomorrow." />
      ) : (
        <div className="flex flex-col gap-2">
          {manifestRows.map((row) => (
            <Card key={row.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="flex items-center gap-2.5">
                  <PersonAvatar name={`${row.patient?.firstName ?? ""} ${row.patient?.lastName ?? ""}`} size="sm" />
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{row.patient?.firstName} {row.patient?.lastName}</span>
                    <span className="text-xs text-muted-foreground">
                      {row.clinic} · {row.purpose} · Carer: {row.carer?.name ?? "—"}
                    </span>
                  </div>
                </div>
                <Badge variant="secondary">{row.time} departure</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
