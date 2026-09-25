"use client";

import * as React from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/patterns/page-header";
import { SectionCard } from "@/components/patterns/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/patterns/empty-state";
import { newId } from "@/lib/utils/id";

const METRICS = ["Bed Nights", "Meals Served", "Trips", "Care Cart Meals", "Donations (Cash)", "Donations (In-Kind)", "Program Expenses"];

interface SavedDefinition {
  id: string;
  name: string;
  period: string;
  metrics: string[];
}

export default function ReportBuilderPage() {
  const [name, setName] = React.useState("");
  const [period, setPeriod] = React.useState("monthly");
  const [metrics, setMetrics] = React.useState<string[]>([]);
  const [saved, setSaved] = React.useState<SavedDefinition[]>([]);

  function toggleMetric(m: string) {
    setMetrics((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));
  }

  function save() {
    if (!name.trim() || metrics.length === 0) {
      toast.error("Add a name and at least one metric");
      return;
    }
    setSaved((prev) => [{ id: newId("def"), name, period, metrics }, ...prev]);
    toast.success("Report definition saved");
    setName("");
    setMetrics([]);
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Report Builder" description="Configurable period and metric set, saved as a reusable definition." />

      <SectionCard title="New Definition" className="max-w-xl">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="name">Name</FieldLabel>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Grant Q3 Impact Snapshot" />
          </Field>
          <Field>
            <FieldLabel>Period</FieldLabel>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="quarterly">Quarterly</SelectItem>
                <SelectItem value="annual">Annual</SelectItem>
                <SelectItem value="custom">Custom Range</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>Metrics</FieldLabel>
            <div className="grid grid-cols-2 gap-2">
              {METRICS.map((m) => (
                <label key={m} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={metrics.includes(m)} onCheckedChange={() => toggleMetric(m)} />
                  {m}
                </label>
              ))}
            </div>
          </Field>
          <div className="flex justify-end pt-2">
            <Button onClick={save}>Save Definition</Button>
          </div>
        </FieldGroup>
      </SectionCard>

      <div className="flex flex-col gap-3">
        <h2 className="text-base font-medium text-foreground">Saved Definitions</h2>
        {saved.length === 0 ? (
          <EmptyState title="No saved definitions yet" description="Build one above to see it appear here." />
        ) : (
          <SectionCard flush>
            <ul className="divide-y divide-border">
              {saved.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-theme-sm">
                  <div className="flex min-w-0 flex-col">
                    <span className="font-medium text-foreground">{d.name}</span>
                    <span className="text-theme-xs text-muted-foreground">{d.period} · {d.metrics.join(", ")}</span>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => toast.success(`Generated ${d.name}`)}>
                    Run
                  </Button>
                </li>
              ))}
            </ul>
          </SectionCard>
        )}
      </div>
    </div>
  );
}
