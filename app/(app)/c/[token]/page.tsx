"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ScanLine } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { CardScanResult, cardToken } from "@/components/modules/patients/card-scan-result";

/** Where a Patient ID card's QR lands (0165) when a phone camera reads it: the child, then one tap. */
export default function CardLinkPage() {
  const { token: raw } = useParams<{ token: string }>();
  const token = cardToken(raw ?? "");
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <PageHeader title="Patient ID card" />
      {token ? <CardScanResult token={token} /> : <p className="text-theme-sm text-muted-foreground">This link is not a Patient ID card.</p>}
      <Link href="/scan" className="flex w-fit items-center gap-1.5 text-theme-sm font-medium text-primary hover:underline">
        <ScanLine className="size-4" />
        Scan the next card
      </Link>
    </div>
  );
}
