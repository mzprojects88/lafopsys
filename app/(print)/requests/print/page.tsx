import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/app/(print)/hr/payslips/[id]/print/print-button";
import { loadVoucherSheets } from "@/components/modules/requests/voucher-sheet";

const MAX = 50;

/**
 * Several vouchers printed together for filing (polish 3), from the Ledger: one sheet a page, each read under the
 * caller's RLS (one they can't see is left out). Up to 50 at a time.
 */
export default async function PrintSeveralPage({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const { ids } = await searchParams;
  const list = [...new Set((ids ?? "").split(",").filter((x) => /^[0-9a-f-]{36}$/i.test(x)))].slice(0, MAX);
  if (!list.length) notFound();
  const sheets = await loadVoucherSheets(list);
  return (
    <div className="mx-auto max-w-3xl p-6 text-sm text-neutral-900 print:max-w-none print:p-0">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href="/finance/ledger" className="text-xs underline">Back to the Ledger</Link>
        <span className="text-xs text-neutral-600">{sheets.length} voucher{sheets.length === 1 ? "" : "s"}</span>
        <PrintButton />
      </div>
      {sheets.map(({ id, sheet }) => (
        <div key={id} className="mb-6 break-after-page print:mb-0 last:break-after-auto">{sheet}</div>
      ))}
    </div>
  );
}
