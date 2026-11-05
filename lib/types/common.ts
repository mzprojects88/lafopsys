export type Role =
  | "admin"
  | "social_worker"
  | "house_staff"
  | "driver"
  | "finance"
  | "board"
  | "volunteer"
  | "chef"
  | "inventory_staff"
  | "inventory_lead"
  | "nutritionist"
  | "office_admin"
  | "ceo"
  /** An outside account (0090): not LAF staff. Opens the Inventory app to look, nothing here. */
  | "partner_viewer"
  /** A role an admin created in Settings > Roles & Access (0093): key "role-<name>". */
  | (string & {});

export const ROLES: { value: Role; label: string }[] = [
  // "admin" is the database name of the Super Admin (0073 kept it, to keep ~50 checks unchanged).
  { value: "admin", label: "Super Admin" },
  { value: "ceo", label: "CEO" },
  { value: "office_admin", label: "Office Admin" },
  { value: "social_worker", label: "Social Worker" },
  { value: "house_staff", label: "House Staff" },
  { value: "driver", label: "Driver" },
  { value: "finance", label: "Finance Staff" },
  { value: "board", label: "Board" },
  { value: "volunteer", label: "Volunteer" },
  { value: "chef", label: "Chef & Kitchen Staff" },
  { value: "inventory_staff", label: "Inventory Staff" },
  { value: "inventory_lead", label: "Inventory Lead" },
  { value: "nutritionist", label: "Nutritionist" },
  { value: "partner_viewer", label: "Partner viewer (outside)" },
];

export type Entity = "US_501C3" | "PH_SEC";

export const ENTITIES: { value: Entity; label: string }[] = [
  { value: "US_501C3", label: "US · 501(c)(3)" },
  { value: "PH_SEC", label: "PH · SEC" },
];

export type Currency = "USD" | "PHP";

export type LifecycleTone = "neutral" | "info" | "positive" | "warning" | "negative";

export interface Address {
  province: string;
  city: string;
}
