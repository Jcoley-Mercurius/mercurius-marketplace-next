-- Phase 7.5E / TRACE-159 (OD-5, owner approval 2026-11-24): the admin notification readback's
-- database contract. Record: governance/PHASE-7-ADMIN-NOTIFICATION-READBACK-7-5E.md.
--
-- No migration: the page uses the existing table, policies, grants and indexes. The queries below
-- mirror useOwnNotifications exactly (every one names user_id = the signed-in account).
-- A. Characterization: RLS does NOT keep an admin to their own rows ("Admins can view all
--    notifications"), so the explicit user_id filter is what isolates an operator. Pinned so a later
--    policy change is deliberate.
-- B. Operator isolation through the page's queries: admin A lists, pages, counts and marks only A's
--    rows; A cannot mark or delete admin B's rows; keyset paging reaches every row once, including
--    equal timestamps across a page boundary; marking sets read_at only where null, only on the ids
--    given, and is idempotent; historical rows (null body, null or external link, unknown type) are
--    returned unchanged for the client to present safely.
-- C. Non-admin refusal at the database: a homeowner or vendor cannot read or mark admin rows; anon
--    has no access.
-- D. A real producer (open_support_ticket): one row per admin account, each admin's readback lists
--    only their own copy, marking one admin's copy leaves the other's unread, a replayed request key
--    writes none, and no row goes to the requester.
-- Synthetic data only; everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Users: 1 admin A, 2 admin B, 3 homeowner H, 4 vendor V.
insert into auth.users(id,email) select ('c75e0000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'p75e-'||n||'@example.invalid'
  from unnest(array[1,2,3,4]) n;
delete from public.user_roles where user_id in (select ('c75e0000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from unnest(array[1,2,3,4]) n);
insert into public.user_roles(user_id,role) values
 ('c75e0000-0000-4000-8000-000000000001','admin'),('c75e0000-0000-4000-8000-000000000002','admin'),
 ('c75e0000-0000-4000-8000-000000000003','homeowner'),('c75e0000-0000-4000-8000-000000000004','vendor');

create function pg_temp.u(n integer) returns uuid language sql as $$ select ('c75e0000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.n(k integer) returns uuid language sql as $$ select ('c75e9000-0000-4000-8000-'||lpad(k::text,12,'0'))::uuid $$;
create function pg_temp.call(p_user integer, p_sql text) returns jsonb language plpgsql as $$
declare r jsonb; previous text := current_setting('request.jwt.claims', true);
begin
  perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.u(p_user))::text,true);
  set local role authenticated;
  execute p_sql into r;
  reset role;
  perform set_config('request.jwt.claims',coalesce(previous,''),true);
  return r;
end $$;
create function pg_temp.as_anon(p_sql text) returns text language plpgsql as $$
declare r text; previous text := current_setting('request.jwt.claims', true);
begin
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  set local role anon;
  begin
    execute p_sql; r := 'ok';
  exception when others then r := sqlstate;
  end;
  reset role;
  perform set_config('request.jwt.claims',coalesce(previous,''),true);
  return r;
end $$;

-- A has 8 rows: three share one timestamp and two share another, so pages of 2 and 3 split
-- equal-timestamp groups. Unread: n1, n2, n4, n6, n7 (5). Rows 6-8 are historical shapes.
-- B, H and V each have rows A must never list, count or change.
insert into public.notifications(id,user_id,type,severity,title,body,link,related_request_id,read_at,created_at) values
 (pg_temp.n(1), pg_temp.u(1),'support','info','Support request MS-1','Synthetic subject','/admin/tickets',null,null,'2026-02-05 10:00:00.000004+00'),
 (pg_temp.n(2), pg_temp.u(1),'dispute','warning','Service dispute needs review','Synthetic reason','/admin/disputes','c75e8000-0000-4000-8000-000000000001',null,'2026-02-04 10:00:00.000002+00'),
 (pg_temp.n(3), pg_temp.u(1),'job_status','info','Quote proposal ready for review','Synthetic','/admin/requests','c75e8000-0000-4000-8000-000000000001','2026-02-06 00:00:00+00','2026-02-04 10:00:00.000002+00'),
 (pg_temp.n(4), pg_temp.u(1),'job_status','info','Service update','reschedule request: synthetic reason','/notifications','c75e8000-0000-4000-8000-000000000001',null,'2026-02-04 10:00:00.000002+00'),
 (pg_temp.n(5), pg_temp.u(1),'vendor_application','warning','New vendor application','Synthetic Co applied.','/admin/applications',null,'2026-02-06 00:00:00+00','2026-02-03 10:00:00+00'),
 (pg_temp.n(6), pg_temp.u(1),'legacy_kind','info','',null,null,null,null,'2026-02-02 10:00:00.5+00'),
 (pg_temp.n(7), pg_temp.u(1),'job_status','critical','<b>Legacy</b>','Synthetic','https://evil.example/x',null,null,'2026-02-01 10:00:00+00'),
 (pg_temp.n(8), pg_temp.u(1),'job_status','info','Unconfirmed completion needs review','Synthetic','/admin/requests',null,'2026-02-06 00:00:00+00','2026-02-01 10:00:00+00'),
 (pg_temp.n(20), pg_temp.u(2),'support','info','Support request MS-1','Synthetic subject','/admin/tickets',null,null,'2026-02-05 10:00:00.000004+00'),
 (pg_temp.n(21), pg_temp.u(3),'job_status','info','Job complete','Synthetic','/dashboard',null,null,'2026-02-05 10:00:00+00'),
 (pg_temp.n(22), pg_temp.u(4),'job_status','info','Job completed','Synthetic','/vendor/jobs',null,null,'2026-02-05 10:00:00+00');

create temp table original as select * from public.notifications where user_id in (select ('c75e0000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from unnest(array[1,2,3,4]) n);

-- The page's keyset walk (useOwnNotifications.fetchPage), run as the given user until no more rows.
create function pg_temp.walk(p_user integer, p_size integer) returns jsonb language plpgsql as $$
declare acc jsonb := '[]'::jsonb; page jsonb; c_at text; c_id text; guard integer := 0;
begin
  loop
    guard := guard + 1;
    if guard > 50 then raise exception 'paging did not end'; end if;
    page := pg_temp.call(p_user, format($q$select coalesce(jsonb_agg(jsonb_build_object('id', id, 'at', created_at) order by created_at desc, id desc), '[]'::jsonb)
      from (select id, created_at from public.notifications where user_id = auth.uid()
        and (%1$L::timestamptz is null or created_at < %1$L::timestamptz or (created_at = %1$L::timestamptz and id < %2$L::uuid))
        order by created_at desc, id desc limit %3$s) s$q$, c_at, c_id, p_size + 1));
    acc := acc || coalesce((select jsonb_agg(e->'id' order by o) from jsonb_array_elements(page) with ordinality x(e, o) where o <= p_size), '[]'::jsonb);
    exit when jsonb_array_length(page) <= p_size;
    c_at := page->(p_size - 1)->>'at';
    c_id := page->(p_size - 1)->>'id';
  end loop;
  return acc;
end $$;
create function pg_temp.expected_order(p_user integer) returns jsonb language sql as $$
  select jsonb_agg(to_jsonb(id) order by created_at desc, id desc) from public.notifications where user_id = pg_temp.u(p_user) $$;
create function pg_temp.unread(p_user integer) returns bigint language sql as $$
  select (pg_temp.call(p_user, 'select to_jsonb(count(*)) from public.notifications where user_id = auth.uid() and read_at is null'))::text::bigint $$;
create function pg_temp.mark(p_user integer, p_ids uuid[]) returns bigint language sql as $$
  select (pg_temp.call(p_user, format($q$with u as (update public.notifications set read_at = now()
    where user_id = auth.uid() and id = any(%L::uuid[]) and read_at is null returning 1) select to_jsonb(count(*)) from u$q$, p_ids)))::text::bigint $$;

-- =====================================================================================================
-- A. RLS does not isolate admins (characterization)
-- =====================================================================================================
select ok((pg_temp.call(1, format('select to_jsonb(count(*)) from public.notifications where id in (%L, %L, %L)', pg_temp.n(20), pg_temp.n(21), pg_temp.n(22))))::text::int = 3,
  'RLS lets admin A read admin B''s, a homeowner''s and a vendor''s rows: the page''s user_id filter is the isolation');
select is((select count(*) from pg_policy where polrelid = 'public.notifications'::regclass), 5::bigint, 'notifications still has its five policies');
select is((select pg_get_expr(polqual, polrelid) from pg_policy where polrelid = 'public.notifications'::regclass and polname = 'Admins can view all notifications'),
  'has_role(auth.uid(), ''admin''::app_role)', 'the admin read policy is unchanged');
select is((select pg_get_expr(polqual, polrelid) || ' / ' || pg_get_expr(polwithcheck, polrelid) from pg_policy where polrelid = 'public.notifications'::regclass and polcmd = 'w'),
  '(auth.uid() = user_id) / (auth.uid() = user_id)', 'the only UPDATE policy is own-row, for admins too');
select is((select count(*) from pg_policy where polrelid = 'public.notifications'::regclass and polcmd in ('w', 'd') and pg_get_expr(polqual, polrelid) like '%has_role%'), 0::bigint,
  'no admin UPDATE or DELETE policy exists');

-- =====================================================================================================
-- B. Operator isolation through the page's queries
-- =====================================================================================================
select is(pg_temp.walk(1, 25), pg_temp.expected_order(1), 'admin A''s page lists exactly A''s eight rows, newest first');
select is(pg_temp.walk(1, 2), pg_temp.expected_order(1), 'keyset pages of 2 reach every row once, in order, across equal timestamps');
select is(pg_temp.walk(1, 3), pg_temp.expected_order(1), 'keyset pages of 3: the same rows in the same order');
select is((select count(distinct e) from jsonb_array_elements(pg_temp.walk(1, 2)) e), 8::bigint, 'no row is repeated');
select ok(not (pg_temp.walk(1, 2) @> jsonb_build_array(pg_temp.n(20))) and not (pg_temp.walk(1, 2) @> jsonb_build_array(pg_temp.n(21)))
  and not (pg_temp.walk(1, 2) @> jsonb_build_array(pg_temp.n(22))), 'B''s, the homeowner''s and the vendor''s rows never appear in A''s list');
select is(pg_temp.walk(2, 25), jsonb_build_array(pg_temp.n(20)), 'admin B''s page lists only B''s row');
select is((select jsonb_agg(e) from jsonb_array_elements(pg_temp.walk(1, 2)) with ordinality x(e, o) where o between 2 and 4),
  jsonb_build_array(pg_temp.n(4), pg_temp.n(3), pg_temp.n(2)), 'rows sharing a timestamp are ordered by id, descending');
select is(pg_temp.call(1, format('select to_jsonb(r) - %L from (select id, type, severity, title, body, link, related_request_id, read_at from public.notifications where user_id = auth.uid() and id = %L) r', 'id', pg_temp.n(6))),
  '{"body": null, "link": null, "type": "legacy_kind", "title": "", "read_at": null, "severity": "info", "related_request_id": null}'::jsonb,
  'a historical row with a blank title, no body, no link and an unknown type is returned as stored');
select is(pg_temp.call(1, format('select to_jsonb(link) from public.notifications where user_id = auth.uid() and id = %L', pg_temp.n(7)))#>>'{}',
  'https://evil.example/x', 'an external link is returned as stored; the client drops it (unit test)');

select is(pg_temp.unread(1), 5::bigint, 'A''s exact unread count covers A''s whole history');
select is(pg_temp.unread(2), 1::bigint, 'B''s count is only B''s');

-- Cross-account writes change nothing, even between admins.
select is(pg_temp.call(1, format('with u as (update public.notifications set read_at = now() where id = %L returning 1) select to_jsonb(count(*)) from u', pg_temp.n(20)))::text, '0',
  'admin A cannot mark admin B''s row read, even without the user_id filter');
select is(pg_temp.call(1, format('with u as (update public.notifications set read_at = now() where id in (%L, %L) returning 1) select to_jsonb(count(*)) from u', pg_temp.n(21), pg_temp.n(22)))::text, '0',
  'or a homeowner''s or vendor''s row');
select is(pg_temp.call(1, format('with d as (delete from public.notifications where id in (%L, %L, %L) returning 1) select to_jsonb(count(*)) from d', pg_temp.n(20), pg_temp.n(21), pg_temp.n(22)))::text, '0',
  'admin A cannot delete other accounts'' rows');
select is(pg_temp.mark(1, array[pg_temp.n(20), pg_temp.n(21), pg_temp.n(22)]), 0::bigint, 'the page''s mark query with other accounts'' ids changes nothing');
select is((select count(*) from public.notifications where id in (pg_temp.n(20), pg_temp.n(21), pg_temp.n(22)) and read_at is null), 3::bigint, 'those rows are still unread');

-- "Mark visible as read": only the ids loaded and shown (the first page of 3: n1, n4, n3).
create temp table before_mark as select id, read_at from public.notifications where user_id = pg_temp.u(1);
select is(pg_temp.mark(1, array[pg_temp.n(1), pg_temp.n(4), pg_temp.n(3)]), 2::bigint, 'mark visible updates the two unread rows shown');
select is(pg_temp.unread(1), 3::bigint, 'the exact count drops by two');
select is((select array_agg(id order by id) from public.notifications where user_id = pg_temp.u(1) and read_at is null), array[pg_temp.n(2), pg_temp.n(6), pg_temp.n(7)],
  'rows not loaded stay unread');
select is((select read_at from public.notifications where id = pg_temp.n(3)), (select read_at from before_mark where id = pg_temp.n(3)),
  'an already read row shown on the page keeps its read_at');
create temp table after_mark as select id, read_at from public.notifications where user_id = pg_temp.u(1);
select is(pg_temp.mark(1, array[pg_temp.n(1), pg_temp.n(4), pg_temp.n(3)]), 0::bigint, 'marking again is idempotent');
select is((select count(*) from public.notifications n join after_mark a using (id) where n.read_at is distinct from a.read_at), 0::bigint,
  'and every read_at is exactly as before');
select is(pg_temp.mark(1, array[pg_temp.n(7)]), 1::bigint, 'opening an unread row marks it');
select is(pg_temp.mark(1, array[pg_temp.n(7)]), 0::bigint, 'opening it again changes nothing');
select is((select read_at from public.notifications where id = pg_temp.n(20)), null, 'B''s copy of the same ticket notice is still unread');
select is((select count(*) from public.notifications n join original o using (id)
  where (n.user_id, n.type, n.severity, n.title, n.body, n.link, n.related_request_id, n.related_contractor_id, n.created_at)
    is distinct from (o.user_id, o.type, o.severity, o.title, o.body, o.link, o.related_request_id, o.related_contractor_id, o.created_at)), 0::bigint,
  'marking changed no column but read_at, on any account''s row');
select is((select array_agg(id order by id) from public.notifications n join original o using (id) where n.read_at is distinct from o.read_at),
  array[pg_temp.n(1), pg_temp.n(4), pg_temp.n(7)], 'and read_at changed only on the three rows A opened or marked visible');

-- =====================================================================================================
-- C. Non-admin refusal at the database
-- =====================================================================================================
select is(pg_temp.call(3, format('select to_jsonb(count(*)) from public.notifications where user_id in (%L, %L)', pg_temp.u(1), pg_temp.u(2)))::text, '0',
  'a homeowner cannot read admin rows');
select is(pg_temp.call(4, format('select to_jsonb(count(*)) from public.notifications where user_id in (%L, %L)', pg_temp.u(1), pg_temp.u(2)))::text, '0',
  'a vendor cannot read admin rows');
select is(pg_temp.call(4, format('with u as (update public.notifications set read_at = now() where user_id = %L returning 1) select to_jsonb(count(*)) from u', pg_temp.u(2)))::text, '0',
  'a vendor cannot mark admin rows read');
select is(pg_temp.as_anon('select count(*) from public.notifications'), '42501', 'anon has no access to notifications');

-- =====================================================================================================
-- D. A real producer: open_support_ticket (N-SUP-01)
-- =====================================================================================================
create temp table admins_now as select user_id from public.user_roles where role = 'admin';
create temp table before_ticket as select id from public.notifications;
grant select on admins_now, before_ticket to authenticated;
select is(pg_temp.call(3, $q$select to_jsonb((public.open_support_ticket('c75e7000-0000-4000-8000-000000000001', 'P75E access question', 'Synthetic description', null))->>'replayed')$q$)#>>'{}',
  'false', 'the homeowner opens a ticket');
create temp table ticket_rows as select n.* from public.notifications n where n.id not in (select id from before_ticket);
select is((select count(*) from ticket_rows), (select count(*) from admins_now), 'one row per admin account');
select is((select count(distinct user_id) from ticket_rows), (select count(*) from admins_now), 'each admin gets exactly one');
select is((select count(*) from ticket_rows where user_id not in (select user_id from admins_now)), 0::bigint, 'no row goes to the requester or anyone else');
select is((select count(*) from ticket_rows where type = 'support' and link = '/admin/tickets' and title like 'Support request %' and body = 'P75E access question' and read_at is null),
  (select count(*) from ticket_rows), 'every copy is the support notice, unread, linking to Support Tickets');
select is(pg_temp.call(1, 'select to_jsonb(count(*)) from public.notifications where user_id = auth.uid() and id in (select id from (select id from public.notifications except select id from before_ticket) s)')::text,
  '1', 'admin A''s readback lists only A''s copy');
select is(pg_temp.call(2, 'select to_jsonb(count(*)) from public.notifications where user_id = auth.uid() and id in (select id from (select id from public.notifications except select id from before_ticket) s)')::text,
  '1', 'admin B''s readback lists only B''s copy');
select is(pg_temp.mark(1, array(select id from ticket_rows where user_id = pg_temp.u(1))), 1::bigint, 'A opens A''s copy');
select is((select read_at from public.notifications where id = (select id from ticket_rows where user_id = pg_temp.u(2))), null,
  'B''s copy stays unread: read state is per account');
select is(pg_temp.call(3, $q$select to_jsonb((public.open_support_ticket('c75e7000-0000-4000-8000-000000000001', 'P75E access question', 'Synthetic description', null))->>'replayed')$q$)#>>'{}',
  'true', 'replaying the request key returns the stored ticket');
select is((select count(*) from public.notifications where id not in (select id from before_ticket)), (select count(*) from ticket_rows), 'and writes no further notice');

select * from finish();
rollback;
