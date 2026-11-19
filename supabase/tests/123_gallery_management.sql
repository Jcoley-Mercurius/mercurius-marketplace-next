-- TRACE-156 gallery management. Synthetic data, rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Users: 1 vendor A, 2 vendor B, 3 admin, 4 homeowner.
insert into auth.users(id,email) select ('9c110000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'t156-'||n||'@example.invalid'
  from generate_series(1,4) n;
delete from public.user_roles where user_id in (select ('9c110000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,4) n);
insert into public.user_roles(user_id,role) values
 ('9c110000-0000-4000-8000-000000000001','vendor'),('9c110000-0000-4000-8000-000000000002','vendor'),
 ('9c110000-0000-4000-8000-000000000003','admin'),('9c110000-0000-4000-8000-000000000004','homeowner');

insert into public.service_categories(id,name) values ('t156-cat','T156 category') on conflict do nothing;
insert into public.services_catalog(id,name,category_id,is_active) values
 ('t156-pool','T156 Pool service','t156-cat',true),
 ('t156-lawn','T156 Lawn care','t156-cat',true),
 ('t156-gutter','T156 Gutter cleaning','t156-cat',true),
 ('t156-packaged','T156 Packaged only','t156-cat',true),
 ('t156-paused','T156 Paused package','t156-cat',true),
 ('t156-unrelated','T156 Unrelated','t156-cat',true),
 ('t156-retired','T156 Retired','t156-cat',false);

insert into public.contractors(id,user_id,name,is_active,marketing_enabled,services) values
 ('9c120000-0000-4000-8000-000000000001','9c110000-0000-4000-8000-000000000001','T156 Provider A',true,true,array['t156-pool','t156-lawn','t156-retired']),
 ('9c120000-0000-4000-8000-000000000002','9c110000-0000-4000-8000-000000000002','T156 Provider B',true,true,array['t156-gutter']);
insert into public.vendor_packages(id,contractor_id,service_id,name,pricing_mode,is_active,needs_review) values
 ('9c130000-0000-4000-8000-000000000001','9c120000-0000-4000-8000-000000000001','t156-packaged','T156 active','custom_quote',true,false),
 ('9c130000-0000-4000-8000-000000000002','9c120000-0000-4000-8000-000000000001','t156-paused','T156 paused','custom_quote',false,false);
insert into public.contractor_gallery(id,contractor_id,image_url,caption,sort_order) values
 ('9c140000-0000-4000-8000-000000000001','9c120000-0000-4000-8000-000000000001','https://synthetic.invalid/a1.jpg','Pool deck',0),
 ('9c140000-0000-4000-8000-000000000002','9c120000-0000-4000-8000-000000000001','https://synthetic.invalid/a2.jpg',null,1),
 ('9c140000-0000-4000-8000-000000000003','9c120000-0000-4000-8000-000000000002','https://synthetic.invalid/b1.jpg',null,0);

create function pg_temp.u(n integer) returns uuid language sql as $$ select ('9c110000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.c(n integer) returns uuid language sql as $$ select ('9c120000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.g(n integer) returns uuid language sql as $$ select ('9c140000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
-- Run a statement as a role; returns its first value as text, or the SQLSTATE and message.
create function pg_temp.run(p_role text, p_user integer, p_sql text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims',case when p_user is null then jsonb_build_object('role',p_role) else jsonb_build_object('role',p_role,'sub',pg_temp.u(p_user)) end::text,true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql into r;
  exception when others then
    r := sqlstate||': '||sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims','',true);
  return r;
end $$;

-- A fourth photo lets us exercise cross-role pair membership.
insert into public.contractor_gallery(id,contractor_id,image_url,sort_order) values
 ('9c140000-0000-4000-8000-000000000004',pg_temp.c(1),'https://synthetic.invalid/a4.jpg',2);
create function pg_temp.a() returns uuid[] language sql as $$ select array[pg_temp.g(1),pg_temp.g(2),pg_temp.g(4)] $$;
create function pg_temp.command(p_user integer,p_command text) returns text language sql as $$ select pg_temp.run('authenticated',p_user,p_command) $$;

select ok(has_table_privilege('anon','public.contractor_gallery_pairs','SELECT'),'pair metadata is public like gallery photos');
select ok(not has_table_privilege('authenticated','public.contractor_gallery_pairs','INSERT'),'clients cannot forge pairs');
select ok(not has_table_privilege('authenticated','public.contractor_gallery_pairs','UPDATE'),'clients cannot rewrite pairs');
select ok(not has_table_privilege('authenticated','public.contractor_gallery_pairs','DELETE'),'clients cannot directly delete pairs');
select ok(not has_function_privilege('anon','public.reorder_contractor_gallery(uuid,uuid[],uuid[])','EXECUTE'),'anonymous cannot reorder');
select ok(not has_function_privilege('anon','public.bulk_contractor_gallery_services(uuid,uuid[],text[],text)','EXECUTE'),'anonymous cannot bulk edit');
select ok(not has_function_privilege('anon','public.create_contractor_gallery_pair(uuid,uuid,uuid,text)','EXECUTE'),'anonymous cannot pair');
select ok(pg_temp.command(2,format('select public.save_contractor_gallery_caption(%L,%L,%L)',pg_temp.g(1),'Wrong','Pool deck')) like '42501:%%','another vendor cannot caption');
select ok(pg_temp.command(4,format('select public.save_contractor_gallery_caption(%L,%L,%L)',pg_temp.g(1),'Wrong','Pool deck')) like '42501:%%','homeowner cannot caption');
select ok(pg_temp.command(1,format('select public.save_contractor_gallery_caption(%L,%L,%L)',pg_temp.g(1),'  Before cleaning  ','Pool deck')) = 'Before cleaning','owner saves trimmed caption');
select ok(pg_temp.command(1,format('select public.save_contractor_gallery_caption(%L,%L,%L)',pg_temp.g(1),'Lost update','Pool deck')) like '40001:%%','stale caption rejected');
select ok((select caption from public.contractor_gallery where id=pg_temp.g(1))='Before cleaning','stale save preserves saved text');
select ok(pg_temp.command(3,format('select public.save_contractor_gallery_caption(%L,%L,%L)',pg_temp.g(1),'Admin edit','Before cleaning'))='Admin edit','admin can save');
select ok(pg_temp.command(1,format('select public.save_contractor_gallery_caption(%L,%L,%L)',pg_temp.g(1),repeat('x',501),'Admin edit')) like '22023:%%','caption length enforced');

select ok(pg_temp.command(1,format('select count(*) from public.bulk_contractor_gallery_services(%L,%L,array[''t156-pool''],''replace'')',pg_temp.c(1),array[pg_temp.g(1),pg_temp.g(2)]))='2','replace labels on two photos');
select ok((select count(*) from public.contractor_gallery_services where service_id='t156-pool')=2,'both assignments persist');
select ok(pg_temp.command(1,format('select count(*) from public.bulk_contractor_gallery_services(%L,%L,array[''t156-lawn''],''add'')',pg_temp.c(1),array[pg_temp.g(1),pg_temp.g(2)]))='2','add labels');
select ok((select count(*) from public.contractor_gallery_services where gallery_id=pg_temp.g(1))=2,'add preserves old labels');
select ok(pg_temp.command(1,format('select count(*) from public.bulk_contractor_gallery_services(%L,%L,array[''t156-unrelated''],''replace'')',pg_temp.c(1),array[pg_temp.g(1),pg_temp.g(2)])) like '22023:%%','invalid service rejects batch');
select ok((select count(*) from public.contractor_gallery_services)=4,'failed batch leaves all labels');
select ok(pg_temp.command(1,format('select count(*) from public.bulk_contractor_gallery_services(%L,%L,array[''t156-pool''],''replace'')',pg_temp.c(1),array[pg_temp.g(1),pg_temp.g(3)])) like '40001:%%','cross-provider batch rejected');
select ok(pg_temp.command(2,format('select count(*) from public.bulk_contractor_gallery_services(%L,%L,array[''t156-pool''],''clear'')',pg_temp.c(1),array[pg_temp.g(1)])) like '42501:%%','other vendor cannot clear');
select ok(pg_temp.command(1,format('select count(*) from public.bulk_contractor_gallery_services(%L,%L,''{}'',''clear'')',pg_temp.c(1),array[pg_temp.g(1),pg_temp.g(2)]))='2','explicit clear returns general');
select ok((select count(*) from public.contractor_gallery_services)=0,'cleared links are gone');

select ok(pg_temp.command(1,format('select public.reorder_contractor_gallery(%L,%L,%L)::text',pg_temp.c(1),pg_temp.a(),array[pg_temp.g(4),pg_temp.g(1),pg_temp.g(2)]))=array[pg_temp.g(4),pg_temp.g(1),pg_temp.g(2)]::text,'owner reorders whole gallery');
select ok((select sort_order from public.contractor_gallery where id=pg_temp.g(4))=0,'order persists');
select ok(pg_temp.command(1,format('select public.reorder_contractor_gallery(%L,%L,%L)::text',pg_temp.c(1),pg_temp.a(),pg_temp.a())) like '40001:%%','stale order rejected');
select ok(pg_temp.command(1,format('select public.reorder_contractor_gallery(%L,%L,%L)::text',pg_temp.c(1),array[pg_temp.g(4),pg_temp.g(1),pg_temp.g(2)],array[pg_temp.g(4),pg_temp.g(1),pg_temp.g(1)])) like '22023:%%','duplicate order rejected');
select ok(pg_temp.command(2,format('select public.reorder_contractor_gallery(%L,%L,%L)::text',pg_temp.c(1),pg_temp.a(),pg_temp.a())) like '42501:%%','other vendor cannot reorder');

select ok(pg_temp.command(1,format('select title from public.create_contractor_gallery_pair(%L,%L,%L,%L)',pg_temp.c(1),pg_temp.g(1),pg_temp.g(2),'  Patio cleanup  '))='Patio cleanup','owner pairs two existing photos');
select ok((select count(*) from public.contractor_gallery)=4,'pairing copies no photos');
select ok(pg_temp.run('anon',null,'select count(*) from public.contractor_gallery_pairs')='1','public reads saved project');
select ok(pg_temp.command(1,format('select title from public.create_contractor_gallery_pair(%L,%L,%L,%L)',pg_temp.c(1),pg_temp.g(2),pg_temp.g(4),'Other')) like '22023:%%','photo cannot be reused in opposite role');
select ok(pg_temp.command(1,format('select title from public.create_contractor_gallery_pair(%L,%L,%L,%L)',pg_temp.c(1),pg_temp.g(1),pg_temp.g(1),'Same')) like '22023:%%','same-photo pair rejected');
select ok(pg_temp.command(1,format('select title from public.create_contractor_gallery_pair(%L,%L,%L,%L)',pg_temp.c(1),pg_temp.g(1),pg_temp.g(3),'Foreign')) like '22023:%%','cross-provider pair rejected');
select ok(pg_temp.command(2,format('select public.remove_contractor_gallery_pair(%L)',(select id from public.contractor_gallery_pairs))) like '42501:%%','other vendor cannot unpair');
select ok(coalesce(pg_temp.command(3,format('select public.remove_contractor_gallery_pair(%L)',(select id from public.contractor_gallery_pairs))), '') = '','admin removes through command');
select ok((select count(*) from public.contractor_gallery_pairs)=0,'admin unpairs');
select ok((select count(*) from public.contractor_gallery)=4,'unpair leaves both photos');
select ok(pg_temp.command(1,format('select title from public.create_contractor_gallery_pair(%L,%L,%L,%L)',pg_temp.c(1),pg_temp.g(1),pg_temp.g(2),'Cleanup'))='Cleanup','re-pair after removal');
delete from public.contractor_gallery where id=pg_temp.g(1);
select ok((select count(*) from public.contractor_gallery_pairs)=0,'deleting a photo removes its pairing');
select ok(exists(select 1 from public.contractor_gallery where id=pg_temp.g(2)),'deleting one side preserves the other photo');
select * from finish();
rollback;
