import { PageHeader } from "@/components/patterns/page-header";
import { PatientsSubNav } from "@/components/modules/patients/patients-subnav";
import { IdCardsBulk } from "@/components/modules/patients/id-cards-bulk";

/** Patients > ID cards (0169): issue and print or download many children's Patient ID cards at once. */
export default function IdCardsPage() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="ID cards"
        description="Find the children, issue the cards they lack, then print or download their cards in one go. The design is set in Settings › Patient ID card."
        action={<PatientsSubNav except="/patients/id-cards" />}
      />
      <IdCardsBulk />
    </div>
  );
}
