/** Where the LAF Inventory app lives. Everything that *changes* stock --
 * scanning, receiving, drawing, waste, counts -- happens there; this app only
 * reads inventory's published views. Override per environment with
 * NEXT_PUBLIC_INVENTORY_APP_URL (e.g. a preview deployment). */
export const INVENTORY_APP_URL = (process.env.NEXT_PUBLIC_INVENTORY_APP_URL ?? "https://lafinventory.vercel.app").replace(/\/$/, "");

export function inventoryAppHref(path: string): string {
  return `${INVENTORY_APP_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
