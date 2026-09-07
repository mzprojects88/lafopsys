-- Two per-person access settings, both admin-only.
--
-- clock_in_exempt: the clock-in gate (components/layout/clock-in-gate.tsx)
-- decides by ROLE -- every lafopsys role is gated, the four inventory roles
-- are not until an org-wide switch is flipped. There has never been a way to
-- say "this one person does not clock in", so the CEO has been redirected to
-- /staff and held by a non-dismissable dialog like everyone else.
--
-- landing_path: where a person goes after signing in. Today that is the
-- literal "/dashboard" for everyone (components/modules/auth/login-form.tsx).
-- The CEO's first screen is meant to be the financial summary, not a
-- dashboard built for house operations. Kept as a plain path rather than a
-- page id so it can point at any route the person's role can see; the app
-- validates it against the visible navigation before honouring it, so a
-- typo or a page that has not shipped yet falls back to the role default.
--
-- Both are PRIVILEGED. They are deliberately not added to 0025's column
-- grant (authenticated keeps only the profile columns), and the guard trigger
-- is extended so that even if that grant were ever widened, a person still
-- could not exempt themselves or pick their own landing page. Written only
-- through app/(app)/settings/users/actions.ts with the service role.

alter table shared.staff
  add column clock_in_exempt boolean not null default false,
  add column landing_path text
    check (landing_path is null or landing_path ~ '^/[a-z0-9-]+(/[a-z0-9-]+)*$');

create or replace function shared.guard_staff_privileged_columns()
returns trigger
language plpgsql
as $$
begin
  if current_user = 'authenticated'
     and (
       new.id is distinct from old.id
       or new.role is distinct from old.role
       or new.active is distinct from old.active
       or new.staff_code is distinct from old.staff_code
       or new.position is distinct from old.position
       or new.hire_date is distinct from old.hire_date
       or new.clock_in_exempt is distinct from old.clock_in_exempt
       or new.landing_path is distinct from old.landing_path
     )
     and coalesce(shared.current_staff_role(), '') <> 'admin' then
    raise exception 'Only admins can change staff role, status, code, or access settings'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- The CEO. Idempotent, and a no-op on a database without that account. The
-- other admin account (Super Admin) is left as it was: these are per-person
-- settings, not a change to what "admin" means.
update shared.staff
set clock_in_exempt = true,
    landing_path = '/executive'
where staff_code = 'butch.bustamante';
