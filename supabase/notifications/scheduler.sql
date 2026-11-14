-- One cheap DB tick per minute; call Edge only for due work or hourly reconciliation.
create extension if not exists pg_cron;
create extension if not exists pg_net;
create or replace function myspace_private.notification_tick() returns void
language plpgsql security invoker set search_path='' as $$
declare c myspace_private.notification_config; need boolean; begin
 select * into c from myspace_private.notification_config where id;
 if not c.enabled then return; end if;
 select (c.last_reconcile is null or c.last_reconcile<now()-interval '1 hour'
 or exists(select 1 from public.myspace_notification_events where kind='publication' and processed_at is null)
 or exists(select 1 from public.myspace_notifications n join public.myspace_push_subscriptions s on s.user_id=n.user_id and s.enabled join public.myspace_notification_preferences p on p.user_id=n.user_id
 where n.read_at is null and n.expires_at>now() and n.available_at<=now() and n.created_at>=s.created_at and not public.ms_notice_quiet(now(),p.quiet_start,p.quiet_end)
 and not exists(select 1 from public.myspace_push_deliveries d where d.notification_id=n.id and d.subscription_id=s.id))
 or exists(select 1 from public.myspace_push_deliveries d join public.myspace_push_subscriptions s on s.id=d.subscription_id and s.enabled join public.myspace_notification_preferences p on p.user_id=s.user_id
 where (d.state='pending' or(d.state='sending' and d.locked_at<now()-interval '3 minutes')) and d.next_at<=now() and not public.ms_notice_quiet(now(),p.quiet_start,p.quiet_end))) into need;
 if need then perform net.http_post(url:='https://rjnfokknhjmtuzturvub.supabase.co/functions/v1/myspace-notifications',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||c.worker_token),body:='{"action":"worker"}'::jsonb,timeout_milliseconds:=60000); end if;
end $$;
revoke all on function myspace_private.notification_tick() from public,anon,authenticated;
select cron.schedule('myspace-notification-dispatch','* * * * *','select myspace_private.notification_tick();');
