-- TRACE-081: bank statement reconciliation (MPS §§6.5/7; CFG-008 "ACH batch, statement, ledger,
-- hold, failure, retry, and reconciliation scenarios"; DECISION-LOG DEC-2026-011: store statements
-- and bank outcomes, never bank credentials or full account details; TRACE-075–080).
--
-- There is no bank API. Owner decisions 2026-09-22:
--  * statement lines arrive from the bank's CSV export, parsed in the operator's browser. Only each
--    line's posting date, direction, amount and bank reference reach the database; the file itself,
--    its descriptions and any account details never do. A single line can also be entered by hand;
--  * only payout-related lines are imported: ACH debits to providers, and credits that are returns
--    or provider repayments. The operator leaves everything else out;
--  * a statement line is evidence only. It never changes a transfer, a payout or the ledger. A line
--    that disagrees with what was recorded is an exception, resolved through the existing commands
--    (a bank outcome, a reviewed late payment) with the line's reference and details filled in;
--  * a statement period is closed by a reviewed request that a second finance operator approves,
--    refused while any exception is open. A closed statement is immutable.
--
-- Matching. Each recorded bank movement is a settled or returned ACH event, a late payment of a
-- withdrawn transfer (TRACE-080) or a provider repayment. A statement line pairs with a movement of
-- the same direction and bank reference; lines and movements sharing a reference pair in date
-- order. An operator can also match a line to a movement by hand (same direction and amount), for a
-- repayment, which carries no reference, or where the bank shows a different reference. Closing a
-- statement stores its pairs, so a later statement cannot re-pair them.
-- Dates are Mercurius's Eastern business days (CFG-010's time zone), as a bank statement is.

create table public.money_bank_statements (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (period_end>=period_start and period_end<=period_start+31)
);
alter table public.money_bank_statements add constraint money_bank_statement_periods_do_not_overlap
  exclude using gist (daterange(period_start,period_end,'[]') with &&);

create table public.money_bank_statement_imports (
  id uuid primary key default gen_random_uuid(),
  statement_id uuid not null references public.money_bank_statements(id),
  business_key text not null unique check (length(business_key) between 1 and 200),
  -- SHA-256 of the canonical lines sent, so a replay of the key must send the same lines.
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  -- SHA-256 of the bank file computed in the browser, when one was used. The file is never stored.
  file_fingerprint text check (file_fingerprint is null or file_fingerprint ~ '^[0-9a-f]{64}$'),
  line_count integer not null check (line_count between 0 and 1000),
  actor uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index money_bank_statement_imports_statement on public.money_bank_statement_imports(statement_id);

-- One payout-related line as the bank shows it. No description, payee or account detail is kept.
create table public.money_bank_statement_lines (
  id uuid primary key default gen_random_uuid(),
  statement_id uuid not null references public.money_bank_statements(id),
  import_id uuid not null references public.money_bank_statement_imports(id),
  line_number integer not null check (line_number>0),
  posted_on date not null,
  direction text not null check (direction in ('debit','credit')),
  amount bigint not null check (amount>0 and amount<=9007199254740991),
  bank_reference text not null check (length(bank_reference) between 1 and 200 and bank_reference=btrim(bank_reference)),
  created_at timestamptz not null default now(),
  unique (statement_id,line_number),
  unique (posted_on,direction,amount,bank_reference)
);
create index money_bank_statement_lines_reference on public.money_bank_statement_lines(direction,bank_reference);

-- A line paired with a recorded movement: by an operator (manual), or stored from its reference
-- pairing when its statement closed.
create table public.money_bank_line_matches (
  line_id uuid primary key references public.money_bank_statement_lines(id),
  movement text not null unique check (movement ~ '^(settled|returned|late|repayment):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  how text not null check (how in ('reference','manual')),
  actor uuid not null references auth.users(id),
  reason text check (reason is null or (length(trim(reason))>0 and length(reason)<=1000)),
  created_at timestamptz not null default now(),
  check ((how='manual')=(reason is not null))
);

-- A line imported by mistake: it is not a payout movement. Refused for a line whose reference was
-- recorded on a transfer or late payment.
create table public.money_bank_line_dismissals (
  line_id uuid primary key references public.money_bank_statement_lines(id),
  actor uuid not null references auth.users(id),
  reason text not null check (length(trim(reason))>0 and length(reason)<=1000),
  created_at timestamptz not null default now()
);

create table public.money_bank_statement_closes (
  statement_id uuid primary key references public.money_bank_statements(id),
  line_count integer not null check (line_count>=0),
  debit_total bigint not null check (debit_total>=0),
  credit_total bigint not null check (credit_total>=0),
  requested_by uuid not null references auth.users(id),
  approved_by uuid not null references auth.users(id),
  reason text not null check (length(trim(reason))>0 and length(reason)<=1000),
  created_at timestamptz not null default now(),
  check (requested_by<>approved_by)
);

do $$ declare t text; begin
  foreach t in array array['money_bank_statements','money_bank_statement_imports','money_bank_statement_lines',
    'money_bank_line_matches','money_bank_line_dismissals','money_bank_statement_closes'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on public.%I to service_role',t);
    execute format('create trigger immutable_evidence before update or delete on public.%I for each row execute function public.money_immutable()',t);
  end loop;
end $$;

alter table public.money_review_requests drop constraint money_review_requests_operation_check;
alter table public.money_review_requests add constraint money_review_requests_operation_check
  check (operation in ('event_exclusion','reconciliation_resolution','hold_resolution',
    'refund_authorization','cancellation_refund','chargeback_allocation','ach_preparation','ach_retry','ach_withdrawal',
    'ach_late_settlement','payout_recovery','bank_statement_close'));
-- A close takes no separate evidence: the statement's lines are the evidence.
alter table public.money_review_requests drop constraint money_review_requests_evidence_shape;
alter table public.money_review_requests add constraint money_review_requests_evidence_shape
  check ((operation in ('reconciliation_resolution','cancellation_refund','chargeback_allocation','ach_preparation','ach_retry',
    'bank_statement_close'))=(evidence is null));

-- Every statement write serializes on one lock: an import into one statement can change how lines
-- of another pair by reference.
create function private.money_lock_bank_statements() returns void
language sql volatile set search_path='' as $$ select pg_advisory_xact_lock(hashtextextended('money_bank_statements',0)) $$;

-- Mercurius's business day, in the Eastern time zone its bank statements use.
create function private.money_bank_day(p_at timestamptz) returns date
language sql stable set search_path='' as $$ select (p_at at time zone 'America/New_York')::date $$;

-- Every bank movement Mercurius has recorded: settled and returned ACH transfers, late payments of
-- withdrawn transfers and provider repayments. A repayment carries no bank reference.
create function private.money_bank_movements()
returns table(movement text,kind text,direction text,amount bigint,bank_reference text,obligation_id uuid,attempt_id uuid,recorded_at timestamptz)
language sql stable security definer set search_path='' as $$
  select e.status||':'||e.id,e.status,case when e.status='settled' then 'debit' else 'credit' end,i.amount,a.bank_reference,i.obligation_id,a.id,e.created_at
    from public.money_ach_events e join public.money_ach_attempts a on a.id=e.attempt_id join public.money_ach_items i on i.id=a.item_id
    where e.status in ('settled','returned')
  union all
  select 'late:'||s.id,'late','debit',s.amount,s.bank_reference,s.obligation_id,s.attempt_id,s.created_at
    from public.money_ach_late_settlements s
  union all
  select 'repayment:'||r.id,'repayment','credit',r.amount,null,r.obligation_id,null,r.created_at
    from public.money_payout_recoveries r where r.kind='repayment'
$$;

-- Every line paired with a movement: stored matches, then lines and movements that share a
-- direction and reference, paired in order (lines by posting date, movements by when recorded).
create function private.money_bank_pairs()
returns table(line_id uuid,movement text,how text)
language sql stable security definer set search_path='' as $$
  with stored as (select m.line_id,m.movement,m.how from public.money_bank_line_matches m),
  lines as (
    select l.id,l.direction,l.bank_reference,
      row_number() over (partition by l.direction,l.bank_reference order by l.posted_on,l.created_at,l.statement_id,l.line_number) n
    from public.money_bank_statement_lines l
    where not exists(select 1 from stored s where s.line_id=l.id)
      and not exists(select 1 from public.money_bank_line_dismissals d where d.line_id=l.id)),
  moves as (
    select m.movement,m.direction,m.bank_reference,
      row_number() over (partition by m.direction,m.bank_reference order by m.recorded_at,m.movement) n
    from private.money_bank_movements() m
    where m.bank_reference is not null and not exists(select 1 from stored s where s.movement=m.movement))
  select s.line_id,s.movement,s.how from stored s
  union all
  select l.id,m.movement,'reference' from lines l join moves m on m.direction=l.direction and m.bank_reference=l.bank_reference and m.n=l.n
$$;

-- Each line's state: matched, amount_mismatch (paired by reference at a different amount),
-- dismissed or unmatched.
create function private.money_bank_line_states()
returns table(line_id uuid,statement_id uuid,state text,movement text,how text)
language sql stable security definer set search_path='' as $$
  select l.id,l.statement_id,
    case when d.line_id is not null then 'dismissed' when p.movement is null then 'unmatched'
      when m.amount<>l.amount then 'amount_mismatch' else 'matched' end,
    p.movement,p.how
  from public.money_bank_statement_lines l
  left join public.money_bank_line_dismissals d on d.line_id=l.id
  left join private.money_bank_pairs() p on p.line_id=l.id
  left join private.money_bank_movements() m on m.movement=p.movement
$$;

-- Recorded movements no statement line evidences.
create function private.money_bank_unevidenced()
returns table(movement text,kind text,direction text,amount bigint,bank_reference text,obligation_id uuid,attempt_id uuid,recorded_at timestamptz)
language sql stable security definer set search_path='' as $$
  select m.* from private.money_bank_movements() m
  where not exists(select 1 from private.money_bank_pairs() p where p.movement=m.movement)
$$;

-- What an unmatched line suggests, from the transfer its reference names:
--  record_settled / record_returned: the bank shows an outcome not yet recorded on the transfer;
--  request_late_settlement: the bank paid a withdrawn transfer (TRACE-080, a reviewed request);
--  match_repayment: a credit with no transfer, and a recorded repayment of that amount has no line;
--  amount_mismatch: the transfer is for a different amount;
--  outcome_conflict: the transfer's recorded outcome contradicts the line;
--  already_evidenced: the transfer's movement is already on another line;
--  no_transfer: no transfer or late payment has this reference.
create function private.money_bank_line_suggestion(p_line uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare l public.money_bank_statement_lines; a public.money_ach_attempts; i public.money_ach_items; action text;
begin
  select * into l from public.money_bank_statement_lines where id=p_line;
  if not found then return null; end if;
  select * into a from public.money_ach_attempts where bank_reference=l.bank_reference;
  if not found then
    if exists(select 1 from public.money_ach_late_settlements where bank_reference=l.bank_reference) then
      return jsonb_build_object('action',case when l.direction='debit' then 'already_evidenced' else 'outcome_conflict' end);
    end if;
    if l.direction='credit' and exists(select 1 from private.money_bank_unevidenced() u where u.kind='repayment' and u.amount=l.amount) then
      return jsonb_build_object('action','match_repayment');
    end if;
    return jsonb_build_object('action','no_transfer');
  end if;
  select * into strict i from public.money_ach_items where id=a.item_id;
  if l.direction='debit' then
    action:=case
      when a.status in ('submitted','unknown') then 'record_settled'
      when a.status='withdrawn' and not exists(select 1 from public.money_ach_late_settlements s where s.attempt_id=a.id) then 'request_late_settlement'
      when a.status in ('settled','returned','withdrawn') then 'already_evidenced'
      else 'outcome_conflict' end;
  else
    action:=case
      when a.status='settled' then 'record_returned'
      when a.status='returned' then 'already_evidenced'
      else 'outcome_conflict' end;
  end if;
  if action in ('record_settled','record_returned','request_late_settlement') and i.amount<>l.amount then action:='amount_mismatch'; end if;
  return jsonb_build_object('action',action,'attempt_id',a.id,'status',a.status,'obligation_id',i.obligation_id,'amount',i.amount,
    'attempt_number',a.attempt_number,
    'invoice_number',(select s.invoice_number from public.money_snapshots s where s.id=i.snapshot_id),
    'payee_name',(select c.name from public.contractors c where c.id=i.contractor_id));
end $$;

-- A statement's lines and totals.
create function private.money_bank_statement_totals(p_statement uuid)
returns table(line_count integer,debit_total bigint,credit_total bigint)
language sql stable security definer set search_path='' as $$
  select count(*)::integer,coalesce(sum(amount) filter (where direction='debit'),0)::bigint,coalesce(sum(amount) filter (where direction='credit'),0)::bigint
  from public.money_bank_statement_lines where statement_id=p_statement
$$;

-- A statement's open exceptions: its unmatched and mismatched lines, and recorded movements with no
-- line whose business day falls in its period.
create function private.money_bank_statement_exceptions(p_statement uuid)
returns integer language sql stable security definer set search_path='' as $$
  select (select count(*) from private.money_bank_line_states() s where s.statement_id=p_statement and s.state in ('unmatched','amount_mismatch'))::integer
    +(select count(*) from private.money_bank_unevidenced() u join public.money_bank_statements b on b.id=p_statement
      where private.money_bank_day(u.recorded_at) between b.period_start and b.period_end)::integer
$$;

-- The exact object money_close_bank_statement hashes: the statement, its lines and totals when the
-- close was requested, and the reason. A line imported afterwards makes the request stale.
create function private.money_bank_statement_close_command(p_statement uuid,p_lines integer,p_debits bigint,p_credits bigint,p_reason text)
returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object('operation','bank_statement_close','statement',p_statement,'lines',p_lines,'debits',p_debits,'credits',p_credits,'reason',p_reason)
$$;

-- Why this statement cannot be closed now. Mirrors money_close_bank_statement.
create function private.money_bank_statement_close_blocker(p_statement uuid,p_lines integer,p_debits bigint,p_credits bigint)
returns text language plpgsql stable security definer set search_path='' as $$
declare b public.money_bank_statements; t record;
begin
  select * into b from public.money_bank_statements where id=p_statement;
  if not found then return 'not_found'; end if;
  if exists(select 1 from public.money_bank_statement_closes where statement_id=b.id) then return 'completed'; end if;
  if b.period_end>=private.money_bank_day(now()) then return 'period_open'; end if;
  select * into strict t from private.money_bank_statement_totals(b.id);
  if (t.line_count,t.debit_total,t.credit_total) is distinct from (p_lines,p_debits,p_credits) then return 'statement_changed'; end if;
  if private.money_bank_statement_exceptions(b.id)>0 then return 'statement_exceptions'; end if;
  return null;
end $$;

-- Kernel: close a reconciled statement. Two finance operators, bound to the exact command. Stores
-- every reference pairing of its lines, so the closed statement's evidence cannot change.
create function public.money_close_bank_statement(p_statement uuid,p_lines integer,p_debits bigint,p_credits bigint,
  p_actor uuid,p_approver uuid,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare c public.money_bank_statement_closes; blocker text;
begin
  perform public.money_require_finance(p_actor); perform public.money_require_finance(p_approver);
  perform public.money_require_review(p_actor,p_approver,private.money_bank_statement_close_command(p_statement,p_lines,p_debits,p_credits,p_reason));
  perform private.money_lock_bank_statements();
  perform 1 from public.money_bank_statements where id=p_statement for update;
  if not found then raise exception 'Bank statement not found'; end if;
  select * into c from public.money_bank_statement_closes where statement_id=p_statement;
  if found then
    if (c.line_count,c.debit_total,c.credit_total,c.requested_by,c.approved_by,c.reason)
      is distinct from (p_lines,p_debits,p_credits,p_actor,p_approver,p_reason) then
      raise exception 'Bank statement close idempotency conflict';
    end if;
    return;
  end if;
  blocker:=private.money_bank_statement_close_blocker(p_statement,p_lines,p_debits,p_credits);
  if blocker is not null then raise exception 'Bank statement cannot be closed: %',blocker; end if;
  insert into public.money_bank_line_matches(line_id,movement,how,actor)
    select s.line_id,s.movement,'reference',p_actor from private.money_bank_line_states() s
    where s.statement_id=p_statement and s.how='reference';
  insert into public.money_bank_statement_closes(statement_id,line_count,debit_total,credit_total,requested_by,approved_by,reason)
    values(p_statement,p_lines,p_debits,p_credits,p_actor,p_approver,p_reason);
end $$;

-- One operator imports payout-related lines into the statement for this exact period, creating it
-- on the first import. Each line is {posted_on: 'YYYY-MM-DD', direction: 'debit'|'credit',
-- amount: cents, reference}. An import may carry no lines, recording that the period had none.
create function public.money_operator_import_bank_statement(p_period_start date,p_period_end date,p_lines jsonb,p_file_fingerprint text,p_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); b public.money_bank_statements; imp public.money_bank_statement_imports;
  canonical jsonb:='[]'::jsonb; line jsonb; posted date; amount bigint; reference text; hash text; n integer:=0; next_number integer;
begin
  perform public.money_require_finance(actor);
  perform private.money_require_key(p_key);
  if p_period_start is null or p_period_end is null or p_period_end<p_period_start or p_period_end>p_period_start+31 then
    raise exception 'Statement period of up to 32 days required' using errcode='22023';
  end if;
  if p_period_start>private.money_bank_day(now()) then raise exception 'Statement period cannot start in the future' using errcode='22023'; end if;
  if p_file_fingerprint is not null and p_file_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'File fingerprint must be a SHA-256 hex digest' using errcode='22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)>1000 then
    raise exception 'Up to 1000 statement lines required' using errcode='22023';
  end if;
  for line in select value from jsonb_array_elements(p_lines) loop
    n:=n+1;
    if jsonb_typeof(line)<>'object' or coalesce(jsonb_typeof(line->'posted_on'),'')<>'string' or coalesce(jsonb_typeof(line->'amount'),'')<>'number'
      or coalesce(jsonb_typeof(line->'reference'),'')<>'string' or coalesce(line->>'direction','') not in ('debit','credit')
      or (select count(*) from jsonb_object_keys(line))<>4 then
      raise exception 'Statement line % needs a posting date, direction, amount and reference only',n using errcode='22023';
    end if;
    if line->>'posted_on' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Statement line % has an invalid posting date',n using errcode='22023'; end if;
    begin
      posted:=(line->>'posted_on')::date;
    exception when others then
      raise exception 'Statement line % has an invalid posting date',n using errcode='22023';
    end;
    if posted not between p_period_start and p_period_end then
      raise exception 'Statement line % is posted outside the statement period',n using errcode='22023';
    end if;
    if (line->>'amount') !~ '^[0-9]+$' or length(line->>'amount')>16 or (line->>'amount')::numeric not between 1 and 9007199254740991 then
      raise exception 'Statement line % needs an amount in whole cents greater than zero',n using errcode='22023';
    end if;
    amount:=(line->>'amount')::bigint;
    reference:=btrim(line->>'reference');
    if length(reference) not between 1 and 200 then
      raise exception 'Statement line % needs a bank reference of up to 200 characters',n using errcode='22023';
    end if;
    canonical:=canonical||jsonb_build_array(jsonb_build_object('posted_on',to_char(posted,'YYYY-MM-DD'),'direction',line->>'direction','amount',amount,'reference',reference));
  end loop;
  hash:=encode(sha256(convert_to(canonical::text,'UTF8')),'hex');
  perform private.money_lock_bank_statements();
  select * into imp from public.money_bank_statement_imports where business_key=p_key;
  if found then
    select * into strict b from public.money_bank_statements where id=imp.statement_id;
    if imp.actor<>actor or imp.content_hash<>hash or imp.file_fingerprint is distinct from p_file_fingerprint
      or b.period_start<>p_period_start or b.period_end<>p_period_end then
      raise exception 'Statement import idempotency conflict' using errcode='23505';
    end if;
    return jsonb_build_object('statement_id',b.id,'import_id',imp.id,'lines',imp.line_count,'replay',true);
  end if;
  select * into b from public.money_bank_statements where period_start=p_period_start and period_end=p_period_end for update;
  if not found then
    if exists(select 1 from public.money_bank_statements x where daterange(x.period_start,x.period_end,'[]') && daterange(p_period_start,p_period_end,'[]')) then
      raise exception 'Another statement already covers part of this period' using errcode='23P01';
    end if;
    insert into public.money_bank_statements(period_start,period_end,created_by) values(p_period_start,p_period_end,actor) returning * into b;
  end if;
  if exists(select 1 from public.money_bank_statement_closes where statement_id=b.id) then
    raise exception 'Bank statement is closed' using errcode='55000';
  end if;
  n:=0;
  for line in select value from jsonb_array_elements(canonical) loop
    n:=n+1;
    if exists(select 1 from public.money_bank_statement_lines x where x.posted_on=(line->>'posted_on')::date and x.direction=line->>'direction'
        and x.amount=(line->>'amount')::bigint and x.bank_reference=line->>'reference')
      or exists(select 1 from jsonb_array_elements(canonical) with ordinality y(v,k) where y.v=line and y.k<n) then
      raise exception 'Statement line % is already imported',n using errcode='23505';
    end if;
  end loop;
  insert into public.money_bank_statement_imports(statement_id,business_key,content_hash,file_fingerprint,line_count,actor)
    values(b.id,p_key,hash,p_file_fingerprint,jsonb_array_length(canonical),actor) returning * into imp;
  select coalesce(max(line_number),0) into next_number from public.money_bank_statement_lines where statement_id=b.id;
  insert into public.money_bank_statement_lines(statement_id,import_id,line_number,posted_on,direction,amount,bank_reference)
    select b.id,imp.id,next_number+x.n::integer,(x.v->>'posted_on')::date,x.v->>'direction',(x.v->>'amount')::bigint,x.v->>'reference'
    from jsonb_array_elements(canonical) with ordinality x(v,n);
  return jsonb_build_object('statement_id',b.id,'import_id',imp.id,'lines',imp.line_count,'replay',false);
end $$;

-- Locks the statement lock and an open line's statement, or refuses.
create function private.money_open_bank_line(p_line uuid) returns public.money_bank_statement_lines
language plpgsql security definer set search_path='' as $$
declare l public.money_bank_statement_lines;
begin
  perform private.money_lock_bank_statements();
  select * into l from public.money_bank_statement_lines where id=p_line;
  if not found then raise exception 'Statement line not found' using errcode='P0002'; end if;
  perform 1 from public.money_bank_statements where id=l.statement_id for update;
  if exists(select 1 from public.money_bank_statement_closes where statement_id=l.statement_id) then
    raise exception 'Bank statement is closed' using errcode='55000';
  end if;
  return l;
end $$;

-- One operator matches an unmatched line to a recorded movement of the same direction and amount
-- that no line evidences: a provider repayment, or a transfer the bank shows under another reference.
create function public.money_operator_match_bank_line(p_line uuid,p_movement text,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); l public.money_bank_statement_lines; m record; prior public.money_bank_line_matches; reason text;
begin
  perform public.money_require_finance(actor);
  perform private.money_require_text(p_reason,'Reason');
  reason:=btrim(p_reason);
  l:=private.money_open_bank_line(p_line);
  select * into prior from public.money_bank_line_matches where line_id=l.id;
  if found then
    if prior.movement is distinct from p_movement or prior.how<>'manual' or prior.actor<>actor or prior.reason<>reason then
      raise exception 'Statement line not matchable: line_matched' using errcode='55000';
    end if;
    return jsonb_build_object('line_id',l.id,'movement',prior.movement,'replay',true);
  end if;
  if exists(select 1 from public.money_bank_line_dismissals where line_id=l.id) then
    raise exception 'Statement line not matchable: dismissed' using errcode='55000';
  end if;
  if exists(select 1 from private.money_bank_pairs() p where p.line_id=l.id) then
    raise exception 'Statement line not matchable: line_matched' using errcode='55000';
  end if;
  select * into m from private.money_bank_movements() x where x.movement=p_movement;
  if not found then raise exception 'Statement line not matchable: movement_not_found' using errcode='55000'; end if;
  if exists(select 1 from private.money_bank_pairs() p where p.movement=p_movement) then
    raise exception 'Statement line not matchable: movement_matched' using errcode='55000';
  end if;
  if m.direction<>l.direction then raise exception 'Statement line not matchable: direction_mismatch' using errcode='55000'; end if;
  if m.amount<>l.amount then raise exception 'Statement line not matchable: amount_mismatch' using errcode='55000'; end if;
  insert into public.money_bank_line_matches(line_id,movement,how,actor,reason) values(l.id,p_movement,'manual',actor,reason);
  return jsonb_build_object('line_id',l.id,'movement',p_movement,'replay',false);
end $$;

-- One operator records that an unmatched line is not a payout movement and was imported by mistake.
create function public.money_operator_dismiss_bank_line(p_line uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); l public.money_bank_statement_lines; prior public.money_bank_line_dismissals; reason text;
begin
  perform public.money_require_finance(actor);
  perform private.money_require_text(p_reason,'Reason');
  reason:=btrim(p_reason);
  l:=private.money_open_bank_line(p_line);
  select * into prior from public.money_bank_line_dismissals where line_id=l.id;
  if found then
    if prior.actor<>actor or prior.reason<>reason then raise exception 'Statement line not dismissable: dismissed' using errcode='55000'; end if;
    return jsonb_build_object('line_id',l.id,'replay',true);
  end if;
  if exists(select 1 from private.money_bank_pairs() p where p.line_id=l.id) then
    raise exception 'Statement line not dismissable: line_matched' using errcode='55000';
  end if;
  if exists(select 1 from public.money_ach_attempts where bank_reference=l.bank_reference)
    or exists(select 1 from public.money_ach_late_settlements where bank_reference=l.bank_reference) then
    raise exception 'Statement line not dismissable: line_names_transfer' using errcode='55000';
  end if;
  insert into public.money_bank_line_dismissals(line_id,actor,reason) values(l.id,actor,reason);
  return jsonb_build_object('line_id',l.id,'replay',false);
end $$;

-- Resolves an unmatched line through the existing command its suggestion names, with the line's
-- reference and details as the evidence: a bank outcome (one operator, money_operator_record_ach)
-- or a late payment request (two operators, money_operator_request_ach_late_settlement). The
-- caller names the action it showed; if the suggestion changed since, nothing is recorded.
create function public.money_operator_resolve_bank_line(p_line uuid,p_action text,p_note text,p_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare l public.money_bank_statement_lines; b public.money_bank_statements; s jsonb; evidence text; note text;
begin
  perform public.money_require_finance(auth.uid());
  perform private.money_require_key(p_key);
  if p_note is null or length(trim(p_note))=0 or length(p_note)>500 then
    raise exception 'Note of up to 500 characters required' using errcode='22023';
  end if;
  if p_action is null or p_action not in ('record_settled','record_returned','request_late_settlement') then
    raise exception 'Statement line action required' using errcode='22023';
  end if;
  note:=btrim(p_note);
  l:=private.money_open_bank_line(p_line);
  select * into strict b from public.money_bank_statements where id=l.statement_id;
  evidence:=format('Bank statement %s to %s, line %s: %s of %s posted %s. %s',to_char(b.period_start,'YYYY-MM-DD'),to_char(b.period_end,'YYYY-MM-DD'),
    l.line_number,l.direction,to_char(l.amount/100.0,'FM999999999999990.00'),to_char(l.posted_on,'YYYY-MM-DD'),note);
  -- A replay of the same key goes straight to the command it recorded, which replays or conflicts.
  if p_action in ('record_settled','record_returned') and exists(select 1 from public.money_ach_events e where e.business_key='finance-ach:'||p_key) then
    return public.money_operator_record_ach((select e.attempt_id from public.money_ach_events e where e.business_key='finance-ach:'||p_key),
      case when p_action='record_settled' then 'settled' else 'returned' end,l.bank_reference,evidence,p_key);
  end if;
  if p_action='request_late_settlement' and exists(select 1 from public.money_review_requests q where q.business_key=p_key) then
    return public.money_operator_request_ach_late_settlement((select q.subject::uuid from public.money_review_requests q where q.business_key=p_key),
      l.bank_reference,note,evidence,p_key);
  end if;
  if exists(select 1 from private.money_bank_pairs() p where p.line_id=l.id) or exists(select 1 from public.money_bank_line_dismissals where line_id=l.id) then
    raise exception 'Statement line not resolvable: line_matched' using errcode='55000';
  end if;
  s:=private.money_bank_line_suggestion(l.id);
  if s->>'action' is distinct from p_action then
    raise exception 'Statement line not resolvable: suggestion_changed' using errcode='55000';
  end if;
  if p_action='request_late_settlement' then
    return public.money_operator_request_ach_late_settlement((s->>'attempt_id')::uuid,l.bank_reference,note,evidence,p_key);
  end if;
  return public.money_operator_record_ach((s->>'attempt_id')::uuid,case when p_action='record_settled' then 'settled' else 'returned' end,
    l.bank_reference,evidence,p_key);
end $$;

-- Gateway: closing a statement is a reviewed request bound to its lines and totals now. A replay of
-- the same key keeps the totals it was requested against.
create function public.money_operator_request_bank_statement_close(p_statement uuid,p_reason text,p_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); reason text; t record; prior jsonb;
begin
  perform public.money_require_finance(actor);
  perform private.money_require_key(p_key);
  perform private.money_require_text(p_reason,'Reason');
  if not exists(select 1 from public.money_bank_statements where id=p_statement) then
    raise exception 'Bank statement not found' using errcode='P0002';
  end if;
  reason:=btrim(p_reason);
  select q.command into prior from public.money_review_requests q where q.business_key=p_key and q.operation='bank_statement_close';
  if prior is not null then
    return private.money_store_review_request(actor,p_key,'bank_statement_close',p_statement::text,null,
      private.money_bank_statement_close_command(p_statement,(prior->>'lines')::integer,(prior->>'debits')::bigint,(prior->>'credits')::bigint,reason),
      reason,null,true,null::jsonb);
  end if;
  select * into strict t from private.money_bank_statement_totals(p_statement);
  return private.money_store_review_request(actor,p_key,'bank_statement_close',p_statement::text,null,
    private.money_bank_statement_close_command(p_statement,t.line_count,t.debit_total,t.credit_total,reason),reason,null,true,null::jsonb);
end $$;

-- What a close request asks for, so the approver sees the statement's totals and open exceptions.
create function private.money_bank_close_request_details(p_request public.money_review_requests)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('period_start',to_char(b.period_start,'YYYY-MM-DD'),'period_end',to_char(b.period_end,'YYYY-MM-DD'),
    'lines',(p_request.command->>'lines')::integer,'debits',(p_request.command->>'debits')::bigint,'credits',(p_request.command->>'credits')::bigint,
    'exceptions_now',private.money_bank_statement_exceptions(b.id))
  from public.money_bank_statements b where b.id=p_request.subject::uuid
$$;

-- The statement part of the operator readback. Bank references are returned as their last four
-- characters only.
create function private.money_bank_statement_operations(p_me uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  with states as (select * from private.money_bank_line_states()),
  moves as (select * from private.money_bank_movements()),
  movement_info as (
    select m.movement,jsonb_build_object('movement',m.movement,'kind',m.kind,'direction',m.direction,'amount',m.amount,
      'bank_reference_hint',right(m.bank_reference,4),'obligation_id',m.obligation_id,
      'invoice_number',(select s.invoice_number from public.money_obligations o join public.money_snapshots s on s.id=o.current_snapshot_id where o.id=m.obligation_id),
      'payee_name',(select c.name from public.contractors c where c.id=private.money_effective_contractor(m.obligation_id)),
      'attempt_number',(select a.attempt_number from public.money_ach_attempts a where a.id=m.attempt_id),
      'recorded_at',m.recorded_at) info
    from moves m)
  select jsonb_build_object(
    'today',to_char(private.money_bank_day(now()),'YYYY-MM-DD'),
    'statements',coalesce((select jsonb_agg(x.item order by x.period_start desc) from (
      select b.period_start,jsonb_build_object(
        'statement_id',b.id,'period_start',to_char(b.period_start,'YYYY-MM-DD'),'period_end',to_char(b.period_end,'YYYY-MM-DD'),
        'created_by_me',b.created_by=p_me,'created_at',b.created_at,
        'line_count',t.line_count,'debit_total',t.debit_total,'credit_total',t.credit_total,
        'imports',(select count(*) from public.money_bank_statement_imports i where i.statement_id=b.id),
        'exceptions',private.money_bank_statement_exceptions(b.id),
        'closed',(select jsonb_build_object('by_me',p_me in (c.requested_by,c.approved_by),'reason',c.reason,'created_at',c.created_at)
          from public.money_bank_statement_closes c where c.statement_id=b.id),
        'close_blocker',case when not exists(select 1 from public.money_bank_statement_closes c where c.statement_id=b.id)
          then private.money_bank_statement_close_blocker(b.id,t.line_count,t.debit_total,t.credit_total) end,
        'open_request_id',(select q.id from public.money_review_requests q where q.operation='bank_statement_close' and q.subject=b.id::text
          and now()<private.money_review_expires_at(q.created_at)
          and not exists(select 1 from public.money_review_executions z where z.request_id=q.id)
          order by q.created_at desc limit 1),
        'lines',coalesce((select jsonb_agg(jsonb_build_object(
            'line_id',l.id,'line_number',l.line_number,'posted_on',to_char(l.posted_on,'YYYY-MM-DD'),'direction',l.direction,'amount',l.amount,
            'bank_reference_hint',right(l.bank_reference,4),'state',s.state,
            'match',case when s.movement is not null then (select mi.info||jsonb_build_object('how',s.how) from movement_info mi where mi.movement=s.movement) end,
            'suggestion',case when s.state='unmatched' then private.money_bank_line_suggestion(l.id) end,
            'dismissal',(select jsonb_build_object('reason',d.reason,'by_me',d.actor=p_me,'created_at',d.created_at)
              from public.money_bank_line_dismissals d where d.line_id=l.id)) order by l.line_number)
          from public.money_bank_statement_lines l join states s on s.line_id=l.id where l.statement_id=b.id),'[]'::jsonb)) item
      from public.money_bank_statements b cross join lateral private.money_bank_statement_totals(b.id) t
      where not exists(select 1 from public.money_bank_statement_closes c where c.statement_id=b.id)
        or b.period_end>private.money_bank_day(now())-120
      order by b.period_start desc limit 24) x),'[]'::jsonb),
    'unevidenced',coalesce((select jsonb_agg(mi.info||jsonb_build_object('statement_id',
        (select b.id from public.money_bank_statements b where private.money_bank_day(u.recorded_at) between b.period_start and b.period_end))
        order by u.recorded_at desc,u.movement)
      from private.money_bank_unevidenced() u join movement_info mi on mi.movement=u.movement),'[]'::jsonb))
$$;

-- The review gateway learns the close, and the readbacks learn statements. Each body below is the
-- latest definition, copied by a generator that asserts exactly one match per substitution.

-- private.money_request_blocker: latest body from 20260921003000_money_payout_recovery.sql; adds bank_statement_close.
create or replace function private.money_request_blocker(p_operation text,p_subject text,p_command jsonb,p_terms jsonb)
returns text language plpgsql stable security definer set search_path='' as $$
begin
  if p_operation='ach_preparation' then
    return private.money_ach_preparation_blocker(p_subject::date,p_terms);
  elsif p_operation='ach_retry' then
    return private.money_ach_retry_blocker(p_subject::uuid);
  elsif p_operation='ach_withdrawal' then
    return private.money_ach_withdrawal_blocker(p_subject::uuid,p_command->>'status');
  elsif p_operation='ach_late_settlement' then
    return private.money_ach_late_settlement_blocker(p_subject::uuid,p_command->>'bank_ref');
  elsif p_operation='payout_recovery' then
    return private.money_payout_recovery_blocker(p_subject::uuid,p_command->>'kind',(p_command->>'amount')::bigint,
      (p_command->>'owed')::bigint,p_command->>'key');
  elsif p_operation='bank_statement_close' then
    return private.money_bank_statement_close_blocker(p_subject::uuid,(p_command->>'lines')::integer,(p_command->>'debits')::bigint,
      (p_command->>'credits')::bigint);
  end if;
  return private.money_command_blocker(p_operation,p_subject,p_command);
end $$;


-- public.money_operator_execute_review: latest body from 20260921003000_money_payout_recovery.sql; adds bank_statement_close under the statement lock.
create or replace function public.money_operator_execute_review(p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); q public.money_review_requests; approver uuid; blocker text; job uuid;
  payouts uuid[]; i public.money_ach_items;
begin
  perform public.money_require_finance(actor);
  select * into q from public.money_review_requests where id=p_request for update;
  if not found then raise exception 'Finance review request not found' using errcode='P0002'; end if;
  if q.requested_by<>actor then raise exception 'Only the requesting finance operator can execute this command' using errcode='42501'; end if;
  if exists(select 1 from public.money_review_executions where request_id=q.id) then
    return jsonb_build_object('request_id',q.id,'operation',q.operation,'replay',true);
  end if;
  if now()>=private.money_review_expires_at(q.created_at) then
    raise exception 'Finance review request expired; request it again' using errcode='55000';
  end if;
  -- Two requests for the same subject serialize here; the second then sees it completed. Batches
  -- share one lock because weeks of different requests may overlap.
  perform pg_advisory_xact_lock(hashtextextended('money_review_subject:'||q.operation||':'
    ||case when q.operation='ach_preparation' then 'all' else q.subject end,0));
  -- Take the rows the kernel will lock, in the kernel's order, before checking.
  if q.operation='event_exclusion' then
    perform 1 from public.money_webhook_events where event_id=q.subject for update;
  elsif q.operation='cancellation_refund' then
    select job_id into strict job from public.job_operations where id=split_part(q.subject,':',1)::uuid;
    perform pg_advisory_xact_lock(hashtextextended(job::text,0));
    perform 1 from public.service_requests where id=job for update;
    perform 1 from public.money_obligations where service_request_id=job for update;
  elsif q.operation='ach_preparation' then
    payouts:=array(select x.v::uuid from jsonb_array_elements_text(q.command->'obligations') with ordinality x(v,n) order by x.n);
    perform private.money_lock_lifecycle(payouts);
    perform 1 from public.vendor_onboarding where contractor_id in(
      select private.money_effective_contractor(id) from public.money_obligations where id=any(payouts)
    ) order by contractor_id for share;
    perform 1 from public.money_obligations where id=any(payouts) order by id for update;
  elsif q.operation in ('ach_retry','ach_withdrawal','ach_late_settlement') then
    select item.* into strict i from public.money_ach_items item join public.money_ach_attempts attempt on attempt.item_id=item.id
      where attempt.id=q.subject::uuid;
    perform private.money_lock_lifecycle(array[i.obligation_id]);
    perform 1 from public.vendor_onboarding where contractor_id=i.contractor_id for share;
    perform 1 from public.money_obligations where id=i.obligation_id for update;
  elsif q.operation='payout_recovery' then
    perform private.money_lock_lifecycle(array[q.obligation_id]);
    perform 1 from public.money_obligations where id=q.obligation_id for update;
  elsif q.operation='bank_statement_close' then
    perform private.money_lock_bank_statements();
    perform 1 from public.money_bank_statements where id=q.subject::uuid for update;
  else
    perform 1 from public.money_obligations where id=q.obligation_id for update;
  end if;
  approver:=private.money_review_approver(q.id);
  if approver is null then
    raise exception 'Separate authenticated approval of exact financial command required' using errcode='42501';
  end if;
  blocker:=private.money_request_blocker(q.operation,q.subject,q.command,q.terms);
  if blocker is not null then raise exception 'Finance review not actionable: %',blocker using errcode='55000'; end if;
  if q.operation='event_exclusion' then
    perform public.money_exclude_event(q.subject,actor,approver,q.reason,q.evidence);
  elsif q.operation='reconciliation_resolution' then
    perform public.money_resolve_reconciliation(q.subject::uuid,actor,approver,q.reason);
  elsif q.operation='hold_resolution' then
    -- Requests made before owner decision G3 run as approved until they expire.
    perform public.money_require_finance(approver);
    perform public.money_require_review(actor,approver,q.command);
    perform public.money_resolve_hold(q.subject::uuid,actor,q.reason,q.evidence);
  elsif q.operation='refund_authorization' then
    perform public.money_authorize_refund(q.obligation_id,q.command->>'payment',(q.command->>'service')::bigint,(q.command->>'tax')::bigint,
      (q.command->>'tip')::bigint,q.command->>'key',actor,approver,q.command->>'policy',q.command->>'reason');
  elsif q.operation='cancellation_refund' then
    perform public.money_authorize_cancellation_refund(split_part(q.subject,':',1)::uuid,q.command->>'payment',actor,approver,q.reason);
  elsif q.operation='chargeback_allocation' then
    perform public.money_resolve_chargeback_loss(q.subject,(q.command->>'service')::bigint,(q.command->>'tax')::bigint,
      (q.command->>'tip')::bigint,actor,approver,q.reason);
  elsif q.operation='ach_preparation' then
    perform public.money_prepare_ach(q.subject::date,payouts,actor,approver,q.command->>'bank_ref',q.command->>'reason');
  elsif q.operation='ach_retry' then
    perform public.money_retry_ach(i.id,actor,approver);
  elsif q.operation='ach_withdrawal' then
    perform public.money_withdraw_ach(q.subject::uuid,q.command->>'status',actor,approver,q.reason,q.evidence);
  elsif q.operation='ach_late_settlement' then
    perform public.money_record_ach_late_settlement(q.subject::uuid,q.command->>'bank_ref',actor,approver,q.reason,q.evidence);
  elsif q.operation='payout_recovery' then
    perform public.money_record_payout_recovery(q.obligation_id,q.command->>'kind',(q.command->>'amount')::bigint,
      (q.command->>'owed')::bigint,q.command->>'key',actor,approver,q.reason,q.evidence);
  elsif q.operation='bank_statement_close' then
    perform public.money_close_bank_statement(q.subject::uuid,(q.command->>'lines')::integer,(q.command->>'debits')::bigint,
      (q.command->>'credits')::bigint,actor,approver,q.reason);
  else
    raise exception 'Unsupported finance review' using errcode='22023';
  end if;
  insert into public.money_review_executions(request_id,actor,approver) values(q.id,actor,approver);
  return jsonb_build_object('request_id',q.id,'operation',q.operation,'replay',false);
end $$;


-- public.money_finance_operations: latest body from 20260921003000_money_payout_recovery.sql; close requests read back their details, and the readback gains statements.
create or replace function public.money_finance_operations()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid:=auth.uid();
begin
  perform public.money_require_finance(me);
  return jsonb_build_object(
    'evaluated_at',now(),
    'requests',coalesce((select jsonb_agg(t.item order by t.created_at desc,t.id) from (
      select q.id,q.created_at,jsonb_build_object(
        'request_id',q.id,'operation',q.operation,'subject',q.subject,'obligation_id',q.obligation_id,
        'invoice_number',(select s.invoice_number from public.money_obligations o join public.money_snapshots s on s.id=o.current_snapshot_id where o.id=q.obligation_id),
        'reason',q.reason,'evidence',q.evidence,
        'details',case when q.operation in ('refund_authorization','cancellation_refund') then jsonb_build_object(
            'payment_id',q.command->>'payment','service',(q.command->>'service')::bigint,'tax',(q.command->>'tax')::bigint,'tip',(q.command->>'tip')::bigint)
          when q.operation='chargeback_allocation' then jsonb_build_object(
            'dispute_id',q.subject,'service',(q.command->>'service')::bigint,'tax',(q.command->>'tax')::bigint,'tip',(q.command->>'tip')::bigint)
          when q.operation in ('ach_preparation','ach_retry','ach_withdrawal') then private.money_ach_request_details(q,l.live)
          when q.operation in ('ach_late_settlement','payout_recovery') then private.money_recovery_request_details(q)
          when q.operation='bank_statement_close' then private.money_bank_close_request_details(q) end,
        'requested_by_me',q.requested_by=me,
        'approved_by_me',exists(select 1 from public.money_review_request_approvals a where a.request_id=q.id and a.approved_by=me),
        'recorded_by_me',q.operation='reconciliation_resolution' and exists(select 1 from public.money_readback_entries e where e.observation_id::text=q.subject and e.actor=me),
        'state',case when x.request_id is not null then 'executed'
          when not l.live then 'expired'
          when b.blocker is not null then 'stale'
          when private.money_review_approver(q.id) is not null then 'approved' else 'awaiting_approval' end,
        'blocker',b.blocker,
        'created_at',q.created_at,'expires_at',private.money_review_expires_at(q.created_at),'executed_at',x.created_at) item
      from public.money_review_requests q left join public.money_review_executions x on x.request_id=q.id
      cross join lateral (select x.request_id is null and now()<private.money_review_expires_at(q.created_at) live) l
      cross join lateral (select case when l.live then private.money_request_blocker(q.operation,q.subject,q.command,q.terms) end blocker) b
      where coalesce(x.created_at,q.created_at)>now()-interval '30 days'
      order by q.created_at desc limit 200) t),'[]'::jsonb),
    'holds',coalesce((select jsonb_agg(jsonb_build_object(
        'hold_id',h.id,'obligation_id',h.obligation_id,
        'invoice_number',(select s.invoice_number from public.money_obligations o join public.money_snapshots s on s.id=o.current_snapshot_id where o.id=h.obligation_id),
        'reason',h.reason,'evidence',h.evidence,'placed_by_me',h.actor=me,'created_at',h.created_at) order by h.created_at,h.id)
      from public.money_holds h where not exists(select 1 from public.money_hold_resolutions r where r.hold_id=h.id)),'[]'::jsonb),
    'readbacks',coalesce((select jsonb_agg(jsonb_build_object(
        'obligation_id',o.id,'invoice_number',s.invoice_number,'reconciliation_open',o.reconciliation_open,
        'net_collected',o.captured-o.refunded_service-o.refunded_tax-o.refunded_tip,
        'observation_id',r.id,'observed',r.observed,'expected',r.expected,'currency',r.currency,'evidence',r.evidence,
        'attributed',e.actor is not null,'recorded_by_me',e.actor=me,'recorded_at',r.created_at,
        'resolution_blocker',case when r.id is null then 'not_found' else private.money_review_blocker('reconciliation_resolution',r.id::text) end)
        order by o.created_at,o.id)
      from public.money_obligations o
      left join public.money_snapshots s on s.id=o.current_snapshot_id
      left join lateral (select * from public.money_reconciliation x where x.obligation_id=o.id order by x.observation_sequence desc limit 1) r on true
      left join public.money_readback_entries e on e.observation_id=r.id
      where o.reconciliation_open or (r.id is not null and (r.observed<>r.expected or r.currency<>'usd'))),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(jsonb_build_object(
        'event_id',e.event_id,'event_type',e.event_type,'status',e.status,'attempts',e.attempt_count,
        'holds_all_payouts',e.event_type='reconciliation_required',
        'exclusion_blocker',private.money_review_blocker('event_exclusion',e.event_id),'received_at',e.received_at)
        order by e.received_at,e.event_id)
      from public.money_webhook_events e where e.status<>'processed'
        and not exists(select 1 from public.money_event_exclusions x where x.event_id=e.event_id)),'[]'::jsonb),
    'refunds',coalesce((select jsonb_agg(jsonb_build_object(
        'authorization_id',a.id,'obligation_id',a.obligation_id,
        'invoice_number',(select s.invoice_number from public.money_obligations o join public.money_snapshots s on s.id=o.current_snapshot_id where o.id=a.obligation_id),
        'payment_id',a.payment_id,'amount',a.service+a.tax+a.tip,
        'attempt_status',coalesce(t.status,'not_started'),'provider_reference',t.provider_reference,
        'can_send',me in (a.created_by,a.approved_by),
        'generation',1+(select count(*) from public.money_refund_reissues z where z.authorization_id=a.id),
        'reissue_blocker',case when t.authorization_id is not null and t.status='reconcile' then private.money_reissue_blocker(a.id) end,
        'last_readback',(select jsonb_build_object('found',b.found,'provider_status',b.provider_status,'by_me',b.actor=me,'created_at',b.created_at)
          from public.money_refund_readbacks b where b.authorization_id=a.id order by b.readback_sequence desc limit 1),
        'created_at',a.created_at) order by a.created_at,a.id)
      from public.money_refund_authorizations a left join public.money_refund_attempts t on t.authorization_id=a.id
      where not exists(select 1 from public.money_refunds f where f.authorization_id=a.id)),'[]'::jsonb),
    'cancellations',coalesce((select jsonb_agg(c.item order by c.created_at desc,c.operation_id,c.payment_id) from (
      select j.created_at,j.id operation_id,p.payment_id,jsonb_build_object(
        'operation_id',j.id,'kind',j.kind,'payment_id',p.payment_id,'obligation_id',o.id,'invoice_number',s.invoice_number,
        'refund_percent',(p.preview->>'refund_percent')::integer,
        'service',(p.preview->>'service')::bigint,'tax',(p.preview->>'tax')::bigint,'tip',(p.preview->>'tip')::bigint,
        'blocker',private.money_refund_blocker(o.id,p.payment_id,(p.preview->>'service')::bigint,(p.preview->>'tax')::bigint,(p.preview->>'tip')::bigint),
        'open_request_id',(select q.id from public.money_review_requests q where q.operation='cancellation_refund' and q.subject=j.id||':'||p.payment_id
          and now()<private.money_review_expires_at(q.created_at) and not exists(select 1 from public.money_review_executions x where x.request_id=q.id)
          order by q.created_at desc limit 1),
        'cancelled_at',j.created_at) item
      from public.job_operations j
      join public.money_obligations o on o.service_request_id=j.job_id
      left join public.money_snapshots s on s.id=o.current_snapshot_id
      cross join lateral (select a.stripe_payment_id payment_id,private.money_cancellation_preview(j.id,a.stripe_payment_id) preview
        from public.money_checkout_attempts a where a.obligation_id=o.id and a.status='captured' and a.stripe_payment_id is not null) p
      where j.kind in ('customer_cancel','provider_cancel','no_show')
        and not exists(select 1 from public.money_operation_refund_sources x where x.operation_id=j.id and x.payment_id=p.payment_id)
        and p.preview is not null and (p.preview->>'service')::bigint+(p.preview->>'tax')::bigint+(p.preview->>'tip')::bigint>0
      order by j.created_at desc limit 200) c),'[]'::jsonb),
    'chargebacks',coalesce((select jsonb_agg(jsonb_build_object(
        'dispute_id',d.provider_id,'obligation_id',d.obligation_id,'payment_id',d.payment_id,'amount',d.amount,
        'invoice_number',(select s.invoice_number from public.money_obligations o join public.money_snapshots s on s.id=o.current_snapshot_id where o.id=d.obligation_id),
        'retained',(select jsonb_build_object('service',p.service,'tax',p.tax,'tip',p.tip) from public.money_retained_parts(d.obligation_id) p),
        'blocker',private.money_chargeback_state_blocker(d.provider_id),
        'open_request_id',(select q.id from public.money_review_requests q where q.operation='chargeback_allocation' and q.subject=d.provider_id
          and now()<private.money_review_expires_at(q.created_at) and not exists(select 1 from public.money_review_executions x where x.request_id=q.id)
          order by q.created_at desc limit 1),
        'created_at',d.created_at) order by d.created_at,d.provider_id)
      from public.money_disputes d where d.status='lost'
        and not exists(select 1 from public.money_chargeback_resolutions r where r.dispute_id=d.provider_id)),'[]'::jsonb),
    'ach',private.money_ach_operations(me),
    'recoveries',private.money_recovery_operations(me),
    'statements',private.money_bank_statement_operations(me));
end $$;


-- public.money_finance_reconciliation: latest body from 20260921003000_money_payout_recovery.sql; adds statement line and unevidenced movement exceptions.
create or replace function public.money_finance_reconciliation()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare at_value timestamptz:=now(); rows jsonb; listed integer:=200;
begin
  perform public.money_require_finance(auth.uid());
  select coalesce(jsonb_agg(x.row order by jsonb_array_length(x.row->'issues')>0 desc,(x.row->>'created_at')::timestamptz desc,x.id),'[]'::jsonb)
    into rows from (select o.id,private.money_obligation_reconciliation(o.id,at_value) row from public.money_obligations o) x;
  return jsonb_build_object(
    'evaluated_at',at_value,
    'fee_percent',15,
    'obligation_count',jsonb_array_length(rows),
    'listed_limit',listed,
    'accounts',coalesce((select jsonb_agg(jsonb_build_object('account',a.account,'debit',a.debit,'credit',a.credit) order by a.account)
      from (select l->>'account' account,sum((l->>'debit')::bigint)::bigint debit,sum((l->>'credit')::bigint)::bigint credit
        from public.money_journals j cross join lateral jsonb_array_elements(j.lines) l group by 1) a),'[]'::jsonb),
    'totals',jsonb_build_object(
      'captured',(select coalesce(sum((v->'charges'->>'captured')::bigint),0) from jsonb_array_elements(rows) v),
      'refunded',(select coalesce(sum((v->'refunds'->>'service')::bigint+(v->'refunds'->>'tax')::bigint+(v->'refunds'->>'tip')::bigint),0) from jsonb_array_elements(rows) v),
      'platform_fee',(select coalesce(sum((v->'earnings'->>'platform_fee_ledger')::bigint),0) from jsonb_array_elements(rows) v),
      'tax',(select coalesce(sum((v->'earnings'->>'tax_ledger')::bigint),0) from jsonb_array_elements(rows) v),
      'provider_payable',(select coalesce(sum((v->'payout'->>'payable_ledger')::bigint),0) from jsonb_array_elements(rows) v),
      'paid_out',(select coalesce(sum((v->'payout'->>'paid')::bigint-(v->'payout'->>'returned')::bigint),0) from jsonb_array_elements(rows) v),
      'processor_costs',(select coalesce(sum((v->>'processor_costs')::bigint),0) from jsonb_array_elements(rows) v),
      'chargeback_suspense',(select coalesce(sum((v->'chargebacks'->>'suspense_ledger')::bigint),0) from jsonb_array_elements(rows) v),
      'provider_owed',(select coalesce(sum((v->'payout'->'recovery'->>'owed')::bigint),0) from jsonb_array_elements(rows) v),
      'with_issues',(select count(*) from jsonb_array_elements(rows) v where jsonb_array_length(v->'issues')>0)),
    'global_event_holds',private.money_unprocessed_events(null),
    'exceptions',coalesce((select jsonb_agg(e.item order by e.since,e.kind,e.reference) from (
      select 'ledger_mismatch' kind,v->>'obligation_id' reference,(v->>'created_at')::timestamptz since,
        jsonb_build_object('kind','ledger_mismatch','obligation_id',v->>'obligation_id','invoice_number',v->>'invoice_number','codes',v->'issues','since',v->>'created_at') item
        from jsonb_array_elements(rows) v where jsonb_array_length(v->'issues')>0
      union all
      select 'provider_event',e.event_id,e.received_at,jsonb_build_object('kind','provider_event','event_id',e.event_id,'event_type',e.event_type,
        'status',e.status,'attempts',e.attempt_count,'error_code',e.last_error,'holds_all_payouts',e.event_type='reconciliation_required',
        'obligation_id',(select a.obligation_id from public.money_checkout_attempts a
          where a.id::text=e.payload->>'attempt_id' or a.stripe_payment_id=e.payload->>'payment_id' limit 1),
        'since',e.received_at)
        from public.money_webhook_events e where e.status<>'processed'
          and not exists(select 1 from public.money_event_exclusions x where x.event_id=e.event_id)
      union all
      select 'checkout_reconcile',a.id::text,a.created_at,jsonb_build_object('kind','checkout_reconcile','obligation_id',a.obligation_id,
        'attempt_id',a.id,'mode',a.mode,'amount',a.amount,'error_code',a.failure_code,'since',a.created_at)
        from public.money_checkout_attempts a where a.status='reconcile'
      union all
      select 'refund_pending',a.id::text,a.created_at,jsonb_build_object('kind','refund_pending','obligation_id',a.obligation_id,
        'authorization_id',a.id,'payment_id',a.payment_id,'amount',a.service+a.tax+a.tip,
        'attempt_status',coalesce((select t.status from public.money_refund_attempts t where t.authorization_id=a.id),'not_started'),'since',a.created_at)
        from public.money_refund_authorizations a where not exists(select 1 from public.money_refunds f where f.authorization_id=a.id)
      union all
      select 'reconciliation_open',o.id::text,coalesce((select max(created_at) from public.money_reconciliation where obligation_id=o.id),o.created_at),
        jsonb_build_object('kind','reconciliation_open','obligation_id',o.id,
          'since',coalesce((select max(created_at) from public.money_reconciliation where obligation_id=o.id),o.created_at))
        from public.money_obligations o where o.reconciliation_open
      union all
      select 'chargeback',d.provider_id,d.created_at,jsonb_build_object('kind','chargeback','obligation_id',d.obligation_id,'dispute_id',d.provider_id,
        'payment_id',d.payment_id,'amount',d.amount,'status',d.status,'since',d.created_at)
        from public.money_disputes d where d.status='open' or (d.status='lost'
          and not exists(select 1 from public.money_chargeback_resolutions x where x.dispute_id=d.provider_id))
      union all
      select 'payout_hold',h.id::text,h.created_at,jsonb_build_object('kind','payout_hold','obligation_id',h.obligation_id,'hold_id',h.id,'since',h.created_at)
        from public.money_holds h where not exists(select 1 from public.money_hold_resolutions x where x.hold_id=h.id)
      union all
      select 'provider_owes',x.obligation_id,x.since,jsonb_build_object('kind','provider_owes','obligation_id',x.obligation_id,
        'invoice_number',x.invoice_number,'payee_name',x.payee_name,'amount',x.owed,'since',x.since)
        from (select v->>'obligation_id' obligation_id,v->>'invoice_number' invoice_number,v->'payee'->>'name' payee_name,
            (v->'payout'->'recovery'->>'owed')::bigint owed,
            (select max(j.created_at) from public.money_journals j where j.obligation_id=(v->>'obligation_id')::uuid) since
          from jsonb_array_elements(rows) v) x where x.owed>0
      union all
      select 'bank_outcome',a.id::text,a.created_at,jsonb_build_object('kind','bank_outcome','obligation_id',i.obligation_id,'item_id',i.id,
        'attempt_number',a.attempt_number,'amount',i.amount,'status',a.status,'since',a.created_at)
        from public.money_ach_items i join lateral (select * from public.money_ach_attempts t where t.item_id=i.id order by t.attempt_number desc limit 1) a on true
        where a.status in ('unknown','failed','returned')
      union all
      select 'bank_line',s.line_id::text,l.created_at,jsonb_build_object('kind','bank_line','line_id',s.line_id,'statement_id',l.statement_id,
        'period_start',to_char(b.period_start,'YYYY-MM-DD'),'period_end',to_char(b.period_end,'YYYY-MM-DD'),'line_number',l.line_number,
        'direction',l.direction,'amount',l.amount,'state',s.state,
        'obligation_id',(select m.obligation_id from private.money_bank_movements() m where m.movement=s.movement),'since',l.created_at)
        from private.money_bank_line_states() s join public.money_bank_statement_lines l on l.id=s.line_id
        join public.money_bank_statements b on b.id=l.statement_id
        where s.state in ('unmatched','amount_mismatch')
      union all
      -- A recorded movement with no line, on a business day some imported statement period covers or
      -- that falls between two of them. Later movements wait for the next statement.
      select 'bank_unevidenced',u.movement,u.recorded_at,jsonb_build_object('kind','bank_unevidenced','movement',u.movement,
        'movement_kind',u.kind,'obligation_id',u.obligation_id,'direction',u.direction,'amount',u.amount,'since',u.recorded_at)
        from private.money_bank_unevidenced() u
        where private.money_bank_day(u.recorded_at) between (select min(period_start) from public.money_bank_statements)
          and (select max(period_end) from public.money_bank_statements)
    ) e),'[]'::jsonb),
    'obligations',coalesce((select jsonb_agg(l.v order by l.n) from (select v,n from jsonb_array_elements(rows) with ordinality x(v,n) order by n limit listed) l),'[]'::jsonb));
end $$;


revoke all on function private.money_lock_bank_statements(),
  private.money_bank_day(timestamptz),
  private.money_bank_movements(),
  private.money_bank_pairs(),
  private.money_bank_line_states(),
  private.money_bank_unevidenced(),
  private.money_bank_line_suggestion(uuid),
  private.money_bank_statement_totals(uuid),
  private.money_bank_statement_exceptions(uuid),
  private.money_bank_statement_close_command(uuid,integer,bigint,bigint,text),
  private.money_bank_statement_close_blocker(uuid,integer,bigint,bigint),
  private.money_open_bank_line(uuid),
  private.money_bank_close_request_details(public.money_review_requests),
  private.money_bank_statement_operations(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.money_close_bank_statement(uuid,integer,bigint,bigint,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.money_close_bank_statement(uuid,integer,bigint,bigint,uuid,uuid,text) to service_role;
revoke all on function public.money_operator_import_bank_statement(date,date,jsonb,text,text),
  public.money_operator_match_bank_line(uuid,text,text),
  public.money_operator_dismiss_bank_line(uuid,text),
  public.money_operator_resolve_bank_line(uuid,text,text,text),
  public.money_operator_request_bank_statement_close(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.money_operator_import_bank_statement(date,date,jsonb,text,text),
  public.money_operator_match_bank_line(uuid,text,text),
  public.money_operator_dismiss_bank_line(uuid,text),
  public.money_operator_resolve_bank_line(uuid,text,text,text),
  public.money_operator_request_bank_statement_close(uuid,text,text) to authenticated;
