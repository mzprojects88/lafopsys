# Little Ark Foundation — Operations Management System
## Build Plan v2.0

**Date:** August 4, 2026
**Supersedes:** v1.0
**Change in v2:** System count and module boundaries defined; database sharing answered; feature breakdown per module; realtime architecture specified; bed-assignment rules formally deferred; build sequence reordered to match stated priorities (basics first).

---

## 1. The answer up front

**You are building ONE application with NINE modules on ONE database.**

Not seven systems. Your checklist — Inventory, Donors, Financial, Patients, Analytics, Operations, Reports — reads like seven products, but every one of them reads and writes the same handful of records. Splitting them into separate systems would mean typing the same event up to six times and reconciling it never.

Here is the proof, using one real line from your own In-kind Donations sheet:

> `WEEK 2 | 2026-01-08 | EVALYN LAXAMANA | EGG (30/TRAY) | FOOD | 3 | 285 | 855`

That single line is simultaneously:

| Read as | By module | Producing |
|---|---|---|
| A gift from a donor | Donors | Donor history, lifetime value, next-touch |
| A ₱855 non-cash inflow | Finance | Cashflow, program allocation, the 88% claim |
| 90 eggs, perishable | Inventory | Lot with expiry, cabinet location, stock level |
| Food consumed at meals | House Ops | Cost per meal, consumption rate, reorder trigger |
| A document obligation | Donors + Finance | Acknowledgment Receipt, Donee Cert |
| One row in a total | Analytics + Public | ₱1.66M YTD on the dashboard and website |

Six modules, one event, one record. **That is why it is one database.**

The only thing that gets physically separated is the public website — and only because it should never hold a connection that can reach a patient table.

---

## 2. System inventory — nine modules

Mapping your checklist to what actually gets built:

| # | Module | Your checklist item | Priority |
|---|---|---|---|
| **M0** | Foundation & Access | *(not listed — required by all)* | Sprint 0 |
| **M1** | Staff & Timekeeping | Operations Management System | **Basic — first** |
| **M2** | Patients & Admissions | Patients Tracking | **Basic** |
| **M3** | House Operations | Operations Management System | **Basic** |
| **M4** | Donors & Donations | Donors Masterlist and Tracking | **Basic** |
| **M5** | Inventory Management | Inventory Management | **Basic** |
| **M6** | Financial Tracking | Financial Tracking | **Basic** |
| **M7** | Analytics Dashboard | Analytics Dashboard | After M1–M6 |
| **M8** | Reports & Documentation | Reports and Documentations | After M7 |
| **P1** | Public Impact Feed | *(website summary)* | After M7 |

M7, M8 and P1 are **derived** — they compute from M1–M6 and own almost no data of their own. That is deliberate: it means the dashboard and the website can never disagree with operations, because they read the same tables.

---

## 3. Which modules share a database

**All nine share one PostgreSQL database.** One schema namespace, logical separation by table ownership, physical separation by nothing.

### Shared-entity map

Rows are core tables. `W` = writes, `R` = reads, `Ř` = reads aggregates only.

| Table | M1 Staff | M2 Patients | M3 House | M4 Donors | M5 Inv | M6 Finance | M7 Dash | M8 Rpts | P1 Public |
|---|---|---|---|---|---|---|---|---|---|
| `staff` | **W** | R | R | R | R | R | R | R | — |
| `time_entries` | **W** | — | R | — | — | R | R | R | — |
| `patients` | — | **W** | R | — | — | — | R | R | Ř |
| `carers` | — | **W** | R | — | — | — | R | R | — |
| `referrals` | — | **W** | R | — | — | — | R | R | Ř |
| `stays` | — | **W** | **W** | — | — | R | R | R | Ř |
| `bed_positions` | — | R | **W** | — | — | — | R | R | — |
| `appointments` | — | **W** | R | — | — | — | R | R | — |
| `trips` | R | R | **W** | — | — | R | R | R | Ř |
| `meal_services` | — | — | **W** | — | R | R | R | R | Ř |
| `donors` | — | — | — | **W** | R | R | R | R | — |
| `donations` | — | — | — | **W** | **W** | **W** | R | R | Ř |
| `acknowledgment_receipts` | — | — | — | **W** | — | R | R | R | — |
| `donee_certificates` | — | — | — | **W** | — | R | R | R | — |
| `inventory_items` | — | — | R | — | **W** | R | R | R | — |
| `inventory_lots` | — | — | R | R | **W** | R | R | R | — |
| `inventory_txns` | — | — | **W** | — | **W** | R | R | R | — |
| `storage_locations` | — | — | R | — | **W** | — | — | R | — |
| `cash_entries` | — | — | — | R | R | **W** | R | R | Ř |
| `expenses` | — | — | — | — | R | **W** | R | R | Ř |
| `programs` | — | — | R | R | R | **W** | R | R | Ř |
| `metric_snapshots` | — | — | — | — | — | — | **W** | R | R |
| `audit_log` | **W** | **W** | **W** | **W** | **W** | **W** | R | R | — |

**Read the `donations` row.** Four modules write to it. That is not a design smell — it is a single business event with four legitimate perspectives. Any architecture that gives each of them its own database turns that row into four rows that drift apart within a month.

### The one physical separation

```
┌───────────────────────────────┐      ┌────────────────────────────────┐
│  PUBLIC SITE                  │      │  OPS APP                       │
│  littlearkfoundation.org      │      │  app.littlearkfoundation.org   │
│  Marketing + Give Hope        │      │  All nine modules, RBAC        │
│  NO patient-table access      │      │  Full database access          │
└──────────────┬────────────────┘      └───────────────┬────────────────┘
               │                                       │
      GET /api/impact                                  │
      (aggregates only, cached)                        │
               │                                       │
               └───────────┬───────────────────────────┘
                           ▼
              ┌────────────────────────────┐
              │  PostgreSQL — ONE DATABASE │
              │  + metric_snapshots        │◄── the only table P1 reads
              └────────────────────────────┘
```

The public site queries exactly one table: `metric_snapshots`. It has no credential path to `patients`, `stays`, or `donors`. That constraint is enforced at the database role level, not in application code.

---

## 4. Realtime — what it actually means here

"Realtime" is four different things depending on the surface. Building all four the same way is expensive and pointless.

| Tier | Surface | Mechanism | Latency |
|---|---|---|---|
| **Live** | House census board, check-in/out, who's in the building | Postgres `LISTEN/NOTIFY` or Supabase Realtime channel | < 2 sec |
| **Near-live** | Analytics dashboard KPIs | Polling / SWR revalidate | 30–60 sec |
| **On-write** | Public website summary | ISR + on-demand revalidation webhook | < 60 sec after a change |
| **Scheduled** | Expiry alerts, reorder alerts, nightly census, monthly rollups | Vercel Cron | Daily / monthly |

**Do not put the public site on live subscriptions.** It defeats caching, costs money, and no donor needs sub-second bed-night counts. On-demand ISR revalidation gives you a site that is never more than a minute stale, at effectively zero cost.

**Do put the census board on live.** Two social workers and house staff need to see the same picture at the same time when someone checks in.

---

## 5. Module feature breakdown

### M0 — Foundation & Access *(Sprint 0, ~2 weeks)*

Not on your list, but nothing else ships without it.

- Email/password + magic-link auth; optional 2FA for Admin and Finance
- Role-based access control — 7 roles (§7)
- **Audit log on every write** to patients, stays, donations, cash entries
- File storage: receipts, donation photos, IDs, signed documents
- Notification engine: in-app, email, optional SMS for expiry and admission alerts
- Reference data: provinces, regions, diagnoses, treatment phases, programs, UoM + conversions
- PWA shell with offline write queue

---

### M1 — Staff & Timekeeping *(Sprint 1, ~1 week)* — **build first**

Smallest module, zero dependencies, immediate daily value. It also proves the stack end-to-end before anything sensitive touches it.

**Features**
- Clock in / clock out — mobile PWA, one tap
- Optional GPS stamp and/or shared kiosk mode at the house
- Shift scheduling; 24/7 roster for resident social workers and household support
- Break tracking
- Late / early-out / missed-punch flags
- Timesheet approval workflow with adjustment reason (adjustments are audit-logged)
- Overtime and rest-day calculation
- Payroll-ready export (CSV / XLSX)
- Volunteer sign-in — separate from staff, tracks hours, generates service certificates

**Why first:** you currently have zero timekeeping data anywhere. Nothing to migrate, nothing to reconcile, no clinical risk.

---

### M2 — Patients & Admissions *(Sprint 2, ~3 weeks)*

Your stated basics: *how many admitted, how many moving out, when, and hospital visit schedule for transport.*

**Patient master**
- Full record migrated from `FINAL_PATIENTS DATABASE`, preserving `PATIENT NUMBER` / CL number
- **Age computed from `birth_date`, never stored** — this permanently fixes the age-bracket error in the deck
- Normalized province + city (splits the current mixed `PROVINCE/CITY` column)
- Diagnosis and treatment phase as reference data, not free text
- Status: ongoing treatment / check-up / completed / expired / lost to follow-up / non-pedia
- Carers as separate records with an effective-dated relationship — because carers change between stays
- Document attachments: referral letter, IDs, consent forms
- Photo/media consent flag

**Referrals & admissions**
- NCH referral intake — date, referring person, department, urgency
- Approve / waitlist / decline, with reason captured
- **Waitlist** — currently invisible; the decline record is what makes unmet demand reportable to grantmakers
- Bed availability forecast against expected check-outs

**Check-in / check-out**
- Check in: assign bed position, record carer, expected check-out date, next appointment
- Check out: reason, destination, follow-up date
- Extend stay
- Transfer between beds mid-stay
- **Today board:** arrivals today, departures today, in-house now, overdue check-outs

**Appointments & transport scheduling**
- Appointment calendar per patient (the tracker's `Next Appointment` column becomes a real date field)
- **Daily transport manifest** — auto-generated from tomorrow's appointments: who needs a ride, what time, which direction
- Links directly into M3 trip logging

> **Bed rules deferred, bed *data* not deferred.** Per your instruction, no restriction logic in v1 — staff pick any open position. But the system still records `bed_position_id` on every assignment from day one. That costs nothing now and means that when rules arrive, you have months of real assignment history to write them against. Skipping the field would force a migration later.

---

### M3 — House Operations *(Sprint 2–3, ~3 weeks)*

**Bed & room management**
- 13 units across 3 rooms; each unit = double-deck = **4 sleeping positions**
- Visual floor-plan board matching the actual layout (B1–B13)
- Position-level assignment — required, since your data shows 19 nights exceeded 13 units, peaking at 19 patients
- Unit status: available / occupied / maintenance / blocked
- Shared-unit flag (no restriction enforced yet, just recorded)

**Meals**
- Auto-generated from who is in-house — breakfast, lunch, dinner
- Staff mark exceptions only, not every meal
- Replaces ~90 manual cell entries per day at current occupancy
- Consumption posts to inventory

**Transport**
- Trip log: direction, driver, vehicle, departure/return, passengers, odometer, fuel
- Passengers linked to stays — so "803 transported" becomes verifiable instead of an unreconciled number
- Fuel and maintenance cost flows to Finance

**Care Cart**
- Service log by time slot — 10:00 / 12:00 / 14:00 / **17:00 ER round (started Aug 3)**
- Meals served, food item, quantity, unit cost, source (LAF Pantry vs donation)
- Volunteer attribution

**Activity Center @ NCH**
- Session log: participants, hours, volunteers, facilitator

**Live census**
- Real-time board: in-house, units occupied, units shared, utilization
- Nightly `daily_census` snapshot for historical reporting

---

### M4 — Donors & Donations *(Sprint 3, ~3 weeks)*

**Donor masterlist**
- Unified from `In-kind Donations` (99 donors) + `DonorsVisitors Information` — currently two lists with no shared key
- Type: individual / corporate / foundation / government / anonymous
- Contact, address, **tax jurisdiction (US / PH)**, TIN
- Giving history, lifetime value, first and last gift, gift frequency
- Corporate parent grouping
- Visitor log — a visitor is a donor-relationship touchpoint, not a separate list

**Donation intake**
- Cash and in-kind in one flow
- **`receiving_entity` is mandatory: US 501(c)(3) or PH SEC entity.** A gift to one is not a gift to the other and the tax documents differ completely. Retrofitting this later means re-issuing receipts.
- In-kind: description, quantity, **UoM as a real field**, unit value, total value, valuation method
- In-kind intake **creates an inventory lot automatically** — one entry, not two
- Photo attachment
- Anonymous handling

> **UoM is the biggest data fix here.** Today "EGG (30/TRAY)" qty 3 means 90 eggs but reads as quantity 3. Until UoM is structured with a conversion table, nothing about food stock can be aggregated.

**Acknowledgment Receipt (AR)**
- Auto-generated on donation, sequential numbering
- States: `draft → issued → sent → acknowledged`
- Template per entity (US vs PH)
- PDF generation, email delivery, resend
- Outstanding-AR queue

**Donee Certificate**
- **Request → Prepared → Approved → Released → Filed** (you specified request and release explicitly)
- Sequential control numbering
- Linked to BIR registration 601-322-056-00000
- Released-date tracking and reissue history
- Pending-request queue with ageing

> Confirm exact AR and Donee Cert requirements with your own board before building templates — Marivic Fortes-Bartolome (CFO USA), Leah Uy-Vitalicio (CPA), and Rosemarie Dayupay (Treasurer) can settle the US and PH document rules definitively. Also confirm PCNC accreditation status, since it affects what deductibility you can promise PH donors.

**Campaigns**
- Group donations by appeal; track against target
- Supports the four Programs in Development (Farewell with Dignity, Paths to Hope, The Ark Circle, Compassion Fund)

---

### M5 — Inventory Management *(Sprint 4, ~4 weeks)*

Your requirement: *scan a barcode and know everything about the item, replenish it, track expiry, know which cabinet it's in.*

**Item catalog**
- Category, type, name, description, default UoM, perishable flag, shelf life
- Reorder point and reorder quantity
- Barcode(s) — an item can carry several (manufacturer + internal)

**⚠ The barcode/lot problem — you will hit this on day one**

A manufacturer barcode identifies an *item*, not a *batch*. Two trays of eggs received three weeks apart carry the same barcode and different expiry dates. **Scanning the pack barcode can never tell you when that specific pack expires.**

The solution:

1. **Item barcode** (GTIN/EAN, manufacturer) → identifies *what* it is. Works for packaged goods.
2. **Lot label** (internal QR, printed at intake) → identifies *this specific batch*: expiry, source donor, cabinet, unit cost.

At intake: scan the manufacturer barcode to identify the item → enter quantity, expiry, location → system prints a lot QR → sticker goes on the physical item.

For loose goods — "CHICKEN (WHOLE)", "RICE 25 KG", "CARROTS (0.8 KG)", which are a large share of your intake — there is no manufacturer barcode at all, so the internal lot label is the only identifier. A cheap thermal label printer (~₱3–5k) is the one hardware purchase this project needs. Phone cameras handle all scanning.

**Scan result screen** — scan any code and see:
- Item name, category, photo
- Total stock on hand across all lots
- Every lot: quantity, expiry, days remaining, storage location, source donor, unit cost
- Consumption rate and days of cover remaining
- Reorder status
- Full transaction history
- Actions: **Replenish** · **Issue** · **Move** · **Adjust** · **Mark waste**

**Storage locations — four levels, to cabinet granularity**
```
Site          → LAF House · NCH Center
  Room        → Pantry · Kitchen · Stockroom · Staff Room
    Unit      → Cabinet A · Fridge 1 · Freezer · Shelf Rack 2
      Bin     → Shelf 3 · Drawer 2
```
Every lot lives at a specific bin. Location is scannable too — scan a cabinet, see its contents.

**Expiry tracking & alerts**
- Per-lot expiry dates
- Alerts at **60 days / 30 days / 14 days** *(confirming this is what "2-1 month & 2 Weeks" means)*
- Daily cron; in-app + email digest
- Expiring-soon dashboard, sorted by urgency
- FEFO picking guidance — first expired, first out
- Waste log with reason, for donor reporting

> This is the single highest-value inventory feature. **463 of your 785 donation lines are FOOD, and the current sheet records no expiry date whatsoever.**

**Stock operations**
- Receive (from donation or purchase), issue to meals/Care Cart, transfer, cycle count, adjustment with reason
- Low-stock and reorder alerts
- Valuation report feeding Finance

---

### M6 — Financial Tracking *(Sprint 5, ~3 weeks)*

Your requirement: *all cashflow IN/OUT — donation, infusion, and other means.*

**Cashflow ledger — inflows**
- Cash donations (from M4)
- In-kind donations, valued (non-cash, tracked separately so they don't inflate cash position)
- **Capital infusion** — founder, board, related-party
- **Inter-entity transfers** — US 501(c)(3) → PH entity. This is a real, recurring money flow with tax implications and it appears nowhere in your current records.
- Grants
- Fundraising events
- Interest and other income

**Cashflow ledger — outflows**
- Program expenses tagged to: Housing · Meals · Care Cart · Transportation · Activities · Spiritual Care
- Payroll (feeds from M1 timesheets)
- Rent, utilities, vehicle and fuel, maintenance
- Administrative and operations
- Emergency assistance (Compassion Fund), burial assistance (Farewell with Dignity)

**Core features**
- Multi-entity: every entry belongs to US or PH entity
- Multi-currency: USD / PHP with rate-at-transaction
- Bank and cash-on-hand accounts with running balance
- Receipt upload and attachment
- Approval workflow above configurable thresholds
- **Program allocation on every expense** — this is what converts the website's "88% to programs / Housing 68.4% / Meals 25.3% / Care Cart 4.2% / Transport 2%" from an assertion into a computed, auditable figure
- **Cost per outcome**, computed: cost per bed night, per meal, per trip, per Care Cart meal
- Budget vs actual by program
- Monthly close checklist
- Runway calculation

**Document control** *(shared with M4)*
- AR register with sequential numbering and gap detection
- Donee Cert register — requested / released / pending, with ageing
- DSWD public solicitation reporting (permit `DSWD-SB-PSP-S-2026-000125`)

---

### M7 — Analytics Dashboard *(Sprint 6, ~2 weeks)*

Everything here is **derived**. It owns no operational data.

**Panel A — Enrolled Patients Overview** *(your slide, live)*
- Total enrolled · sex split · **age brackets computed from birth_date**
- Illness breakdown: cancer / thalassemia / other
- **Plus a status breakdown the current slide omits: ongoing, expired, lost to follow-up, non-pedia**

**Panel B — Accommodated Clients by Diagnosis** *(monthly, by illness)*

⚠ **Define this metric before building it.** The numbers on the current slide (Jan 162 / Feb 135 / Mar 195 cancer) track patient-*nights*, not patients — they match the daily tracker's monthly totals almost exactly. A donor reads "162 cancer patients in January" when the real figure is roughly 6 children per night. Recommendation: build both measures with an explicit toggle, and label them unambiguously. Baking the current wording into a live dashboard makes the ambiguity permanent.

**Panel C — Distribution by Province/Area**
- Choropleth map of the Philippines, live from normalized province data
- Top areas ranked
- Requires the province normalization in Phase 0 — today the column mixes "NCR" with "Manila" and "Muntinlupa"

**Panel D — Live House Census** *(new — not in the current deck)*
- In-house now · arrivals today · departures today
- Units occupied / shared · utilization %
- Average occupancy trend
- Overdue check-outs

**Panel E — Impact YTD** — the five headline metrics, live: bed nights, meals, trips, Care Cart meals, Activity Center participants, each with prior-year comparison

**Panel F — Donations & Inventory** — MTD/YTD value, cash vs in-kind, top donors, items expiring in 14/30/60 days, items below reorder point

**Panel G — Financial** — cashflow in/out by month, program allocation, cost per outcome, runway

Role-filtered: Board sees aggregates only, never clinical detail.

---

### M8 — Reports & Documentation *(Sprint 7, ~2 weeks)*

- **DSWD** — licensing and public solicitation reports
- **BIR** — donee certificate register, donation summary
- **US 501(c)(3)** — donor acknowledgment register, Form 990 support schedules
- **Board pack** — monthly, auto-assembled
- **Grant reports** — configurable period and metric set
- **Impact report** — the deck, generated rather than hand-built
- Ad-hoc report builder with saved definitions
- Scheduled email delivery
- Export: PDF · XLSX · CSV
- Document library: policies, licenses, MOAs, determination letter

---

### P1 — Public Impact Feed *(Sprint 8, ~1 week)*

- `GET /api/impact` — cached aggregate endpoint, reads `metric_snapshots` only
- Website impact block rendered from live data
- On-demand ISR revalidation triggered by writes
- Optional embeddable widget for partners
- **Retires the manual copy step that left the site showing first-half numbers labelled "live year-to-date"**

---

## 6. Data flow — how a donation moves through the system

```
      In-kind donation arrives at LAF House
                    │
                    ▼
       ┌────────────────────────┐
       │  M4 · Scan / enter     │
       │  donor, item, qty,     │
       │  UoM, value, expiry,   │
       │  entity (US/PH)        │
       └────────────┬───────────┘
                    │  ONE entry
      ┌─────────────┼─────────────┬──────────────┐
      ▼             ▼             ▼              ▼
 ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌───────────┐
 │ M4      │  │ M5       │  │ M6       │  │ M4        │
 │ donor   │  │ lot +    │  │ non-cash │  │ AR issued │
 │ history │  │ QR label │  │ inflow   │  │ Cert queue│
 └─────────┘  └────┬─────┘  └────┬─────┘  └───────────┘
                   │             │
                   ▼             ▼
            ┌──────────────┐  ┌──────────────┐
            │ M3 consumed  │  │ M6 cost per  │
            │ at meals     │─▶│ meal, program│
            └──────────────┘  │ allocation   │
                   │          └──────┬───────┘
                   ▼                 ▼
            ┌──────────────────────────────┐
            │ M7 dashboard → P1 website    │
            └──────────────────────────────┘
```

Staff touch it once. Six modules and the public website update themselves.

---

## 7. Roles

| Role | Who | Access |
|---|---|---|
| **Admin** | Butch Bustamante, Ana Del Mundo | Full |
| **Social Worker** | Queen Izell Spencer, Cathlyn Paglinawan | Patients, referrals, stays, check-in/out, appointments |
| **House Staff** | Margielyn Formento, Jonalie Mapesos | Check-in/out, meals, inventory issue/receive, own time |
| **Driver** | Christopher Fajardo | Trip log, transport manifest, own time |
| **Finance** | Desiree Loquinario + board finance | Donations, cashflow, expenses, AR, Donee Certs, reports |
| **Board** | Trustees | Read-only aggregate dashboards |
| **Volunteer** | Care Cart / Activity | Session sign-in, own hours |

**Two hard rules:**
1. Finance and Board see **no diagnoses, addresses, or birthdates**. Aggregates only. A treasurer has no operational need for a child's diagnosis.
2. Every write to `patients`, `stays`, `donations`, `cash_entries` is audit-logged — actor, timestamp, before/after.

---

## 8. Build sequence

Reordered to match your stated priority: basics first, rules later.

| Sprint | Module | Weeks | Ships |
|---|---|---|---|
| **0** | M0 Foundation + migration prep | 2 | Auth, RBAC, audit, PWA shell |
| **1** | M1 Staff & Timekeeping | 1 | Staff clock in/out live |
| **2** | M2 Patients & Admissions | 3 | Check-in/out, appointments, transport manifest |
| **3** | M3 House Operations | 3 | Beds, meals, trips, Care Cart, live census |
| **4** | M4 Donors & Donations | 3 | Donor masterlist, intake, AR, Donee Cert |
| **5** | M5 Inventory | 4 | Barcode, lots, cabinets, expiry alerts |
| **6** | M6 Finance | 3 | Cashflow in/out, program allocation |
| **7** | M7 Analytics | 2 | Live dashboard |
| **8** | M8 Reports + P1 Public | 3 | Report suite, live website feed |

**Total ≈ 24 weeks.** Every sprint ships something usable on its own.

**Data migration runs in parallel**, starting Sprint 0 and completing before Sprint 2 goes live:
- Deduplicate patients — resolve name drift ("Carpio, Kieth Xander" vs "…Xander Ero"); reconcile 169 database rows against ~219 tracker name strings
- Backfill `patient_number` into all 245 daily tracker sheets — the missing join key
- Normalize province/city; split carers from patient rows
- Reconstruct `stays` from 245 daily snapshots (flag ambiguities for human review — two patients show 151 nights across 6–8 month spans, which is certainly multiple stays, not one)
- Import 785 donation lines; parse UoM out of description strings
- Merge donor and visitor registers

**Run parallel with the spreadsheets for one month** after each of Sprints 2 and 3. A nightly diff job is how you discover the operating rules nobody has written down.

---

## 9. Explicitly deferred

Per your instruction — build the basics, refine later.

| Deferred | Why it's safe | What we still do now |
|---|---|---|
| Bed assignment restrictions | No rules confirmed yet | **Still record `bed_position_id` on every assignment.** Zero cost now, avoids a migration later, and generates the history the rules will be written from. |
| Isolation / infection-control blocking | Needs clinical sign-off | Add an `isolation_required` flag on patients, unenforced |
| Waitlist priority scoring | Needs admission criteria | Capture referrals and declines; score manually |
| Max length of stay | Undefined | Record `expected_checkout_at`; flag overdue, don't block |
| Room assignment by sex/age/illness | Undefined | Record room and position; report on patterns |
| Automated payroll | Out of scope | Timesheet export to whatever payroll runs today |

---

## 10. Open questions

**Blocking Sprint 3 (Donors)**
1. **"AR" — Acknowledgment Receipt or Accounts Receivable?** Position next to Donee Cert suggests the former; confirming.
2. Exact AR and Donee Cert templates required for each entity — needs board finance sign-off.
3. Does LAF hold PCNC accreditation? Affects what deductibility you can promise PH donors.

**Blocking Sprint 5 (Inventory)**
4. **Expiry alerts — is "2-1 month & 2 Weeks" three thresholds (60/30/14 days)?** Assumed yes.
5. Full list of storage locations — every cabinet, fridge, shelf at both LAF House and the NCH Center.
6. Approve the lot-label printer purchase (~₱3–5k thermal).

**Blocking Sprint 6 (Finance)**
7. Existing accounting system to reconcile with — QuickBooks, Xero, spreadsheet?
8. **What is "CAF"?** Appears in the REPORT tab (134/132/172/198/176/85, 897 YTD) and as "CAF – PATIENT / DATE" and "CAF – BILLABLE STAY" in the June sheet.
9. **What does "BILLABLE STAY" mean — is any portion of a stay charged to anyone?** This materially changes the Finance and Admissions modules.
10. How do US → PH entity transfers currently happen, and who records them?

**Blocking Sprint 7 (Analytics)**
11. **"Accommodated Clients by Diagnosis" — patient-nights or unique patients?** Recommend building both.
12. Is "true capacity 40 persons" a DSWD-licensed ceiling? If so it must be enforced, not just displayed.

**Non-blocking**
13. Ops app on a subdomain of the main site, or separate domain?
14. Is SMS notification needed, or is email plus in-app sufficient?
15. Photo/media consent — how is it obtained today?

---

## 11. Privacy — action needed regardless of this project

The system will hold, for 173+ children: names, birthdates, home addresses, diagnoses, treatment phases, and carer mobile numbers. Under the Philippine **Data Privacy Act of 2012 (RA 10173)**, health information is *sensitive personal information* with stricter handling requirements than ordinary personal data.

I'm not a lawyer and can't assess which thresholds apply to LAF specifically. What I'd raise:

- Confirm whether LAF has a designated Data Protection Officer and whether its processing systems are registered with the National Privacy Commission. A DSWD-licensed residential facility handling minors' health data sits squarely in the population these rules contemplate.
- **Audit the current spreadsheet exposure now.** `Copy_of_LAF_PROGRAMS_2026.xlsx` contains 169 children's names, addresses, diagnoses, and carer phone numbers, in a file whose name indicates it has been copied and shared. That is a live exposure today, independent of this build.
- Choose a database region deliberately — check whether your provider offers Singapore or Asia-Pacific.
- Build consent capture into intake, especially given active social media posting (76 posts YTD).
- Set a retention policy, including handling for the 29 deceased patients' records.

---

## 12. Quick wins — no build required

1. **Correct the website impact block.** It's labelled "2026 YTD / live totals" but shows first-half figures. Housing reads 2,953 when the tracker supports ~3,592 through August 4.
2. **Fix the Care Cart growth figure.** 1,132 → 6,741 is a **495%** increase, not 472%. The other four percentages check out.
3. **Repair the REPORT tab TOTAL formulas** to include June, and re-verify the 803 transportation figure — it ties to neither the sheet total nor its components.

---

*v2.0 — prepared for review. Items 1, 4, 8 and 9 in §10 are the highest-value answers; they unblock three sprints between them.*
