"use client";

import * as React from "react";
import { use } from "react";
import { notFound } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/patterns/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/patterns/empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useReferenceTableData } from "@/lib/hooks/use-reference-table-collection";
import { useDiagnosesReferenceData, type DiagnosisCategory } from "@/lib/hooks/use-diagnoses-reference-collection";
import { unitsOfMeasure } from "@/lib/mock-data";

const SIMPLE_TABLES: Record<string, { label: string; table: string; idPrefix: string; metaColumn?: string; metaLabel?: string }> = {
  provinces: { label: "Provinces & Cities", table: "provinces", idPrefix: "prov", metaColumn: "region", metaLabel: "Region" },
  "treatment-phases": { label: "Treatment Phases", table: "treatment_phases", idPrefix: "phase" },
  programs: { label: "Programs", table: "programs", idPrefix: "prog", metaColumn: "description", metaLabel: "Description" },
};

const DIAGNOSIS_CATEGORIES: DiagnosisCategory[] = ["cancer", "thalassemia", "other"];

function SimpleReferenceTable({ config }: { config: (typeof SIMPLE_TABLES)[string] }) {
  const { rows, loading, addRow, deleteRow } = useReferenceTableData(config.table, config.idPrefix, config.metaColumn);
  const [name, setName] = React.useState("");
  const [meta, setMeta] = React.useState("");

  async function handleAdd() {
    if (!name.trim()) return;
    const result = await addRow(name.trim(), meta.trim() || undefined);
    if (result.ok) {
      toast.success("Added");
      setName("");
      setMeta("");
    } else {
      toast.error(result.error);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This removes it from the live database, not just this view.`)) return;
    const result = await deleteRow(id);
    toast[result.ok ? "success" : "error"](result.ok ? "Removed" : result.error);
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        <div className="flex gap-2">
          <Input
            placeholder={`New ${config.label.toLowerCase()} entry…`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
          {config.metaColumn && (
            <Input
              placeholder={config.metaLabel}
              value={meta}
              onChange={(e) => setMeta(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              className="max-w-48"
            />
          )}
          <Button onClick={handleAdd}><Plus />Add</Button>
        </div>

        {!loading && rows.length === 0 && <EmptyState title="No entries yet" description="Add the first one above." />}

        <div className="flex flex-col divide-y">
          {rows.map((row) => (
            <div key={row.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{row.name}</span>
                {row.meta && <Badge variant="secondary" className="text-[10px]">{row.meta}</Badge>}
              </div>
              <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(row.id, row.name)}>
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function DiagnosesTable() {
  const { rows, loading, addRow, deleteRow } = useDiagnosesReferenceData();
  const [name, setName] = React.useState("");
  const [category, setCategory] = React.useState<DiagnosisCategory>("other");

  async function handleAdd() {
    if (!name.trim()) return;
    const result = await addRow(name.trim(), category);
    if (result.ok) {
      toast.success("Added");
      setName("");
    } else {
      toast.error(result.error);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This removes it from the live database, not just this view.`)) return;
    const result = await deleteRow(id);
    toast[result.ok ? "success" : "error"](result.ok ? "Removed" : result.error);
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        <div className="flex gap-2">
          <Input
            placeholder="New diagnosis entry…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
          <Select value={category} onValueChange={(v) => setCategory(v as DiagnosisCategory)}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DIAGNOSIS_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={handleAdd}><Plus />Add</Button>
        </div>

        {!loading && rows.length === 0 && <EmptyState title="No entries yet" description="Add the first one above." />}

        <div className="flex flex-col divide-y">
          {rows.map((row) => (
            <div key={row.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{row.name}</span>
                <Badge variant="secondary" className="text-[10px]">{row.category}</Badge>
              </div>
              <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(row.id, row.name)}>
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function UnitsOfMeasureTable() {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        <p className="text-sm text-muted-foreground">
          Units of measure are owned and edited by the Inventory app, not lafopsys — shown here read-only for reference.
        </p>
        <div className="flex flex-col divide-y">
          {unitsOfMeasure.map((u) => (
            <div key={u.id} className="flex items-center justify-between gap-3 py-2.5">
              <span className="text-sm font-medium">{u.name} ({u.code})</span>
              {u.baseUnitCode && (
                <Badge variant="secondary" className="text-[10px]">= {u.conversionFactor} {u.baseUnitCode}</Badge>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

const TABLE_LABELS: Record<string, string> = {
  provinces: "Provinces & Cities",
  diagnoses: "Diagnoses",
  "treatment-phases": "Treatment Phases",
  programs: "Programs",
  "units-of-measure": "Units of Measure",
};

export default function ReferenceDataTablePage({ params }: { params: Promise<{ table: string }> }) {
  const { table } = use(params);
  const label = TABLE_LABELS[table];

  if (!label) notFound();

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title={label} description="Reference data used across modules — provinces, diagnoses, treatment phases, programs, UoM conversions." />
      {table === "diagnoses" ? (
        <DiagnosesTable />
      ) : table === "units-of-measure" ? (
        <UnitsOfMeasureTable />
      ) : (
        <SimpleReferenceTable config={SIMPLE_TABLES[table]} />
      )}
    </div>
  );
}
