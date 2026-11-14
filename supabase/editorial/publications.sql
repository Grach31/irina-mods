-- Independent editorial delivery state; existing Moda decisions are unchanged.
create table if not exists public.myspace_editorial_publications (
 space text not null check(space in ('fashion','history')), source_id text not null,
 revision text not null, plan jsonb not null, next_part integer not null default 0 check(next_part>=0),
 status text not null check(status in ('publishing','published','failed','uncertain')),
 attempt_id uuid not null default gen_random_uuid(), message_ids jsonb not null default '[]',
 error_code text, updated_at timestamptz not null default now(), primary key(space,source_id)
);
alter table public.myspace_editorial_publications enable row level security;
revoke all on public.myspace_editorial_publications from public,anon,authenticated;
grant all on public.myspace_editorial_publications to service_role;

create or replace function public.ms_ep_claim(p_space text,p_id text,p_revision text,p_plan jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.myspace_editorial_publications; token uuid:=gen_random_uuid(); begin
 if p_space not in ('fashion','history') or p_id !~ '^[a-zA-Z0-9_.-]{1,200}$' or p_revision !~ '^[a-f0-9]{64}$'
 or jsonb_typeof(p_plan) is distinct from 'array' or jsonb_array_length(p_plan) not between 1 and 64 then raise exception 'invalid_plan'; end if;
 perform pg_advisory_xact_lock(hashtextextended('editorial:'||p_space||':'||p_id,0));
 select * into r from public.myspace_editorial_publications where space=p_space and source_id=p_id for update;
 if r.status in ('published','publishing','uncertain') then return jsonb_build_object('error',case r.status when 'published' then 'already_published' when 'publishing' then 'already_processing' else 'delivery_unconfirmed' end,'message_ids',r.message_ids); end if;
 if r.next_part>0 and (r.revision<>p_revision or r.plan<>p_plan) then return jsonb_build_object('error','partial_revision_changed'); end if;
 insert into public.myspace_editorial_publications(space,source_id,revision,plan,status,attempt_id)
 values(p_space,p_id,p_revision,p_plan,'publishing',token)
 on conflict(space,source_id) do update set revision=p_revision,plan=p_plan,status='publishing',attempt_id=token,error_code=null,updated_at=now();
 select * into r from public.myspace_editorial_publications where space=p_space and source_id=p_id;
 return jsonb_build_object('ok',true,'attempt_id',token,'next_part',r.next_part,'message_ids',r.message_ids);
end $$;

create or replace function public.ms_ep_checkpoint(p_space text,p_id text,p_attempt uuid,p_part integer,p_ids jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.myspace_editorial_publications; begin
 if jsonb_typeof(p_ids) is distinct from 'array' or jsonb_array_length(p_ids)=0
 or exists(select 1 from jsonb_array_elements(p_ids) n where jsonb_typeof(n)<>'number') then raise exception 'invalid_message_ids'; end if;
 update public.myspace_editorial_publications set next_part=next_part+1,message_ids=message_ids||p_ids,
 status=case when next_part+1=jsonb_array_length(plan) then 'published' else 'publishing' end,updated_at=now()
 where space=p_space and source_id=p_id and attempt_id=p_attempt and status='publishing' and next_part=p_part returning * into r;
 if not found then
 -- A lost HTTP acknowledgement may retry this exact stored checkpoint safely.
 select * into r from public.myspace_editorial_publications where space=p_space and source_id=p_id
 and attempt_id=p_attempt and next_part=p_part+1 and message_ids @> p_ids and status in ('publishing','published');
 if not found then return jsonb_build_object('error','checkpoint_rejected'); end if;
 end if;
 return jsonb_build_object('ok',true,'status',r.status,'message_ids',r.message_ids,'next_part',r.next_part);
end $$;

create or replace function public.ms_ep_fail(p_space text,p_id text,p_attempt uuid,p_status text,p_error text) returns boolean
language plpgsql security invoker set search_path='' as $$ begin
 if p_status not in ('failed','uncertain') then raise exception 'invalid_status'; end if;
 update public.myspace_editorial_publications set status=p_status,error_code=left(p_error,100),updated_at=now()
 where space=p_space and source_id=p_id and attempt_id=p_attempt and status='publishing';return found;
end $$;
revoke all on function public.ms_ep_claim(text,text,text,jsonb),public.ms_ep_checkpoint(text,text,uuid,integer,jsonb),public.ms_ep_fail(text,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.ms_ep_claim(text,text,text,jsonb),public.ms_ep_checkpoint(text,text,uuid,integer,jsonb),public.ms_ep_fail(text,text,uuid,text,text) to service_role;
