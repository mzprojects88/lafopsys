import { TODAY_ISO } from "@/lib/utils/seeded-random";

/** Age is always computed from birth_date, never stored — see spec §M2. */
export function computeAge(birthDate: string, asOf: string = TODAY_ISO): number {
  const birth = new Date(birthDate);
  const ref = new Date(asOf);
  let age = ref.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = ref.getUTCMonth() - birth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && ref.getUTCDate() < birth.getUTCDate())) {
    age--;
  }
  return age;
}

export function ageBracket(age: number): string {
  if (age <= 1) return "0–1";
  if (age <= 5) return "2–5";
  if (age <= 9) return "6–9";
  if (age <= 12) return "10–12";
  if (age <= 15) return "13–15";
  return "16–18";
}
