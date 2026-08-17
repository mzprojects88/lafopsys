"use client";

import * as React from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ShieldCheck, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PinInput } from "@/components/patterns/pin-input";
import { createClient } from "@/lib/supabase/client";

const PIN_LENGTH = 6;

export default function ChangePinPage() {
  const router = useRouter();
  const [newPin, setNewPin] = React.useState("");
  const [confirmPin, setConfirmPin] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [checkingSession, setCheckingSession] = React.useState(true);

  React.useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        router.replace("/login");
        return;
      }
      setCheckingSession(false);
    });
  }, [router]);

  const mismatch = confirmPin.length === PIN_LENGTH && newPin !== confirmPin;
  const canSubmit = newPin.length === PIN_LENGTH && confirmPin.length === PIN_LENGTH && !mismatch;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    const supabase = createClient();

    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      router.replace("/login");
      return;
    }

    const { error: updateAuthError } = await supabase.auth.updateUser({ password: newPin });
    if (updateAuthError) {
      toast.error(`Couldn't set new PIN: ${updateAuthError.message}`);
      setSubmitting(false);
      return;
    }

    const { error: updateStaffError } = await supabase
      .schema("shared")
      .from("staff")
      .update({ must_change_pin: false })
      .eq("id", userData.user.id);

    if (updateStaffError) {
      // The PIN itself already changed successfully in Supabase Auth -- this only
      // means the forced-change flag didn't clear, which just means they'll be
      // asked again next login. Not worth blocking on or rolling back for.
      toast.error("PIN changed, but couldn't clear the 'must change' flag — you may be asked again next login.");
    } else {
      toast.success("PIN updated.");
    }

    router.push("/dashboard");
  }

  if (checkingSession) return null;

  return (
    <Card className="w-full max-w-lg">
      <CardContent className="flex flex-col items-center gap-6 px-8 py-10 sm:px-10">
        <Image src="/logo/laf-mark.png" alt="Little Ark Foundation" width={140} height={150} priority />

        <div className="flex flex-col items-center gap-1.5 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Set a New PIN</h1>
          <p className="text-sm text-muted-foreground">You&apos;re using a temporary PIN — choose a new 6-digit PIN to continue.</p>
        </div>

        <form onSubmit={handleSubmit} className="flex w-full flex-col gap-5">
          <div className="flex flex-col gap-2">
            <span className="flex items-center gap-1.5 text-sm font-medium text-primary">
              <ShieldCheck className="size-4" />
              New PIN
            </span>
            <PinInput length={PIN_LENGTH} value={newPin} onChange={setNewPin} />
          </div>

          <div className="flex flex-col gap-2">
            <span className="flex items-center gap-1.5 text-sm font-medium text-primary">
              <ShieldCheck className="size-4" />
              Confirm PIN
            </span>
            <PinInput length={PIN_LENGTH} value={confirmPin} onChange={setConfirmPin} />
            {mismatch && <span className="text-xs text-destructive">PINs don&apos;t match.</span>}
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
