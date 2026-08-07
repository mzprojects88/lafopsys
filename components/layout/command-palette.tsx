"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useVisibleNavItems } from "@/lib/rbac/use-role";
import { patients, donors, inventoryItems } from "@/lib/mock-data";

interface CommandPaletteProps {
  externalOpen?: boolean;
  onExternalOpenChange?: (open: boolean) => void;
}

export function CommandPalette({ externalOpen, onExternalOpenChange }: CommandPaletteProps) {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = externalOpen ?? internalOpen;
  const setOpen = onExternalOpenChange ?? setInternalOpen;
  const router = useRouter();
  const navItems = useVisibleNavItems();

  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(!open);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Search LAF Operating System" description="Jump to a page or record">
      <CommandInput placeholder="Search pages, patients, donors, inventory…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Go to page">
          {navItems.map((item) => (
            <CommandItem key={item.href} onSelect={() => go(item.href)}>
              <item.icon />
              <span>{item.title}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Patients">
          {patients.map((p) => (
            <CommandItem key={p.id} onSelect={() => go(`/patients/${p.id}`)}>
              <span>{p.firstName} {p.lastName}</span>
              <span className="ml-auto text-xs text-muted-foreground">{p.patientNumber}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Donors">
          {donors.map((d) => (
            <CommandItem key={d.id} onSelect={() => go(`/donors/${d.id}`)}>
              <span>{d.name}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Inventory">
          {inventoryItems.slice(0, 6).map((i) => (
            <CommandItem key={i.id} onSelect={() => go(`/inventory/${i.id}`)}>
              <span>{i.name}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
