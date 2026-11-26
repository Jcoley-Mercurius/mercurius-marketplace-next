-- Phase 7.5F-1 forward repair F208-1 (TRACE-159): the detector reads a replayed run's start and
-- result in ONE statement. Record: governance/PHASE-7-SLA-BREACH-OBSERVATION-7-5F-1.md §8.
--
-- Defect (merged in 20261203001000, on hosted since 2026-11-26): step 4 read the run start and its
-- result in two statements. Under READ COMMITTED each statement takes its own snapshot, so a
-- retention purge (which deletes the expired result and start in one transaction, and does not take
-- the key lock) committing between them left the start found and the result absent. The function
-- then returned state 'visible' with a null outcome, finished_at and rules, because
-- operations_sla_expired(null) is false.
--
-- Repair: the start and its result come from one statement, so they are read from one snapshot:
-- both present (replay, or 'expired' with content withheld), or both absent (no committed run under
-- the key, or purged). A start without its result can then arise only from a damaged ledger (a run's
-- start and result commit together, and the purge removes both together); it is refused with XX000,
-- never returned as visible and never scanned again. An absent pair goes on to the existing key
-- checks: a purged run's key was issued at most 5 minutes after its start, its result expired at
-- least 7 days ago (retention floor), so it is past the 24-hour start window and refused as too old.
--
-- Only step 4 changes. Signature, owner, ACL (authenticated only), the actor and normalized-limit
-- checks and their order, expiry withholding, the old-key and future-key refusals, the READ
-- COMMITTED refusal, the key lock, the scan try-lock and steps 5 to 8 are as merged. No table, other
-- function, grant or trigger is touched. CREATE OR REPLACE keeps the existing privileges.

create or replace function public.admin_detect_sla_breaches(p_run_key uuid, p_limit integer default 200) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_limit integer := least(500, greatest(1, coalesce(p_limit, 200)));  -- step 2: normalized before any comparison
  v_issued timestamptz;
  v_run private.operations_sla_detector_runs;
  v_res private.operations_sla_detector_run_results;
  v_pair record;
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

  -- Step 4: recheck after serialization, in a new statement. The start and its result are read in
  -- ONE statement (one snapshot), so a purge committing meanwhile cannot split them (F208-1).
  select r as run_row, x as result_row into v_pair
    from private.operations_sla_detector_runs r
    left join private.operations_sla_detector_run_results x on x.run_id = r.id
   where r.id = p_run_key;
  if found then
    v_run := v_pair.run_row;
    v_res := v_pair.result_row;  -- all fields null when the start has no result
    if v_run.actor <> v_actor then
      raise exception 'Run key reused by another operator' using errcode = '22023';
    end if;
    if v_run.applied_limit <> v_limit then
      raise exception 'Run key reused with different parameters' using errcode = '22023';
    end if;
    if v_res.run_id is null then
      raise exception 'SLA run start found without its result' using errcode = 'XX000';
    end if;
    if private.operations_sla_expired(v_res.finished_at) then
      return jsonb_build_object('run_key', p_run_key, 'state', 'expired', 'replayed', true);
    end if;
    return private.operations_sla_run_json(v_run, v_res) || jsonb_build_object('state', 'visible', 'replayed', true);
  end if;
  -- No pair: never committed under this key, or purged (refused as too old just below).
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
