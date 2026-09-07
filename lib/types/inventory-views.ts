/**
 * The published interface laf-inventory exposes to this app (its migrations
 * 0019 + 0020, per LAF_Inventory_Build_Plan.md §5): read-only views over the
 * `inventory` schema, granted SELECT to every staff role. lafopsys never reads
 * inventory's tables directly -- the views are the contract, and a breaking
 * change to one ships as a `_v2` view rather than an edit in place.
 *
 * Column names are the views' own (snake_case) so a change on the inventory
 * side is a visible diff here rather than a silently broken mapper.
 */

export type StockStatus = "ok" | "low" | "out";

/** inventory.v_stock_summary -- one row per item per House. */
export interface StockSummaryRow {
  item_id: string;
  name: string;
  category: string;
  uom: string;
  house_id: string;
  on_hand_qty: number;
  stock_value: number;
  reorder_point: number;
  status: StockStatus;
}

/** inventory.v_expiring -- lots with stock on hand expiring within 60 days. */
export interface ExpiringLotRow {
  lot_id: string;
  item_id: string;
  name: string;
  house_id: string;
  storage_location_id: string;
  expiry_date: string;
  days_left: number;
  tier: 14 | 30 | 60;
  qty_remaining: number;
  value_at_risk: number;
}

/** inventory.v_lots_on_hand -- every lot with stock on hand, expiring or not. */
export interface LotOnHandRow {
  lot_id: string;
  item_id: string;
  name: string;
  uom: string;
  house_id: string;
  storage_location_id: string;
  expiry_date: string | null;
  days_left: number | null;
  qty_remaining: number;
  unit_cost: number;
  value: number;
  received_at: string;
  source_type: "donation" | "purchase";
  source_donor_id: string | null;
}

/** inventory.v_consumption_daily -- quantity drawn out per item per day per channel. */
export interface ConsumptionDailyRow {
  date: string;
  item_id: string;
  name: string;
  house_id: string;
  channel: "kitchen" | "care_cart" | "family" | null;
  qty_issued: number;
  cost: number;
}

/** inventory.v_waste -- one row per waste transaction. */
export interface WasteRow {
  transaction_id: string;
  date: string;
  item_id: string;
  name: string;
  house_id: string;
  reason: string | null;
  qty: number;
  value: number;
  source_donor_id: string | null;
  performed_by: string;
}

/** inventory.v_storage_locations -- the Site › Room › Unit › Bin tree with paths. */
export interface StorageLocationRow {
  id: string;
  parent_id: string | null;
  level: "site" | "room" | "unit" | "bin";
  name: string;
  code: string | null;
  house_id: string;
  path: string;
  depth: number;
}

/** inventory.v_donation_receipts -- inventory's own record of what it logged to finance. */
export interface DonationReceiptRow {
  id: string;
  donor_id: string | null;
  date: string;
  status: string;
  valuation_total: number;
  item_summary: string;
  notes: string | null;
  lots_count: number;
}

/** inventory.v_fixed_assets -- one row per fixed asset the foundation has
 * registered, disposed of or not. `value_on_books` is the acquisition value
 * for an asset still owned and 0 once it has been disposed of, so summing it
 * gives register value without re-deriving the rule here. */
export interface FixedAssetRow {
  asset_id: string;
  name: string;
  category: string;
  brand: string | null;
  manufacturer: string | null;
  description: string | null;
  serial_number: string | null;
  condition: "good" | "fair" | "needs_repair" | "retired";
  acquired_date: string;
  acquired_value: number;
  source_donor_id: string | null;
  storage_location_id: string;
  location_path: string | null;
  disposed_at: string | null;
  value_on_books: number;
  house_id: string;
  /** Years of useful life, or null for an asset that is deliberately not
   * depreciated -- book_value then equals what was paid for it. */
  useful_life_years: number | null;
  salvage_value: number;
  /** Straight-line book value as of today, computed by
   * inventory.asset_book_value() in the view (laf-inventory 0028) rather than
   * stored, so it is never stale. Zero once the asset has been disposed of. */
  book_value: number;
}

/** inventory.v_asset_disposals -- one row per asset that has left, with what
 * came back for it. `signed_off` is true only once both signatures are in. */
export interface AssetDisposalRow {
  disposal_id: string;
  asset_id: string;
  name: string;
  category: string;
  date: string;
  reason: string;
  proceeds: number;
  notes: string | null;
  acquired_value: number;
  recorded_by: string;
  sign_off_1: string | null;
  sign_off_2: string | null;
  signed_off: boolean;
}
