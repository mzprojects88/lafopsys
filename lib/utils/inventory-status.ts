/** StatusBadge "expiry" domain key for a lot, from its server-computed days_left
 * (inventory.v_expiring / v_lots_on_hand). Mirrors the 14/30/60 tiers the
 * inventory app itself uses. */
export function expiryStatus(daysLeft: number): "expired" | "soon14" | "soon30" | "soon60" | "fresh" {
  if (daysLeft < 0) return "expired";
  if (daysLeft <= 14) return "soon14";
  if (daysLeft <= 30) return "soon30";
  if (daysLeft <= 60) return "soon60";
  return "fresh";
}
