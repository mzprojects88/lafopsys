"use client";

import { toast } from "sonner";
import { PageHeader } from "@/components/patterns/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { reportDefinitions } from "@/lib/mock-data";

export default function SchedulePage() {
  return (
    <div className="flex max-w-xl flex-1 flex-col gap-6">
      <PageHeader title="Scheduled Delivery" description="Configure recurring email delivery for a report." />
      <Card>
        <CardContent className="pt-6">
          <FieldGroup>
            <Field>
              <FieldLabel>Report</FieldLabel>
              <Select defaultValue={reportDefinitions[0].id}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {reportDefinitions.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Frequency</FieldLabel>
              <Select defaultValue="monthly">
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="annual">Annual</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="recipients">Recipients</FieldLabel>
              <FieldDescription>Comma-separated email addresses.</FieldDescription>
              <Input id="recipients" defaultValue="board@littlearkfoundation.org, finance@littlearkfoundation.org" />
            </Field>
            <div className="flex justify-end pt-2">
              <Button onClick={() => toast.success("Delivery schedule saved")}>Save Schedule</Button>
            </div>
          </FieldGroup>
        </CardContent>
      </Card>
    </div>
  );
}
