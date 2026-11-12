import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/app/(print)/hr/payslips/[id]/print/print-button";
import { VoucherSheet } from "@/components/modules/requests/voucher-sheet";

/** One request or voucher on paper (the sheet is shared with printing several, polish 3). */
export default async function RequestPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sheet = await VoucherSheet({ id });
  if (!sheet) notFound();
  return (
    <div className="mx-auto max-w-3xl p-6 text-sm text-neutral-900 print:max-w-none print:p-0">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href={`/requests/${id}`} className="text-xs underline">Back to the request</Link>
        <PrintButton />
      </div>
      {sheet}
    </div>
  );
}
