"use client";

import * as React from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { User, ShieldCheck, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PinInput } from "@/components/patterns/pin-input";
import { useRole } from "@/context/role-provider";
import { createClient } from "@/lib/supabase/client";
import type { Role } from "@/lib/types/common";

const PIN_LENGTH = 6;

export interface LoginRosterEntry {
  id: string;
  staffCode: string;
  firstName: string;
  lastName: string;
}

export function LoginForm({ roster }: { roster: LoginRosterEntry[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useRole();
  const [staffId, setStaffId] = React.useState(roster[0]?.id ?? "");
  const [pin, setPin] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const selected = roster.find((s) => s.id === staffId);
  const canSubmit = !!selected && pin.length === PIN_LENGTH;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || pin.length !== PIN_LENGTH) return;

    setSubmitting(true);
    const supabase = createClient();
    const email = `${selected.staffCode.toLowerCase()}@staff.lafopsys.internal`;

    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email, password: pin });
    if (signInError || !signInData.user) {
      toast.error("Incorrect PIN. Please try again.");
      setPin("");
      setSubmitting(false);
      return;
    }

    const { data: staffRow, error: staffError } = await supabase
      .schema("shared")
      .from("staff")
      .select("role, first_name, last_name, must_change_pin")
      .eq("id", signInData.user.id)
      .single();

    if (staffError || !staffRow) {
      toast.error("Signed in, but couldn't load your account details. Contact an admin.");
      setSubmitting(false);
      return;
    }

    const fullName = `${staffRow.first_name} ${staffRow.last_name}`;
    login(staffRow.role as Role, fullName);

    if (staffRow.must_change_pin) {
      toast.info("This is a temporary PIN — set a new one to continue.");
      router.push("/change-pin");
      return;
    }

    toast.success(`Welcome, ${fullName}`);
    router.push(searchParams.get("next") || "/dashboard");
  }

  return (
    <Card className="w-full max-w-lg">
      <CardContent className="flex flex-col items-center gap-6 px-8 py-10 sm:px-10">
        <Image src="/logo/laf-mark.png" alt="Little Ark Foundation" width={140} height={150} priority />

        <div className="flex flex-col items-center gap-1.5 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">LAF Staff Login</h1>
          <p className="text-sm text-muted-foreground">Select your name and enter your 6-digit PIN.</p>
        </div>

        <form onSubmit={handleSubmit} className="flex w-full flex-col gap-5">
          <div className="flex flex-col gap-2">
            <span className="flex items-center gap-1.5 text-sm font-medium text-primary">
              <User className="size-4" />
              Select Staff
            </span>
            <Select value={staffId} onValueChange={setStaffId}>
              <SelectTrigger size="default" className="h-11 w-full rounded-xl">
                <SelectValue placeholder="Select your name" />
              </SelectTrigger>
              <SelectContent>
                {roster.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.firstName} {s.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <span className="flex items-center gap-1.5 text-sm font-medium text-primary">
              <ShieldCheck className="size-4" />
              PIN
            </span>
            <PinInput length={PIN_LENGTH} value={pin} onChange={setPin} />
          </div>

          <Button type="submit" size="lg" className="h-12 w-full gap-2 rounded-xl text-base" disabled={!canSubmit || submitting}>
            {submitting ? "Signing in…" : "Continue"}
            <ArrowRight className="size-4" />
          </Button>
        </form>

        <div className="flex w-full flex-col items-center gap-3">
          <div className="flex w-full items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <ShieldCheck className="size-4 shrink-0 text-primary" />
            <div className="h-px flex-1 bg-border" />
          </div>
          <span className="text-xs text-muted-foreground">Secure internal access</span>
        </div>
      </CardContent>
    </Card>
  );
}
