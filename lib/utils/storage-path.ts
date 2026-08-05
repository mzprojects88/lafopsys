import { storageLocations } from "@/lib/mock-data/inventory";

export function storageLocationPath(locationId: string): string {
  const parts: string[] = [];
  let current = storageLocations.find((l) => l.id === locationId);
  while (current) {
    parts.unshift(current.name);
    current = current.parentId ? storageLocations.find((l) => l.id === current!.parentId) : undefined;
  }
  return parts.join(" › ");
}
