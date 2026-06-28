-- Cerebrum — one-time cron setup (run AFTER deploying the market-sync Edge Function
-- and setting Edge Function secrets in the Supabase dashboard).
--
-- This: (1) enables pg_cron + pg_net, (2) stores the CRON_SECRET in vault for the
-- scheduled job to read, (3) schedules the daily 4 PM IST sync.
--
-- Before running, replace <YOUR_CRON_SECRET> below with the same string you set
-- in Dashboard → Settings → Edge Functions → Secrets → CRON_SECRET.
-- Replace <YOUR_PROJECT_REF> with your Supabase project ref (the subdomain
-- before .supabase.co).

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

select vault.create_secret(
  '<YOUR_CRON_SECRET>',
  'cerebrum_cron_secret',
  'Shared secret passed in X-Cron-Secret header from pg_cron to market-sync Edge Function'
);

select cron.unschedule('cerebrum-market-sync-daily')
where exists (select 1 from cron.job where jobname = 'cerebrum-market-sync-daily');

select cron.schedule(
  'cerebrum-market-sync-daily',
  '30 10 * * 1-5',                        -- 10:30 UTC Mon-Fri = 4:00 PM IST
  $job$
  select net.http_post(
    url     := 'https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/market-sync',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'X-Cron-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cerebrum_cron_secret')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) as request_id;
  $job$
);

-- Verify:
select jobid, jobname, schedule, active from cron.job where jobname = 'cerebrum-market-sync-daily';
