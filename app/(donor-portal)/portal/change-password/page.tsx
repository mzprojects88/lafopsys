"use client";

import * as React from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Lock, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { completeDonorPasswordChange } from "@/app/(donor-portal)/portal/actions";

const MIN_LENGTH = 8;

export default function DonorChangePasswordPage() {
  const router = useRouter();
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [checkingSession, setCheckingSession] = React.useState(true);

  React.useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        router.replace("/portal/login");
        return;
      }
      setCheckingSession(false);
    });
  }, [router]);

  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const canSubmit = newPassword.length >= MIN_LENGTH && confirmPassword.length >= MIN_LENGTH && !mismatch;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    const supabase = createClient();

    const { error: updateAuthError } = await supabase.auth.updateUser({ password: newPassword });
    if (updateAuthError) {
      toast.error(`Couldn't set new password: ${updateAuthError.message}`);
      setSubmitting(false);
      return;
    }

    // Donors have no RLS UPDATE path on shared.donor_accounts (see
    // supabase/migrations/0022_donor_accounts.sql) -- clearing this flag
    // needs the service-role client, done server-side.
    const result = await completeDonorPasswordChange();
    if (!result.ok) {
      toast.error("Password changed, but couldn't clear the 'must change' flag — you may be asked again next login.");
    } else {
      toast.success("Password updated.");
    }

    router.push("/portal/dashboard");
  }

  if (checkingSession) return null;

  return (
    <Card className="w-full max-w-lg">
      <CardContent className="flex flex-col items-center gap-6 px-8 py-10 sm:px-10">
        <Image src="/logo/laf-mark.png" alt="Little Ark Foundation" width={140} height={150} priority />

        <div className="flex flex-col items-center gap-1.5 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Set a New Password</h1>
          <p className="text-sm text-muted-foreground">
            You&apos;re using a temporary password — choose a new one (at least {MIN_LENGTH} characters) to continue.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex w-full flex-col gap-5">
          <div className="flex flex-col gap-2">
            <span className="flex items-center gap-1.5 text-sm font-medium text-primary">
              <Lock className="size-4" />
              New password
            </span>
            <Input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="h-11 rounded-xl"
            />
          </div>

          <div className="flex flex-col gap-2">
            <span className="flex items-center gap-1.5 text-sm font-medium text-primary">
              <Lock className="size-4" />
              Confirm password
            </span>
            <Input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="h-11 rounded-xl"
            />
            {mismatch && <span className="text-xs text-destructive">Passwords don&apos;t match.</span>}
          </div>

          <Button type="submit" size="lg" className="h-12 w-full gap-2 rounded-xl text-base" disabled={!canSubmit || submitting}>
            {submitting ? "Saving…" : "Save & Continue"}
            <ArrowRight className="size-4" />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
