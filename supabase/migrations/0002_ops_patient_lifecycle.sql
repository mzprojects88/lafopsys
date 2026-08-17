-- Phase 0/1: ops.* tables backing the patient check-in/check-out flagship.
-- Field-for-field mirror of lib/types/patient.ts, lib/types/house-ops.ts,
-- lib/types/hospital.ts, lib/types/reference.ts so the app-layer types need
-- no reshaping once wired to real queries -- only naming convention changes
-- (camelCase -> snake_case, handled at the query-mapping layer, not here).

-- ---------- reference / lookup tables ----------

create table ops.provinces (
  id text primary key,
  name text not null,
  region text
);

create table ops.cities (
  id text primary key,
  province_id text not null references ops.provinces (id),
  name text not null
);

create table ops.diagnoses (
  id text primary key,
  name text not null,
  category text not null check (category in ('cancer', 'thalassemia', 'other'))
);

create table ops.treatment_phases (
  id text primary key,
  name text not null
);

create table ops.hospitals (
  id text primary key,
  name text not null,
  code text not null unique,
  address text
);

create table ops.hospital_nurses (
  id text primary key,
  hospital_id text not null references ops.hospitals (id),
  first_name text not null,
  last_name text not null,
  position text,
  active boolean not null default true
);

-- ---------- house structure ----------

create table ops.rooms (
  id text primary key,
  name text not null
);

create table ops.units (
  id text primary key,
  code text not null unique, -- B1..B13
  room_id text not null references ops.rooms (id),
  status text not null check (status in ('available', 'occupied', 'maintenance', 'blocked')),
  shared_unit boolean not null default false
);

create table ops.bed_positions (
  id text primary key,
  unit_id text not null references ops.units (id),
  label text not null check (label in ('A', 'B', 'C', 'D')),
  unique (unit_id, label)
);

-- ---------- patient lifecycle ----------

create table ops.patients (
  id uuid primary key default gen_random_uuid(),
  patient_number text not null unique,
  first_name text not null,
  last_name text not null,
  birth_date date,
  sex text not null check (sex in ('M', 'F')),
  province_id text references ops.provinces (id),
  city_id text references ops.cities (id),
  raw_address text,
  treatment_phase_id text references ops.treatment_phases (id),
  status text not null check (status in ('ongoing', 'check_up', 'completed', 'expired', 'lost_to_follow_up', 'non_pedia')),
  isolation_required boolean, -- null = unknown, not "no" -- see Patient.isolationRequired's comment in lib/types/patient.ts
  photo_consent_granted boolean, -- null = unknown, not "not granted"
  admitted_at date not null,
  marital_status text,
  remarks text,
  referring_hospital_id text references ops.hospitals (id),
  -- DSWD Caseload Inventory fields, real data migrated in integrate.md Step 2 --
  -- undefined/null means no DSWD-sheet match was found, not fabricated.
  religion text,
  sector_case_category text,
  place_of_birth text,
  illness_type text,
  source_of_referral_text text,
  reason_for_referral text,
  social_profile_of_parent text,
  services_received text,
  death_info text,
  length_of_stay text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ops.patient_diagnoses (
  patient_id uuid not null references ops.patients (id) on delete cascade,
  diagnosis_id text not null references ops.diagnoses (id),
  primary key (patient_id, diagnosis_id)
);

create table ops.carers (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references ops.patients (id) on delete cascade,
  name text not null,
  relationship text not null,
  mobile_number text,
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now()
);

create table ops.referrals (
  id uuid primary key default gen_random_uuid(),
  -- basic fields present on every referral regardless of source
  patient_name text not null,
  referring_person text not null,
  department text not null,
  urgency text not null check (urgency in ('routine', 'urgent', 'emergency')),
  date date not null default current_date,
  status text not null check (status in ('submitted', 'approved', 'waitlisted', 'declined', 'admitted')) default 'submitted',
  reason text,
  hospital_id text references ops.hospitals (id),
  submitted_by_staff_id uuid references shared.staff (id), -- who transcribed this from the hospital's sheet
  -- rich intake fields (per the Phase 1 redesign: staff now captures the full
  -- set at referral time, since there's no hospital self-service form anymore)
  patient_first_name text,
  patient_last_name text,
  patient_birth_date date,
  patient_sex text check (patient_sex in ('M', 'F')),
  treatment_phase_id text references ops.treatment_phases (id),
  province_id text references ops.provinces (id),
  raw_address text,
  carer_name text,
  carer_relationship text,
  carer_mobile text,
  next_appointment_note text, -- free text from the hospital sheet's "Next Appointment" column
  transcription_note text, -- e.g. "transcribed from hospital sheet on 2026-08-17 by Ana Del Mundo"
  admitted_patient_id uuid references ops.patients (id),
  admitted_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ops.referral_diagnoses (
  referral_id uuid not null references ops.referrals (id) on delete cascade,
  diagnosis_id text not null references ops.diagnoses (id),
  primary key (referral_id, diagnosis_id)
);

create table ops.stays (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references ops.patients (id) on delete cascade,
  bed_position_id text not null references ops.bed_positions (id),
  carer_id uuid references ops.carers (id),
  check_in_at date not null,
  expected_checkout_at date,
  check_out_at date,
  check_out_reason text,
  destination text,
  follow_up_date date,
  status text not null check (status in ('in_house', 'checked_out', 'overdue')) default 'in_house',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ops.appointments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references ops.patients (id) on delete cascade,
  date date not null,
  time text not null,
  clinic text not null,
  purpose text not null,
  needs_transport boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- admission document checklist (new, non-blocking per project decision) ----------
-- Replaces the patient-detail page's hardcoded empty "Documents" tab. Tracked
-- per patient, never gates Confirm Arrival & Admit. Actual files live in
-- Supabase Storage (bucket set up separately); this table is the checklist +
-- pointer to the stored file path.

create table ops.patient_documents (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references ops.patients (id) on delete cascade,
  document_type text not null check (
    document_type in ('parent_guardian_id', 'medical_certificate', 'signed_intake_form', 'patient_photo', 'photo_media_consent')
  ),
  storage_path text, -- null until actually uploaded
  collected_at timestamptz,
  collected_by_staff_id uuid references shared.staff (id),
  notes text,
  created_at timestamptz not null default now(),
  unique (patient_id, document_type)
);

-- updated_at triggers
create trigger set_updated_at before update on ops.patients for each row execute function shared.set_updated_at();
create trigger set_updated_at before update on ops.referrals for each row execute function shared.set_updated_at();
create trigger set_updated_at before update on ops.stays for each row execute function shared.set_updated_at();

-- ---------- indexes for the lookups the UI actually does ----------
create index on ops.carers (patient_id);
create index on ops.stays (patient_id);
create index on ops.stays (bed_position_id);
create index on ops.stays (status);
create index on ops.appointments (patient_id);
create index on ops.appointments (date);
create index on ops.referrals (status);
create index on ops.patient_documents (patient_id);

-- ---------- row level security ----------
-- Blanket "any authenticated staff can read/write" for Phase 0 -- matches
-- today's app behavior (no per-action RBAC exists yet, confirmed during
-- research: "any role that can reach the page can click the buttons that
-- exist"). Finance/Board's clinical-detail restriction (canSeeClinicalDetail)
-- is enforced at the UI layer today and stays that way for now; tightening
-- this to real column/row-level RLS is a later hardening pass, not Phase 0.

alter table ops.provinces enable row level security;
alter table ops.cities enable row level security;
alter table ops.diagnoses enable row level security;
alter table ops.treatment_phases enable row level security;
alter table ops.hospitals enable row level security;
alter table ops.hospital_nurses enable row level security;
alter table ops.rooms enable row level security;
alter table ops.units enable row level security;
alter table ops.bed_positions enable row level security;
alter table ops.patients enable row level security;
alter table ops.patient_diagnoses enable row level security;
alter table ops.carers enable row level security;
alter table ops.referrals enable row level security;
alter table ops.referral_diagnoses enable row level security;
alter table ops.stays enable row level security;
alter table ops.appointments enable row level security;
alter table ops.patient_documents enable row level security;

do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'provinces', 'cities', 'diagnoses', 'treatment_phases', 'hospitals', 'hospital_nurses',
      'rooms', 'units', 'bed_positions', 'patients', 'patient_diagnoses', 'carers',
      'referrals', 'referral_diagnoses', 'stays', 'appointments', 'patient_documents'
    ])
  loop
    execute format(
      'create policy "authenticated staff full access" on ops.%I for all to authenticated using (true) with check (true)',
      t
    );
  end loop;
end $$;
