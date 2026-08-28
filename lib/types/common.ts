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
  | "nutritionist";

export const ROLES: { value: Role; label: string; sampleUser: string }[] = [
  { value: "admin", label: "Admin", sampleUser: "Butch Bustamante" },
  { value: "social_worker", label: "Social Worker", sampleUser: "Queen Izell Spencer" },
  { value: "house_staff", label: "House Staff", sampleUser: "Margielyn Formento" },
  { value: "driver", label: "Driver", sampleUser: "Christopher Fajardo" },
  { value: "finance", label: "Finance", sampleUser: "Desiree Loquinario" },
  { value: "board", label: "Board", sampleUser: "Board Trustee" },
  { value: "volunteer", label: "Volunteer", sampleUser: "Care Cart Volunteer" },
  { value: "chef", label: "Chef", sampleUser: "Jonalie Mapesos" },
  { value: "inventory_staff", label: "Inventory Staff", sampleUser: "Jeffrey Olfato" },
  { value: "inventory_lead", label: "Inventory Lead", sampleUser: "Desiree Candia Loquinario" },
  { value: "nutritionist", label: "Nutritionist", sampleUser: "Staff Nutritionist" },
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
