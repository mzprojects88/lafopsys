"use client";

import { Button } from "@/components/ui/button";
import { resetAllMockData } from "@/lib/store/use-mock-store";

export function ResetDemoDataButton() {
  return (
    <Button
      variant="outline"
      size="sm"
      className="w-fit"
      onClick={() => {
        if (confirm("Reset all demo data in this browser back to the seed state?")) {
          resetAllMockData();
        }
      }}
    >
      Reset Demo Data
    </Button>
  );
}
