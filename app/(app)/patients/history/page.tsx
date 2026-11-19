import { HistoryLedger } from "@/components/modules/patients/history-ledger";

/** Patients > History (0167): past nights, beds, meals and rides, entered after the fact. */
export default function PatientsHistoryPage() {
  return <HistoryLedger mode="patients" />;
}
