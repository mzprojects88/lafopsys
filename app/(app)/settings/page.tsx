import Link from "next/link";
import { Database, Users, Bell, RotateCcw } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { IconCircle } from "@/components/patterns/icon-circle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ResetDemoDataButton } from "@/components/modules/settings/reset-demo-data-button";

const REFERENCE_TABLES = [
  { slug: "provinces", label: "Provinces & Cities" },
  { slug: "diagnoses", label: "Diagnoses" },
  { slug: "treatment-phases", label: "Treatment Phases" },
  { slug: "programs", label: "Programs" },
  { slug: "units-of-measure", label: "Units of Measure" },
];

export default function SettingsPage() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Settings" description="Foundation & Access — auth, RBAC, reference data, and demo controls." />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex-row items-center gap-2 space-y-0">
            <IconCircle icon={Database} color="blue" size="sm" />
            <CardTitle className="text-sm">Reference Data</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5">
            {REFERENCE_TABLES.map((t) => (
              <Link key={t.slug} href={`/settings/reference-data/${t.slug}`} className="text-sm text-primary hover:underline">
                {t.label}
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center gap-2 space-y-0">
            <IconCircle icon={Users} color="purple" size="sm" />
            <CardTitle className="text-sm">Users & Roles</CardTitle>
          </CardHeader>
          <CardContent>
            <Link href="/settings/users" className="text-sm text-primary hover:underline">Manage users</Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center gap-2 space-y-0">
            <IconCircle icon={Bell} color="amber" size="sm" />
            <CardTitle className="text-sm">Notifications</CardTitle>
          </CardHeader>
          <CardContent>
            <Link href="/settings/notifications" className="text-sm text-primary hover:underline">Notification preferences</Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center gap-2 space-y-0">
            <IconCircle icon={RotateCcw} color="rose" size="sm" />
            <CardTitle className="text-sm">Demo Data</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              This prototype persists your edits to this browser only. Reset to restore the original seed data.
            </p>
            <ResetDemoDataButton />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
