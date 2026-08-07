"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building2, User, ShieldCheck, ArrowRight } from "lucide-react";
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
import { useHospitalAuth } from "@/context/hospital-auth-provider";
import { hospitals, hospitalNurses } from "@/lib/mock-data";

const PIN_LENGTH = 6;

export default function PartnerLoginPage() {
  const router = useRouter();
  const { login } = useHospitalAuth();
  const [hospitalId, setHospitalId] = React.useState(hospitals[0]?.id ?? "");
  const [nurseId, setNurseId] = React.useState("");
  const [pin, setPin] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const nurseRoster = hospitalNurses.filter((n) => n.hospitalId === hospitalId && n.active);
  const selectedHospital = hospitals.find((h) => h.id === hospitalId);
  const selectedNurse = nurseRoster.find((n) => n.id === nurseId);
  const canSubmit = !!selectedHospital && !!selectedNurse && pin.length === PIN_LENGTH;

  function handleHospitalChange(next: string) {
    setHospitalId(next);
    setNurseId("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedHospital || !selectedNurse || pin.length !== PIN_LENGTH) return;

    setSubmitting(true);
    const nurseName = `${selectedNurse.firstName} ${selectedNurse.lastName}`;
    login({
      hospitalId: selectedHospital.id,
      hospitalName: selectedHospital.name,
      nurseId: selectedNurse.id,
      nurseName,
    });
    toast.success(`Welcome, ${nurseName} (demo — no real authentication)`);
    router.push("/partners");
  }

  return (
    <Card className="w-full max-w-lg">
      <CardContent className="flex flex-col items-center gap-6 px-8 py-10 sm:px-10">
        <Image src="/logo/laf-mark.png" alt="Little Ark Foundation" width={140} height={150} priority />

        <div className="flex flex-col items-center gap-1.5 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Partner Hospital Portal</h1>
          <p className="text-sm text-muted-foreground">Select your hospital and name, then enter your 6-digit PIN.</p>
        </div>

        <form onSubmit={handleSubmit} className="flex w-full flex-col gap-5">
          <div className="flex flex-col gap-2">
            <span className="flex items-center gap-1.5 text-sm font-medium text-primary">
              <Building2 className="size-4" />
              Hospital
            </span>
            <Select value={hospitalId} onValueChange={handleHospitalChange}>
              <SelectTrigger size="default" className="h-11 w-full rounded-xl">
                <SelectValue placeholder="Select your hospital" />
              </SelectTrigger>
              <SelectContent>
                {hospitals.map((h) => (
                  <SelectItem key={h.id} value={h.id}>
                    {h.name} ({h.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <span className="flex items-center gap-1.5 text-sm font-medium text-primary">
              <User className="size-4" />
              Your Name
            </span>
            <Select value={nurseId} onValueChange={setNurseId}>
              <SelectTrigger size="default" className="h-11 w-full rounded-xl">
                <SelectValue placeholder="Select your name" />
              </SelectTrigger>
              <SelectContent>
                {nurseRoster.map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    {n.firstName} {n.lastName}
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
          <span className="text-xs text-muted-foreground">Secure partner access</span>
          <Link href="/login" className="text-xs text-primary hover:underline">
            LAF staff? Sign in here
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
