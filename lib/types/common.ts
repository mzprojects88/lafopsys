export type Role =
  | "admin"
  | "social_worker"
  | "house_staff"
  | "driver"
  | "finance"
  | "board"
  | "volunteer";

export const ROLES: { value: Role; label: string; sampleUser: string }[] = [
  { value: "admin", label: "Admin", sampleUser: "Butch Bustamante" },
  { value: "social_worker", label: "Social Worker", sampleUser: "Queen Izell Spencer" },
  { value: "house_staff", label: "House Staff", sampleUser: "Margielyn Formento" },
  { value: "driver", label: "Driver", sampleUser: "Christopher Fajardo" },
  { value: "finance", label: "Finance", sampleUser: "Desiree Loquinario" },
  { value: "board", label: "Board", sampleUser: "Board Trustee" },
  { value: "volunteer", label: "Volunteer", sampleUser: "Care Cart Volunteer" },
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
