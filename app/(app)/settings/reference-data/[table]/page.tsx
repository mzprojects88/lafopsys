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
import {
  provinces,
  diagnoses,
  treatmentPhases,
  programs,
  unitsOfMeasure,
} from "@/lib/mock-data";
import { useLocalCollection } from "@/lib/store/use-mock-store";
import { newId } from "@/lib/utils/id";

interface Row {
  id: string;
  name: string;
  meta?: string;
}

const TABLES: Record<string, { label: string; seed: Row[] }> = {
  provinces: {
    label: "Provinces & Cities",
    seed: provinces.map((p) => ({ id: p.id, name: p.name, meta: p.region })),
  },
  diagnoses: {
    label: "Diagnoses",
    seed: diagnoses.map((d) => ({ id: d.id, name: d.name, meta: d.category })),
  },
  "treatment-phases": {
    label: "Treatment Phases",
    seed: treatmentPhases.map((t) => ({ id: t.id, name: t.name })),
  },
  programs: {
    label: "Programs",
    seed: programs.map((p) => ({ id: p.id, name: p.name, meta: p.description })),
  },
  "units-of-measure": {
    label: "Units of Measure",
    seed: unitsOfMeasure.map((u) => ({ id: u.id, name: `${u.name} (${u.code})`, meta: u.baseUnitCode ? `= ${u.conversionFactor} ${u.baseUnitCode}` : undefined })),
  },
};

export default function ReferenceDataTablePage({ params }: { params: Promise<{ table: string }> }) {
  const { table } = use(params);
  const config = TABLES[table];
  const [newName, setNewName] = React.useState("");

  if (!config) notFound();

  const { items, addItem, setItems } = useLocalCollection<Row>(`reference-${table}`, config.seed);

  function handleAdd() {
    if (!newName.trim()) return;
    addItem({ id: newId(`${table}-new`), name: newName.trim() });
    toast.success("Added");
    setNewName("");
  }

  function handleDelete(id: string) {
    setItems(items.filter((i) => i.id !== id));
    toast.success("Removed");
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title={config.label} description="Reference data used across modules — provinces, diagnoses, treatment phases, programs, UoM conversions." />

      <Card>
        <CardContent className="flex flex-col gap-3 pt-6">
          <div className="flex gap-2">
            <Input
              placeholder={`New ${config.label.toLowerCase()} entry…`}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            />
            <Button onClick={handleAdd}><Plus />Add</Button>
          </div>

          <div className="flex flex-col divide-y">
            {items.map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{row.name}</span>
                  {row.meta && <Badge variant="secondary" className="text-[10px]">{row.meta}</Badge>}
                </div>
                <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(row.id)}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
