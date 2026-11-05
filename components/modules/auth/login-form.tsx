"use client";

import * as React from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { User, ShieldCheck, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PinInput } from "@/components/patterns/pin-input";
import { signInWithPin } from "@/app/(auth)/login/actions";
import type { Role } from "@/lib/types/common";
import { resolveLandingPath } from "@/lib/rbac/roles";
import { fetchModuleAccess, fetchMyOverrides } from "@/lib/hooks/use-module-access";

const PIN_LENGTH = 6;

export interface LoginRosterEntry {
  id: string;
  firstName: string;
  lastName: string;
}

export function LoginForm({ roster }: { roster: LoginRosterEntry[] }) {
  const searchParams = useSearchParams();
  const [staffId, setStaffId] = React.useState(roster[0]?.id ?? "");
  const [pin, setPin] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const selected = roster.find((s) => s.id === staffId);
  const canSubmit = !!selected && pin.length === PIN_LENGTH;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || pin.length !== PIN_LENGTH) return;

    setSubmitting(true);
    // The account's email is resolved on the server: the browser only ever holds staff ids and names.
    const result = await signInWithPin({ staffId: selected.id, pin });
    if (!result.ok) {
      toast.error(result.error);
      setPin("");
      setSubmitting(false);
      return;
    }

    // A bookmarked deep link (middleware's ?next=) still wins; otherwise the
    // person's own landing page, otherwise their role's default. The PIN-change
    // page carries the same ?next= through so the link is not lost on the way.
    const destination = resolveLandingPath(
      {
        role: [result.role as Role, ...(result.extraRoles as Role[])],
        landingPath: result.landingPath,
        next: searchParams.get("next"),
      },
      await fetchModuleAccess(),
      await fetchMyOverrides(result.staffId)
    );

    // A full page load, not router.push: the session cookies were set by the server, so RoleProvider
    // gets no sign-in event and would keep its signed-out state (no staff id) until the next reload.
    if (result.mustChangePin) {
      toast.info("This is a temporary PIN — set a new one to continue.");
      window.location.assign(`/change-pin?next=${encodeURIComponent(destination)}`);
      return;
    }

    toast.success(`Welcome, ${result.name}`);
    window.location.assign(destination);
  }

  return (
    <Card className="w-full max-w-lg border-0 bg-transparent shadow-none">
      <CardContent className="flex flex-col items-center gap-6 px-2 py-4 sm:px-6">
        <Image src="/logo/laf-mark.png" alt="Little Ark Foundation" width={120} height={129} priority className="lg:hidden" />

        <div className="flex flex-col items-center gap-1.5 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Sign in</h1>
          <p className="text-sm text-muted-foreground">Select your name and enter your 6-digit PIN.</p>
        </div>

        <form onSubmit={handleSubmit} className="flex w-full flex-col gap-5">
          <div className="flex flex-col gap-2">
            <span className="flex items-center gap-1.5 text-theme-sm font-medium text-foreground">
              <User className="size-4 text-muted-foreground" />
              Staff member
            </span>
            <Select value={staffId} onValueChange={setStaffId}>
              <SelectTrigger size="default" className="w-full">
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
            <span className="flex items-center gap-1.5 text-theme-sm font-medium text-foreground">
              <ShieldCheck className="size-4 text-muted-foreground" />
              PIN
            </span>
            <PinInput length={PIN_LENGTH} value={pin} onChange={setPin} />
          </div>

          <Button type="submit" size="lg" className="h-12 w-full gap-2 text-base" disabled={!canSubmit || submitting}>
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
