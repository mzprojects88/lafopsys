"use client";

import * as React from "react";
import { toast } from "sonner";
import { Copy, KeyRound } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/patterns/status-badge";
import { useDonorsData } from "@/lib/hooks/use-donors-collection";
import { useDonorPledgesData } from "@/lib/hooks/use-donor-pledges-collection";
import { useDonorAccountsData } from "@/lib/hooks/use-donor-accounts-collection";
import { isVipEligible } from "@/lib/utils/donor-vip";
import { createDonorPortalAccount } from "@/app/(app)/donors/[donorId]/actions";

function eligibilityReasons(
  donor: { type: string; email?: string; giftCount: number } | undefined,
  hasActivePledge: boolean
): string[] {
  if (!donor) return ["Donor not found."];
  const reasons: string[] = [];
  if (donor.type === "anonymous") reasons.push("Anonymous donors can't get a portal account.");
  if (!donor.email) reasons.push("No email on file.");
  if (donor.giftCount < 3) reasons.push("Fewer than 3 recorded gifts.");
  if (!hasActivePledge) reasons.push("No active recurring pledge on file.");
  return reasons;
}

/** VIP Donors Portal provisioning card on a donor's detail page. Eligibility
 * shown here is a client-side convenience -- the real gate is enforced
 * server-side in createDonorPortalAccount, which re-checks every condition
 * since the admin client it uses bypasses RLS entirely. */
export function PortalAccountCard({ donorId }: { donorId: string }) {
  const { donors, loading: donorsLoading } = useDonorsData();
  const { pledges, loading: pledgesLoading } = useDonorPledgesData();
  const { accounts, loading: accountsLoading, refetch } = useDonorAccountsData();
  const loading = donorsLoading || pledgesLoading || accountsLoading;
  const [submitting, setSubmitting] = React.useState(false);
  const [credentials, setCredentials] = React.useState<{ email: string; tempPassword: string } | null>(null);

  const donor = donors.find((d) => d.id === donorId);
  const account = accounts.find((a) => a.donorId === donorId);
  const hasActivePledge = pledges.some((p) => p.donorId === donorId && p.status === "active");
  const eligible = !!donor && isVipEligible(donor, pledges);

  async function handleCreate() {
    setSubmitting(true);
    const result = await createDonorPortalAccount(donorId);
    setSubmitting(false);
    if (!result.ok || !result.email || !result.tempPassword) {
      toast.error(result.error ?? "Couldn't create the portal account.");
      return;
    }
    setCredentials({ email: result.email, tempPassword: result.tempPassword });
    await refetch();
  }

  async function handleCopy() {
    if (!credentials) return;
    await navigator.clipboard.writeText(`Username: ${credentials.email}\nTemporary password: ${credentials.tempPassword}`);
    toast.success("Copied to clipboard");
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <KeyRound className="size-4" />
            VIP Portal Account
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : account ? (
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">{account.email}</span>
                <span className="text-xs text-muted-foreground">
                  {account.mustChangePassword ? "Awaiting first login" : "Active login"}
                </span>
              </div>
              <StatusBadge domain="donorAccount" status={account.status} />
            </div>
          ) : eligible ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">Eligible for the VIP Donors Portal.</p>
              <Button size="sm" disabled={submitting} onClick={handleCreate}>
                {submitting ? "Creating…" : "Create Portal Account"}
              </Button>
            </div>
          ) : (
            <ul className="list-inside list-disc text-sm text-muted-foreground">
              {eligibilityReasons(donor, hasActivePledge).map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!credentials} onOpenChange={(next) => !next && setCredentials(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Portal Account Created</DialogTitle>
            <DialogDescription>
              This password will not be shown again — copy it into an email to the donor now.
            </DialogDescription>
          </DialogHeader>
          {credentials && (
            <div className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3 font-mono text-sm">
              <span>Username: {credentials.email}</span>
              <span>Temporary password: {credentials.tempPassword}</span>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={handleCopy} className="gap-1.5">
              <Copy className="size-3.5" />
              Copy
            </Button>
            <Button onClick={() => setCredentials(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
