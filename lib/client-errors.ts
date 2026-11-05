// Failures the app hits in the browser reach the Super Admin (shared.client_errors, 0129): a failed
// save the staff could not see the cause of, an unhandled error on a page. Best-effort and silent:
// reporting an error never throws, never blocks, never loops on itself.
import { createClient } from "@/lib/supabase/client";

const APP = "lafopsys";
let recent: string[] = [];

export function reportClientError(message: string, detail: Record<string, unknown> = {}, page?: string): void {
  try {
    const msg = String(message ?? "").slice(0, 500) || "Unknown error";
    const key = `${msg}|${page ?? ""}`;
    if (recent.includes(key)) return; // the same error on the same page again: once is enough
    recent = [...recent.slice(-19), key];
    const row = {
      app: APP,
      page: (page ?? (typeof location !== "undefined" ? location.pathname : undefined))?.slice(0, 200) ?? null,
      role: typeof document !== "undefined" ? (document.documentElement.dataset.role ?? null) : null,
      message: msg,
      detail: safeDetail(detail),
    };
    void createClient()
      .schema("shared")
      .from("client_errors")
      .insert(row)
      .then(() => undefined, () => undefined);
  } catch {
    // never
  }
}

function safeDetail(d: Record<string, unknown>): Record<string, unknown> {
  try {
    const s = JSON.stringify(d, (_k, v) => (typeof v === "string" ? v.slice(0, 400) : v));
    return s.length > 6000 ? { truncated: s.slice(0, 6000) } : JSON.parse(s);
  } catch {
    return {};
  }
}

/** Window-level errors and unhandled promise rejections, once per page load. */
export function installClientErrorReporting(): () => void {
  if (typeof window === "undefined") return () => undefined;
  const onError = (e: ErrorEvent) => reportClientError(e.message, { source: e.filename, line: e.lineno, stack: e.error?.stack });
  const onRejection = (e: PromiseRejectionEvent) => {
    const r = e.reason as { message?: string; stack?: string; code?: string } | string | undefined;
    reportClientError(typeof r === "string" ? r : r?.message ?? "Unhandled promise rejection", { stack: typeof r === "object" ? r?.stack : undefined, code: typeof r === "object" ? r?.code : undefined });
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
