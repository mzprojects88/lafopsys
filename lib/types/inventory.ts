export interface StorageLocation {
  id: string;
  parentId?: string;
  level: "site" | "room" | "unit" | "bin";
  name: string;
}

export interface InventoryItem {
  id: string;
  category: "Food" | "Medical Supplies" | "Hygiene" | "Household" | "Other";
  name: string;
  defaultUomId: string;
  perishable: boolean;
  shelfLifeDays?: number;
  reorderPoint: number;
  reorderQty: number;
  barcode?: string;
}

export interface InventoryLot {
  id: string;
  itemId: string;
  quantity: number;
  uomId: string;
  expiryDate?: string;
  storageLocationId: string;
  sourceDonorId?: string;
  unitCost: number;
  receivedAt: string;
}

export type InventoryTxnType = "receive" | "issue" | "transfer" | "adjust" | "waste";

export interface InventoryTxn {
  id: string;
  lotId: string;
  itemId: string;
  type: InventoryTxnType;
  quantity: number;
  date: string;
  reason?: string;
  performedBy: string;
}
