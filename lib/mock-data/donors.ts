import type { AcknowledgmentReceipt, ArStatus, Campaign, Donation, Donor, DoneeCertificate } from "@/lib/types/donor";
import { makeRng } from "@/lib/utils/seeded-random";
import realDonors from "@/lib/mock-data/real/donors.json";
import realDonations from "@/lib/mock-data/real/donations.json";

const rng = makeRng(505);

// Real donors/donations, synced from DATA/clean/{donors,donations}.json (see
// scripts/sync-real-data.mjs and scripts/clean-real-data.py). Falls back to an
// empty list if that sync hasn't run.
export const donors: Donor[] = realDonors as Donor[];
export const donations: Donation[] = realDonations as Donation[];

export const campaigns: Campaign[] = [
  { id: "camp-farewell", name: "Farewell with Dignity", targetAmount: 500000, raisedAmount: 318500, startDate: "2026-01-01" },
  { id: "camp-paths", name: "Paths to Hope", targetAmount: 1200000, raisedAmount: 940200, startDate: "2026-01-01" },
  { id: "camp-arkcircle", name: "The Ark Circle", targetAmount: 800000, raisedAmount: 512000, startDate: "2026-02-01" },
  { id: "camp-compassion", name: "Compassion Fund", targetAmount: 300000, raisedAmount: 276750, startDate: "2026-01-01" },
];

const arStatusPool: ArStatus[] = ["draft", "issued", "issued", "sent", "acknowledged", "acknowledged"];

export const acknowledgmentReceipts: AcknowledgmentReceipt[] = donations.map((d, i) => ({
  id: `ar-${i + 1}`,
  donationId: d.id,
  sequenceNumber: `AR-2026-${String(2000 + i)}`,
  entity: d.receivingEntity,
  status: rng.pick(arStatusPool),
  issuedAt: d.date,
  sentAt: rng.bool(0.6) ? rng.daysFromNow(-rng.int(0, 5), new Date(d.date)) : undefined,
  acknowledgedAt: rng.bool(0.4) ? rng.daysFromNow(-rng.int(0, 10), new Date(d.date)) : undefined,
}));

export const doneeCertificates: DoneeCertificate[] = donations
  .filter((d) => d.kind === "in_kind" && d.totalValue > 800)
  .map((d, i) => ({
    id: `cert-${i + 1}`,
    donationId: d.id,
    controlNumber: `DC-2026-${String(300 + i)}`,
    status: rng.pick(["requested", "prepared", "approved", "released", "released", "filed"] as const),
    requestedAt: d.date,
    releasedAt: rng.bool(0.5) ? rng.daysFromNow(rng.int(3, 15), new Date(d.date)) : undefined,
  }));
