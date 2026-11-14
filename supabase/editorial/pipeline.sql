alter table public.myspace_publications drop constraint myspace_publications_status_check;
alter table public.myspace_publications add constraint myspace_publications_status_check check(status in ('rejected','publishing','published','failed','uncertain'));
alter table public.myspace_publications add column if not exists approved_revision text;
alter table public.myspace_publications add column if not exists attempt_id uuid;
create table if not exists public.myspace_editorial_leases (
 draft_id text primary key, request_created_at timestamptz not null, worker text not null,
 lease_token uuid not null default gen_random_uuid(), state text not null default 'held' check(state in ('held','submitted','completed')),
 expires_at timestamptz not null default now()+interval '20 minutes', updated_at timestamptz not null default now()
);
alter table public.myspace_editorial_leases enable row level security;
revoke all on public.myspace_editorial_leases from anon,authenticated;
grant all on public.myspace_editorial_leases to service_role;
create or replace function public.ms_editorial_claim(p_id text,p_requested_at timestamptz,p_worker text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare l public.myspace_editorial_leases; begin
 perform pg_advisory_xact_lock(hashtextextended('myspace:'||p_id,0));
 if not exists(select 1 from public.myspace_edit_requests where draft_id=p_id and created_at=p_requested_at) then return jsonb_build_object('claimed',false,'reason','superseded'); end if;
 if exists(select 1 from public.myspace_publications where draft_id=p_id and status in ('published','rejected','publishing','uncertain')) then return jsonb_build_object('claimed',false,'reason','final_or_sending'); end if;
 if exists(select 1 from public.myspace_edit_completions where draft_id=p_id and request_created_at=p_requested_at) then return jsonb_build_object('claimed',false,'reason','completed'); end if;
 select * into l from public.myspace_editorial_leases where draft_id=p_id for update;
 if found and l.expires_at>now() and l.state in ('held','submitted') then return jsonb_build_object('claimed',false,'reason','busy'); end if;
 insert into public.myspace_editorial_leases(draft_id,request_created_at,worker) values(p_id,p_requested_at,left(p_worker,200))
 on conflict(draft_id) do update set request_created_at=excluded.request_created_at,worker=excluded.worker,lease_token=gen_random_uuid(),state='held',expires_at=now()+interval '20 minutes',updated_at=now()
 returning * into l;
 return jsonb_build_object('claimed',true,'lease_token',l.lease_token,'expires_at',l.expires_at);
end $$;
create or replace function public.ms_editorial_verify(p_id text,p_token uuid) returns boolean
language sql security invoker set search_path='' as $$
 select exists(select 1 from public.myspace_editorial_leases l join public.myspace_edit_requests r on r.draft_id=l.draft_id and r.created_at=l.request_created_at
 where l.draft_id=p_id and l.lease_token=p_token and l.expires_at>now() and l.state in ('held','submitted') and not exists(select 1 from public.myspace_publications p where p.draft_id=l.draft_id and p.status in ('published','rejected','publishing','uncertain')));
$$;
create or replace function public.ms_editorial_submit(p_id text,p_token uuid) returns boolean
language plpgsql security invoker set search_path='' as $$ begin
 perform pg_advisory_xact_lock(hashtextextended('myspace:'||p_id,0));
 if not public.ms_editorial_verify(p_id,p_token) then return false; end if;
 update public.myspace_editorial_leases set state='submitted',expires_at=now()+interval '1 hour',updated_at=now() where draft_id=p_id and lease_token=p_token;return true;
end $$;
create or replace function public.ms_editorial_release(p_id text,p_token uuid) returns boolean
language plpgsql security invoker set search_path='' as $$ begin
 update public.myspace_editorial_leases set expires_at=now(),updated_at=now() where draft_id=p_id and lease_token=p_token;return found;
end $$;
create or replace function public.ms_publication_decide(p_id text,p_action text,p_revision text default null,p_notes text default null,p_owner bigint default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s text; attempt uuid; stamp timestamptz; begin
 if p_id !~ '^[a-zA-Z0-9_.-]{1,100}$' then return jsonb_build_object('error','invalid_id'); end if;
 perform pg_advisory_xact_lock(hashtextextended('myspace:'||p_id,0));
 select status into s from public.myspace_publications where draft_id=p_id for update;
 if s in ('published','publishing','uncertain') then return jsonb_build_object('error',case s when 'published' then 'already_published' when 'publishing' then 'already_processing' else 'delivery_unconfirmed' end); end if;
 if s='rejected' and p_action<>'reject' then return jsonb_build_object('error','rejected'); end if;
 if p_action='edit' then
 if p_notes is null or length(trim(p_notes)) not between 3 and 2000 or p_owner is null then return jsonb_build_object('error','invalid_edit_notes'); end if;
 stamp:=clock_timestamp();
 insert into public.myspace_edit_requests(draft_id,notes,requested_by,created_at) values(p_id,trim(p_notes),p_owner,stamp)
 on conflict(draft_id) do update set notes=excluded.notes,requested_by=excluded.requested_by,created_at=greatest(excluded.created_at,public.myspace_edit_requests.created_at+interval '1 microsecond')
 returning created_at into stamp;
 return jsonb_build_object('ok',true,'status','edit_requested','request_created_at',stamp);
 elsif p_action='reject' then
 insert into public.myspace_publications(draft_id,status) values(p_id,'rejected') on conflict(draft_id) do update set status='rejected',updated_at=now();
 return jsonb_build_object('ok',true,'status','rejected');
 elsif p_action='claim' then
 if s='rejected' then return jsonb_build_object('error','rejected'); end if;
 if p_revision is null or p_revision !~ '^[a-f0-9]{64}$' then return jsonb_build_object('error','revision_required'); end if;
 if exists(select 1 from public.myspace_editorial_leases where draft_id=p_id and expires_at>now() and state in ('held','submitted')) then return jsonb_build_object('error','editing_in_progress'); end if;
 attempt:=gen_random_uuid();
 insert into public.myspace_publications(draft_id,status,attempt_id,approved_revision) values(p_id,'publishing',attempt,p_revision)
 on conflict(draft_id) do update set status='publishing',attempt_id=attempt,approved_revision=p_revision,error_code=null,updated_at=now();
 return jsonb_build_object('ok',true,'attempt_id',attempt,'status','publishing');
 end if;
 return jsonb_build_object('error','invalid_action');
end $$;
create or replace function public.ms_publication_finish(p_id text,p_attempt uuid,p_status text,p_ids jsonb default '[]',p_error text default null) returns boolean
language plpgsql security invoker set search_path='' as $$ begin
 if p_status not in ('published','failed','uncertain') then raise exception 'invalid_status'; end if;
 if p_status='published' and (jsonb_array_length(p_ids)=0 or exists(select 1 from jsonb_array_elements(p_ids) x where jsonb_typeof(x)<>'number')) then raise exception 'message_ids_required'; end if;
 update public.myspace_publications set status=p_status,telegram_message_ids=p_ids,error_code=p_error,updated_at=now()
 where draft_id=p_id and attempt_id=p_attempt and status in ('publishing','uncertain');
 return found;
end $$;
do $$ declare r record; begin for r in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and (proname like 'ms_editorial_%' or proname like 'ms_publication_%') loop
 execute format('revoke all on function %s from public,anon,authenticated',r.signature);
 execute format('grant execute on function %s to service_role',r.signature);
end loop; end $$;
