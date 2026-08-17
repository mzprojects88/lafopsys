# LAF Operating System — Project Details

**For:** Development team onboarding / handoff
**Owner:** Little Ark Foundation (LAF)
**Repo:** `mzprojects88/lafopsys`
**Purpose of this document:** a single reference describing what this system is, what it does, how it's built, every screen and navigation path, and the key process flows — so a new developer can get oriented without reading the full commit history.

---

## 1. What this project is

The **LAF Operating System** is an internal operations platform for the **Little Ark Foundation**, a nonprofit that houses pediatric patients (mostly childhood cancer/thalassemia patients referred by partner hospitals) while they undergo treatment, alongside a family carer.

It has two audiences, served by two separate portals in the same codebase:

1. **Internal Operations System** (`/dashboard`, `/patients`, `/house-ops`, `/donors`, `/inventory`, `/finance`, `/analytics`, `/reports`, `/staff`, `/settings`) — used by LAF's own staff (admins, social workers, house staff, drivers, finance, board members, volunteers) to run the house day-to-day: admissions, bed management, donations, inventory, finances, HR/time tracking, and reporting.
2. **Partner Hospital Portal** (`/partners/*`) — a separate, hospital-facing portal used by nurses at partner hospitals (currently National Children's Hospital) to submit patient referrals, track their patients' status at LAF House, log follow-up hospital visits, and see partnership analytics — without any access to LAF's internal operational data (finance, inventory, other hospitals' patients, etc).

**Current build stage:** this is a **frontend prototype** — there is no backend/database yet. See [§4 Data & persistence model](#4-data--persistence-model) for how state currently works and what a backend would need to replace.

---

## 2. Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS v4 |
| Components | shadcn/ui (Radix UI primitives) |
| Forms | react-hook-form + zod validation |
| Tables | @tanstack/react-table (`DataTable` pattern) |
| Charts | Recharts (via a shared `ChartContainer` wrapper) |
| Icons | lucide-react |
| Toasts | sonner |
| Theming | next-themes (light/dark) |
| State/persistence (prototype only) | React Context + `localStorage`-backed mock collections (no server, no database) |

Scripts (`package.json`):
- `npm run dev` — local dev server (runs `predev` sync script first, see §4)
- `npm run build` / `npm run start` — production build/serve
- `npm run lint` — ESLint

---

## 3. High-level architecture

```
app/
  (app)/          → internal operations system, behind RoleProvider + ClockInGate
  (auth)/login/    → internal staff login
  (public)/impact/ → public-facing impact page (no auth)
  partners/        → Partner Hospital Portal, behind HospitalAuthProvider + HospitalAuthGate
components/
  layout/          → shells, sidebar, topbar, gates, command palette
  modules/         → feature-specific components (house-ops, patients, etc.)
  patterns/        → reusable page-building blocks (PageHeader, KpiCard, DataTable, StatusBadge, EntityDetailHeader, EmptyState...)
  ui/              → shadcn primitives (button, card, dialog, table, etc.)
context/           → React Context providers (role, hospital auth, theme)
lib/
  types/           → TypeScript domain model (one file per domain)
  mock-data/       → seed data for every entity (real data merged in where available)
  hooks/           → shared data hooks (usePatientsData, useClockStatus, etc.)
  rbac/            → role-based nav visibility rules
  store/           → localStorage-backed mock persistence layer
  utils/           → formatting, date, status-color helpers
scripts/           → data-cleaning (Python) and git-safe data-sync (Node) scripts
DATA/ (outside git) → source spreadsheets + cleaned JSON output
```

### Two independent auth/session systems
- **Internal:** `RoleProvider` (`context/role-provider.tsx`) — no real authentication; a demo "role switcher" lets any of 7 roles be selected, stored in `localStorage` (`laf-active-role`, `laf-active-user`). Every internal page is gated by role via `lib/rbac/roles.ts`.
- **Partner Portal:** `HospitalAuthProvider` (`context/hospital-auth-provider.tsx`) — a fully separate demo login (hospital → nurse dropdown + PIN, unvalidated), session stored under `laf-hospital-session`. Completely independent of the internal `RoleProvider` — a hospital nurse has no visibility into or connection to the internal role system.

These two systems never overlap: a partner-portal session cannot reach `/dashboard`, `/finance`, etc., and an internal staff session cannot reach `/partners/*` (there's a cross-link between the two login pages for convenience only).

---

## 4. Data & persistence model

**There is no backend or database yet.** All "data" is:

1. **Seed arrays** in `lib/mock-data/*.ts`, typed against `lib/types/*.ts` interfaces — this is the schema the eventual backend should implement.
2. Made "live" in the browser via `useLocalCollection<T>(key, seed)` (`lib/store/use-mock-store.ts`) — reads/writes a JSON copy of the array to `localStorage` under `laf-mock-store:<key>`. This means actions like "approve a referral," "clock out," "log a visit," or "admit a patient" persist across navigation and refresh **within one browser**, but are invisible to any other browser/device and reset if `localStorage` is cleared. `resetAllMockData()` wipes all of it back to seed.
3. Real patient/donor data (from actual LAF spreadsheets) is merged into the seed arrays where available — see below.

### Real-data pipeline (patients & donors)

Actual Little Ark Foundation records (from `LAF PROGRAMS 2026.xlsx`, National Children's Hospital-sourced) were cleaned and merged in, while keeping raw PII **out of git**:

1. `scripts/clean-real-data.py` (Python + openpyxl) parses the source spreadsheet into clean JSON at `DATA/clean/*.json` — a sibling directory to the repo, **not tracked in git**. Handles ID-collision guards (e.g. "ALL"/"AML" diagnosis abbreviations) and diagnosis-category heuristics, and reports any ambiguous rows for manual review rather than guessing.
2. `scripts/sync-real-data.mjs` (Node) copies `DATA/clean/*.json` into `lib/mock-data/real/` inside the repo — a directory that **is** git-ignored (`.gitignore` → `/lib/mock-data/real/`). This runs automatically via the `predev`/`prebuild` npm hooks, so Next.js can statically import it, but it never gets committed. If the source data is absent, the sync script falls back to empty-array placeholders so the app still builds.
3. `lib/mock-data/patients.ts` and `lib/mock-data/donors.ts` import from `./real/patients.json`, `./real/carers.json`, `./real/donors.json`, `./real/donations.json` and map them onto the typed `Patient`/`Carer`/`Donor`/`Donation` interfaces, with `??` fallbacks for any field the real data doesn't have (never fabricated). `lib/mock-data/reference-data.ts` also merges in real provinces/diagnoses/treatment-phases discovered in the source data.
4. Everything downstream of patients/donors (stays, referrals, appointments, campaigns, receipts, certificates) is still **synthetic**, but generated so it's consistent with the real people (e.g. stay records reference real patient IDs).

**Rule for this repo: real patient/donor PII must never be committed.** Always verify with `git status --short | grep "real/"` (should be empty) before any commit.

### Shared live-data hook

`usePatientsData()` (`lib/hooks/use-patients-collection.ts`) bundles `patients`, `carers`, `stays`, and `appointments` as one set of `useLocalCollection` calls, plus `addPatient`/`addCarer`/`addStay`/`addAppointment`/`updatePatient`/`updateStay`. This is the **single source of truth** used by every page that reads or writes patient-related data — both internal and partner-portal pages import it, so a new admission or a doctor-logged visit shows up everywhere immediately (see §6 for why this mattered).

---

## 5. Internal Operations System — modules & navigation

Sidebar nav (`lib/rbac/roles.ts` → `NAV_ITEMS`), filtered per role:

| Nav item | Route | Roles allowed |
|---|---|---|
| Dashboard | `/dashboard` | all |
| Staff & Time | `/staff` | all |
| Patients & Admissions | `/patients` | admin, social_worker |
| House Operations | `/house-ops` | admin, social_worker, house_staff, driver |
| Donors & Donations | `/donors` | admin, finance |
| Inventory | `/inventory` | admin, house_staff, finance |
| Financial | `/finance` | admin, finance, board |
| Analytics | `/analytics` | all |
| Reports | `/reports` | admin, finance, board |
| Settings | `/settings` | admin only |

**Roles:** `admin`, `social_worker`, `house_staff`, `driver`, `finance`, `board`, `volunteer` (`lib/types/common.ts`). Finance and Board roles never see clinical detail (`canSeeClinicalDetail()` gates this at the component level, e.g. diagnosis/carer info hidden on patient screens).

**Clock-in gate:** any staff role with a matching `Staff` record must clock in for the day (via `/staff`) before reaching any other internal screen — enforced by `ClockInGate` (`components/layout/clock-in-gate.tsx`), which redirects to `/staff` and toasts a reminder. Roles with no staff record (demo-only Board/Volunteer switch) are exempt.

### 5.1 Dashboard (`/dashboard`)
Landing page after login — role-aware KPI summary and quick links into the other modules.

### 5.2 Patients & Admissions (`/patients`)
The clinical/admissions core.

- **`/patients`** — full patient roster (`DataTable`), sourced from `usePatientsData()`.
- **`/patients/[patientId]`** — patient detail: demographics, diagnosis, carer, location (with graceful fallback to `rawAddress` when structured city/province is missing), photo-consent/isolation flags (3-state, since real data doesn't always have these), Tabs for Overview / Stays / Appointments / Documents (Documents & full clinical detail hidden from Finance/Board).
- **`/patients/today`** — today's operational snapshot (check-ins/outs, tasks).
- **`/patients/waitlist`** — patients awaiting a bed; "Approve" action.
- **`/patients/referrals`** — referral pipeline board across 5 statuses: `submitted → approved → waitlisted / declined`, plus `admitted`. Shows the referring hospital's name badge. Approved referrals get a **"Confirm Arrival & Admit"** action (see §6.1).
- **`/patients/referrals/new`** — internal-side new referral form.
- **`/patients/stays`** — Stay History: every stay record (past & present) across the house, i.e. "who has ever stayed at LAF House" — this was the feature that kicked off the current work.
- **`/patients/appointments`** — org-wide appointments calendar/list (chemo, check-up, other procedures), live via `usePatientsData()`.
- **`/patients/manifest`** — printable/exportable patient manifest.

### 5.3 House Operations (`/house-ops`)
Running the physical house.

- **`/house-ops`** — overview.
- **`/house-ops/floor-plan`** — visual bed/room map. Rooms → Units → Bed Positions (13 units / up to 52 bed positions). True occupancy is derived from active `Stay` records (`in_house`/`overdue` matched to `bedPositionId`) — **not** from the cosmetic, independently-set `Unit.status` field, which only reflects maintenance/blocked state.
- **`/house-ops/activity-center`** — patient activity/program sessions log.
- **`/house-ops/care-cart`** — volunteer care-cart visit logging.
- **`/house-ops/meals`** — meal service logging (breakfast/lunch/dinner).
- **`/house-ops/trips`** — transportation trip log (to/from hospital, errands), tracks passenger patient IDs — this feeds the "Total Transportation Served" partner-portal metric (§5.9).

### 5.4 Donors & Donations (`/donors`)
- **`/donors`** — donor roster (real data), cash + in-kind donations.
- **`/donors/[donorId]`** — donor detail & donation history.
- **`/donors/intake`** — record a new donation.
- **`/donors/campaigns`** — fundraising campaigns.
- **`/donors/receipts`** — acknowledgment receipts (draft → issued → sent → acknowledged).
- **`/donors/donee-certs`** — donee certificates (PH BIR-style tax compliance workflow: requested → prepared → approved → released → filed).

### 5.5 Inventory (`/inventory`)
- **`/inventory`** — item catalog & stock levels.
- **`/inventory/[itemId]`** — item detail, lots, transactions.
- **`/inventory/scan`** — barcode/manual scan-based receive/issue.
- **`/inventory/locations`** — storage locations.
- **`/inventory/expiry`** — expiring-lot tracking.
- **`/inventory/waste`** — waste/write-off logging.

### 5.6 Financial (`/finance`)
- **`/finance`** — overview.
- **`/finance/entry`** — cash entry (inflow/outflow) recording.
- **`/finance/approvals`** — pending → approved/rejected approval queue.
- **`/finance/accounts`** — chart of accounts.
- **`/finance/registers`** — cash registers/ledgers.
- **`/finance/budget`** — budget lines by category.
- **`/finance/allocation`** — fund allocation across programs/entities (US 501(c)(3) vs PH SEC).
- **`/finance/cost-per-outcome`** — cost-per-outcome analysis (ties spend to patient/program outcomes).
- **`/finance/close`** — period close workflow.

### 5.7 Analytics (`/analytics`)
Org-wide analytics — patient demographics/outcomes, donations, inventory, financials — all roles can see this (scope of what's shown may vary by role's clinical-detail permission).

### 5.8 Reports (`/reports`)
- **`/reports`** — report list.
- **`/reports/builder`** — ad hoc report builder.
- **`/reports/documents`** — generated document records.
- **`/reports/schedule`** — scheduled report runs.

### 5.9 Staff (`/staff`)
- **`/staff`** — clock in/out (the gate destination), today's roster.
- **`/staff/roster`** — staff directory & scheduling.
- **`/staff/timesheets`** — timesheet review, flags (`on_time`/`late`/`early_out`/`missed_punch`).
- **`/staff/payroll-export`** — payroll export.
- **`/staff/volunteers`** — volunteer roster.

### 5.10 Settings (`/settings`) — admin only
- **`/settings`** — overview.
- **`/settings/users`** — user/staff account management.
- **`/settings/notifications`** — notification preferences.
- **`/settings/reference-data/[table]`** — CRUD over reference tables (provinces, cities, diagnoses, treatment phases, programs, units of measure).

### 5.11 Auth & public
- **`/login`** — internal staff login (demo, role-based), cross-links to `/partners/login`.
- **`/impact`** — public-facing impact/story page, no auth required.

### Shared UI infrastructure
- **Command palette** (⌘K-style, `components/layout/command-palette.tsx`) — searches across patients and donors; intentionally **not truncated** to a small slice, because the underlying search library (`cmdk`) only filters mounted items — at real data scale (169 patients / 242 donors) a truncated list broke search entirely for anything not in the first N.
- **Notification center**, **breadcrumbs**, **theme toggle** (light/dark), **role switcher** (demo role picker in the sidebar footer).

---

## 6. Partner Hospital Portal (`/partners/*`) — REMOVED 2026-08-18

Per an org decision during the real-backend wiring effort, hospitals no longer get direct system access at all: referrals now arrive as a hospital-maintained Google Sheet that LAF staff transcribe into `app/(app)/patients/referrals/new` themselves. The route tree, `HospitalAuthProvider`/`HospitalAuthGate`, and `PartnerTopbar` described below were deleted from the codebase. Section kept for historical context only — nothing below this line still exists.

A dedicated portal for partner hospitals (currently National Children's Hospital — "NCH") to manage their relationship with LAF House, without touching internal operational data. Built to digitize a workflow that was previously a shared Google Sheet: a hospital-assigned nurse logs in with a PIN, encodes patients being referred to LAF House, and tracks them through to admission.

**Auth:** `/partners/login` — Hospital → Nurse dependent dropdowns + PIN input (demo, unvalidated). Session (`hospitalId`, `hospitalName`, `nurseId`, `nurseName`) stored in `localStorage` under `laf-hospital-session` via `HospitalAuthProvider`. Gated by `HospitalAuthGate`, which redirects unauthenticated visitors to `/partners/login` (excluding the login route itself).

Nav (`components/layout/partner-topbar.tsx`): Dashboard · Patients · Referrals · New Referral · Analytics · Bed Availability, plus hospital/nurse identity and logout.

### 6.1 Dashboard (`/partners/page.tsx`)
- KPI row: Total Referred, Pending, Admitted (scoped to the logged-in hospital's own referrals).
- **LAF House Occupancy widget** (`HouseOccupancySummary`) — a compact 13-tile grid, one tile per bed **unit** (matching the real spreadsheet's 13-row structure, not the finer-grained 52 bed-position model used internally), color-coded available (green) / occupied (blue, shows occupant initials + "+N more" for multi-occupant units) / out-of-service (amber), with an "N of 13 beds available right now" header — so a hospital can check capacity without leaving the dashboard or navigating to the full Bed Availability page. True availability is derived from active `Stay` records, same rule as the internal floor plan.
- Recent Referrals list.

### 6.2 Patients Directory (`/partners/patients`, `/partners/patients/[patientId]`)
Every patient ever referred by this hospital, since the start of the partnership — not a new dataset, but the existing real `Patient` records scoped by `referringHospitalId`.
- **List**: Name, Age (guarded for missing birthdate), Sex, Diagnosis, Status, and a **Next Visit** column (soonest upcoming `Appointment`).
- **Detail**: Overview / Stays / Appointments / Carers tabs, plus a **"Log Next Visit"** action — a dialog (Date, Time, Clinic, Purpose: chemo cycle / follow-up check-up / lab work / transfusion / consult / other procedure, Needs Transport checkbox) that writes into the shared `appointments` collection via `usePatientsData()`, so it's visible immediately both here and on the internal `/patients/appointments` calendar.

### 6.3 Referrals (`/partners/referrals`, `/partners/referrals/new`)
- **List** — read-only view of this hospital's own referral submissions and their status.
- **New Referral** — intake form (patient demographics + carer details), submitted into the shared `referrals` collection with `hospitalId` and `submittedByNurseId` attached.

### 6.4 Analytics (`/partners/analytics`)
Partnership-specific analytics, scoped to this hospital's own patients/referrals only (explicitly excludes internal-only data like donations/inventory/financials):
- **Patient Overview** — Total Referred, Cancer/Thalassemia/Other split, age-bracket bar chart.
- **Treatment Outcomes** — Ongoing Treatment, Survived/Finished Treatment, Deceased.
- **Referral Funnel** — Submitted / Approved / Waitlisted / Declined / Admitted counts.
- **Impact Since the Partnership Began** — Total Days Stayed, Total Stays, Avg. Length of Stay, **Total Meals Served** (an explicitly-labeled estimate: `nights stayed × 3`, since no real per-patient meal data exists), **Total Transportation Served** (real, derived from trip records where this hospital's patients were passengers).

### 6.5 Bed Availability (`/partners/beds`)
KPI summary + the same live `FloorPlanBoard` used internally, read-only.

---

## 7. Key process flows

### 7.1 Referral → Admission (the core cross-portal workflow)
1. A hospital nurse submits a referral via `/partners/referrals/new` (or an internal social worker via `/patients/referrals/new`) — captures patient demographics, diagnosis, carer info, and (if from a hospital) `hospitalId`/`submittedByNurseId`. Status starts `submitted`.
2. An internal social worker/admin reviews it on `/patients/referrals`, moving it to `approved`, `waitlisted`, or `declined`.
3. When the patient physically arrives, LAF staff click **"Confirm Arrival & Admit"** on the approved referral. This opens `ConfirmArrivalDialog`, which:
   - Shows a bed picker with **true** current availability (derived from active `Stay` records, not the cosmetic `Unit.status`).
   - On confirm, creates a real `Patient` + `Carer` + `Stay` record (IDs prefixed `pt-hosp-*`/`carer-hosp-*`/`stay-hosp-*`), sets `referringHospitalId` on the new patient from the referral's `hospitalId`, and flips the referral's status to `admitted`.
4. From that point on, the patient shows up everywhere live: internal Patients roster, Stay History, House Operations floor plan, the referring hospital's own Patients Directory and Analytics — all because they share the one `usePatientsData()` live collection.

This models the real intake process: patient/carer details are encoded once by the hospital, then verified/confirmed as the patient actually arrives and is admitted for housing — not two disconnected records.

### 7.2 Doctor logs a follow-up visit
A hospital nurse opens a patient in `/partners/patients/[id]`, clicks "Log Next Visit," fills in date/time/clinic/purpose (chemo, check-up, or other procedure) and whether transport is needed. This writes an `Appointment` via the shared collection, and is immediately visible in three places: the patient's own Appointments tab (both portal and internal), the "Next Visit" column back on the Patients Directory list, and the internal org-wide `/patients/appointments` calendar.

### 7.3 Staff clock-in gating
Any staff member with a matching `Staff` record must clock in via `/staff` before they can reach any other internal page that day; `ClockInGate` enforces this on every route change and toasts a reminder if blocked. Clock-out happens on the same page in the evening; timesheet review/approval happens later on `/staff/timesheets`.

### 7.4 Donation → Acknowledgment → Donee Certificate
A donation is recorded on `/donors/intake` (cash or in-kind), linked to a `Donor`. An `AcknowledgmentReceipt` is generated (draft → issued → sent → acknowledged) on `/donors/receipts`. For qualifying donations, a `DoneeCertificate` (PH BIR-style compliance document) moves through requested → prepared → approved → released → filed on `/donors/donee-certs`.

### 7.5 Inventory receive/issue
Items are received or issued via `/inventory/scan` (barcode or manual), generating `InventoryTxn` records (`receive`/`issue`/`transfer`/`adjust`/`waste`) against `InventoryLot`s, which affect the item's current stock as shown on `/inventory` and `/inventory/[itemId]`.

### 7.6 Cash entry → Approval → Close
Cash movements are logged on `/finance/entry` as `CashEntry` records (inflow/outflow, tagged with a source), routed through `/finance/approvals` (pending → approved/rejected), and eventually locked in via the `/finance/close` period-close workflow.

---

## 8. Domain model summary

| File | Key entities |
|---|---|
| `lib/types/common.ts` | `Role`, `Entity` (US 501(c)(3) / PH SEC), `Currency`, `Address` |
| `lib/types/patient.ts` | `Patient`, `Carer`, `Referral` (+ `ReferralStatus`), `Stay` (+ `StayStatus`), `Appointment` |
| `lib/types/hospital.ts` | `Hospital`, `HospitalNurse` |
| `lib/types/house-ops.ts` | `Room`, `Unit` (+ `UnitStatus`), `BedPosition`, `Trip`, `MealService`, `CareCartLog`, `ActivitySession`, `CensusSnapshot` |
| `lib/types/donor.ts` | `Donor`, `Donation`, `AcknowledgmentReceipt`, `DoneeCertificate`, `Campaign` |
| `lib/types/inventory.ts` | `StorageLocation`, `InventoryItem`, `InventoryLot`, `InventoryTxn` |
| `lib/types/finance.ts` | `CashEntry`, `Account`, `BudgetLine` |
| `lib/types/staff.ts` | `Staff`, `Shift`, `TimeEntry`, `TimesheetApproval`, `Volunteer` |
| `lib/types/reference.ts` | `Province`, `City`, `Diagnosis`, `TreatmentPhase`, `Program`, `UnitOfMeasure` |
| `lib/types/reports.ts` | `ReportDefinition`, `DocumentRecord`, `MetricSnapshot`, `AppNotification` |

---

## 9. Known gaps / what a real backend needs to replace

- **No real backend or database** — everything is seed data + `localStorage`. A production build needs a real API/DB matching the `lib/types/*.ts` schema, real auth (both internal staff and partner-hospital nurse logins are currently unauthenticated demos), and multi-device/multi-user consistency (today, one browser's "approved" referral is invisible to a colleague on another machine).
- **Real data currently covers**: patients, carers, and donors/donations (from NCH spreadsheets), plus reference data (provinces, diagnoses, treatment phases) discovered in that source. Referrals, stays, appointments, house-ops logs (meals, trips, care-cart, activities), inventory, and finance are still synthetic/demo data layered on top of the real people.
- **"Total Meals Served"** on the partner analytics page is a labeled estimate (nights × 3), not real per-patient meal-service data — flagged in the UI itself rather than presented as exact.
- **A few real patient records have missing fields** (e.g. 1 missing `birthDate`, 12 missing `treatmentPhaseId`) — the UI is built to degrade gracefully (`—` fallbacks) rather than crash or fabricate values; a real backend should decide whether to require these going forward.
- **PIN-based hospital login is unvalidated** in the prototype — any PIN is accepted. Needs real credential validation before going live.

---

*Last updated to reflect the state of the repo as of the Stay History, real-data pipeline, and Partner Hospital Portal work (commit `559c89b`).*
