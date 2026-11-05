-- 0129: errors the apps used to keep in the browser console now reach the Super Admin (5 Nov 2026).
--
-- The 5 Nov receive that lost its receipt failed with an error only the phone's console saw. From here
-- both apps write such failures (a failed save, an unhandled error on a page) to shared.client_errors:
-- the person writes their own rows, the admin reads them on Settings. Rows older than 90 days go.

create table if not exists shared.client_errors (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  app text not null check (app in ('lafopsys', 'inventory')),
  staff_id uuid default auth.uid() references shared.staff (id) deferrable,
  role text check (role is null or length(role) <= 80),
  page text check (page is null or length(page) <= 200),
  message text not null check (length(message) between 1 and 500),
  detail jsonb not null default '{}'::jsonb check (pg_column_size(detail) <= 8192)
);
comment on table shared.client_errors is 'Failures the apps hit in the browser (0129): who, where, what. Read by the Super Admin on Settings.';
create index if not exists client_errors_at_idx on shared.client_errors (at desc);

alter table shared.client_errors enable row level security;
drop policy if exists "own errors insert" on shared.client_errors;
create policy "own errors insert" on shared.client_errors for insert to authenticated
  with check (staff_id = auth.uid());
drop policy if exists "admin reads errors" on shared.client_errors;
create policy "admin reads errors" on shared.client_errors for select to authenticated
  using ((select shared.has_role('admin')));
revoke all on shared.client_errors from anon, public;
grant insert, select on shared.client_errors to authenticated;

-- Ninety days is enough to find a pattern; the table never grows past that.
create or replace function shared.prune_client_errors()
returns trigger language plpgsql security definer
set search_path to 'shared', 'pg_temp' as $$
begin
  delete from shared.client_errors where at < now() - interval '90 days';
  return null;
end;
$$;
revoke all on function shared.prune_client_errors() from public, anon, authenticated;
drop trigger if exists prune_client_errors on shared.client_errors;
create trigger prune_client_errors after insert on shared.client_errors
  for each statement execute function shared.prune_client_errors();

notify pgrst, 'reload schema';
