import { redirect } from "next/navigation";

/** The compliance tracker moved to its own menu (0044); old links and bookmarks land there. */
export default function HrCompliancePage() {
  redirect("/compliance");
}
