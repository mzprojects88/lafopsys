import type { InventoryItem, InventoryLot, InventoryTxn, StorageLocation } from "@/lib/types/inventory";
import { makeRng } from "@/lib/utils/seeded-random";

const rng = makeRng(404);

export const storageLocations: StorageLocation[] = [
  { id: "loc-lafhouse", level: "site", name: "LAF House" },
  { id: "loc-nch", level: "site", name: "NCH Center" },
  { id: "loc-pantry", parentId: "loc-lafhouse", level: "room", name: "Pantry" },
  { id: "loc-kitchen", parentId: "loc-lafhouse", level: "room", name: "Kitchen" },
  { id: "loc-stockroom", parentId: "loc-lafhouse", level: "room", name: "Stockroom" },
  { id: "loc-staffroom", parentId: "loc-lafhouse", level: "room", name: "Staff Room" },
  { id: "loc-cabinet-a", parentId: "loc-pantry", level: "unit", name: "Cabinet A" },
  { id: "loc-fridge-1", parentId: "loc-kitchen", level: "unit", name: "Fridge 1" },
  { id: "loc-freezer", parentId: "loc-kitchen", level: "unit", name: "Freezer" },
  { id: "loc-shelfrack-2", parentId: "loc-stockroom", level: "unit", name: "Shelf Rack 2" },
  { id: "loc-bin-shelf3", parentId: "loc-cabinet-a", level: "bin", name: "Shelf 3" },
  { id: "loc-bin-drawer2", parentId: "loc-fridge-1", level: "bin", name: "Drawer 2" },
  { id: "loc-bin-shelf1", parentId: "loc-shelfrack-2", level: "bin", name: "Shelf 1" },
  { id: "loc-bin-shelf2", parentId: "loc-shelfrack-2", level: "bin", name: "Shelf 2" },
];

const bins = storageLocations.filter((l) => l.level === "bin");

export const inventoryItems: InventoryItem[] = [
  { id: "item-egg", category: "Food", name: "Egg (30/Tray)", defaultUomId: "uom-tray", perishable: true, shelfLifeDays: 21, reorderPoint: 5, reorderQty: 10, barcode: "4800012345678" },
  { id: "item-rice", category: "Food", name: "Rice 25kg", defaultUomId: "uom-sack", perishable: false, reorderPoint: 2, reorderQty: 4, barcode: "4800098765432" },
  { id: "item-chicken", category: "Food", name: "Chicken (Whole)", defaultUomId: "uom-kg", perishable: true, shelfLifeDays: 3, reorderPoint: 8, reorderQty: 15 },
  { id: "item-carrots", category: "Food", name: "Carrots", defaultUomId: "uom-kg", perishable: true, shelfLifeDays: 10, reorderPoint: 3, reorderQty: 8 },
  { id: "item-milk", category: "Food", name: "Milk (Powdered)", defaultUomId: "uom-can", perishable: false, shelfLifeDays: 365, reorderPoint: 10, reorderQty: 24, barcode: "4800011122233" },
  { id: "item-canned-goods", category: "Food", name: "Canned Sardines", defaultUomId: "uom-can", perishable: false, shelfLifeDays: 730, reorderPoint: 20, reorderQty: 48, barcode: "4800055566677" },
  { id: "item-gloves", category: "Medical Supplies", name: "Disposable Gloves", defaultUomId: "uom-box", perishable: false, reorderPoint: 5, reorderQty: 10, barcode: "8850001112223" },
  { id: "item-alcohol", category: "Medical Supplies", name: "Alcohol 70%", defaultUomId: "uom-liter", perishable: false, reorderPoint: 6, reorderQty: 12, barcode: "8850004445556" },
  { id: "item-diapers", category: "Hygiene", name: "Diapers (Medium)", defaultUomId: "uom-pack", perishable: false, reorderPoint: 8, reorderQty: 20 },
  { id: "item-soap", category: "Hygiene", name: "Bath Soap", defaultUomId: "uom-pc", perishable: false, reorderPoint: 15, reorderQty: 30 },
  { id: "item-detergent", category: "Household", name: "Laundry Detergent", defaultUomId: "uom-pack", perishable: false, reorderPoint: 4, reorderQty: 10 },
];

const donorIdPool = Array.from({ length: 15 }).map((_, i) => `donor-${i + 1}`);

export const inventoryLots: InventoryLot[] = inventoryItems.flatMap((item, itemIdx) =>
  Array.from({ length: rng.int(2, 4) }).map((_, i) => {
    const expiryOffset = item.perishable ? rng.int(-3, 65) : undefined;
    return {
      id: `lot-${item.id}-${i}`,
      itemId: item.id,
      quantity: rng.int(3, 60),
      uomId: item.defaultUomId,
      expiryDate: item.perishable ? rng.daysFromNow(expiryOffset!) : undefined,
      storageLocationId: bins[(itemIdx + i) % bins.length].id,
      sourceDonorId: rng.bool(0.7) ? rng.pick(donorIdPool) : undefined,
      unitCost: rng.int(15, 900),
      receivedAt: rng.daysFromNow(-rng.int(1, 40)),
    };
  })
);

export const inventoryTxns: InventoryTxn[] = inventoryLots.flatMap((lot) => {
  const txns: InventoryTxn[] = [
    {
      id: `txn-${lot.id}-receive`,
      lotId: lot.id,
      itemId: lot.itemId,
      type: "receive",
      quantity: lot.quantity,
      date: lot.receivedAt,
      performedBy: "Margielyn Formento",
    },
  ];
  if (rng.bool(0.5)) {
    txns.push({
      id: `txn-${lot.id}-issue`,
      lotId: lot.id,
      itemId: lot.itemId,
      type: "issue",
      quantity: rng.int(1, Math.max(1, Math.floor(lot.quantity / 3))),
      date: rng.daysFromNow(-rng.int(0, 10)),
      reason: "Meal service",
      performedBy: "Jonalie Mapesos",
    });
  }
  if (rng.bool(0.15)) {
    txns.push({
      id: `txn-${lot.id}-waste`,
      lotId: lot.id,
      itemId: lot.itemId,
      type: "waste",
      quantity: rng.int(1, Math.max(1, Math.floor(lot.quantity / 5))),
      date: rng.daysFromNow(-rng.int(0, 8)),
      reason: rng.pick(["Spoiled before use", "Damaged in storage", "Past expiry"]),
      performedBy: "Margielyn Formento",
    });
  }
  return txns;
});
