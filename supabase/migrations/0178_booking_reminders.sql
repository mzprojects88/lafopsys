-- 0178: the daily booking reminders. Every day at 8:00 AM (Manila) the database asks ArkOS to write the
-- reminders for the visits that are 3 days away and for tomorrow's, and to send whatever email waits in
-- booking.outbox. Scheduled on production only (where the House Sheet job runs, like the other scheduled jobs:
-- the same test as 0157), with the same key the Shop's email job uses. Development schedules nothing.
--
-- Nothing is sent before the email key is set on the hosting: until then the reminders wait as "held".

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from cron.job where jobname = 'house-sheet-sync') and not exists (select 1 from cron.job where jobname = 'booking-reminders') then
    perform cron.schedule(
      'booking-reminders',
      '0 0 * * *', -- 00:00 UTC = 8:00 AM in Manila
      $job$
      select net.http_post(
        url := 'https://lafopsys.vercel.app/api/bookings/reminders',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'calendar_sync_secret' limit 1)
        ),
        body := '{"trigger":"cron"}'::jsonb,
        timeout_milliseconds := 60000
      )
      where exists (select 1 from booking.requests where status = 'approved' and date >= booking.today())
         or exists (select 1 from booking.outbox where status in ('queued', 'held'));
      $job$
    );
  end if;
end $$;
