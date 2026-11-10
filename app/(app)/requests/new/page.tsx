"use client";

import { PageHeader } from "@/components/patterns/page-header";
import { RequestForm } from "@/components/modules/requests/request-form";

/** Payment Requests › New request (Step 1). */
export default function NewRequestPage() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="New payment request" description="Say what it is for and list the items. Finance codes it and the approvers sign it; you can follow it on its page." />
      <RequestForm />
    </div>
  );
}
