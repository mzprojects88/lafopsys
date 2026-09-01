import type { Donor, DonorPledge } from "@/lib/types/donor";

/** VIP Donors Portal eligibility: a real (non-anonymous) donor with 3+
 * recorded gifts and an active staff-recorded recurring pledge. Purely a
 * client-side display/UX signal -- the actual gate enforced when creating a
 * portal account lives server-side in
 * app/(app)/donors/[donorId]/actions.ts's createDonorPortalAccount. */
export function isVipEligible(donor: Donor, pledges: DonorPledge[]): boolean {
  return (
    donor.type !== "anonymous" &&
    !!donor.email &&
    donor.giftCount >= 3 &&
    pledges.some((p) => p.donorId === donor.id && p.status === "active")
  );
}
