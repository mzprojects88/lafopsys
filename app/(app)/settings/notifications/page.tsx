"use client";

import { toast } from "sonner";
import { PageHeader } from "@/components/patterns/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useNotificationPrefs } from "@/lib/hooks/use-notification-prefs";

const PREFS = [
  { id: "expiry", label: "Inventory expiry alerts", description: "60 / 30 / 14 day thresholds", defaultOn: true },
  { id: "approvals", label: "Approval requests", description: "Timesheets, referrals, finance entries", defaultOn: true },
  { id: "overdue", label: "Overdue check-outs", description: "Stays past expected checkout date", defaultOn: true },
  { id: "email-digest", label: "Daily email digest", description: "Summary of the day's alerts", defaultOn: false },
  { id: "sms", label: "SMS for admission alerts", description: "Optional — carrier charges may apply", defaultOn: false },
];

export default function NotificationSettingsPage() {
  const { prefs, loading, setPref } = useNotificationPrefs();

  return (
    <div className="flex max-w-xl flex-1 flex-col gap-6">
      <PageHeader title="Notification Preferences" description="Your on/off preferences, saved to your account. No email or SMS provider is connected yet — these control what would be sent once one is." />
      <Card>
        <CardContent className="flex flex-col divide-y pt-6">
          {PREFS.map((pref, i) => (
            <div key={pref.id} className={`flex items-center justify-between gap-4 py-3 ${i === 0 ? "pt-0" : ""}`}>
              <div className="flex flex-col">
                <span className="text-sm font-medium">{pref.label}</span>
                <span className="text-xs text-muted-foreground">{pref.description}</span>
              </div>
              <Switch
                disabled={loading}
                checked={prefs[pref.id] ?? pref.defaultOn}
                onCheckedChange={async (checked) => {
                  const result = await setPref(pref.id, checked);
                  toast[result.ok ? "success" : "error"](result.ok ? "Preference saved" : result.error);
                }}
              />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
