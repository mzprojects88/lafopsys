"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintButton() {
  return (
    <Button size="sm" className="gap-1.5" onClick={() => window.print()}>
      <Printer className="size-3.5" />
      Print / save as PDF
    </Button>
  );
}
