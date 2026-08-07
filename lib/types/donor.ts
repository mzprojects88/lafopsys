import type { Currency, Entity } from "@/lib/types/common";

export type DonorType = "individual" | "corporate" | "foundation" | "government" | "anonymous";

export interface Donor {
  id: string;
  name: string;
  type: DonorType;
  email?: string;
  phone?: string;
  taxJurisdiction: "US" | "PH";
  tin?: string;
  firstGiftDate: string;
  lastGiftDate: string;
  lifetimeValue: number;
  giftCount: number;
}

export type DonationKind = "cash" | "in_kind";

export interface Donation {
  id: string;
  donorId: string;
  date: string;
  receivingEntity: Entity;
  kind: DonationKind;
  itemDescription?: string;
  itemType?: string;
  quantity?: number;
  uomId?: string;
  unitValue?: number;
  totalValue: number;
  currency: Currency;
  campaignId?: string;
  createdInventoryLotId?: string;
}

export type ArStatus = "draft" | "issued" | "sent" | "acknowledged";

export interface AcknowledgmentReceipt {
  id: string;
  donationId: string;
  sequenceNumber: string;
  entity: Entity;
  status: ArStatus;
  issuedAt?: string;
  sentAt?: string;
  acknowledgedAt?: string;
}

export type DoneeCertStatus = "requested" | "prepared" | "approved" | "released" | "filed";

export interface DoneeCertificate {
  id: string;
  donationId: string;
  controlNumber: string;
  status: DoneeCertStatus;
  requestedAt: string;
  releasedAt?: string;
}

export interface Campaign {
  id: string;
  name: string;
  targetAmount: number;
  raisedAmount: number;
  startDate: string;
  endDate?: string;
}
