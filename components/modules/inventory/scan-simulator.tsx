"use client";

import { useRouter } from "next/navigation";
import { ScanLine } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Card, CardContent } from "@/components/ui/card";
import { inventoryItems } from "@/lib/mock-data";

export function ScanSimulator() {
  const router = useRouter();

  return (
    <Card className="max-w-lg">
      <CardContent className="flex flex-col gap-4 pt-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <ScanLine className="size-8 text-primary" />
          <p className="text-sm text-muted-foreground">
            No real scanner in this prototype — search for an item below to simulate a barcode scan.
          </p>
        </div>
        <Command className="rounded-md border">
          <CommandInput placeholder="Type an item name or barcode…" />
          <CommandList>
            <CommandEmpty>No item found.</CommandEmpty>
            <CommandGroup heading="Items">
              {inventoryItems.map((item) => (
                <CommandItem key={item.id} onSelect={() => router.push(`/inventory/${item.id}`)}>
                  <span>{item.name}</span>
                  {item.barcode && <span className="ml-auto text-xs text-muted-foreground">{item.barcode}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </CardContent>
    </Card>
  );
}
