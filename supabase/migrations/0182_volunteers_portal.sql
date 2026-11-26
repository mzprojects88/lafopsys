-- 0182: Volunteers, step 2: the Volunteers Portal's accounts and sessions (owner, 26 Nov 2026; PLAN.md v2).
--
--   * One portal account per group, for the group's contact (its email). Staff issue a ONE-TIME PASSWORD from the
--     Volunteers page; it works once, for 72 hours, and the first thing the portal asks is a password of the
--     group's own. Issuing again resets the password (for a forgotten one) and ends every open session.
--   * Passwords are hashed by the ArkOS server (scrypt, salted); the one-time password and the session tokens are
--     kept only as SHA-256 hashes. None of these columns is readable by anyone signed in to ArkOS: staff see a
--     portal's status through booking.portal_status(), and issue or lock through definer functions that check
--     they keep volunteers.
--   * The portal reaches these tables only through the ArkOS server with the service key, like the public
--     booking pages. A volunteer never holds a database key.
--   * A request from the public page joins the group with that email but no longer changes the details of a
--     group that has a portal account (anyone may type an email address on a public form).

create table if not exists booking.portal_accounts (
  group_id uuid primary key references booking.groups (id) on delete cascade deferrable initially immediate,
  -- scrypt$N$r$p$salt$hash, made by the ArkOS server; empty until the group sets its own password.
  password_hash text check (password_hash is null or length(password_hash) <= 300),
  -- SHA-256 (hex) of the one-time password staff issued; single use, expires.
  otp_hash text check (otp_hash is null or otp_hash ~ '^[0-9a-f]{64}$'),
  otp_expires_at timestamptz,
  otp_used_at timestamptz,
  must_set_password boolean not null default true,
  locked boolean not null default false,
  issued_by uuid references shared.staff (id) deferrable initially immediate,
  issued_at timestamptz,
  password_set_at timestamptz,
  last_sign_in_at timestamptz,
  locked_by uuid references shared.staff (id) deferrable initially immediate,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table booking.portal_accounts is 'Volunteers Portal sign-in of a group (0182). Hashes only; read and written by the ArkOS server with the service key.';

create table if not exists booking.portal_sessions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references booking.groups (id) on delete cascade deferrable initially immediate,
  -- SHA-256 (hex) of the random token in the browser's cookie.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  -- Opened with the one-time password: it may only set the group's own password.
  setup_only boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz,
  ended_at timestamptz
);
create index if not exists portal_sessions_group on booking.portal_sessions (group_id) where ended_at is null;

-- Nobody signed in to ArkOS, and nobody outside, reads or writes these tables directly.
alter table booking.portal_accounts enable row level security;
alter table booking.portal_sessions enable row level security;
revoke all on booking.portal_accounts, booking.portal_sessions from public, anon, authenticated;
grant all on booking.portal_accounts, booking.portal_sessions to service_role;

-- ---- Staff: status, issue, lock ----

-- The portal's state of every group, without any secret: issued (waiting for the first sign-in), setup (signed in
-- with the one-time password, no password of its own yet), active, expired (the one-time password ran out before
-- it was used), locked. A group with no row has no portal access.
create or replace function booking.portal_status()
returns table (group_id uuid, state text, issued_at timestamptz, otp_expires_at timestamptz, last_sign_in_at timestamptz, password_set_at timestamptz)
language sql stable security definer set search_path to 'booking', 'pg_temp' as $$
  select a.group_id,
         case when a.locked then 'locked'
              when not a.must_set_password and a.password_hash is not null then 'active'
              when a.otp_hash is not null and a.otp_used_at is null and a.otp_expires_at > now() then 'issued'
              when a.otp_used_at is not null and a.password_hash is null then 'setup'
              else 'expired' end,
         a.issued_at, a.otp_expires_at, a.last_sign_in_at, a.password_set_at
    from booking.portal_accounts a
   where shared.module_viewable(variadic array['volunteers', 'bookings']);
$$;

-- Staff issue portal access: the ArkOS server makes the one-time password and passes only its hash. Issuing again
-- resets the password and ends every open session of the group.
create or replace function booking.portal_issue(p_group uuid, p_otp_hash text) returns jsonb
language plpgsql volatile security definer set search_path to 'booking', 'pg_temp' as $$
declare
  g booking.groups;
begin
  if not shared.module_editable('volunteers') then
    raise exception 'Only the people who keep volunteers can give portal access.' using errcode = '42501';
  end if;
  select * into g from booking.groups where id = p_group;
  if not found then
    raise exception 'That group was not found.' using errcode = 'P0002';
  end if;
  if g.email is null then
    raise exception 'This group has no email address, so it cannot sign in to the portal.' using errcode = '22023';
  end if;
  if coalesce(p_otp_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'The one-time password could not be made. Please try again.' using errcode = '22023';
  end if;
  insert into booking.portal_accounts (group_id, otp_hash, otp_expires_at, otp_used_at, must_set_password, password_hash, password_set_at, locked, locked_by, locked_at, issued_by, issued_at, updated_at)
  values (g.id, p_otp_hash, now() + interval '72 hours', null, true, null, null, false, null, null, auth.uid(), now(), now())
  on conflict (group_id) do update
    set otp_hash = excluded.otp_hash, otp_expires_at = excluded.otp_expires_at, otp_used_at = null, must_set_password = true,
        password_hash = null, password_set_at = null, locked = false, locked_by = null, locked_at = null,
        issued_by = excluded.issued_by, issued_at = excluded.issued_at, updated_at = now();
  update booking.portal_sessions set ended_at = now() where group_id = g.id and ended_at is null;
  return jsonb_build_object('email', g.email, 'expiresAt', now() + interval '72 hours');
end;
$$;

-- Staff lock a group out of the portal (every open session ends) or let it back in.
create or replace function booking.portal_lock(p_group uuid, p_locked boolean) returns void
language plpgsql volatile security definer set search_path to 'booking', 'pg_temp' as $$
begin
  if not shared.module_editable('volunteers') then
    raise exception 'Only the people who keep volunteers can change portal access.' using errcode = '42501';
  end if;
  update booking.portal_accounts
     set locked = p_locked, locked_by = case when p_locked then auth.uid() end, locked_at = case when p_locked then now() end, updated_at = now()
   where group_id = p_group;
  if not found then
    raise exception 'This group has no portal access yet.' using errcode = '22023';
  end if;
  if p_locked then
    update booking.portal_sessions set ended_at = now() where group_id = p_group and ended_at is null;
  end if;
end;
$$;

revoke all on function booking.portal_status() from public, anon;
revoke all on function booking.portal_issue(uuid, text) from public, anon;
revoke all on function booking.portal_lock(uuid, boolean) from public, anon;
grant execute on function booking.portal_status() to authenticated, service_role;
grant execute on function booking.portal_issue(uuid, text) to authenticated, service_role;
grant execute on function booking.portal_lock(uuid, boolean) to authenticated, service_role;

-- ---- A public request no longer changes a group that has a portal account ----
create or replace function booking.assign_group() returns trigger
language plpgsql security definer set search_path to 'booking', 'pg_temp' as $$
begin
  if new.group_id is not null then
    return new;
  end if;
  if new.email is not null then
    insert into booking.groups as g (name, kind, contact_person, email, mobile)
    values (btrim(new.requestor_name), new.requestor_kind, btrim(new.contact_person), lower(new.email), coalesce(new.mobile, ''))
    on conflict ((lower(email))) where email is not null
      do update set name = excluded.name, kind = excluded.kind, contact_person = excluded.contact_person, mobile = excluded.mobile, updated_at = now()
      -- Anyone may type an email on the public form: a group with a portal account keeps its own details.
      where not exists (select 1 from booking.portal_accounts a where a.group_id = g.id)
    returning id into new.group_id;
    if new.group_id is null then
      select id into new.group_id from booking.groups where lower(email) = lower(new.email);
    end if;
  else
    insert into booking.groups (name, kind, contact_person, email, mobile)
    values (btrim(new.requestor_name), new.requestor_kind, btrim(new.contact_person), null, coalesce(new.mobile, ''))
    returning id into new.group_id;
  end if;
  return new;
end;
$$;
revoke all on function booking.assign_group() from public, anon, authenticated;

notify pgrst, 'reload schema';
