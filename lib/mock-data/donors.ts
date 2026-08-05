import type { AcknowledgmentReceipt, ArStatus, Campaign, Donation, Donor, DonorType, DoneeCertificate } from "@/lib/types/donor";
import { makeRng } from "@/lib/utils/seeded-random";

const rng = makeRng(505);

const donorNames = [
  "Evalyn Laxamana", "Roberto Cruz Foundation", "St. Michael Corporate Giving", "Anonymous",
  "Manila Rotary Club", "Chen Family Trust", "Grace Villareal", "Pacific Rim Logistics Inc.",
  "Holy Family Parish", "Marites Uy", "GreenLeaf Foods Corp.", "Antonio & Sons",
  "DSWD Region IV-A", "Jenny Lim", "Bright Future Foundation",
];

const types: DonorType[] = ["individual", "corporate", "foundation", "government", "anonymous"];

export const donors: Donor[] = donorNames.map((name, i) => {
  const type = name === "Anonymous" ? "anonymous" : rng.pick(types.filter((t) => t !== "anonymous"));
  const giftCount = rng.int(1, 40);
  return {
    id: `donor-${i + 1}`,
    name,
    type,
    email: type === "anonymous" ? undefined : `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.org`,
    phone: type === "anonymous" ? undefined : `09${rng.int(10, 99)}${rng.int(1000000, 9999999)}`,
    taxJurisdiction: rng.bool(0.75) ? "PH" : "US",
    tin: rng.bool(0.6) ? `${rng.int(100, 999)}-${rng.int(100, 999)}-${rng.int(100, 999)}` : undefined,
    firstGiftDate: rng.daysFromNow(-rng.int(60, 900)),
    lastGiftDate: rng.daysFromNow(-rng.int(0, 45)),
    lifetimeValue: giftCount * rng.int(500, 8000),
    giftCount,
  };
});

export const campaigns: Campaign[] = [
  { id: "camp-farewell", name: "Farewell with Dignity", targetAmount: 500000, raisedAmount: 318500, startDate: "2026-01-01" },
  { id: "camp-paths", name: "Paths to Hope", targetAmount: 1200000, raisedAmount: 940200, startDate: "2026-01-01" },
  { id: "camp-arkcircle", name: "The Ark Circle", targetAmount: 800000, raisedAmount: 512000, startDate: "2026-02-01" },
  { id: "camp-compassion", name: "Compassion Fund", targetAmount: 300000, raisedAmount: 276750, startDate: "2026-01-01" },
];

const inKindItems = [
  { desc: "Egg (30/Tray)", uom: "uom-tray", unitValue: 285 },
  { desc: "Rice 25kg", uom: "uom-sack", unitValue: 1450 },
  { desc: "Chicken (Whole)", uom: "uom-kg", unitValue: 220 },
  { desc: "Canned Sardines", uom: "uom-can", unitValue: 32 },
  { desc: "Diapers (Medium)", uom: "uom-pack", unitValue: 380 },
];

export const donations: Donation[] = Array.from({ length: 28 }).map((_, i) => {
  const donor = rng.pick(donors);
  const kind = rng.bool(0.6) ? "in_kind" : "cash";
  const entity = rng.bool(0.75) ? "PH_SEC" : "US_501C3";
  if (kind === "cash") {
    const totalValue = rng.int(1000, 60000);
    return {
      id: `don-${i + 1}`,
      donorId: donor.id,
      date: rng.daysFromNow(-rng.int(0, 200)),
      receivingEntity: entity,
      kind,
      totalValue,
      currency: entity === "US_501C3" ? "USD" : "PHP",
      campaignId: rng.bool(0.4) ? rng.pick(campaigns).id : undefined,
    } satisfies Donation;
  }
  const item = rng.pick(inKindItems);
  const qty = rng.int(1, 10);
  return {
    id: `don-${i + 1}`,
    donorId: donor.id,
    date: rng.daysFromNow(-rng.int(0, 200)),
    receivingEntity: entity,
    kind,
    itemDescription: item.desc,
    quantity: qty,
    uomId: item.uom,
    unitValue: item.unitValue,
    totalValue: qty * item.unitValue,
    currency: "PHP",
    campaignId: rng.bool(0.3) ? rng.pick(campaigns).id : undefined,
  } satisfies Donation;
});

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
