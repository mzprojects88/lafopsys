import { redirect } from "next/navigation";

// The report generator is the Reports landing page now (Nov 2026): old links land there.
export default function GenerateRedirect() {
  redirect("/reports");
}
