"use client";

import * as React from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { User, ShieldCheck, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PinInput } from "@/components/patterns/pin-input";
import { useRole } from "@/context/role-provider";
import { staff } from "@/lib/mock-data";

const PIN_LENGTH = 6;
const roster = staff.filter((s) => s.active);

export default function LoginPage() {
  const router = useRouter();
  const { login } = useRole();
  const [staffId, setStaffId] = React.useState(roster[0]?.id ?? "");
  const [pin, setPin] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const selected = roster.find((s) => s.id === staffId);
  const canSubmit = !!selected && pin.length === PIN_LENGTH;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || pin.length !== PIN_LENGTH) return;

    setSubmitting(true);
    const fullName = `${selected.firstName} ${selected.lastName}`;
    login(selected.role, fullName);
    toast.success(`Welcome, ${fullName} (demo — no real authentication)`);
    router.push("/staff");
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
            Continue
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
