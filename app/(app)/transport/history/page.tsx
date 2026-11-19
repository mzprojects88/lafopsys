import { HistoryLedger } from "@/components/modules/patients/history-ledger";

/** Transport > Ride history (0167): the rides of past days between LAF House and NCH. */
export default function TransportHistoryPage() {
  return <HistoryLedger mode="transport" />;
}
