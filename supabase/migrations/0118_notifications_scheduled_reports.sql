-- 0118: Notifications by email and scheduled report delivery (Sprint 10; T-020 and T-021, decided
-- 27 Oct: email through Resend, no SMS; the Monthly Summary and the Programs report to the CEO
-- and the board on the 5th, the NCH bill to the Social Worker on the 1st).
--
--   * ops.outbox: every email the app sends -- who to, the subject, the body, and whether it was
--     sent. Until the Resend key is set on the hosting, emails wait there ("held") and the Super
--     Admin's bell says so; they go out once it is set.
--   * ops.report_schedules: which report goes to which addresses, monthly on a day or weekly on a
--     weekday. Staff accounts have no real email address in the app, so recipients are typed.
--   * a daily run at 7:00 AM Manila (production only) sends what is due.

create or replace function ops.all_emails(p text[])
returns boolean language sql immutable as $$
  select coalesce(bool_and(x ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'), true) from unnest(p) x;
$$;

-- ---- 1. the outbox ----
create table if not exists ops.outbox (
  id uuid primary key default gen_random_uuid(),
  to_address text not null check (to_address ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(to_address) <= 200),
  subject text not null check (length(subject) between 1 and 200),
  body_html text not null,
  source text,
  status text not null default 'queued' check (status in ('queued', 'held', 'sent', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists outbox_status on ops.outbox (status, created_at);
comment on table ops.outbox is 'Every email the app sends (0118). held = waiting for the email key on the hosting.';
alter table ops.outbox enable row level security;
drop policy if exists "super admin reads the outbox" on ops.outbox;
create policy "super admin reads the outbox" on ops.outbox for select to authenticated using ((select shared.has_role('admin')));
revoke all on ops.outbox from anon, authenticated;
grant select on ops.outbox to authenticated;

-- ---- 2. the schedules ----
create table if not exists ops.report_schedules (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 100),
  report text not null check (report in ('monthly_summary', 'programs', 'caf_billing')),
  recipients text[] not null default '{}' check (cardinality(recipients) <= 20 and ops.all_emails(recipients)),
  frequency text not null default 'monthly' check (frequency in ('monthly', 'weekly')),
  -- monthly: day of the month 1-28; weekly: 1 = Monday ... 7 = Sunday
  day smallint not null check (day between 1 and 28),
  active boolean not null default true,
  last_sent_on date,
  created_by uuid default auth.uid() references shared.staff (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (frequency = 'monthly' or day <= 7)
);
comment on table ops.report_schedules is 'Scheduled report delivery by email (0118); sent at 7:00 AM Manila on the day.';
alter table ops.report_schedules enable row level security;
drop policy if exists "reports viewers read schedules" on ops.report_schedules;
drop policy if exists "admin and finance manage schedules" on ops.report_schedules;
create policy "reports viewers read schedules" on ops.report_schedules for select to authenticated
  using ((select shared.module_viewable('reports')));
create policy "admin and finance manage schedules" on ops.report_schedules for all to authenticated
  using ((select shared.has_role('admin')) or (select shared.has_power('finance_work')))
  with check ((select shared.has_role('admin')) or (select shared.has_power('finance_work')));
grant select, insert, update, delete on ops.report_schedules to authenticated;
drop trigger if exists set_updated_at on ops.report_schedules;
create trigger set_updated_at before update on ops.report_schedules for each row execute function shared.set_updated_at();

-- The three agreed deliveries, waiting for their addresses (off until someone adds them).
insert into ops.report_schedules (name, report, frequency, day, active)
select v.name, v.report, 'monthly', v.day, false
from (values ('Monthly Summary for the CEO and the board', 'monthly_summary', 5),
             ('Programs report for the CEO and the board', 'programs', 5),
             ('NCH bill for the Social Worker', 'caf_billing', 1)) as v(name, report, day)
where not exists (select 1 from ops.report_schedules s where s.report = v.report);

-- ---- 3. the daily run (production only: where the House Sheet job runs) ----
do $$
begin
  if exists (select 1 from cron.job where jobname = 'house-sheet-sync') and not exists (select 1 from cron.job where jobname = 'scheduled-reports') then
    perform cron.schedule(
      'scheduled-reports',
      '0 23 * * *', -- 7:00 AM Manila
      $job$
      select net.http_post(
        url := 'https://lafopsys.vercel.app/api/reports/scheduled-run',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'calendar_sync_secret' limit 1)
        ),
        body := '{"trigger":"cron"}'::jsonb,
        timeout_milliseconds := 120000
      );
      $job$
    );
  end if;
end $$;
