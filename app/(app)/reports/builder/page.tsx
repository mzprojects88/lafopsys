import { redirect } from "next/navigation";

/** The prototype's free-form report builder is replaced (Sprint 10, 0118): each report page has its
 * own filters, PDF and CSV, and Scheduled Delivery emails them. Old links land there. */
export default function ReportBuilderPage() {
  redirect("/reports/schedule");
}
