-- TRACE-156: saved photo-to-service associations. A photo is stored once and linked to any number
-- of the provider's applicable services; no link means General business. Covers the grants, the
-- only client write path, ownership and role boundaries, provider/service validity, withdrawn
-- services, referential integrity and the unchanged gallery paths. Synthetic data only.
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
create function pg_temp.vendor(p_user integer, p_sql text) returns text language sql as $$ select pg_temp.run('authenticated',p_user,p_sql) $$;
create function pg_temp.save(p_user integer, p_photo integer, p_services text) returns text language sql as $$
  select pg_temp.run('authenticated',p_user,format('select public.set_contractor_gallery_photo_services(%L::uuid,%s)::text',pg_temp.g(p_photo),p_services))
$$;
create function pg_temp.links(p_photo integer) returns text language sql as $$
  select coalesce(string_agg(service_id,',' order by service_id),'') from public.contractor_gallery_services where gallery_id=pg_temp.g(p_photo)
$$;

-- Schema, grants and policies
select has_table('public','contractor_gallery_services','the link table exists');
select ok((select relrowsecurity from pg_class where oid='public.contractor_gallery_services'::regclass),'the link table has row-level security');
select is((select string_agg(cmd,',') from pg_policies where schemaname='public' and tablename='contractor_gallery_services'),'SELECT','the only policy is a public read');
select ok(has_table_privilege('anon','public.contractor_gallery_services','SELECT'),'public visitors can read links');
select ok(has_table_privilege('authenticated','public.contractor_gallery_services','SELECT'),'signed-in users can read links');
select is((select count(*) from information_schema.role_table_grants where table_schema='public' and table_name='contractor_gallery_services'
  and grantee in ('anon','authenticated','PUBLIC') and privilege_type<>'SELECT'),0::bigint,'clients have no direct write or maintenance grant');
select ok(has_function_privilege('authenticated','public.set_contractor_gallery_photo_services(uuid,text[])','EXECUTE'),'signed-in users can call the save function');
select ok(not has_function_privilege('anon','public.set_contractor_gallery_photo_services(uuid,text[])','EXECUTE'),'public visitors cannot call the save function');
select ok(has_function_privilege('authenticated','public.contractor_photo_service_options(uuid)','EXECUTE'),'signed-in users can call the options function');
select ok(not has_function_privilege('anon','public.contractor_photo_service_options(uuid)','EXECUTE'),'public visitors cannot call the options function');
select ok(not has_function_privilege('authenticated','private.contractor_photo_service_is_applicable(uuid,text)','EXECUTE'),'the applicability helper is private');
select ok(not has_function_privilege('authenticated','private.can_manage_contractor_photos(uuid)','EXECUTE'),'the authorization helper is private');
select is((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='public.set_contractor_gallery_photo_services(uuid,text[])'::regprocedure),true,'the save function pins an empty search path');
select is((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='public.contractor_photo_service_options(uuid)'::regprocedure),true,'the options function pins an empty search path');

-- Existing photos stay General business
select is((select count(*) from public.contractor_gallery_services where contractor_id in (pg_temp.c(1),pg_temp.c(2))),0::bigint,'photos start with no link, so they are General business');

-- Saving and reloading
select is(pg_temp.save(1,1,$$array['t156-pool','t156-lawn']$$),'{t156-lawn,t156-pool}','the owner links one photo to two services');
select is(pg_temp.links(1),'t156-lawn,t156-pool','both links are saved');
select is((select count(*) from public.contractor_gallery where contractor_id=pg_temp.c(1)),2::bigint,'linking copies no photo');
select is((select count(distinct contractor_id) from public.contractor_gallery_services where gallery_id=pg_temp.g(1)),1::bigint,'each link records one provider');
select is((select contractor_id from public.contractor_gallery_services where gallery_id=pg_temp.g(1) limit 1),pg_temp.c(1),'the link records the provider of the stored photo');
select is(pg_temp.run('anon',null,format($$select string_agg(service_id,',' order by service_id) from public.contractor_gallery_services where gallery_id=%L$$,pg_temp.g(1))),'t156-lawn,t156-pool','a public visitor reads the saved links');
select is(pg_temp.save(1,1,$$array['t156-pool','t156-pool']$$),'{t156-pool}','duplicates collapse and an omitted service is removed');
select is(pg_temp.links(1),'t156-pool','the replaced set is what is saved');
select is(pg_temp.save(1,1,$$array['t156-pool']$$),'{t156-pool}','saving the same set again is harmless');
select is(pg_temp.save(1,1,$$'{}'::text[]$$),'{}','an empty set returns the photo to General business');
select is(pg_temp.links(1),'','no link remains');
select is(pg_temp.save(1,2,$$array['t156-packaged']$$),'{t156-packaged}','a service backed by an active package is applicable');

-- Authorization
select is(pg_temp.save(1,3,$$array['t156-gutter']$$),'42501: This photo is not available to change','a vendor cannot change another provider''s photo');
select is(pg_temp.links(3),'','the other provider''s photo is unchanged');
select is(pg_temp.vendor(1,format($$select public.set_contractor_gallery_photo_services(%L::uuid,'{}')::text$$,'9c140000-0000-4000-8000-0000000000ff')),'42501: This photo is not available to change','a missing photo gives the same answer');
select is(pg_temp.save(4,1,$$array['t156-pool']$$),'42501: This photo is not available to change','a homeowner cannot change a photo');
select matches(pg_temp.run('anon',null,format($$select public.set_contractor_gallery_photo_services(%L::uuid,'{}')::text$$,pg_temp.g(1))),'^42501','a public visitor cannot change a photo');
select is(pg_temp.save(3,3,$$array['t156-gutter']$$),'{t156-gutter}','an admin can change any provider''s photo');
select is(pg_temp.save(3,3,$$array['t156-pool']$$),'22023: That service is not available for this provider','an admin is still limited to that provider''s services');
select is(pg_temp.links(3),'t156-gutter','a rejected admin save changes nothing');
select matches(pg_temp.vendor(1,format($$insert into public.contractor_gallery_services(gallery_id,contractor_id,service_id) values (%L,%L,'t156-pool') returning 'written'$$,pg_temp.g(1),pg_temp.c(1))),'^42501','a vendor cannot insert a link directly');
select matches(pg_temp.vendor(2,format($$delete from public.contractor_gallery_services where gallery_id=%L returning 'written'$$,pg_temp.g(3))),'^42501','a vendor cannot delete a link directly');
select matches(pg_temp.vendor(2,format($$update public.contractor_gallery_services set service_id='t156-pool' where gallery_id=%L returning 'written'$$,pg_temp.g(3))),'^42501','a vendor cannot update a link directly');

-- Provider and service validity
select is(pg_temp.save(1,1,$$array['t156-unrelated']$$),'22023: That service is not available for this provider','a catalog service the provider does not offer is rejected');
select is(pg_temp.save(1,1,$$array['t156-gutter']$$),'22023: That service is not available for this provider','another provider''s service is rejected');
select is(pg_temp.save(1,1,$$array['t156-retired']$$),'22023: That service is not available for this provider','a retired catalog service is rejected');
select is(pg_temp.save(1,1,$$array['t156-paused']$$),'22023: That service is not available for this provider','a service backed only by a paused package is rejected');
select is(pg_temp.save(1,1,$$array['no-such-service']$$),'22023: That service is not available for this provider','an unknown service is rejected');
select is(pg_temp.save(1,1,$$array['t156-pool','t156-unrelated']$$),'22023: That service is not available for this provider','one invalid service rejects the whole save');
select is(pg_temp.links(1),'','a rejected save leaves no partial link');
select is(pg_temp.save(1,1,'null::text[]'),'22023: Choose valid services for this photo','a null list is rejected');
select is(pg_temp.save(1,1,$$array['t156-pool',null]$$),'22023: Choose valid services for this photo','a null service is rejected');
select is(pg_temp.save(1,1,$$array['  ']$$),'22023: Choose valid services for this photo','a blank service is rejected');
select is(pg_temp.save(1,1,$$array[array['t156-pool']]$$),'22023: Choose valid services for this photo','a nested list is rejected');
select is(pg_temp.save(1,1,$$array(select 't156-pool' from generate_series(1,101))$$),'22023: Choose valid services for this photo','an oversized list is rejected');

-- A withdrawn service keeps its link and is never rewritten to General business
select is(pg_temp.save(1,1,$$array['t156-pool']$$),'{t156-pool}','a photo is linked before the service is withdrawn');
update public.contractors set services=array['t156-lawn'] where id=pg_temp.c(1);
select is(pg_temp.links(1),'t156-pool','withdrawing a service leaves the link in place');
select is(pg_temp.save(1,1,$$array['t156-pool','t156-lawn']$$),'{t156-lawn,t156-pool}','a retained link does not block saving a new one');
select is(pg_temp.save(1,1,$$array['t156-lawn']$$),'{t156-lawn}','a withdrawn link can be removed');
select is(pg_temp.save(1,1,$$array['t156-pool']$$),'22023: That service is not available for this provider','a removed withdrawn link cannot be added back');
update public.contractors set services=array['t156-pool','t156-lawn'] where id=pg_temp.c(1);

-- Assignable services
select is(pg_temp.save(1,1,$$array['t156-pool']$$),'{t156-pool}','a link exists before reading the options');
update public.contractors set services=array['t156-lawn'] where id=pg_temp.c(1);
select is(pg_temp.vendor(1,format($$select string_agg(service_id||'='||is_applicable,',' order by service_name) from public.contractor_photo_service_options(%L)$$,pg_temp.c(1))),
  't156-lawn=true,t156-packaged=true,t156-pool=false','the owner sees assignable services and flags a withdrawn link');
select is(pg_temp.vendor(3,format($$select string_agg(service_id,',' order by service_name) from public.contractor_photo_service_options(%L)$$,pg_temp.c(2))),'t156-gutter','an admin reads any provider''s options');
select is(pg_temp.vendor(1,format($$select count(*)::text from public.contractor_photo_service_options(%L)$$,pg_temp.c(2))),'42501: These services are not available','a vendor cannot read another provider''s options');
select is(pg_temp.vendor(4,format($$select count(*)::text from public.contractor_photo_service_options(%L)$$,pg_temp.c(1))),'42501: These services are not available','a homeowner cannot read provider options');
select matches(pg_temp.run('anon',null,format($$select count(*)::text from public.contractor_photo_service_options(%L)$$,pg_temp.c(1))),'^42501','a public visitor cannot read provider options');
update public.contractors set services=array['t156-pool','t156-lawn'] where id=pg_temp.c(1);

-- Integrity below the client path
select throws_ok(format($$insert into public.contractor_gallery_services(gallery_id,contractor_id,service_id) values (%L,%L,'t156-gutter')$$,pg_temp.g(1),pg_temp.c(2)),'23503',null,'a link cannot name a provider other than the photo''s');
select throws_ok(format($$insert into public.contractor_gallery_services(gallery_id,contractor_id,service_id) values (%L,%L,'t156-unrelated')$$,pg_temp.g(2),pg_temp.c(1)),'22023',null,'the trigger rejects an inapplicable service on every write path');
select throws_ok(format($$update public.contractor_gallery_services set created_at=now() where gallery_id=%L$$,pg_temp.g(1)),'55000',null,'a stored link cannot be edited');
select throws_ok(format($$update public.contractor_gallery set contractor_id=%L where id=%L$$,pg_temp.c(2),pg_temp.g(1)),'23503',null,'a linked photo cannot move to another provider');
select throws_ok($$delete from public.services_catalog where id='t156-pool'$$,'23503',null,'a linked catalog service cannot be deleted');

-- The existing gallery paths still work
select is(pg_temp.vendor(1,format($$insert into public.contractor_gallery(contractor_id,image_url,sort_order) values (%L,'https://synthetic.invalid/a3.jpg',2) returning (select count(*)::text from public.contractor_gallery_services l where l.gallery_id=contractor_gallery.id)$$,pg_temp.c(1))),'0','a new upload starts as General business');
select is(pg_temp.vendor(1,format($$update public.contractor_gallery set caption='Updated' where id=%L returning caption$$,pg_temp.g(1))),'Updated','an owner still edits a caption');
select is(pg_temp.vendor(1,format($$delete from public.contractor_gallery where id=%L returning 'removed'$$,pg_temp.g(1))),'removed','an owner still removes a linked photo');
select is(pg_temp.links(1),'','removing a photo removes its links');
select is(pg_temp.links(2),'t156-packaged','removing one photo leaves other photos'' links');
select is(pg_temp.vendor(2,format($$update public.contractor_gallery set caption='Taken' where id=%L returning caption$$,pg_temp.g(2))),null,'a vendor still cannot edit another provider''s photo');

select * from finish();
rollback;
