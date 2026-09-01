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

export type PledgeFrequency = "weekly" | "monthly" | "quarterly" | "annual";
export type PledgeStatus = "active" | "paused" | "cancelled";

export interface DonorPledge {
  id: string;
  donorId: string;
  kind: DonationKind;
  frequency: PledgeFrequency;
  amount?: number;
  currency?: Currency;
  itemDescription?: string;
  status: PledgeStatus;
  startedAt: string;
  notes?: string;
}

export type CommitmentStatus = "pledged" | "fulfilled" | "cancelled";

export interface CampaignCommitment {
  id: string;
  donorId: string;
  campaignId: string;
  kind: DonationKind;
  pledgedAmount?: number;
  currency?: Currency;
  itemDescription?: string;
  status: CommitmentStatus;
  fulfilledDonationId?: string;
  createdAt: string;
}

export type DonorAccountStatus = "active" | "suspended";

export interface DonorAccount {
  id: string;
  donorId: string;
  email: string;
  mustChangePassword: boolean;
  status: DonorAccountStatus;
}
