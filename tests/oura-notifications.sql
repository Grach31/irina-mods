-- Integration regression: run the whole file as one query. All fixtures roll back.
begin;
set local role service_role;
do $$
declare d date:=(now() at time zone 'Europe/Moscow')::date; p jsonb; q jsonb; result boolean; begin
 p:=jsonb_build_object(
 'sleep',jsonb_build_object('score',80,'detail',jsonb_build_object('day',d,'total_seconds',28800)),
 'readiness',jsonb_build_object('score',81),
 'activity',jsonb_build_object('score',70,'day',d-1,'steps',0,'active_calories',0),
 'history',jsonb_build_array(jsonb_build_object('day',d,'sleep',80,'readiness',81),jsonb_build_object('day',d-1,'activity',70)));
 assert myspace_private.oura_package_ready(p,d),'complete current package including zero activity must qualify';
 assert not myspace_private.oura_package_ready(p,d+1),'yesterday sleep must not qualify';
 assert not myspace_private.oura_package_ready(p-'history',d),'no history must not qualify';
 assert not myspace_private.oura_package_ready(jsonb_set(p,'{history}','{}'),d),'malformed history must not qualify';
 assert not myspace_private.oura_package_ready(jsonb_set(p,'{readiness,score}','null'),d),'missing readiness must wait';
 assert not myspace_private.oura_package_ready(jsonb_set(p,'{readiness,score}','"81"'),d),'string score must not qualify';
 assert not myspace_private.oura_package_ready(jsonb_set(p,'{readiness,score}','82'),d),'stale summary must not qualify';
 assert not myspace_private.oura_package_ready(jsonb_set(p,'{sleep,detail,total_seconds}','0'),d),'missing real sleep must wait';
 assert not myspace_private.oura_package_ready(jsonb_set(p,'{activity,steps}','null'),d),'partial activity must wait';
 assert not myspace_private.oura_package_ready(jsonb_set(p,'{activity,day}',to_jsonb((d-2)::text)),d),'old activity must wait';
 assert not myspace_private.oura_package_ready(jsonb_set(p,'{sleep,score}','101'),d),'invalid score must wait';
 assert public.ms_notice_quiet((d::timestamp+interval '7 hours 59 minutes') at time zone 'Europe/Moscow',1320,480),'07:59 must be quiet';
 assert not public.ms_notice_quiet((d::timestamp+interval '8 hours') at time zone 'Europe/Moscow',1320,480),'08:00 must allow delivery';
 assert not has_function_privilege('anon','public.ms_notice_oura()','execute'),'anon must not enqueue';
 assert not has_function_privilege('authenticated','public.ms_notice_oura()','execute'),'browser must not enqueue';

 -- Remove this test day's records only inside the rolled-back transaction.
 delete from public.myspace_notifications where group_key='oura:'||d;
 delete from public.myspace_notification_events where event_key='oura:'||d;
 update myspace_private.notification_config set enabled=true where id;
 update myspace_private.notification_source_state set version=(now()+interval '1 day')::text where source_id='oura:enabled_at';
 update public.stambo_oura_snapshot set payload=p,updated_at=now() where id=1;
 assert not public.ms_notice_oura(),'rollout baseline must suppress existing data';
 update myspace_private.notification_source_state set version=(now()-interval '1 day')::text where source_id='oura:enabled_at';
 update public.stambo_oura_snapshot set payload=jsonb_set(p,'{readiness,score}','null') where id=1;
 assert not public.ms_notice_oura(),'saved partial data must wait';
 update public.stambo_oura_snapshot set payload=p where id=1;
 assert public.ms_notice_oura(),'complete saved data must enqueue';
 assert not public.ms_notice_oura(),'duplicate tick must not enqueue';
 assert (select count(*)=1 from public.myspace_notifications where group_key='oura:'||d),'exactly one center record';
 assert (select targets=jsonb_build_array(jsonb_build_object('space','oura','id',d)) from public.myspace_notifications where group_key='oura:'||d),'ring deep link';
 assert (select payload=jsonb_build_object('day',d) from public.myspace_notification_events where event_key='oura:'||d),'no health values in events';
 delete from public.myspace_notifications where group_key='oura:'||d;
 assert not public.ms_notice_oura(),'history cleanup must not recreate an old event';
end $$;
rollback;
