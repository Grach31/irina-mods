-- Apply after schema.sql. One existing DB tick reads one saved snapshot; no Oura API polling.
-- Preserve a silent rollout watermark on reapplication; never announce pre-install data.
alter table public.myspace_notification_preferences alter column push_categories
 set default array['draft','edit','updates','error','oura'];
alter table public.myspace_notification_preferences alter column center_categories
 set default array['draft','edit','updates','error','published','oura'];
with installed as (
 insert into myspace_private.notification_source_state(source_id,version)
 values('oura:enabled_at',clock_timestamp()::text) on conflict do nothing returning source_id
)
update public.myspace_notification_preferences set
 push_categories=array_append(push_categories,'oura'),center_categories=array_append(center_categories,'oura')
where exists(select 1 from installed) and not ('oura'=any(push_categories)) and not ('oura'=any(center_categories));

-- Pure readiness check follows the existing Grach31/oura dashboard contract:
-- today's sleep/readiness + latest completed activity day (normally yesterday).
create or replace function myspace_private.oura_package_ready(p jsonb, d date) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare h jsonb; a jsonb; k text; activity_day text:=p#>>'{activity,day}'; begin
 if p#>>'{sleep,detail,day}' is distinct from d::text
 or activity_day is null or activity_day not in (d::text,(d-1)::text)
 or jsonb_typeof(p->'history') is distinct from 'array' then return false; end if;
 for k in select unnest(array['sleep','readiness','activity']) loop
 if jsonb_typeof(p#>array[k,'score']) is distinct from 'number' then return false; end if;
 if (p#>>array[k,'score'])::numeric not between 0 and 100 then return false; end if;
 end loop;
 if jsonb_typeof(p#>'{sleep,detail,total_seconds}') is distinct from 'number' then return false; end if;
 if (p#>>'{sleep,detail,total_seconds}')::numeric<=0 then return false; end if;
 for k in select unnest(array['steps','active_calories']) loop
 if jsonb_typeof(p#>array['activity',k]) is distinct from 'number' then return false; end if;
 if (p#>>array['activity',k])::numeric<0 then return false; end if;
 end loop;
 select value into h from jsonb_array_elements(p->'history') where value->>'day'=d::text limit 1;
 select value into a from jsonb_array_elements(p->'history') where value->>'day'=activity_day limit 1;
 return coalesce(jsonb_typeof(h->'sleep')='number' and h->'sleep'=p#>'{sleep,score}'
 and jsonb_typeof(h->'readiness')='number' and h->'readiness'=p#>'{readiness,score}'
 and jsonb_typeof(a->'activity')='number' and a->'activity'=p#>'{activity,score}',false);
end $$;

create or replace function public.ms_notice_oura() returns boolean
language plpgsql security invoker set search_path='' as $$
declare s public.stambo_oura_snapshot; d date:=(now() at time zone 'Europe/Moscow')::date;
 stamp text; nid uuid; baseline text; begin
 if not exists(select 1 from myspace_private.notification_config where id and enabled) then return false; end if;
 stamp:='oura:'||d;
 -- Permanent event key survives history cleanup. Unique insertion also fences concurrent ticks.
 if exists(select 1 from public.myspace_notification_events where event_key=stamp) then return false; end if;
 select version into baseline from myspace_private.notification_source_state where source_id='oura:enabled_at';
 select * into s from public.stambo_oura_snapshot where id=1;
 if baseline is null or s.updated_at is null or s.updated_at<=baseline::timestamptz
 or not myspace_private.oura_package_ready(s.payload,d) then return false; end if;
 insert into public.myspace_notification_events(event_key,kind,source_id,version,payload,processed_at)
 values(stamp,'oura','oura',d::text,jsonb_build_object('day',d),now()) on conflict do nothing;
 if not found then return false; end if;
 nid:=public.ms_notice_put(stamp,'oura','Данные Oura обновлены',
 'Сон, готовность и активность сохранены в My Space.',
 jsonb_build_array(jsonb_build_object('space','oura','id',d)),0);
 -- Avoid a delayed outdated morning alert days later; history is still retained for 90 days.
 update public.myspace_notifications set expires_at=least(expires_at,(d+2)::timestamp at time zone 'Europe/Moscow') where id=nid;
 return true;
end $$;
revoke all on function myspace_private.oura_package_ready(jsonb,date) from public,anon,authenticated;
revoke all on function public.ms_notice_oura() from public,anon,authenticated;
grant execute on function myspace_private.oura_package_ready(jsonb,date) to service_role;
grant execute on function public.ms_notice_oura() to service_role;
