-- Phase 7.5F-1 (TRACE-159): SLA-breach observation ledger and operator-run detector.
-- Plan: governance/PHASE-7-SLA-BREACH-OBSERVATION-PLAN-7-5F.md (revision 4; Codex D-1..D-9 and
-- F-1..F-10). Owner approval 2026-11-25 ET (DEC-2026-069): OD-1 rules T-3, T-4 failure aging, T-5,
-- T-8 and T-10 with their specified kinds; OD-2 manual operator scans only, no scheduler; P-1
-- dispute and dispute-appeal tickets once under T-8; P-2 operational records, 90-day logical
-- retention with this manual purge; P-3 and P-7 any authenticated admin; P-4 no derived
-- first-reply lateness; P-5 no backfill; P-6 no cadence.
--
-- Additive only. No existing table, column, constraint, policy, grant, function or trigger is
-- altered. The detector CALLS the existing queue readers as the invoking admin (D-1) and restates
-- none of them; it writes only the 7.5F tables: no notice, flag, event, job, ticket, quote,
-- payment, offer, HTTP request or cron job. An observation is not an alert.
--
-- What an observation proves: the reader listed the item as past due_at under rule T-n, judged at
-- evaluated_at (transaction now()), in data that includes every commit before observed_at (the
-- rule's read time). It does not prove the item is still overdue, how long it lasted, or that
-- anything unobserved never breached: counts are a lower bound (plan §3.2, M-1..M-11).
--
-- Retention (P-2): 90 days, computed at read time from one policy row. Expired rows are hidden from
-- every readback even while they cannot yet be deleted (F-8); only the bounded admin purge deletes
-- them, never an unexpired row. Nothing schedules the purge or the detector.

-- 1. Tables ---------------------------------------------------------------------------------------
-- Foreign keys are ordinary, NON-DEFERRABLE, immediate constraints; a run start, its observations
-- and its result are inserted in that order in one transaction (F-2).

create table private.operations_sla_detector_runs (
  id uuid primary key,                       -- the caller's version-7 run key
  actor uuid not null,
  applied_limit integer not null check (applied_limit between 1 and 500),
  rule_set text not null,
  evaluated_at timestamptz not null,         -- transaction now(): the readers' predicate clock
  started_at timestamptz not null,           -- clock_timestamp() at insert
  check (evaluated_at <= started_at)
);

create table private.operations_sla_observations (
  id bigint generated always as identity primary key,
  run_id uuid not null references private.operations_sla_detector_runs(id),
  rule_id text not null,
  queue text not null,
  item_kind text not null,
  subject_id uuid not null,                  -- no foreign key: no business delete is blocked or cascaded
  subject_kind text,                         -- T-8 only: the ticket's kind (P-1 label)
  request_id uuid,
  due_at timestamptz not null,
  evaluated_at timestamptz not null,
  observed_at timestamptz not null,
  constraint operations_sla_observations_kind_check check ((rule_id, queue, item_kind) in (
    ('T-3', 'quote', 'proposal_missing'), ('T-3', 'quote', 'proposal_review'), ('T-3', 'quote', 'quote_decision'),
    ('T-4', 'quote', 'payment_failed'), ('T-5', 'fulfillment', 'confirmation_overdue'),
    ('T-8', 'support', 'first_reply_overdue'), ('T-10', 'offer_terms', 'unanswered'))),
  constraint operations_sla_observations_label_check check ((rule_id = 'T-8') = (subject_kind is not null)),
  -- T-8's reader is strict (response_due_at < now()); every other reader lists at due_at itself.
  constraint operations_sla_observations_due_check check (
    case when rule_id = 'T-8' then due_at < evaluated_at else due_at <= evaluated_at end),
  constraint operations_sla_observations_time_check check (evaluated_at <= observed_at),
  constraint operations_sla_observations_episode_key unique (rule_id, item_kind, subject_id, due_at)
);
create index operations_sla_observations_run_idx on private.operations_sla_observations(run_id);
create index operations_sla_observations_observed_idx on private.operations_sla_observations(observed_at, id);

create table private.operations_sla_detector_run_results (
  run_id uuid primary key references private.operations_sla_detector_runs(id),
  outcome text not null check (outcome in ('complete', 'partial', 'failed', 'skipped')),
  rules jsonb not null check (jsonb_typeof(rules) = 'array'),  -- SQLSTATE only; never a message or row content
  finished_at timestamptz not null
);
create index operations_sla_detector_run_results_finished_idx on private.operations_sla_detector_run_results(finished_at, run_id);

-- One row. Null retention means "not yet decided": nothing expires and the purge refuses. Changed
-- only by a reviewed migration naming the owner's decision. The 7-day floor is a technical bound
-- above the 24-hour run-key retry lifetime (F-9), not a retention policy.
create table private.operations_sla_retention (
  singleton boolean primary key default true check (singleton),
  retention interval check (retention is null or retention >= interval '7 days'),
  decision_ref text
);
insert into private.operations_sla_retention(retention, decision_ref) values
  (interval '90 days', 'P-2, owner approval 2026-11-25 ET (DEC-2026-069): CFG-011 operational records, 90 days');

-- Counts-only purge log: never a row's content. Logical counts are items (observations, runs,
-- purge-log rows); physical counts are table rows (a run is one start row and one result row).
-- Remaining expired counts are logical, capped at 10,000.
create table private.operations_sla_purges (
  id bigint generated always as identity primary key,
  actor uuid not null,
  outcome text not null check (outcome in ('complete', 'skipped')),
  applied_limit integer not null check (applied_limit between 1 and 1000),
  deleted_observations integer not null check (deleted_observations >= 0),
  deleted_runs integer not null check (deleted_runs >= 0),
  deleted_purge_logs integer not null check (deleted_purge_logs >= 0),
  deleted_observation_rows integer not null check (deleted_observation_rows >= 0),
  deleted_run_result_rows integer not null check (deleted_run_result_rows >= 0),
  deleted_run_start_rows integer not null check (deleted_run_start_rows >= 0),
  deleted_purge_log_rows integer not null check (deleted_purge_log_rows >= 0),
  remaining_expired_observations integer check (remaining_expired_observations between 0 and 10000),
  remaining_expired_runs integer check (remaining_expired_runs between 0 and 10000),
  remaining_expired_runs_referenced integer check (remaining_expired_runs_referenced between 0 and 10000),
  remaining_expired_purge_logs integer check (remaining_expired_purge_logs between 0 and 10000),
  remaining_over_cap boolean,
  ran_at timestamptz not null default now(),
  check ((outcome = 'skipped') = (remaining_expired_observations is null))
);
create index operations_sla_purges_ran_idx on private.operations_sla_purges(ran_at, id);

alter table private.operations_sla_detector_runs enable row level security;
alter table private.operations_sla_observations enable row level security;
alter table private.operations_sla_detector_run_results enable row level security;
alter table private.operations_sla_retention enable row level security;
alter table private.operations_sla_purges enable row level security;
revoke all on private.operations_sla_detector_runs, private.operations_sla_observations,
  private.operations_sla_detector_run_results, private.operations_sla_retention, private.operations_sla_purges
  from public, anon, authenticated, service_role;
revoke all on sequence private.operations_sla_observations_id_seq, private.operations_sla_purges_id_seq
  from public, anon, authenticated, service_role;

-- 2. Retention helpers ----------------------------------------------------------------------------
-- The instant before which a row is logically expired, or null while retention is undecided. The
-- interval is applied as elapsed seconds, so the cutoff does not depend on the session time zone.
create function private.operations_sla_cutoff() returns timestamptz
language sql stable set search_path = '' as $$
  select now() - extract(epoch from r.retention) * interval '1 second'
  from private.operations_sla_retention r where r.retention is not null
$$;

-- Logical expiry, computed on read and never stamped. Depends on time only, never on references.
create function private.operations_sla_expired(p_ts timestamptz) returns boolean
language sql stable set search_path = '' as $$
  select coalesce(p_ts < private.operations_sla_cutoff(), false)
$$;

-- 3. Append-only guard ----------------------------------------------------------------------------
-- UPDATE is always refused. DELETE is refused unless this transaction is the retention purge
-- (transaction-local setting equal to the current transaction id) AND the row is logically
-- expired. A run start may go only after its result row is gone (the purge deletes the result
-- first, and only when expired). Table privileges remain the primary control; the table owner can
-- still bypass triggers, which no function can prevent.
create function private.operations_sla_guard() returns trigger
language plpgsql set search_path = '' as $$
declare row_ jsonb := to_jsonb(old); ts timestamptz;
begin
  if tg_op = 'UPDATE' then
    raise exception 'SLA observation records are append-only' using errcode = '55000';
  end if;
  if coalesce(current_setting('private.operations_sla_purge', true), '') is distinct from pg_current_xact_id()::text then
    raise exception 'SLA observation records are deleted only by the retention purge' using errcode = '55000';
  end if;
  ts := case tg_table_name
    when 'operations_sla_observations' then (row_->>'observed_at')::timestamptz
    when 'operations_sla_detector_run_results' then (row_->>'finished_at')::timestamptz
    when 'operations_sla_detector_runs' then (row_->>'started_at')::timestamptz
    when 'operations_sla_purges' then (row_->>'ran_at')::timestamptz end;
  if tg_table_name = 'operations_sla_detector_runs' then
    if exists(select 1 from private.operations_sla_detector_run_results x where x.run_id = (row_->>'id')::uuid) then
      raise exception 'A run is deleted only after its result' using errcode = '55000';
    end if;
  end if;
  if not private.operations_sla_expired(ts) then
    raise exception 'An unexpired SLA observation record cannot be deleted' using errcode = '55000';
  end if;
  return old;
end $$;

create trigger operations_sla_detector_runs_guard before update or delete on private.operations_sla_detector_runs
  for each row execute function private.operations_sla_guard();
create trigger operations_sla_observations_guard before update or delete on private.operations_sla_observations
  for each row execute function private.operations_sla_guard();
create trigger operations_sla_detector_run_results_guard before update or delete on private.operations_sla_detector_run_results
  for each row execute function private.operations_sla_guard();
create trigger operations_sla_purges_guard before update or delete on private.operations_sla_purges
  for each row execute function private.operations_sla_guard();

-- 4. Run keys --------------------------------------------------------------------------------------
-- The issue time inside a version-7 key (its first 48 bits, Unix milliseconds); null for any other
-- key. The timestamp is validated as the detector specifies; it is neither proof of server issuance
-- nor an authorization (admin is checked on every call).
create function private.operations_sla_key_issued_at(p_key uuid) returns timestamptz
language sql immutable set search_path = '' as $$
  select case when substr(p_key::text, 15, 1) = '7' and substr(p_key::text, 20, 1) in ('8', '9', 'a', 'b')
    then timestamptz 'epoch' + ('x' || lpad(substr(replace(p_key::text, '-', ''), 1, 12), 16, '0'))::bit(64)::bigint * interval '1 millisecond' end
$$;

-- A fresh version-7 key on the database clock. A convenience, not a control: it writes nothing, and
-- a lost response costs nothing (ask again).
create function public.admin_sla_new_run_key() returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare h text := replace(gen_random_uuid()::text, '-', '');
begin
  if not coalesce(public.has_role(auth.uid(), 'admin'), false) then
    raise exception 'Only admins can run the SLA detector' using errcode = '42501';
  end if;
  return (lpad(to_hex(floor(extract(epoch from clock_timestamp()) * 1000)::bigint), 12, '0') || '7' || substr(h, 14))::uuid;
end $$;

-- 5. Shared shapes ---------------------------------------------------------------------------------
create function private.operations_sla_run_json(r private.operations_sla_detector_runs, x private.operations_sla_detector_run_results)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('run_key', r.id, 'actor', r.actor, 'applied_limit', r.applied_limit, 'rule_set', r.rule_set,
    'evaluated_at', r.evaluated_at, 'started_at', r.started_at, 'finished_at', x.finished_at, 'outcome', x.outcome,
    'rules', x.rules,
    'totals', (select jsonb_build_object(
        'listed', coalesce(sum((e->>'listed')::int), 0), 'already_recorded', coalesce(sum((e->>'already_recorded')::int), 0),
        'inserted', coalesce(sum((e->>'inserted')::int), 0), 'conflicted', coalesce(sum((e->>'conflicted')::int), 0),
        'over_limit', coalesce(sum((e->>'over_limit')::int), 0))
      from jsonb_array_elements(x.rules) e where e->>'status' = 'ok'))
$$;

-- The OD-1 rule set compiled into this detector, in evaluation order.
create function private.operations_sla_rules() returns text[]
language sql immutable set search_path = '' as $$ select array['T-3', 'T-4', 'T-5', 'T-8', 'T-10'] $$;

-- One rule's qualifying items, read through that rule's existing reader (plan §2), normalized to
-- {queue, kind, subject_id, request_id, due_at, subject_kind}. The condition is exactly the
-- reader's own: its listing, plus `aged` for the quote queue and `overdue` for support. Volatile,
-- so the reader's read starts after the caller's observed_at.
create function private.operations_sla_rule_items(p_rule text) returns jsonb
language plpgsql volatile set search_path = '' as $$
declare result jsonb;
begin
  case p_rule
  when 'T-3' then
    select jsonb_agg(jsonb_build_object('queue', 'quote', 'kind', i->>'kind',
        'subject_id', case i->>'kind' when 'proposal_missing' then i->>'request_id'
          when 'proposal_review' then i#>>'{detail,proposal_id}' else i#>>'{detail,quote_id}' end,
        'request_id', i->>'request_id', 'due_at', i->>'due_at', 'subject_kind', null))
      into result from jsonb_array_elements(public.admin_quote_queue()->'items') i
     where i->>'kind' in ('proposal_missing', 'proposal_review', 'quote_decision') and (i->>'aged')::boolean;
  when 'T-4' then
    select jsonb_agg(jsonb_build_object('queue', 'quote', 'kind', i->>'kind', 'subject_id', i#>>'{detail,attempt_id}',
        'request_id', i->>'request_id', 'due_at', i->>'due_at', 'subject_kind', null))
      into result from jsonb_array_elements(public.admin_quote_queue()->'items') i
     where i->>'kind' = 'payment_failed' and (i->>'aged')::boolean;
  when 'T-5' then
    -- The item's `since` is the 72-hour mark itself.
    select jsonb_agg(jsonb_build_object('queue', 'fulfillment', 'kind', i->>'kind', 'subject_id', i->>'request_id',
        'request_id', i->>'request_id', 'due_at', i->>'since', 'subject_kind', null))
      into result from jsonb_array_elements(public.admin_fulfillment_queue()->'items') i
     where i->>'kind' = 'confirmation_overdue';
  when 'T-8' then
    -- Every open or in-progress ticket the queue marks overdue, disputes and dispute appeals included
    -- once (P-1), labelled with the ticket's kind.
    select jsonb_agg(jsonb_build_object('queue', 'support', 'kind', 'first_reply_overdue', 'subject_id', i->>'ticket_id',
        'request_id', i->>'job_id', 'due_at', i->>'response_due_at', 'subject_kind', i->>'kind'))
      into result from jsonb_array_elements(public.admin_support_queue(false)->'items') i
     where (i->>'overdue')::boolean;
  when 'T-10' then
    -- The item's `since` is the provider's acceptance; the target is 24 hours later (D-2).
    select jsonb_agg(jsonb_build_object('queue', 'offer_terms', 'kind', i->>'kind', 'subject_id', i->>'terms_id',
        'request_id', i->>'request_id', 'due_at', (i->>'since')::timestamptz + interval '24 hours', 'subject_kind', null))
      into result from jsonb_array_elements(public.admin_offer_terms_queue()->'items') i
     where i->>'kind' = 'unanswered';
  else
    raise exception 'Unknown SLA rule' using errcode = '22023';
  end case;
  return coalesce(result, '[]'::jsonb);
end $$;

-- 6. Detector ----------------------------------------------------------------------------------------
create function public.admin_detect_sla_breaches(p_run_key uuid, p_limit integer default 200) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_limit integer := least(500, greatest(1, coalesce(p_limit, 200)));  -- step 2: normalized before any comparison
  v_issued timestamptz;
  v_run private.operations_sla_detector_runs;
  v_res private.operations_sla_detector_run_results;
  v_rule text;
  v_rules jsonb := '[]'::jsonb;
  v_items jsonb;
  v_observed timestamptz;
  v_state text;
  v_errors integer := 0;
  v_listed integer; v_already integer; v_inserted integer; v_conflicted integer; v_over integer;
  c_rule_set constant text := 'OD-1 2026-11-25: T-3 (proposal_missing, proposal_review, quote_decision), T-4 (payment_failed), T-5 (confirmation_overdue), T-8 (first reply), T-10 (unanswered)';
begin
  -- Step 1: authorization on every call, whatever the key; key shape and age; isolation.
  if v_actor is null or not coalesce(public.has_role(v_actor, 'admin'), false) then
    raise exception 'Only admins can run the SLA detector' using errcode = '42501';
  end if;
  v_issued := private.operations_sla_key_issued_at(p_run_key);
  if v_issued is null then
    raise exception 'A version-7 run key is required' using errcode = '22023';
  end if;
  if v_issued > clock_timestamp() + interval '5 minutes' then
    raise exception 'Run key is issued in the future' using errcode = '22023';
  end if;
  -- Step 4 relies on a statement after the lock seeing rows committed while it waited.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'The SLA detector requires READ COMMITTED isolation' using errcode = '55000';
  end if;

  -- Step 3: serialize the key (F-1). A same-key call waits here until this one ends.
  perform pg_advisory_xact_lock(hashtextextended('private.operations_sla_detector:key:' || p_run_key::text, 0));

  -- Step 4: recheck after serialization, in a new statement.
  select * into v_run from private.operations_sla_detector_runs where id = p_run_key;
  if found then
    if v_run.actor <> v_actor then
      raise exception 'Run key reused by another operator' using errcode = '22023';
    end if;
    if v_run.applied_limit <> v_limit then
      raise exception 'Run key reused with different parameters' using errcode = '22023';
    end if;
    select * into v_res from private.operations_sla_detector_run_results where run_id = p_run_key;
    if private.operations_sla_expired(v_res.finished_at) then
      return jsonb_build_object('run_key', p_run_key, 'state', 'expired', 'replayed', true);
    end if;
    return private.operations_sla_run_json(v_run, v_res) || jsonb_build_object('state', 'visible', 'replayed', true);
  end if;
  if v_issued < clock_timestamp() - interval '24 hours' then
    raise exception 'Run key is too old to start a scan' using errcode = '22023';
  end if;

  -- Step 5: one scan or purge at a time; contention is recorded, not raised (D-4).
  if not pg_try_advisory_xact_lock(hashtextextended('private.operations_sla_detector:scan', 0)) then
    insert into private.operations_sla_detector_runs(id, actor, applied_limit, rule_set, evaluated_at, started_at)
      values (p_run_key, v_actor, v_limit, c_rule_set, now(), clock_timestamp()) returning * into v_run;
    insert into private.operations_sla_detector_run_results(run_id, outcome, rules, finished_at)
      values (p_run_key, 'skipped',
        (select jsonb_agg(jsonb_build_object('rule', r, 'status', 'skipped') order by o) from unnest(private.operations_sla_rules()) with ordinality u(r, o)),
        clock_timestamp())
      returning * into v_res;
    return private.operations_sla_run_json(v_run, v_res) || jsonb_build_object('state', 'visible', 'replayed', false);
  end if;

  -- Step 6: the run start, before anything references it (F-2).
  insert into private.operations_sla_detector_runs(id, actor, applied_limit, rule_set, evaluated_at, started_at)
    values (p_run_key, v_actor, v_limit, c_rule_set, now(), clock_timestamp()) returning * into v_run;

  -- Step 7: each rule in its own savepoint. A cancellation (57014) is not caught by WHEN OTHERS:
  -- it aborts the whole attempt, which then writes nothing (plan §4.8).
  foreach v_rule in array private.operations_sla_rules() loop
    v_observed := null;
    begin
      v_observed := clock_timestamp();
      v_items := private.operations_sla_rule_items(v_rule);
      with cand as (
        select distinct x.queue, x.kind, x.subject_id, x.request_id, x.due_at, x.subject_kind
        from jsonb_to_recordset(v_items) x(queue text, kind text, subject_id uuid, request_id uuid, due_at timestamptz, subject_kind text)
      ), fresh as (
        -- F-3: episodes already in the ledger (expired-but-unpurged included) never consume the cap.
        select c.* from cand c
        where not exists(select 1 from private.operations_sla_observations o
          where o.rule_id = v_rule and o.item_kind = c.kind and o.subject_id = c.subject_id and o.due_at = c.due_at)
      ), chosen as (
        select f.* from fresh f order by f.due_at, f.subject_id limit v_limit
      ), ins as (
        insert into private.operations_sla_observations(run_id, rule_id, queue, item_kind, subject_id, subject_kind, request_id,
            due_at, evaluated_at, observed_at)
          select p_run_key, v_rule, c.queue, c.kind, c.subject_id, c.subject_kind, c.request_id, c.due_at, v_run.evaluated_at, v_observed
          from chosen c
        on conflict on constraint operations_sla_observations_episode_key do nothing
        returning 1
      )
      select (select count(*) from cand), (select count(*) from cand) - (select count(*) from fresh), (select count(*) from ins),
          (select count(*) from chosen) - (select count(*) from ins), (select count(*) from fresh) - (select count(*) from chosen)
        into v_listed, v_already, v_inserted, v_conflicted, v_over;
      v_rules := v_rules || jsonb_build_array(jsonb_build_object('rule', v_rule, 'status', 'ok', 'sqlstate', null,
        'observed_at', v_observed, 'listed', v_listed, 'already_recorded', v_already, 'inserted', v_inserted,
        'conflicted', v_conflicted, 'over_limit', v_over));
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate;
      v_errors := v_errors + 1;
      v_rules := v_rules || jsonb_build_array(jsonb_build_object('rule', v_rule, 'status', 'error', 'sqlstate', v_state,
        'observed_at', v_observed, 'listed', null, 'already_recorded', null, 'inserted', null, 'conflicted', null, 'over_limit', null));
    end;
  end loop;

  -- Step 8: the result, last; its presence completes the run.
  insert into private.operations_sla_detector_run_results(run_id, outcome, rules, finished_at)
    values (p_run_key,
      case when v_errors = 0 then 'complete' when v_errors = cardinality(private.operations_sla_rules()) then 'failed' else 'partial' end,
      v_rules, clock_timestamp())
    returning * into v_res;
  return private.operations_sla_run_json(v_run, v_res) || jsonb_build_object('state', 'visible', 'replayed', false);
end $$;

-- 7. Readbacks (admin only; expired rows excluded at read time) ---------------------------------------
create function public.admin_sla_observations(p_rule text default null, p_before_id bigint default null, p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare lim integer := least(200, greatest(1, coalesce(p_limit, 50))); cutoff timestamptz := private.operations_sla_cutoff(); result jsonb;
begin
  if not coalesce(public.has_role(auth.uid(), 'admin'), false) then
    raise exception 'Only admins can read SLA observations' using errcode = '42501';
  end if;
  if p_rule is not null and not (p_rule = any(private.operations_sla_rules())) then
    raise exception 'Unknown SLA rule' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'run_key', o.run_id, 'rule', o.rule_id, 'queue', o.queue,
      'kind', o.item_kind, 'subject_id', o.subject_id, 'subject_kind', o.subject_kind, 'request_id', o.request_id,
      'due_at', o.due_at, 'evaluated_at', o.evaluated_at, 'observed_at', o.observed_at,
      'lag_seconds', extract(epoch from o.observed_at - o.due_at)) order by o.id desc), '[]'::jsonb)
    into result
    from (select * from private.operations_sla_observations x
           where (p_rule is null or x.rule_id = p_rule) and (p_before_id is null or x.id < p_before_id)
             and (cutoff is null or x.observed_at >= cutoff)
           order by x.id desc limit lim) o;
  return jsonb_build_object('checked_at', now(), 'items', result,
    'next_before_id', case when jsonb_array_length(result) = lim then (result->(lim - 1)->>'id')::bigint end);
end $$;

create function public.admin_sla_detector_runs(p_limit integer default 20)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare lim integer := least(100, greatest(1, coalesce(p_limit, 20))); cutoff timestamptz := private.operations_sla_cutoff();
begin
  if not coalesce(public.has_role(auth.uid(), 'admin'), false) then
    raise exception 'Only admins can read SLA detector runs' using errcode = '42501';
  end if;
  return jsonb_build_object('checked_at', now(), 'items', coalesce((
    select jsonb_agg(private.operations_sla_run_json(q.r, q.x)
        || jsonb_build_object('actor_name', coalesce((select nullif(btrim(p.full_name), '') from public.profiles p where p.user_id = (q.r).actor), 'Operator'))
        order by (q.r).started_at desc, (q.r).id)
    from (select r0 as r, x0 as x from private.operations_sla_detector_runs r0
            join private.operations_sla_detector_run_results x0 on x0.run_id = r0.id
           where cutoff is null or x0.finished_at >= cutoff
           order by r0.started_at desc, r0.id limit lim) q), '[]'::jsonb));
end $$;

-- The run under one key. 'visible' with its result; 'expired' (present, past retention, content
-- withheld); or 'not_visible': NO COMMITTED RESULT IS VISIBLE. An attempt may still be running,
-- may not have reached the database, may have rolled back, or the run may have been purged. Never
-- "failed". A plain read: it does not wait on the key lock.
create function public.admin_sla_detector_run(p_run_key uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_issued timestamptz := private.operations_sla_key_issued_at(p_run_key);
  v_run private.operations_sla_detector_runs; v_res private.operations_sla_detector_run_results;
begin
  if not coalesce(public.has_role(auth.uid(), 'admin'), false) then
    raise exception 'Only admins can read SLA detector runs' using errcode = '42501';
  end if;
  if v_issued is null then
    raise exception 'A version-7 run key is required' using errcode = '22023';
  end if;
  select * into v_run from private.operations_sla_detector_runs where id = p_run_key;
  select * into v_res from private.operations_sla_detector_run_results where run_id = p_run_key;
  if v_run.id is not null and v_res.run_id is not null then
    if private.operations_sla_expired(v_res.finished_at) then
      return jsonb_build_object('run_key', p_run_key, 'state', 'expired', 'checked_at', now());
    end if;
    return jsonb_build_object('run_key', p_run_key, 'state', 'visible', 'checked_at', now(),
      'run', private.operations_sla_run_json(v_run, v_res));
  end if;
  return jsonb_build_object('run_key', p_run_key, 'state', 'not_visible', 'checked_at', now(),
    'retry_until', v_issued + interval '24 hours');
end $$;

-- Per rule: unexpired observations and lag; runs by outcome and rule status; first and last run in
-- which each rule completed and the largest interval between such runs, DESCRIPTIVE ONLY. No
-- coverage, completeness or miss-rate field exists.
create function public.admin_sla_observation_summary(p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare cutoff timestamptz := private.operations_sla_cutoff();
begin
  if not coalesce(public.has_role(auth.uid(), 'admin'), false) then
    raise exception 'Only admins can read SLA observations' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from >= p_to then
    raise exception 'A window with from before to is required' using errcode = '22023';
  end if;
  return (
    with runs as (
      select r.id, r.evaluated_at, x.outcome, x.rules from private.operations_sla_detector_runs r
        join private.operations_sla_detector_run_results x on x.run_id = r.id
       where r.evaluated_at >= p_from and r.evaluated_at < p_to and (cutoff is null or x.finished_at >= cutoff)
    ), rule_runs as (
      select e->>'rule' as rule, e->>'status' as status, r.evaluated_at from runs r cross join lateral jsonb_array_elements(r.rules) e
    ), completed as (
      select rule, evaluated_at, evaluated_at - lag(evaluated_at) over (partition by rule order by evaluated_at) as gap
      from rule_runs where status = 'ok'
    ), obs as (
      select o.rule_id, o.observed_at - o.due_at as lag from private.operations_sla_observations o
       where o.observed_at >= p_from and o.observed_at < p_to and (cutoff is null or o.observed_at >= cutoff)
    )
    select jsonb_build_object('checked_at', now(), 'from', p_from, 'to', p_to,
      'statement', 'Counts are a lower bound: a breach that begins and ends between scans is never recorded, and absence is not evidence of compliance. Lag is time past due when observed, not breach duration. Intervals between scans describe when scans ran; they do not bound, estimate or count missed breaches.',
      'runs', jsonb_build_object('total', (select count(*) from runs),
        'complete', (select count(*) from runs where outcome = 'complete'), 'partial', (select count(*) from runs where outcome = 'partial'),
        'failed', (select count(*) from runs where outcome = 'failed'), 'skipped', (select count(*) from runs where outcome = 'skipped')),
      'rules', (select jsonb_agg(jsonb_build_object('rule', rl.rule,
          'observations', (select count(*) from obs where obs.rule_id = rl.rule),
          'min_lag_seconds', (select extract(epoch from min(lag)) from obs where obs.rule_id = rl.rule),
          'max_lag_seconds', (select extract(epoch from max(lag)) from obs where obs.rule_id = rl.rule),
          'run_status', jsonb_build_object('ok', (select count(*) from rule_runs q where q.rule = rl.rule and q.status = 'ok'),
            'error', (select count(*) from rule_runs q where q.rule = rl.rule and q.status = 'error'),
            'skipped', (select count(*) from rule_runs q where q.rule = rl.rule and q.status = 'skipped')),
          'first_completed_at', (select min(evaluated_at) from completed c where c.rule = rl.rule),
          'last_completed_at', (select max(evaluated_at) from completed c where c.rule = rl.rule),
          'descriptive_largest_interval_seconds', (select extract(epoch from max(gap)) from completed c where c.rule = rl.rule))
        order by rl.o)
        from unnest(private.operations_sla_rules()) with ordinality rl(rule, o))));
end $$;

-- 8. Retention purge (P-7: any admin, operator-invoked; no scheduler) -----------------------------------
-- Refused (55000, writing nothing) while retention is undecided. Shares the scan lock: a purge and
-- a scan never overlap; contention is logged as 'skipped'. Each phase deletes at most the clamped
-- limit of LOGICAL items, oldest first, skipping locked rows: (1) observations; (2) runs whose
-- observations are all gone (result row, then start row: two physical rows per run); (3) purge-log
-- rows, never this call's own. Limit n deletes at most 4n physical rows.
create function public.admin_purge_sla_records(p_limit integer default 100)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_limit integer := least(1000, greatest(1, coalesce(p_limit, 100)));
  v_cutoff timestamptz;
  v_retention interval;
  v_runs uuid[];
  d_obs integer; d_results integer; d_starts integer; d_logs integer;
  r_obs integer; r_runs integer; r_ref integer; r_logs integer;
  v_oldest timestamptz;
  v_log private.operations_sla_purges;
begin
  if v_actor is null or not coalesce(public.has_role(v_actor, 'admin'), false) then
    raise exception 'Only admins can purge SLA records' using errcode = '42501';
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'The SLA purge requires READ COMMITTED isolation' using errcode = '55000';
  end if;
  v_cutoff := private.operations_sla_cutoff();
  if v_cutoff is null then
    raise exception 'SLA record retention is not decided; nothing can be purged' using errcode = '55000';
  end if;
  select retention into v_retention from private.operations_sla_retention;
  if not pg_try_advisory_xact_lock(hashtextextended('private.operations_sla_detector:scan', 0)) then
    insert into private.operations_sla_purges(actor, outcome, applied_limit, deleted_observations, deleted_runs, deleted_purge_logs,
        deleted_observation_rows, deleted_run_result_rows, deleted_run_start_rows, deleted_purge_log_rows)
      values (v_actor, 'skipped', v_limit, 0, 0, 0, 0, 0, 0, 0) returning * into v_log;
    return jsonb_build_object('purge_id', v_log.id, 'outcome', 'skipped', 'checked_at', now(), 'limit', v_limit);
  end if;
  perform set_config('private.operations_sla_purge', pg_current_xact_id()::text, true);

  -- (1) Observations.
  with doomed as (
    select o.id from private.operations_sla_observations o where o.observed_at < v_cutoff
     order by o.observed_at, o.id limit v_limit for update skip locked
  ), gone as (delete from private.operations_sla_observations o using doomed d where o.id = d.id returning 1)
  select count(*) into d_obs from gone;

  -- (2) Runs: expired and no longer referenced (phase 1's deletions are visible here).
  with doomed as (
    select x.run_id from private.operations_sla_detector_run_results x
     where x.finished_at < v_cutoff and not exists(select 1 from private.operations_sla_observations o where o.run_id = x.run_id)
     order by x.finished_at, x.run_id limit v_limit for update skip locked
  ), gone as (delete from private.operations_sla_detector_run_results x using doomed d where x.run_id = d.run_id returning x.run_id)
  select coalesce(array_agg(run_id), '{}') into v_runs from gone;
  d_results := cardinality(v_runs);
  with gone as (delete from private.operations_sla_detector_runs r where r.id = any(v_runs) returning 1)
  select count(*) into d_starts from gone;
  if d_starts <> d_results then
    raise exception 'SLA purge found a run without its start or result' using errcode = 'XX000';
  end if;

  -- (3) Purge-log rows (this call's row is written below, so it is never among them).
  with doomed as (
    select p.id from private.operations_sla_purges p where p.ran_at < v_cutoff
     order by p.ran_at, p.id limit v_limit for update skip locked
  ), gone as (delete from private.operations_sla_purges p using doomed d where p.id = d.id returning 1)
  select count(*) into d_logs from gone;
  -- Deletion ends here: later statements in this transaction get no purge permission.
  perform set_config('private.operations_sla_purge', '', true);

  -- Remaining expired items per class (logical), counted up to 10,001.
  select count(*) into r_obs from (select 1 from private.operations_sla_observations where observed_at < v_cutoff limit 10001) s;
  select count(*) into r_runs from (select 1 from private.operations_sla_detector_run_results where finished_at < v_cutoff limit 10001) s;
  select count(*) into r_ref from (select 1 from private.operations_sla_detector_run_results x where x.finished_at < v_cutoff
    and exists(select 1 from private.operations_sla_observations o where o.run_id = x.run_id) limit 10001) s;
  select count(*) into r_logs from (select 1 from private.operations_sla_purges where ran_at < v_cutoff limit 10001) s;
  select least((select min(observed_at) from private.operations_sla_observations where observed_at < v_cutoff),
      (select min(finished_at) from private.operations_sla_detector_run_results where finished_at < v_cutoff),
      (select min(ran_at) from private.operations_sla_purges where ran_at < v_cutoff))
    into v_oldest;

  insert into private.operations_sla_purges(actor, outcome, applied_limit, deleted_observations, deleted_runs, deleted_purge_logs,
      deleted_observation_rows, deleted_run_result_rows, deleted_run_start_rows, deleted_purge_log_rows,
      remaining_expired_observations, remaining_expired_runs, remaining_expired_runs_referenced, remaining_expired_purge_logs, remaining_over_cap)
    values (v_actor, 'complete', v_limit, d_obs, d_starts, d_logs, d_obs, d_results, d_starts, d_logs,
      least(r_obs, 10000), least(r_runs, 10000), least(r_ref, 10000), least(r_logs, 10000),
      greatest(r_obs, r_runs, r_ref, r_logs) > 10000)
    returning * into v_log;
  return jsonb_build_object('purge_id', v_log.id, 'outcome', 'complete', 'checked_at', now(), 'limit', v_limit,
    'deleted_logical', jsonb_build_object('observations', d_obs, 'runs', d_starts, 'purge_logs', d_logs),
    'deleted_physical_rows', jsonb_build_object('observations', d_obs, 'run_results', d_results, 'run_starts', d_starts, 'purge_logs', d_logs),
    'remaining_expired_logical', jsonb_build_object('observations', least(r_obs, 10000), 'runs', least(r_runs, 10000),
      'runs_still_referenced', least(r_ref, 10000), 'purge_logs', least(r_logs, 10000), 'cap', 10000,
      'over_cap', greatest(r_obs, r_runs, r_ref, r_logs) > 10000),
    'oldest_remaining_expired_at', v_oldest + extract(epoch from v_retention) * interval '1 second');
end $$;

-- 9. Privileges ---------------------------------------------------------------------------------------
-- Clients: authenticated only, admin checked inside. No anon, service_role or public execute; no
-- scheduler path (OD-2). Helpers are owner only.
revoke all on function
  private.operations_sla_cutoff(),
  private.operations_sla_expired(timestamptz),
  private.operations_sla_guard(),
  private.operations_sla_key_issued_at(uuid),
  private.operations_sla_run_json(private.operations_sla_detector_runs, private.operations_sla_detector_run_results),
  private.operations_sla_rules(),
  private.operations_sla_rule_items(text),
  public.admin_sla_new_run_key(),
  public.admin_detect_sla_breaches(uuid, integer),
  public.admin_sla_observations(text, bigint, integer),
  public.admin_sla_detector_runs(integer),
  public.admin_sla_detector_run(uuid),
  public.admin_sla_observation_summary(timestamptz, timestamptz),
  public.admin_purge_sla_records(integer)
from public, anon, authenticated, service_role;

grant execute on function
  public.admin_sla_new_run_key(),
  public.admin_detect_sla_breaches(uuid, integer),
  public.admin_sla_observations(text, bigint, integer),
  public.admin_sla_detector_runs(integer),
  public.admin_sla_detector_run(uuid),
  public.admin_sla_observation_summary(timestamptz, timestamptz),
  public.admin_purge_sla_records(integer)
to authenticated;
