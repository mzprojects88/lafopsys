import { PageHeader } from "@/components/patterns/page-header";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { storageLocations, inventoryLots, inventoryItems } from "@/lib/mock-data";

function children(parentId?: string) {
  return storageLocations.filter((l) => l.parentId === parentId);
}

function lotsAt(binId: string) {
  return inventoryLots.filter((l) => l.storageLocationId === binId);
}

export default function LocationsPage() {
  const sites = storageLocations.filter((l) => l.level === "site");

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Storage Locations"
        description="Site → Room → Unit → Bin. Every lot lives at a specific bin — location is scannable too."
      />

      <Accordion type="multiple" className="flex flex-col gap-2">
        {sites.map((site) => (
          <AccordionItem key={site.id} value={site.id} className="rounded-md border px-3">
            <AccordionTrigger>{site.name}</AccordionTrigger>
            <AccordionContent>
              <Accordion type="multiple" className="ml-3 flex flex-col gap-1 border-l pl-3">
                {children(site.id).map((room) => (
                  <AccordionItem key={room.id} value={room.id}>
                    <AccordionTrigger className="text-sm">{room.name}</AccordionTrigger>
                    <AccordionContent>
                      <div className="ml-3 flex flex-col gap-2 border-l pl-3">
                        {children(room.id).map((unit) => (
                          <div key={unit.id} className="flex flex-col gap-1">
                            <span className="text-sm font-medium">{unit.name}</span>
                            <div className="ml-3 flex flex-col gap-1 border-l pl-3">
                              {children(unit.id).map((bin) => {
                                const lots = lotsAt(bin.id);
                                return (
                                  <div key={bin.id} className="flex items-center justify-between text-xs">
                                    <span className="text-muted-foreground">{bin.name}</span>
                                    <div className="flex flex-wrap gap-1">
                                      {lots.length === 0 ? (
                                        <span className="text-muted-foreground">Empty</span>
                                      ) : (
                                        lots.map((lot) => (
                                          <Badge key={lot.id} variant="secondary" className="text-[10px]">
                                            {inventoryItems.find((i) => i.id === lot.itemId)?.name}
                                          </Badge>
                                        ))
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
