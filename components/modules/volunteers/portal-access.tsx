"use client";

import * as React from "react";
import { Copy, KeyRound, Lock, LockOpen } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/utils/date";

type State = "none" | "issued" | "setup" | "active" | "expired" | "locked";
interface Status {
  state: State;
  issuedAt: string | null;
  otpExpiresAt: string | null;
  lastSignInAt: string | null;
}
const WORDS: Record<State, string> = {
  none: "No portal access yet.",
  issued: "One-time password given; waiting for the first sign-in.",
  setup: "Signed in once, but no password of their own yet. If they did not finish, give a new one-time password.",
  active: "Signed up: the group has its own password.",
  expired: "The one-time password ran out before it was used.",
  locked: "Locked: the group cannot sign in.",
};
const when = (iso: string | null) => formatDate(iso, "MMM d, yyyy, h:mm a");

/**
 * A group's Volunteers Portal access, on the Volunteers page (0182): its state, and for those who keep volunteers,
 * a one-time password to give the contact (shown once, here only), and lock or unlock. The dialog gives this a key
 * per group, so a password shown for one group never stays on screen for another.
 */
export function PortalAccess({ groupId, hasEmail, canEdit }: { groupId: string; hasEmail: boolean; canEdit: boolean }) {
  const [status, setStatus] = React.useState<Status | null>(null);
  const [reload, setReload] = React.useState(0);
  const [shown, setShown] = React.useState<{ otp: string; email: string; expiresAt: string; signInUrl: string } | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    void createClient()
      .schema("booking")
      .rpc("portal_status")
      .then(({ data }) => {
        if (!live) return;
        const row = ((data ?? []) as { group_id: string; state: State; issued_at: string | null; otp_expires_at: string | null; last_sign_in_at: string | null }[]).find((r) => r.group_id === groupId);
        setStatus(row ? { state: row.state, issuedAt: row.issued_at, otpExpiresAt: row.otp_expires_at, lastSignInAt: row.last_sign_in_at } : { state: "none", issuedAt: null, otpExpiresAt: null, lastSignInAt: null });
      });
    return () => {
      live = false;
    };
  }, [groupId, reload]);

  async function act(action: "issue" | "lock" | "unlock") {
    setBusy(true);
    const res = await fetch("/api/volunteers/portal-access", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ groupId, action }) }).catch(() => null);
    const out = (await res?.json().catch(() => null)) as { ok?: boolean; error?: string; otp?: string; email?: string; expiresAt?: string; signInUrl?: string } | null;
    setBusy(false);
    if (!res?.ok || !out?.ok) return void toast.error(out?.error ?? "That did not go through. Check your connection and try again.");
    if (action === "issue" && out.otp) setShown({ otp: out.otp, email: out.email ?? "", expiresAt: out.expiresAt ?? "", signInUrl: out.signInUrl ?? "" });
    else toast.success(action === "lock" ? "Locked. The group is signed out everywhere." : "Unlocked.");
    setReload((n) => n + 1);
  }

  const st = status?.state ?? "none";
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h4 className="text-theme-sm font-medium text-foreground">Volunteers Portal</h4>
      {!hasEmail ? (
        <p className="text-theme-sm text-muted-foreground">This group has no email address, so it cannot sign in. It follows its bookings with the Request ID.</p>
      ) : (
        <>
          <p className="text-theme-sm text-foreground">
            {status ? WORDS[st] : "Reading…"}
            {status?.lastSignInAt ? <span className="text-muted-foreground"> Last sign-in {when(status.lastSignInAt)}.</span> : null}
            {st === "issued" && status?.otpExpiresAt ? <span className="text-muted-foreground"> It works until {when(status.otpExpiresAt)}.</span> : null}
          </p>
          {shown ? (
            <div className="rounded-xl border border-warning/40 bg-warning/5 p-3 text-theme-sm">
              <p className="text-foreground">
                Give this one-time password to the contact (by phone or message). It is shown only now. It works once, until {when(shown.expiresAt)}.
              </p>
              <p className="mt-2 font-mono text-lg font-semibold tracking-wider text-foreground select-all">{shown.otp}</p>
              <p className="mt-1 text-muted-foreground">
                They sign in at {shown.signInUrl} with {shown.email}, then choose their own password.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => void navigator.clipboard?.writeText(`Volunteers Portal, Little Ark Foundation\nSign in at ${shown.signInUrl}\nEmail: ${shown.email}\nOne-time password: ${shown.otp}\nIt works once, for 72 hours. You will then choose your own password.`).then(() => toast.success("Copied."))}
              >
                <Copy className="size-4" /> Copy the message
              </Button>
            </div>
          ) : null}
          {canEdit && status ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => act("issue")}>
                <KeyRound className="size-4" /> {st === "none" ? "Give portal access" : "New one-time password"}
              </Button>
              {st !== "none" ? (
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => act(st === "locked" ? "unlock" : "lock")}>
                  {st === "locked" ? <LockOpen className="size-4" /> : <Lock className="size-4" />} {st === "locked" ? "Unlock" : "Lock"}
                </Button>
              ) : null}
            </div>
          ) : null}
          {canEdit && st !== "none" && !shown ? <p className="text-theme-xs text-muted-foreground">A new one-time password clears the group&apos;s password (for a forgotten one) and signs it out everywhere.</p> : null}
        </>
      )}
    </section>
  );
}
