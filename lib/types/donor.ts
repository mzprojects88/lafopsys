import type { Currency, Entity } from "@/lib/types/common";

export type DonorType = "individual" | "corporate" | "foundation" | "government" | "anonymous";

export interface Donor {
  id: string;
  name: string;
  /** "Mr.", "Ma'am"... kept out of the name (0083). */
  salutation?: string;
  type: DonorType;
  email?: string;
  phone?: string;
  taxJurisdiction: "US" | "PH";
  tin?: string;
  /** Printed on BIR Form 2322 (0085). */
  address?: string;
  firstGiftDate: string;
  lastGiftDate: string;
  lifetimeValue: number;
  giftCount: number;
}

export type DonationKind = "cash" | "in_kind";
/** How a cash gift was paid (0084). */
export type PaymentMethod = "cash" | "check" | "bank_transfer" | "gcash" | "instapay" | "other";

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
  paymentMethod?: PaymentMethod;
  /** The service invoice / AR number accounting wrote for a cash gift. */
  invoiceNumber?: string;
  notes?: string;
  /** pending_review: received (e.g. logged in LAF Inventory), not yet reviewed by finance. */
  status?: "pending_review" | "reviewed" | "finalized";
}

export type ArStatus = "draft" | "issued" | "sent" | "acknowledged";

export interface AcknowledgmentReceipt {
  id: string;
  donationId: string;
  /** LAF-CSH-YYYY-NNNN from the database series (0085); older rows keep their AR-YYYY-… number. */
  sequenceNumber: string;
  entity: Entity;
  status: ArStatus;
  issuedAt?: string;
  sentAt?: string;
  acknowledgedAt?: string;
  issuedBy?: string;
  /** Accounting's paper AR / service invoice number, printed as reference. */
  /** The paper receipt number from accounting's booklet (the sheet's invoice column). */
  bookletNumber?: string;
  amount?: number;
  currency?: Currency;
}

export type DoneeCertStatus = "requested" | "prepared" | "approved" | "released" | "filed";

export interface DoneeCertificate {
  id: string;
  donationId: string;
  /** DC-YYYY-NNNN from the database series (0085). */
  controlNumber: string;
  status: DoneeCertStatus;
  requestedAt: string;
  releasedAt?: string;
  kind?: DonationKind;
  amount?: number;
  description?: string;
  signatoryId?: string;
  releasedBy?: string;
}

export interface Campaign {
  id: string;
  name: string;
  description?: string;
  /** closed: no longer offered on new gifts; its total stays (0086). */
  status: "active" | "closed";
  targetAmount: number;
  /** Finalized PHP gifts linked to the campaign, kept by the database (0086). */
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
