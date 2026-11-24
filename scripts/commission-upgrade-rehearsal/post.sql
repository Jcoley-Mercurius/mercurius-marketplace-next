-- DEC-2026-067 / TRACE-160 upgrade rehearsal, step 3 of 3. LOCAL ISOLATED STACK ONLY.
-- Runs after step 2 applied 20261201001000 to the database step 1 populated. Every check raises
-- on failure; each success prints a POST line. Rolled back, so it can be re-run.
\set ON_ERROR_STOP 1
begin;
do $$
declare v text; n integer; rec record;
begin
  -- The migration rewrote nothing and every existing snapshot reads 15%.
  if exists (select 1 from rehearsal.ledger_before b where b.journals is distinct from rehearsal.journals(b.obligation_id)) then
    raise exception 'A journal changed across the migration';
  end if;
  raise notice 'POST journals of A and C are byte-identical after the migration';
  select count(*) into n from public.money_snapshots s join rehearsal.fx f on f.id = s.id where s.commission_rate_bps <> 1500;
  if n <> 0 then raise exception 'An existing snapshot does not read 1500'; end if;
  raise notice 'POST existing snapshots A, B and C read commission_rate_bps = 1500';
  if (select column_default from information_schema.columns where table_schema='public' and table_name='money_snapshots' and column_name='commission_rate_bps') is not null then
    raise exception 'The default was not dropped';
  end if;
  raise notice 'POST no default remains on commission_rate_bps';
  if private.money_standard_commission_bps() <> 1000 or private.money_promotional_commission_bps() <> 500 then raise exception 'Policy not 10%%/5%%'; end if;
  raise notice 'POST policy in force: 10%% standard, 5%% promotional, effective %', private.money_commission_effective_at();

  -- A: a refund after the migration uses the original 15%.
  select row(s.fee,s.subsidy)::text into v from private.money_split(rehearsal.o('A'), 8000) s;
  if v <> '(1200,0)' then raise exception 'A split %', v; end if;
  perform rehearsal.refund('A2', rehearsal.o('A'), 3000);
  if -private.money_account_net(rehearsal.o('A'),'platform_revenue') <> 750 then raise exception 'A: refund after the migration not at 15%%'; end if;
  if -private.money_account_net(rehearsal.o('A'),'provider_payable') <> 4250 then raise exception 'A: provider share not 85%%'; end if;
  if private.money_obligation_reconciliation(rehearsal.o('A'),now())->'issues' <> '[]'::jsonb then raise exception 'A reconciliation issues'; end if;
  raise notice 'POST A refund after the migration: fee 750 = 15%% of retained 5000; provider 4250; reconciliation clean';

  -- B: the published unpaid invoice keeps its 15% stamp; paying it charges 15%.
  perform rehearsal.pay('B', rehearsal.o('sB'));
  select o.id into rec from public.money_obligations o where o.current_snapshot_id = rehearsal.o('sB');
  if -private.money_account_net(rec.id,'platform_revenue') <> 1500 then raise exception 'B not charged at its 15%% stamp'; end if;
  raise notice 'POST B (published before, paid after) keeps its stamp: fee 1500';

  -- C: the paid 7.5% promotion is unchanged, including a refund after the migration.
  perform rehearsal.refund('C1', rehearsal.o('C'), 4500);
  if -private.money_account_net(rehearsal.o('C'),'platform_revenue') <> 338 then raise exception 'C: % ', -private.money_account_net(rehearsal.o('C'),'platform_revenue'); end if;
  if private.money_obligation_reconciliation(rehearsal.o('C'),now())->'issues' <> '[]'::jsonb then raise exception 'C reconciliation issues'; end if;
  raise notice 'POST C 7.5%% promotion refunded by half after the migration: fee round(675/2) = 338; reconciliation clean';

  -- D: the 7.5% reservation is reported, refused at publication and released for the homeowner.
  if (select private.promotion_redemption_problem(x, r) from private.promotion_redemptions x join public.service_requests r on r.id = x.service_request_id
      where x.service_request_id = rehearsal.req(4) and x.status = 'reserved') <> 'commission_changed' then raise exception 'D not flagged'; end if;
  begin
    perform rehearsal.publish(rehearsal.req(4), rehearsal.terms(rehearsal.req(4),1000,'Synthetic $10 off: Synthetic vendor terms'));
    raise exception 'D was published at 7.5%%';
  exception when sqlstate '40001' then null;
  end;
  -- Two statements: one expression would read the status under the sweep's own statement snapshot.
  n := private.promotion_release_unpaid();
  if n < 1 or (select status from private.promotion_redemptions where service_request_id = rehearsal.req(4)) <> 'released' then
    raise exception 'D not released (% released)', n;
  end if;
  raise notice 'POST D 7.5%% reservation: commission_changed, refused at publication, released by the sweep';

  -- E: the provider's next booking is stamped 10%.
  perform rehearsal.publish(rehearsal.req(5), rehearsal.terms(rehearsal.req(5),0,null));
  if (select s.commission_rate_bps from public.money_snapshots s join public.money_obligations o on o.current_snapshot_id = s.id
      where o.service_request_id = rehearsal.req(5)) <> 1000 then raise exception 'E not stamped 10%%'; end if;
  perform rehearsal.pay('E', (select o.current_snapshot_id from public.money_obligations o where o.service_request_id = rehearsal.req(5)));
  if -private.money_account_net((select id from public.money_obligations where service_request_id = rehearsal.req(5)),'platform_revenue') <> 1000 then raise exception 'E not 10%%'; end if;
  raise notice 'POST E (same provider, published after) is stamped and charged 10%%: fee 1000, vendor 9000';
end $$;
rollback;
