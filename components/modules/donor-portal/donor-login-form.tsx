"use client";

import * as React from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Mail, Lock, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

/** Real email + password sign-in, deliberately not a reuse of
 * components/modules/auth/login-form.tsx -- that form is a staff
 * name-picker keyed to a synthesized internal email, which doesn't apply
 * here: donors sign in with their own real email. */
export function DonorLoginForm() {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const canSubmit = email.trim().length > 0 && password.length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    const supabase = createClient();

    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (signInError || !signInData.user) {
      toast.error("Incorrect email or password.");
      setPassword("");
      setSubmitting(false);
      return;
    }

    const { data: account, error: accountError } = await supabase
      .schema("shared")
      .from("donor_accounts")
      .select("must_change_password")
      .eq("id", signInData.user.id)
      .single();

    if (accountError || !account) {
      toast.error("Signed in, but no donor portal account was found for this login.");
      await supabase.auth.signOut();
      setSubmitting(false);
      return;
    }

    if (account.must_change_password) {
      toast.info("This is a temporary password — set a new one to continue.");
      router.push("/portal/change-password");
      return;
    }

    toast.success("Welcome back");
    router.push("/portal/dashboard");
  }

  return (
    <Card className="w-full max-w-lg">
      <CardContent className="flex flex-col items-center gap-6 px-8 py-10 sm:px-10">
        <Image src="/logo/laf-mark.png" alt="Little Ark Foundation" width={140} height={150} priority />

        <div className="flex flex-col items-center gap-1.5 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Donors Portal</h1>
          <p className="text-sm text-muted-foreground">Sign in with the email and password we sent you.</p>
        </div>

        <form onSubmit={handleSubmit} className="flex w-full flex-col gap-5">
          <div className="flex flex-col gap-2">
            <span className="flex items-center gap-1.5 text-sm font-medium text-primary">
              <Mail className="size-4" />
              Email
            </span>
            <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-11 rounded-xl" />
          </div>

          <div className="flex flex-col gap-2">
            <span className="flex items-center gap-1.5 text-sm font-medium text-primary">
              <Lock className="size-4" />
              Password
            </span>
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 rounded-xl"
            />
          </div>

          <Button type="submit" size="lg" className="h-12 w-full gap-2 rounded-xl text-base" disabled={!canSubmit || submitting}>
            {submitting ? "Signing in…" : "Continue"}
            <ArrowRight className="size-4" />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
