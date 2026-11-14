-- Notification service: user data is accessible only through the authenticated Edge API.
create schema if not exists myspace_private;
revoke all on schema myspace_private from public, anon, authenticated;
create table if not exists myspace_private.notification_config (
 id boolean primary key default true check(id),
 worker_token text not null default encode(extensions.gen_random_bytes(32),'hex'),
 vapid jsonb, enabled boolean not null default true,
 initialized boolean not null default false, last_reconcile timestamptz, last_success timestamptz,
 last_error text, baseline_at timestamptz not null default now()
);
insert into myspace_private.notification_config(id) values(true) on conflict do nothing;
create table if not exists public.myspace_notification_events (
 event_key text primary key, kind text not null, source_id text not null,
 version text not null, payload jsonb not null, processed_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.myspace_notification_preferences (
 user_id uuid primary key references auth.users(id) on delete cascade,
 push_categories text[] not null default array['draft','edit','updates','error'],
 center_categories text[] not null default array['draft','edit','updates','error','published'],
 quiet_start integer not null default 1320 check(quiet_start between 0 and 1439),
 quiet_end integer not null default 480 check(quiet_end between 0 and 1439)
);
create table if not exists public.myspace_notifications (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 group_key text not null, category text not null, title text not null, body text not null,
 targets jsonb not null default '[]', created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), read_at timestamptz,
 available_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '7 days',
 unique(user_id,group_key)
);
create index if not exists myspace_notifications_user_time on public.myspace_notifications(user_id,created_at desc,id desc);
create index if not exists myspace_notifications_unread on public.myspace_notifications(user_id) where read_at is null;
create table if not exists public.myspace_push_subscriptions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 device_id uuid not null, subscription jsonb not null, endpoint_hash text not null unique,
 enabled boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(user_id,device_id)
);
create table if not exists public.myspace_push_deliveries (
 id uuid primary key default gen_random_uuid(), notification_id uuid not null references public.myspace_notifications(id) on delete cascade,
 subscription_id uuid not null references public.myspace_push_subscriptions(id) on delete cascade,
 state text not null default 'pending' check(state in ('pending','sending','accepted','failed','skipped')),
 attempts integer not null default 0, next_at timestamptz not null default now(),
 lease uuid, locked_at timestamptz, accepted_at timestamptz, opened_at timestamptz, error_code text,
 unique(notification_id,subscription_id)
);
create index if not exists myspace_push_due on public.myspace_push_deliveries(next_at) where state in ('pending','sending');
create table if not exists myspace_private.notification_source_state (
 source_id text primary key, version text not null, present boolean not null default true
);
create table if not exists public.myspace_edit_completions (
 draft_id text not null, request_created_at timestamptz not null, content_hash text not null,
 deployed_sha text not null, completed_at timestamptz not null default now(),
 primary key(draft_id,request_created_at)
);
do $$ declare t text; begin
 foreach t in array array['myspace_notification_events','myspace_notification_preferences','myspace_notifications','myspace_push_subscriptions','myspace_push_deliveries','myspace_edit_completions'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon, authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
-- service_role-only RPCs run as invoker. Private config stays outside the Data API.
grant usage on schema myspace_private to service_role;
grant all on all tables in schema myspace_private to service_role;
create or replace function public.ms_notice_config(p_vapid jsonb default null) returns jsonb
language plpgsql security invoker set search_path='' as $$ declare c jsonb; begin
 if p_vapid is not null then update myspace_private.notification_config set vapid=coalesce(vapid,p_vapid) where id; end if;
 select to_jsonb(t) into c from myspace_private.notification_config t where id; return c;
end $$;
create or replace function public.ms_notice_put(p_key text,p_category text,p_title text,p_body text,p_targets jsonb,p_delay integer default 120)
returns uuid language plpgsql security invoker set search_path='' as $$
declare u uuid; n uuid; begin
 -- Single existing owner. Never infer privilege from client-editable metadata.
 select id into u from auth.users where id='9983fe8e-9a69-4ed5-b8ec-f8e056c2f280';
 if u is null then return null; end if;
 insert into public.myspace_notification_preferences(user_id) values(u) on conflict do nothing;
 insert into public.myspace_notifications(user_id,group_key,category,title,body,targets,available_at)
 values(u,p_key,p_category,p_title,p_body,p_targets,now()+make_interval(secs=>p_delay))
 on conflict(user_id,group_key) do update set targets=excluded.targets,title=excluded.title,body=excluded.body,updated_at=now()
 returning id into n;
 return n;
end $$;
create or replace function public.ms_notice_ingest(p_manifest jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c myspace_private.notification_config; x jsonb; old_version text; changed boolean; drafts jsonb:='[]'; updates jsonb:='[]';
 receipt jsonb; target jsonb; req public.myspace_edit_requests; today text:=to_char(now() at time zone 'Europe/Moscow','YYYY-MM-DD'); n integer:=0;
begin
 select * into c from myspace_private.notification_config where id for update;
 if not c.enabled then return jsonb_build_object('disabled',true); end if;
 if coalesce(p_manifest->>'sha','') !~ '^[a-f0-9]{40}$' or jsonb_array_length(p_manifest->'items')>1000 then raise exception 'invalid_manifest'; end if;
 for x in select value from jsonb_array_elements(p_manifest->'items') loop
 select version into old_version from myspace_private.notification_source_state where source_id=x->>'source_id';
 changed:=old_version is distinct from x->>'version';
 insert into myspace_private.notification_source_state(source_id,version) values(x->>'source_id',x->>'version')
 on conflict(source_id) do update set version=excluded.version,present=true;
 -- Retain event keys after history cleanup, so old releases never re-notify.
 if changed and c.initialized then
 insert into public.myspace_notification_events(event_key,kind,source_id,version,payload)
 values((x->>'source_id')||':'||(x->>'version'),x->>'kind',x->>'source_id',x->>'version',x)
 on conflict do nothing;
 if found then
 n:=n+1; target:=x->'target';
 if x->>'kind'='draft' and old_version is null then drafts:=drafts||jsonb_build_array(target);
 elsif x->>'kind'='updates' then updates:=updates||jsonb_build_array(target); end if;
 end if;
 end if;
 end loop;
 -- Explicit completion receipt is bound to request time AND deployed draft bytes.
 if c.initialized then
 for receipt in select value from jsonb_array_elements(coalesce(p_manifest->'completions','[]')) loop
 select * into req from public.myspace_edit_requests where draft_id=receipt->>'draft_id' and created_at=(receipt->>'request_created_at')::timestamptz;
 if found and not exists(select 1 from public.myspace_publications where draft_id=req.draft_id and status in ('published','rejected')) then
 insert into public.myspace_edit_completions(draft_id,request_created_at,content_hash,deployed_sha)
 values(req.draft_id,req.created_at,receipt->>'content_hash',p_manifest->>'sha') on conflict do nothing;
 if found then
 perform public.ms_notice_put('edit:'||req.draft_id||':'||req.created_at,'edit','Правки готовы','Подборка обновлена по твоим замечаниям.',jsonb_build_array(jsonb_build_object('space','moda','id',req.draft_id,'request_created_at',req.created_at)),0);
 end if; end if;
 end loop; end if;
 if jsonb_array_length(drafts)>0 then perform public.ms_notice_put('drafts:'||(p_manifest->>'sha'),'draft','Подборки ждут решения','Готово материалов: '||jsonb_array_length(drafts),drafts); end if;
 if jsonb_array_length(updates)>0 then
 select coalesce(targets,'[]')||updates into updates from public.myspace_notifications where group_key='updates:'||today limit 1;
 if updates is null then select jsonb_agg(value->'target') into updates from jsonb_array_elements(p_manifest->'items') where value->>'kind'='updates' and exists(select 1 from public.myspace_notification_events e where e.event_key=(value->>'source_id')||':'||(value->>'version') and e.created_at>now()-interval '1 minute'); end if;
 select coalesce(jsonb_agg(v),'[]') into updates from (select distinct value as v from jsonb_array_elements(updates))q;
 perform public.ms_notice_put('updates:'||today,'updates','Новое в твоём пространстве','Обновлены материалы My Space.',updates);
 end if;
 update myspace_private.notification_config set initialized=true,last_reconcile=now(),last_success=now(),last_error=null where id;
 return jsonb_build_object('changes',n,'baseline',not c.initialized);
end $$;
-- Publication writes only a local durable event; network failure cannot affect publication.
create or replace function myspace_private.notice_publication() returns trigger
language plpgsql security invoker set search_path='' as $$ begin
 if new.status not in ('published','failed','rejected') then return new; end if;
 if TG_OP='UPDATE' then if old.status=new.status and old.updated_at=new.updated_at then return new; end if; end if;
 insert into public.myspace_notification_events(event_key,kind,source_id,version,payload)
 values('publication:'||new.draft_id||':'||new.status||':'||new.updated_at,'publication',new.draft_id,new.updated_at::text,to_jsonb(new)) on conflict do nothing;
 return new;
exception when others then return new; -- reconciliation repairs capture without breaking publication
end $$;
create trigger myspace_notice_publication after insert or update on public.myspace_publications for each row execute function myspace_private.notice_publication();
-- Cron reconciliation repairs a missing event after transient capture failures and is idempotent.
create or replace function public.ms_notice_publications() returns void
language plpgsql security invoker set search_path='' as $$ declare r record; begin
 for r in select p.* from public.myspace_publications p,myspace_private.notification_config c where p.updated_at>=c.baseline_at and p.status in ('published','failed','rejected') loop
 if r.status='published' then perform public.ms_notice_put('published:'||r.draft_id||':'||r.updated_at,'published','Публикация отправлена','Подборка опубликована в Telegram.',jsonb_build_array(jsonb_build_object('space','moda','id',r.draft_id)),0);
 elsif r.status='failed' then perform public.ms_notice_put('failed:'||r.draft_id||':'||r.updated_at,'error','Публикация не выполнена','Открой материал и проверь причину ошибки.',jsonb_build_array(jsonb_build_object('space','moda','id',r.draft_id)),0); end if;
 -- Close outdated actionable cards once rejected/published, not their factual history.
 if r.status in ('published','rejected') then update public.myspace_notifications n set expires_at=least(expires_at,now()) where category in ('draft','edit','error') and targets @> jsonb_build_array(jsonb_build_object('space','moda','id',r.draft_id)) and jsonb_array_length(targets)=1; end if;
 end loop;
 update public.myspace_notification_events set processed_at=now() where kind='publication' and processed_at is null;
end $$;
create or replace function public.ms_notice_quiet(p_at timestamptz,p_start integer,p_end integer) returns boolean
language sql immutable security invoker set search_path='' as $$
 select case when p_start=p_end then false when p_start>p_end then m>=p_start or m<p_end else m>=p_start and m<p_end end
 from (select extract(hour from p_at at time zone 'Europe/Moscow')::int*60+extract(minute from p_at at time zone 'Europe/Moscow')::int as m)q;
$$;
create or replace function public.ms_notice_claim() returns jsonb
language plpgsql security invoker set search_path='' as $$ declare batch jsonb; begin
 perform public.ms_notice_publications();
 -- A newer edit request supersedes its previous completion; fully resolved batches do not push.
 update public.myspace_notifications n set expires_at=least(expires_at,now()) where n.category='edit' and exists(select 1 from jsonb_array_elements(n.targets) t join public.myspace_edit_requests r on r.draft_id=t->>'id' where r.created_at>(t->>'request_created_at')::timestamptz);
 update public.myspace_notifications n set expires_at=least(expires_at,now()) where n.category in ('draft','edit') and not exists(select 1 from jsonb_array_elements(n.targets) t where not exists(select 1 from public.myspace_publications p where p.draft_id=t->>'id' and p.status in ('published','rejected')));

 insert into public.myspace_push_deliveries(notification_id,subscription_id,next_at)
 select n.id,s.id,n.available_at from public.myspace_notifications n join public.myspace_push_subscriptions s on s.user_id=n.user_id and s.enabled
 join public.myspace_notification_preferences p on p.user_id=n.user_id
 where n.read_at is null and n.created_at>=s.created_at and n.expires_at>now()
 on conflict do nothing;
 update public.myspace_push_deliveries d set state='skipped',lease=null where state in ('pending','sending') and exists(select 1 from public.myspace_notifications n join public.myspace_push_subscriptions s on s.id=d.subscription_id join public.myspace_notification_preferences p on p.user_id=n.user_id where n.id=d.notification_id and (n.read_at is not null or n.expires_at<=now() or not s.enabled or not(n.category=any(p.push_categories)) or not(n.category=any(p.center_categories))));
 with due as (
 select d.id from public.myspace_push_deliveries d join public.myspace_push_subscriptions s on s.id=d.subscription_id join public.myspace_notification_preferences p on p.user_id=s.user_id
 where (d.state='pending' or (d.state='sending' and d.locked_at<now()-interval '3 minutes')) and d.next_at<=now()
 and not public.ms_notice_quiet(now(),p.quiet_start,p.quiet_end) and d.attempts<8
 order by d.next_at limit 50 for update of d skip locked
 ), claimed as (
 update public.myspace_push_deliveries d set state='sending',attempts=attempts+1,locked_at=now(),lease=gen_random_uuid() from due where d.id=due.id returning d.*
 ) select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'lease',d.lease,'attempts',d.attempts,'subscription_id',s.id,'subscription',s.subscription,'notification',to_jsonb(n))), '[]') into batch
 from claimed d join public.myspace_push_subscriptions s on s.id=d.subscription_id join public.myspace_notifications n on n.id=d.notification_id;
 update public.myspace_push_deliveries set state='failed',error_code='retry_limit',lease=null where state in ('pending','sending') and attempts>=8 and locked_at<now()-interval '3 minutes';
 return batch;
end $$;
create or replace function public.ms_notice_finish(p_ids uuid[],p_leases uuid[],p_status integer,p_retry integer default 60) returns void
language plpgsql security invoker set search_path='' as $$ begin
 if p_status in (404,410) then update public.myspace_push_subscriptions set enabled=false where id in(select subscription_id from public.myspace_push_deliveries d join unnest(p_ids,p_leases) x(id,lease) on d.id=x.id and d.lease=x.lease); end if;
 update public.myspace_push_deliveries d set state=case when p_status between 200 and 299 then 'accepted' when p_status in (404,410) then 'skipped' when attempts>=8 or p_status in (400,401,403,413) then 'failed' else 'pending' end,
 accepted_at=case when p_status between 200 and 299 then now() else null end,
 next_at=now()+make_interval(secs=>greatest(p_retry,least(3600,30*power(2,least(attempts,7))::int))),
 error_code=case when p_status between 200 and 299 then null else 'push_'||p_status end,lease=null
 from unnest(p_ids,p_leases) x(id,lease) where d.id=x.id and d.lease=x.lease;
end $$;
create or replace function public.ms_notice_cleanup() returns void language plpgsql security invoker set search_path='' as $$ begin
 delete from public.myspace_notifications where created_at<now()-interval '90 days';
 delete from public.myspace_push_subscriptions where not enabled and updated_at<now()-interval '90 days';
end $$;
-- No service RPC can be executed by browser roles.
do $$ declare r record; begin for r in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname like 'ms_notice_%' loop
 execute format('revoke all on function %s from public,anon,authenticated',r.signature);
 execute format('grant execute on function %s to service_role',r.signature);
end loop; end $$;
create or replace function public.ms_notice_health(p_error text) returns void language sql security invoker set search_path='' as $$
 update myspace_private.notification_config set last_error=left(p_error,100) where id;
$$;
revoke all on function public.ms_notice_health(text) from public,anon,authenticated;
grant execute on function public.ms_notice_health(text) to service_role;
create or replace function public.ms_notice_build_error(p_sha text) returns void language plpgsql security invoker set search_path='' as $$ begin
 insert into public.myspace_notification_events(event_key,kind,source_id,version,payload) values('build-failed:'||p_sha,'error','build',p_sha,'{}') on conflict do nothing;
 if found then perform public.ms_notice_put('build-failed:'||p_sha,'error','Обновление не завершено','Не удалось развернуть новую версию. Предыдущая версия продолжает работать.',jsonb_build_array(jsonb_build_object('space','notifications','id','build')),0); end if;
end $$;
revoke all on function public.ms_notice_build_error(text) from public,anon,authenticated;
grant execute on function public.ms_notice_build_error(text) to service_role;
