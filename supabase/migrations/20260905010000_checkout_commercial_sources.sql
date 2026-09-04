-- Phase 5 quotes -> checkout. No provider I/O, lifecycle transition or backfill.
create table public.money_commercial_sources (
  snapshot_id uuid primary key references public.money_snapshots(id),
  source_kind text not null check(source_kind in ('quote','offering')),
  source_hash text not null,
  evidence jsonb not null,
  reviewed_terms jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.money_commercial_sources enable row level security;
revoke all on public.money_commercial_sources from public,anon,authenticated,service_role;
grant select on public.money_commercial_sources to service_role;
create trigger immutable_source before update or delete on public.money_commercial_sources
  for each row execute function public.money_immutable();

create function private.money_minor_units(value numeric) returns bigint language plpgsql immutable set search_path='' as $$
begin
  if value is null or value<=0 or value>10000000000 or value*100<>trunc(value*100) then
    raise exception 'Source price must be positive whole cents';
  end if;
  return (value*100)::bigint;
end $$;

create function private.money_source_context(r public.service_requests) returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object('request',r.id,'customer',r.customer_id,'contractor',r.contractor_id,
    'service',r.service_catalog_id,'service_type',r.service_type,'frequency',r.frequency,'zip',r.zip_code,
    'package',r.package_id,'tier',r.package_tier_id,'answers',r.package_question_answers,'scope',r.description,
    'pricing_mode',r.pricing_mode,'quote_only',r.quote_only,'promotion',r.promotion_id)
$$;

create table public.money_quote_contexts (
  quote_id uuid primary key references public.request_quotes(id),
  context jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.money_quote_contexts enable row level security;
revoke all on public.money_quote_contexts from public,anon,authenticated,service_role;
grant select on public.money_quote_contexts to service_role;
create trigger immutable_quote_context before update or delete on public.money_quote_contexts
  for each row execute function public.money_immutable();
create function private.money_capture_quote_context() returns trigger language plpgsql security definer set search_path='' as $$
declare r public.service_requests;
begin
  select * into strict r from public.service_requests where id=new.request_id for update;
  -- Mercurius quotes the request; provider assignment is independent (DEC-007).
  insert into public.money_quote_contexts(quote_id,context) values(new.id,private.money_source_context(r)-'contractor');
  return new;
end $$;
revoke all on function private.money_capture_quote_context() from public,anon,authenticated,service_role;
create trigger quote_context_capture after insert on public.request_quotes
  for each row execute function private.money_capture_quote_context();

-- The caller holds the lifecycle advisory lock and request row first. Row SHARE
-- locks keep the selected catalog/coverage evidence stable through publication.
create function private.money_source(p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.service_requests; q public.request_quotes; p public.vendor_packages;
  t public.package_tiers; evidence jsonb; request_context jsonb; price bigint; questions jsonb;
begin
  lock table public.package_promotions,public.package_qualifying_questions in share mode;
  select * into strict r from public.service_requests where id=p_request;
  if r.customer_id is null or r.contractor_id is null or r.status not in ('scheduled','in_progress','pending_review','vendor_completed','homeowner_confirmed','completed','review_requested','reviewed','closed') then
    raise exception 'Scheduled commercial parties required';
  end if;
  request_context:=private.money_source_context(r);
  if r.current_quote_id is not null then
    select * into strict q from public.request_quotes where id=r.current_quote_id for share;
    if q.request_id<>r.id or q.revision<>r.quote_revision or q.status<>'accepted' or r.quote_status is distinct from 'accepted'
      or q.decision_actor is distinct from r.customer_id or q.decided_at is null or q.decided_at<q.sent_at or q.decided_at>=q.expires_at then
      raise exception 'Current homeowner-accepted quote required';
    end if;
    if not exists(select 1 from public.money_quote_contexts where quote_id=q.id and money_quote_contexts.context=request_context-'contractor') then
      raise exception 'Quote scope unverified or changed; send a new revision';
    end if;
    -- Existing admin/homeowner UI calls amount the total. Never silently add tax,
    -- tips or extras on top of that accepted amount. Its allocation is reviewed.
    price:=private.money_minor_units(q.amount);
    evidence:=jsonb_build_object('kind','quote','context',request_context,'quote',to_jsonb(q),'total',price);
  else
    if r.quote_only is true or r.pricing_mode is distinct from 'fixed' or r.quote_status is not null then
      raise exception 'Versioned quote required';
    end if;
    select * into strict p from public.vendor_packages where id=r.package_id for share;
    select * into strict t from public.package_tiers where id=r.package_tier_id for share;
    if p.contractor_id<>r.contractor_id or p.service_id is distinct from r.service_catalog_id
      or t.package_id<>p.id or p.pricing_mode<>'fixed' or not p.is_active or p.needs_review is true
      or r.frequency is null or t.frequency is distinct from r.frequency
      or not exists(select 1 from public.resolve_package_tier_price(p.id,t.id)) then raise exception 'Selected offering is not eligible'; end if;
    perform 1 from public.contractors where id=p.contractor_id and is_active and marketing_enabled for share;
    if not found then raise exception 'Selected offering is not eligible'; end if;
    perform 1 from public.services_catalog where id=p.service_id and is_active for share;
    if not found then raise exception 'Selected offering is not eligible'; end if;
    perform 1 from public.coverage_areas where zip_code=r.zip_code and is_active for share;
    if not found then raise exception 'Selected offering is not eligible'; end if;
    perform 1 from public.contractor_service_zips where contractor_id=p.contractor_id and zip_code=r.zip_code for share;
    if not found then raise exception 'Selected offering is not eligible'; end if;
    if t.rule_question_key is not null then
      if coalesce(r.package_question_answers->t.rule_question_key->>'answer','') !~ '^-?[0-9]+([.][0-9]+)?$' then
        raise exception 'Offering answers do not match selected tier';
      end if;
      if (t.rule_min is not null and (r.package_question_answers->t.rule_question_key->>'answer')::numeric<t.rule_min)
        or (t.rule_max is not null and (r.package_question_answers->t.rule_question_key->>'answer')::numeric>t.rule_max) then
        raise exception 'Offering answers do not match selected tier';
      end if;
    end if;
    perform 1 from public.package_qualifying_questions where package_id=p.id for share;
    if exists(select 1 from public.package_qualifying_questions x where x.package_id=p.id and x.is_required
      and nullif(btrim(r.package_question_answers->x.question_key->>'answer'),'') is null) then
      raise exception 'Required offering answers missing';
    end if;
    -- Promotions have unresolved funding/allocation authority. Do not silently
    -- charge base price when an advertised promotion may apply.
    if r.promotion_id is not null or exists(select 1 from public.package_promotions where package_id=p.id and is_enabled and starts_at<=now() and ends_at>now()) then
      raise exception 'Promotion allocation integration required';
    end if;
    select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') into questions from public.package_qualifying_questions x where x.package_id=p.id;
    price:=private.money_minor_units(t.price);
    evidence:=jsonb_build_object('kind','offering','context',request_context,'package',to_jsonb(p),'tier',to_jsonb(t),'questions',questions,'service',price);
  end if;
  return evidence||jsonb_build_object('version','commercial-v1:'||encode(sha256(convert_to(evidence::text,'UTF8')),'hex'));
end $$;

create function public.money_preview_commercial_source(p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform public.money_require_finance(auth.uid());
  perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
  perform 1 from public.service_requests where id=p_request for update;
  return private.money_source(p_request);
end $$;
revoke all on function public.money_preview_commercial_source(uuid) from public,anon,authenticated,service_role;
grant execute on function public.money_preview_commercial_source(uuid) to authenticated;

alter function public.money_publish_snapshot(uuid,jsonb,uuid,uuid) set schema private;
revoke all on function private.money_publish_snapshot(uuid,jsonb,uuid,uuid) from public,anon,authenticated,service_role;
create function public.money_publish_snapshot(p_request uuid,p_terms jsonb,p_actor uuid,p_approver uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare source jsonb; existing uuid; result uuid;
begin
  perform public.money_require_finance(p_actor); perform public.money_require_finance(p_approver);
  perform public.money_require_review(p_actor,p_approver,jsonb_build_object('operation','snapshot','request',p_request,'terms',p_terms));
  perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
  perform 1 from public.service_requests where id=p_request for update;
  source:=private.money_source(p_request);
  if p_terms->>'source_version' is distinct from source->>'version' then raise exception 'Commercial source changed; review current terms'; end if;
  if source->>'kind'='quote' then
    if (p_terms->>'total')::numeric is distinct from (source->>'total')::numeric then raise exception 'Checkout total must equal accepted quote'; end if;
  elsif (p_terms->>'service')::numeric is distinct from (source->>'service')::numeric then
    raise exception 'Service amount must equal selected offering';
  end if;
  -- Identical separately-approved publication retries return the same snapshot,
  -- including after a checkout started. Never create another invoice on a retry.
  select s.id into existing from public.money_snapshots s join public.money_obligations o on o.current_snapshot_id=s.id
    join public.money_commercial_sources c on c.snapshot_id=s.id
    where o.service_request_id=p_request and c.source_hash=source->>'version'
      and s.created_by=p_actor and s.approved_by=p_approver
      and c.reviewed_terms=p_terms;
  if existing is not null then return existing; end if;
  result:=private.money_publish_snapshot(p_request,p_terms,p_actor,p_approver);
  insert into public.money_commercial_sources(snapshot_id,source_kind,source_hash,evidence,reviewed_terms) values(result,source->>'kind',source->>'version',source,p_terms);
  return result;
end $$;
revoke all on function public.money_publish_snapshot(uuid,jsonb,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.money_publish_snapshot(uuid,jsonb,uuid,uuid) to service_role;

alter function public.money_prepare_checkout(uuid,text) set schema private;
revoke all on function private.money_prepare_checkout(uuid,text) from public,anon,authenticated,service_role;
create function public.money_prepare_checkout(p_snapshot uuid,p_mode text) returns public.money_checkout_attempts
language plpgsql security definer set search_path='' as $$
declare request_id uuid; owner_id uuid; source jsonb; binding public.money_commercial_sources; r public.service_requests;
begin
  select o.service_request_id,o.customer_id into strict request_id,owner_id from public.money_snapshots s
    join public.money_obligations o on o.id=s.obligation_id where s.id=p_snapshot;
  if auth.uid() is null or auth.uid()<>owner_id then raise exception 'Homeowner authorization required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(request_id::text,0));
  select * into strict r from public.service_requests where id=request_id for update;
  select * into binding from public.money_commercial_sources where snapshot_id=p_snapshot;
  if not found then raise exception 'Legacy snapshot requires source reconciliation'; end if;
  if r.status not in ('scheduled','in_progress','pending_review','vendor_completed','homeowner_confirmed','completed','review_requested','reviewed','closed') or binding.evidence->'context' is distinct from private.money_source_context(r) then
    raise exception 'Commercial source changed; review current terms';
  end if;
  -- A reserved attempt is an agreement to the displayed snapshot. Honor that
  -- price on retries and deposit balances even after unrelated catalog edits.
  if binding.source_kind='quote' or not exists(select 1 from public.money_checkout_attempts where snapshot_id=p_snapshot and status<>'expired') then
    source:=private.money_source(request_id);
    if binding.source_hash<>source->>'version' then raise exception 'Commercial source changed; review current terms'; end if;
  end if;
  return private.money_prepare_checkout(p_snapshot,p_mode);
end $$;
revoke all on function public.money_prepare_checkout(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.money_prepare_checkout(uuid,text) to authenticated;
revoke all on function private.money_source(uuid),private.money_minor_units(numeric),private.money_source_context(public.service_requests) from public,anon,authenticated,service_role;

-- A provider call occurs after attempt reservation, outside the DB transaction.
-- Freeze request-bound source changes across that interval and all uncertainty.
-- Catalog edits may invalidate new checkout, but never rewrite an issued snapshot.
create function private.money_guard_request_source() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if (private.money_source_context(new) is distinct from private.money_source_context(old)
      or jsonb_build_array(new.current_quote_id,new.quote_revision,new.quote_status) is distinct from jsonb_build_array(old.current_quote_id,old.quote_revision,old.quote_status))
    and exists(select 1 from public.money_obligations o join public.money_checkout_attempts a on a.obligation_id=o.id
      where o.service_request_id=old.id and a.status<>'expired') then
    raise exception 'Commercial checkout must be reconciled before changing source';
  end if;
  return new;
end $$;
revoke all on function private.money_guard_request_source() from public,anon,authenticated,service_role;
create trigger protect_checkout_source before update on public.service_requests for each row execute function private.money_guard_request_source();
