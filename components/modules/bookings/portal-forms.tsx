"use client";

import * as React from "react";
import { ui } from "./public-ui";

async function send(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string; next?: string }> {
  const res = await fetch("/api/book/portal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const out = (await res?.json().catch(() => null)) as { ok?: boolean; error?: string; next?: string } | null;
  return out?.ok ? { ok: true, next: out.next } : { ok: false, error: out?.error ?? "We could not reach the server. Please check your connection and try again." };
}

/** Sign in with the group's email and a password (the one-time password, or the group's own). */
export function SignInForm() {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  return (
    <form
      className="mt-5 flex max-w-md flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        const r = await send({ action: "sign-in", email, password });
        if (r.ok && r.next) return void window.location.assign(r.next);
        setBusy(false);
        setError(r.error ?? "");
      }}
    >
      <label className="block">
        <span className={ui.label}>Email</span>
        <input className={ui.input} type="email" inputMode="email" autoComplete="username" required value={email} maxLength={200} onChange={(e) => setEmail(e.target.value)} />
        <span className={`${ui.hint} block`}>The email address your group books with.</span>
      </label>
      <label className="block">
        <span className={ui.label}>Password</span>
        <input className={ui.input} type="password" autoComplete="current-password" required value={password} maxLength={200} onChange={(e) => setPassword(e.target.value)} />
        <span className={`${ui.hint} block`}>The first time, the one-time password Little Ark Foundation sent you.</span>
      </label>
      {error ? (
        <p role="alert" className={ui.problem}>
          {error}
        </p>
      ) : null}
      <button type="submit" className={`${ui.cta} self-start`} disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

/** "Forgot my password" (step 4): asks for a new one-time password by email. The answer is the same either way. */
export function ForgotForm() {
  const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState("");
  const [error, setError] = React.useState("");
  if (done)
    return (
      <p role="status" className={`${ui.soft} mt-5 max-w-md`}>
        {done}
      </p>
    );
  return (
    <form
      className="mt-5 flex max-w-md flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        const r = (await send({ action: "forgot", email })) as { ok?: boolean; error?: string; message?: string };
        setBusy(false);
        if (r.ok && r.message) setDone(r.message);
        else setError(r.error ?? "");
      }}
    >
      <label className="block">
        <span className={ui.label}>Email</span>
        <input className={ui.input} type="email" inputMode="email" autoComplete="username" required value={email} maxLength={200} onChange={(e) => setEmail(e.target.value)} />
        <span className={`${ui.hint} block`}>The email address your group books with.</span>
      </label>
      {error ? (
        <p role="alert" className={ui.problem}>
          {error}
        </p>
      ) : null}
      <button type="submit" className={`${ui.cta} self-start`} disabled={busy}>
        {busy ? "Sending…" : "Email me a one-time password"}
      </button>
    </form>
  );
}

/** The group sets its own password (after the one-time password, or to change it). */
export function SetPasswordForm() {
  const [password, setPassword] = React.useState("");
  const [again, setAgain] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  return (
    <form
      className="mt-5 flex max-w-md flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (password !== again) return void setError("The two passwords are not the same.");
        setBusy(true);
        setError("");
        const r = await send({ action: "set-password", password });
        if (r.ok && r.next) return void window.location.assign(r.next);
        setBusy(false);
        setError(r.error ?? "");
      }}
    >
      <label className="block">
        <span className={ui.label}>New password</span>
        <input className={ui.input} type="password" autoComplete="new-password" required minLength={10} maxLength={200} value={password} onChange={(e) => setPassword(e.target.value)} />
        <span className={`${ui.hint} block`}>At least 10 characters. A short sentence is easy to remember.</span>
      </label>
      <label className="block">
        <span className={ui.label}>The same password again</span>
        <input className={ui.input} type="password" autoComplete="new-password" required maxLength={200} value={again} onChange={(e) => setAgain(e.target.value)} />
      </label>
      {error ? (
        <p role="alert" className={ui.problem}>
          {error}
        </p>
      ) : null}
      <button type="submit" className={`${ui.cta} self-start`} disabled={busy}>
        {busy ? "Saving…" : "Save my password"}
      </button>
    </form>
  );
}

export function SignOutButton() {
  const [busy, setBusy] = React.useState(false);
  return (
    <button
      type="button"
      className={ui.secondary}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const r = await send({ action: "sign-out" });
        window.location.assign(r.next ?? "/book/sign-in");
      }}
    >
      Sign out
    </button>
  );
}
