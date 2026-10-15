import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils/date";
import { formatTime12 } from "@/lib/utils/time12";
import { PrintButton } from "@/app/(print)/hr/payslips/[id]/print/print-button";
import { nameFormat, titleFor } from "@/lib/utils/staff-name";
import { tripWords } from "@/lib/utils/trip-direction";

/**
 * A LAF HOPE pick-up's manifest on paper (go-live, 2026-10-13): who was listed, who boarded,
 * and a line for each family to sign. Read under the caller's RLS (Transport or House Ops
 * view), so a driver prints their own trip.
 */
export default async function ManifestPrintPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(tripId)) notFound();
  const supabase = await createClient();
  const { data: trip } = await supabase
    .schema("ops")
    .from("trips")
    .select("id, date, direction, destination, departure_time, departed_at, arrived_at, status, vehicle, vehicle_id, driver_staff_id, odometer_start, odometer_end, trip_manifest(id, name, carer_name, note, boarded_at)")
    .eq("id", tripId)
    .maybeSingle();
  if (!trip) notFound();
  const [{ data: driver }, { data: vehicle }] = await Promise.all([
    trip.driver_staff_id ? supabase.schema("shared").from("staff").select("first_name, last_name, position").eq("id", trip.driver_staff_id).maybeSingle() : Promise.resolve({ data: null }),
    trip.vehicle_id ? supabase.schema("ops").from("vehicles").select("name, plate_no").eq("id", trip.vehicle_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  // Settings > Documents (0094): the driver's job title under the line, or the name alone.
  const { data: docSettings } = await supabase.schema("shared").from("app_settings").select("document_names").maybeSingle();
  const driverTitle = titleFor(nameFormat(docSettings?.document_names, "manifest"), driver?.position);
  const manifest = ((trip.trip_manifest ?? []) as { id: string; name: string; carer_name: string | null; note: string | null; boarded_at: string | null }[]).sort((a, b) => a.name.localeCompare(b.name));
  const boarded = manifest.filter((m) => m.boarded_at).length;

  return (
    <div className="mx-auto max-w-3xl p-6 text-sm text-neutral-900 print:max-w-none print:p-0">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href="/transport" className="text-xs underline">
          Back to Transport
        </Link>
        <PrintButton />
      </div>
      <div className="rounded-xl border border-neutral-300 p-8 print:rounded-none print:border-0 print:p-0">
        <header className="flex items-start justify-between gap-4 border-b border-neutral-300 pb-4">
          <div className="flex items-center gap-3">
            <Image src="/logo/laf-mark.png" alt="" width={48} height={51} />
            <div>
              <h1 className="text-lg font-semibold">{tripWords(trip.direction).short} Manifest</h1>
              <p className="text-xs text-neutral-600">Little Ark Foundation, Inc. · {tripWords(trip.direction).long}{trip.destination ? ` · ${trip.destination}` : ""}</p>
            </div>
          </div>
          <div className="text-right text-xs text-neutral-700">
            <p className="text-base font-semibold text-neutral-900">{formatDate(trip.date, "EEEE, MMM d, yyyy")}</p>
            <p>Leaves {formatTime12(trip.departure_time)}{trip.departed_at ? ` · departed ${formatDate(trip.departed_at, "h:mm a")}` : ""}{trip.arrived_at ? ` · arrived ${formatDate(trip.arrived_at, "h:mm a")}` : ""}</p>
            <p>Driver: {driver ? `${driver.first_name} ${driver.last_name}` : "—"} · Vehicle: {vehicle?.name ?? trip.vehicle}{vehicle?.plate_no ? ` (${vehicle.plate_no})` : ""}</p>
            {trip.odometer_start != null ? <p>Odometer {trip.odometer_start}{trip.odometer_end != null ? ` → ${trip.odometer_end} (${Number(trip.odometer_end) - Number(trip.odometer_start)} km)` : ""}</p> : null}
          </div>
        </header>
        <table className="mt-4 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-400 text-left text-xs text-neutral-600">
              <th className="py-2 pr-2">#</th>
              <th className="py-2 pr-2">Patient</th>
              <th className="py-2 pr-2">Carer</th>
              <th className="py-2 pr-2">On board</th>
              <th className="py-2">Signature</th>
            </tr>
          </thead>
          <tbody>
            {manifest.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-neutral-500">Nobody on the manifest.</td>
              </tr>
            ) : (
              manifest.map((m, i) => (
                <tr key={m.id} className="border-b border-neutral-200">
                  <td className="py-3 pr-2 text-neutral-500">{i + 1}</td>
                  <td className="py-3 pr-2 font-medium">{m.name}</td>
                  <td className="py-3 pr-2">
                  {m.carer_name ?? ""}
                  {m.note ? <span className="block text-xs text-neutral-600">{m.note}</span> : null}
                </td>
                  <td className="py-3 pr-2">{m.boarded_at ? `✓ ${formatDate(m.boarded_at, "h:mm a")}` : "☐"}</td>
                  <td className="py-3"><div className="h-6 border-b border-neutral-400" /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <footer className="mt-6 flex items-end justify-between gap-6 text-xs text-neutral-600">
          <p>{boarded} of {manifest.length} on board. Families are checked in on the House Sheet on arrival.</p>
          <div className="w-56">
            <div className="h-6 border-b border-neutral-400 text-center text-sm font-medium text-neutral-900">{driver ? `${driver.first_name} ${driver.last_name}` : ""}</div>
            <p className="pt-1">{driverTitle ? `Driver · ${driverTitle}` : "Driver"}</p>
          </div>
        </footer>
      </div>
    </div>
  );
}
