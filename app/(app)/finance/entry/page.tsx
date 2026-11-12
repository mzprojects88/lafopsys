import { redirect } from "next/navigation";

// New Cash Entry is retired (0147, user 12 Nov 2026): gifts come in through Donors and Inventory, and money goes out
// through Payment Requests, whose paid vouchers post to the books themselves. Old links land on a new request.
export default function FinanceEntryPage() {
  redirect("/requests/new");
}
