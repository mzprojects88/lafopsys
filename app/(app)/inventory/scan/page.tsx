import { PageHeader } from "@/components/patterns/page-header";
import { ScanSimulator } from "@/components/modules/inventory/scan-simulator";

export default function ScanPage() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Scan Item" description="Scan any code to see full item detail." />
      <ScanSimulator />
    </div>
  );
}
