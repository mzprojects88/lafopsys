export interface ReportDefinition {
  id: string;
  name: string;
  category: "DSWD" | "BIR" | "US 501(c)(3)" | "Board" | "Grant" | "Impact";
  description: string;
  lastGeneratedAt?: string;
  schedule?: "monthly" | "quarterly" | "annual" | "ad_hoc";
}

export interface DocumentRecord {
  id: string;
  title: string;
  category: "Policy" | "License" | "MOA" | "Determination Letter" | "Other";
  uploadedAt: string;
  uploadedBy: string;
}

export interface MetricSnapshot {
  date: string;
  bedNights: number;
  meals: number;
  trips: number;
  careCartMeals: number;
  activityParticipants: number;
  donationsYtd: number;
}

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
  kind: "expiry" | "approval" | "overdue" | "system";
}
