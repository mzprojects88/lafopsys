import Image from "next/image";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { presignGet } from "@/lib/files/b2";
import { amountInWords } from "@/lib/utils/amount-words";
import { DEFAULT_VOUCHER_CERTIFICATION } from "@/lib/utils/documents";
import { nameFormat, titleFor } from "@/lib/utils/staff-name";
import { KIND_LABEL, PAY_LABEL, STATUS_LABEL, type VoucherKind, type VoucherStatus } from "@/lib/utils/vouchers";

/** The LAF sky blue of the logo (0149). */
const BRAND = "#39B6EA";
const TITLE: Record<string, string> = { PV: "Payment Voucher", PCV: "Petty Cash Voucher", GCV: "GCash Fund Voucher", JV: "Journal Voucher (liquidation)" };
/** The signatures in the order they happen; the first two print smaller (before Finance). The payment steps don't
 * apply to a voucher released straight after approval (a fund slip, a liquidation). */
const SIGNS = [
  { action: "submit", label: "Requested by", small: true },
  { action: "endorse", label: "Endorsed by", small: true },
  { action: "prepare", label: "Prepared by" },
  { action: "review", label: "Reviewed by" },
  { action: "approve", label: "Approved by" },
  { action: "prepare_payment", label: "Payment prepared by", payment: true },
  { action: "approve_payment", label: "Payment approved by", payment: true },
  { action: "release", label: "Released by" },
] as const;
/** Stopped: printed VOID, with no signature image. */
const STOPPED: Record<string, string> = { cancelled: "CANCELLED", rejected: "REJECTED" };
const FILE_KIND: Record<string, string> = { receipt: "Receipt", invoice: "Invoice", quotation: "Quotation", proof: "Proof", other: "Other" };
const peso = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** Manila time whatever the server's clock zone (12-hour, as every time in the apps). */
const manila = (iso: string, withTime = true) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric", ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}) }).format(new Date(iso));
export const printedNow = () => manila(new Date().toISOString());

// The rows as PostgREST returns them (the schema isn't typed for this client).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;
type Ev = { action: string; actor: string | null; signer_text: string | null; at: string; source?: string };

export interface Org {
  header: string;
  address: string;
  dswd: string;
  certification: string;
  names: unknown;
}

/** A voucher's signature boxes: the steps of its latest round (all of a register voucher's), each with the event that
 * signed it or none yet (a line left to sign by hand); the payment steps only when the voucher has them. */
function boxes(v: Row, events: readonly Ev[]) {
  const start = events.map((e) => e.action).lastIndexOf("submit");
  // A voucher from the registers has no submit: its signatures are the register's.
  const round = start < 0 ? events : events.slice(start);
  const direct = v.kind === "liquidation" || (!!v.fund_id && v.kind !== "fund_topup");
  return SIGNS.filter((s) => !("payment" in s) || !direct).map((s) => ({
    ...s,
    e: round.find((x) => x.action === s.action || (s.action === "endorse" && x.action === "skip_endorse")),
  }));
}

/** Who may have their image on a voucher: the person who did a step IN ArkOS (source app), on a voucher not stopped.
 * A register voucher's signer (source sheet) prints by name only, even when matched to a staff member. */
const imageSigner = (v: Row, e: Ev | undefined) => (e && e.actor && e.source !== "sheet" && e.action !== "skip_endorse" && !STOPPED[v.status] ? e.actor : null);

/** One label / value cell pair of the details grid, as on the paper. */
function Cell({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <>
      <div className="border-b border-r border-neutral-300 bg-sky-50 px-2 py-1.5 font-semibold text-sky-900">{label}</div>
      <div className={`border-b border-r border-neutral-300 px-2 py-1.5 ${wide ? "col-span-3" : ""}`}>{children}</div>
    </>
  );
}

/**
 * One voucher on A4 in the foundation's format with the LAF branding (0149): letterhead from Settings › Documents,
 * the sky-blue title band, the details, the items with their coding, the net in words, the papers attached, the
 * certification, and the signature boxes: each signed step with the signer's own image when they did it in ArkOS,
 * the steps still ahead as lines to sign. A cancelled or rejected voucher is marked VOID and carries no image.
 */
export function sheetFor(
  v: Row,
  ctx: { lines: Row[]; events: Ev[]; people: Row[]; codes: Row[]; accounts: Row[]; payees: Row[]; files: Row[]; signatures: Map<string, string>; org: Org; link: string; printedAt: string; place: string },
) {
  const { lines, events, people, codes, accounts, payees, files, signatures, org } = ctx;
  const person = (sid: string | null) => (people ?? []).find((x) => x.id === sid);
  const fullName = (sid: string | null) => ((p) => (p ? `${p.first_name} ${p.last_name}` : ""))(person(sid));
  const position = (sid: string | null) => titleFor(nameFormat(org.names, "voucher"), person(sid)?.position);
  const codeOf = (cid: string | null) => (codes ?? []).find((c) => c.id === cid);
  const account = (aid: string | null) => (accounts ?? []).find((a) => a.id === aid);
  const payee = v.payee_id ? ((payees ?? []) as { id: string; name: string }[]).find((p) => p.id === v.payee_id)?.name : null;
  const items = (lines ?? []) as { id: string; description: string; qty: number; unit_cost: number; amount: number; or_number: string | null; account_id: string | null; t1_id: string | null; t3_id: string | null; legacy_code: string | null; ewt_atc: string | null; ewt_rate: number | null }[];
  const ewt = Number(v.ewt_total ?? 0);
  const net = Number(v.total) - ewt;
  const atcs = [...new Set(items.filter((l) => l.ewt_atc).map((l) => `${l.ewt_atc} ${Number(l.ewt_rate)}%`))].join(", ");
  const prepared = events.filter((e) => e.action === "prepare").map((e) => e.at).sort().at(-1);
  const voucherDate = prepared ?? v.submitted_at ?? v.created_at;
  const fund = codeOf(v.t2_id);
  const signs = boxes(v, events);
  const stopped = STOPPED[v.status];

  const sign = (s: (typeof signs)[number]) => {
    const e = s.e;
    const skipped = e?.action === "skip_endorse";
    const signer = imageSigner(v, e);
    const img = signer ? signatures.get(signer) : undefined;
    return (
      <div key={s.action} className="flex flex-col">
        <div className={`flex items-end justify-center ${"small" in s ? "h-9" : "h-14"}`}>
          {img ? <img src={img} alt="" className="max-h-full max-w-[70%] object-contain" /> : null}
        </div>
        <div className="border-t border-neutral-500 pt-1 text-center">
          <p className="min-h-[1.25em] font-semibold uppercase">{skipped ? "Not needed" : e ? fullName(e.actor) || e.signer_text || "" : ""}</p>
          {e && !skipped && position(e.actor) ? <p className="text-neutral-600">{position(e.actor)}</p> : null}
          <p className="text-neutral-500">{s.label}{e ? ` · ${manila(e.at)}` : " · date"}</p>
        </div>
      </div>
    );
  };

  return (
    <article className="relative mx-auto overflow-hidden bg-white p-8 text-[11px] leading-snug text-neutral-900 [print-color-adjust:exact] print:p-0">
      {stopped ? (
        <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-[96px] font-extrabold tracking-[0.15em] text-red-600/15 [transform:rotate(-28deg)]" aria-hidden>
          VOID
        </p>
      ) : null}
      <header className="flex items-end justify-between gap-6 border-b-2 pb-3" style={{ borderColor: BRAND }}>
        <Image src="/logo/laf-horizontal.png" alt="Little Ark Foundation" width={230} height={42} priority />
        <div className="text-right">
          <p className="text-[13px] font-bold">Little Ark Foundation, Inc.</p>
          {org.address ? <p>{org.address}</p> : null}
          {org.header ? <p className="text-neutral-600">{org.header}</p> : null}
          {org.dswd ? <p className="text-neutral-600">{org.dswd}</p> : null}
        </div>
      </header>

      <div className="mt-3 flex items-center justify-between gap-3 rounded-sm px-4 py-2 text-white" style={{ backgroundColor: BRAND }}>
        <h1 className="text-[15px] font-bold tracking-wider uppercase">{v.voucher_type ? TITLE[v.voucher_type] : "Payment Request"}</h1>
        <div className="flex items-center gap-3">
          {stopped ? <span className="rounded-sm border-2 border-white px-2 py-0.5 text-[12px] font-extrabold tracking-[0.15em]">VOID · {stopped}</span> : null}
          {v.status === "released" ? <span className="rounded-sm border-2 border-white px-2 py-0.5 text-[12px] font-extrabold tracking-[0.15em]">PAID{v.released_at ? ` ${manila(v.released_at, false)}` : ""}</span> : null}
          <p className="text-[13px] font-semibold">No. {v.voucher_number ?? v.legacy_number ?? v.request_number}</p>
        </div>
      </div>

      <section className="mt-3 grid grid-cols-[150px_1fr_110px_1fr] border-t border-l border-neutral-300">
        <Cell label="Voucher no.">{v.voucher_number ?? v.legacy_number ?? "—"}</Cell>
        <Cell label="Date">{manila(voucherDate, false)}</Cell>
        <Cell label="Payee / Recipient" wide>
          <span className="font-semibold">{v.to_person ? v.recipient_name : (payee ?? v.payee_text ?? fullName(v.requested_by))}</span>
        </Cell>
        <Cell label="Purpose / Payment for" wide>{v.purpose}</Cell>
        <Cell label="Type of funding">{fund ? fund.name || fund.code : "—"}</Cell>
        <Cell label="Kind">{KIND_LABEL[v.kind as VoucherKind] ?? v.kind}</Cell>
        <Cell label="Pay by">{PAY_LABEL[v.pay_method as keyof typeof PAY_LABEL] ?? "—"}{v.pay_reference ? ` · ${v.pay_reference}` : ""}</Cell>
        <Cell label="Employee (T4)">{v.t4_code ?? "—"}</Cell>
        <Cell label="Request no.">{v.request_number ?? "—"}</Cell>
        <Cell label="Status">{STATUS_LABEL[v.status as VoucherStatus]}{v.urgent ? " · Urgent" : ""}</Cell>
      </section>

      <table className="mt-4 w-full border-collapse">
        <thead>
          <tr className="bg-sky-50 text-left text-sky-900">
            {["Particulars", "COA code", "Account name", "Reference / OR / Invoice"].map((h) => <th key={h} className="border border-neutral-300 px-2 py-1.5 font-semibold">{h}</th>)}
            {["Qty", "Unit cost", "Amount"].map((h) => <th key={h} className="border border-neutral-300 px-2 py-1.5 text-right font-semibold">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {items.map((l) => {
            const a = account(l.account_id);
            const cls = [codeOf(l.t1_id)?.code, codeOf(l.t3_id)?.code].filter(Boolean).join(":");
            return (
              <tr key={l.id} className="align-top">
                <td className="border border-neutral-300 px-2 py-1.5">{l.description}</td>
                <td className="border border-neutral-300 px-2 py-1.5 tabular-nums">{a?.code ?? l.legacy_code ?? ""}</td>
                <td className="border border-neutral-300 px-2 py-1.5">{a?.name ?? ""}{cls ? <span className="block text-[10px] text-neutral-500">{cls}</span> : null}</td>
                <td className="border border-neutral-300 px-2 py-1.5">{l.or_number ?? ""}</td>
                <td className="border border-neutral-300 px-2 py-1.5 text-right tabular-nums">{Number(l.qty)}</td>
                <td className="border border-neutral-300 px-2 py-1.5 text-right tabular-nums">{peso(Number(l.unit_cost))}</td>
                <td className="border border-neutral-300 px-2 py-1.5 text-right tabular-nums">{peso(Number(l.amount))}</td>
              </tr>
            );
          })}
          <tr className="font-semibold">
            <td colSpan={6} className="border border-neutral-300 px-2 py-1.5 text-right uppercase">Total amount</td>
            <td className="border border-neutral-300 px-2 py-1.5 text-right tabular-nums">{peso(Number(v.total))}</td>
          </tr>
          {ewt > 0 ? (
            <>
              <tr>
                <td colSpan={6} className="border border-neutral-300 px-2 py-1.5 text-right text-neutral-600">Less tax withheld ({atcs})</td>
                <td className="border border-neutral-300 px-2 py-1.5 text-right tabular-nums">({peso(ewt)})</td>
              </tr>
              <tr className="font-semibold">
                <td colSpan={6} className="border border-neutral-300 px-2 py-1.5 text-right uppercase">Net to pay</td>
                <td className="border border-neutral-300 px-2 py-1.5 text-right tabular-nums">{peso(net)}</td>
              </tr>
            </>
          ) : null}
          <tr>
            <td className="border border-neutral-300 bg-sky-50 px-2 py-1.5 font-semibold text-sky-900">Amount in words</td>
            <td colSpan={6} className="border border-neutral-300 px-2 py-1.5 font-medium">{amountInWords(net)}</td>
          </tr>
        </tbody>
      </table>

      <section className="mt-3 grid grid-cols-[150px_1fr] border-t border-l border-neutral-300">
        <div className="border-b border-r border-neutral-300 bg-sky-50 px-2 py-1.5 font-semibold text-sky-900">Supporting documents</div>
        <div className="border-b border-r border-neutral-300 px-2 py-1.5">
          {files.length ? files.map((f) => `${FILE_KIND[f.kind] ?? f.kind}: ${f.file_name}`).join(" · ") : "None attached"}
          <span className="block text-[10px] text-neutral-500">Open them in ArkOS: {ctx.link}</span>
        </div>
      </section>

      <p className="mt-3 rounded-sm border border-neutral-300 px-3 py-2 italic">Certification: {org.certification || DEFAULT_VOUCHER_CERTIFICATION}</p>

      <div className="mt-4 grid grid-cols-3 gap-6">{signs.filter((s) => "small" in s).map(sign)}</div>
      <div className="mt-4 grid grid-cols-3 gap-6">
        {signs.filter((s) => !("small" in s)).map(sign)}
        <div className="flex flex-col">
          <div className="h-14" />
          <div className="border-t border-neutral-500 pt-1 text-center">
            <p className="min-h-[1.25em] font-semibold">&nbsp;</p>
            <p className="text-neutral-500">Received by · signature over printed name · date</p>
          </div>
        </div>
      </div>

      <footer className="mt-6 flex justify-between border-t pt-2 text-[9px] text-neutral-500" style={{ borderColor: BRAND }}>
        <span>{v.voucher_number ?? v.legacy_number ?? v.request_number} · printed {ctx.printedAt} from ArkOS</span>
        <span>{ctx.place}</span>
      </footer>
    </article>
  );
}

/** Five-minute links to these people's own signature images, read by the server. Private to this file: only the
 * signers of printed boxes (loadVoucherSheets) reach it; the preview uses ownSignatureLink. */
async function signatureLinks(staffIds: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!staffIds.length) return out;
  const { data: sigs } = await createAdminClient().schema("shared").from("staff_signatures").select("staff_id, object_key, content_type").in("staff_id", [...staffIds]);
  await Promise.all(
    (sigs ?? []).map(async (s) => {
      try {
        out.set(s.staff_id as string, await presignGet(s.object_key as string, "signature", s.content_type as string, true));
      } catch {
        // Storage not set up on this hosting: the voucher prints without the image.
      }
    }),
  );
  return out;
}

/** The signed-in person's own signature (read as them, RLS), for the preview. */
export async function ownSignatureLink(): Promise<Map<string, string>> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const out = new Map<string, string>();
  if (!user) return out;
  const { data } = await supabase.schema("shared").from("staff_signatures").select("object_key, content_type").eq("staff_id", user.id).maybeSingle();
  if (data) {
    try {
      out.set(user.id, await presignGet(data.object_key as string, "signature", data.content_type as string, true));
    } catch {
      // Storage not set up on this hosting.
    }
  }
  return out;
}

export const SETTINGS_COLUMNS = "report_header, org_address, dswd_label, dswd_number, voucher_certification, document_names";
export function orgFrom(settings: Row): Org {
  return {
    header: settings?.report_header ?? "",
    address: settings?.org_address ?? "",
    dswd: settings?.dswd_number ? `${settings.dswd_label ?? "DSWD Accreditation No."} ${settings.dswd_number}` : "",
    certification: settings?.voucher_certification ?? DEFAULT_VOUCHER_CERTIFICATION,
    names: settings?.document_names ?? {},
  };
}
export async function siteOrigin(): Promise<string> {
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? ""}`;
}

/**
 * Payment requests or vouchers on paper (0134, 0139; several at once since polish 3; branded 0149): read under the
 * caller's RLS, so only what they can see prints (the rest is left out), in a handful of queries whatever the count.
 * Signature images: only for the people in the boxes that print (in-app steps of the latest round, vouchers not
 * stopped), as five-minute private links.
 */
export async function loadVoucherSheets(ids: readonly string[]): Promise<{ id: string; sheet: React.ReactNode }[]> {
  const supabase = await createClient();
  const ops = () => supabase.schema("ops");
  const { data: found } = await ops().from("vouchers").select("*").in("id", [...ids]);
  if (!found?.length) return [];
  const vid = (found as Row[]).map((v) => v.id as string);
  const [lines, events, files, { data: codes }, { data: accounts }, { data: payees }, { data: settings }] = await Promise.all([
    fetchAll<Row>((from, to) => ops().from("voucher_lines").select("*").in("voucher_id", vid).order("voucher_id").order("sort").range(from, to)),
    fetchAll<Row>((from, to) => ops().from("voucher_events").select("id, voucher_id, action, actor, signer_text, at, source").in("voucher_id", vid).order("at").order("id").range(from, to)),
    fetchAll<Row>((from, to) => ops().from("voucher_files").select("id, voucher_id, kind, file_name").in("voucher_id", vid).order("voucher_id").order("id").range(from, to)),
    ops().from("fin_codes").select("id, code, name"),
    ops().from("coa_accounts").select("id, code, name"),
    ops().rpc("payee_choices"),
    supabase.schema("shared").from("app_settings").select(SETTINGS_COLUMNS).maybeSingle(),
  ]);
  const byId = new Map((found as Row[]).map((v) => [v.id as string, v]));
  const eventsOf = (id: string) => events.filter((e) => e.voucher_id === id) as Ev[];
  const actorIds = [...new Set([...(found as Row[]).map((v) => v.requested_by), ...events.map((e) => e.actor)].filter(Boolean))] as string[];
  const { data: people } = actorIds.length ? await supabase.schema("shared").from("staff").select("id, first_name, last_name, position").in("id", actorIds) : { data: [] };
  const signerIds = [...new Set((found as Row[]).flatMap((v) => boxes(v, eventsOf(v.id)).map((b) => imageSigner(v, b.e)).filter((x): x is string => !!x)))];
  const signatures = await signatureLinks(signerIds);

  const origin = await siteOrigin();
  const org = orgFrom(settings);
  const printedAt = printedNow();
  const shown = ids.filter((id) => byId.has(id));
  return shown.map((id, i) => ({
    id,
    sheet: sheetFor(byId.get(id), {
      lines: lines.filter((l) => l.voucher_id === id),
      events: eventsOf(id),
      files: files.filter((f) => f.voucher_id === id),
      people: people ?? [],
      codes: codes ?? [],
      accounts: accounts ?? [],
      payees: payees ?? [],
      signatures,
      org,
      link: `${origin}/requests/${id}`,
      printedAt,
      place: shown.length > 1 ? `Voucher ${i + 1} of ${shown.length}` : "",
    }),
  }));
}
