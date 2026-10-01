-- TRACE-104 evidence: signed-in catalog listing rule. Local throwaway stack only; synthetic records.
insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data,encrypted_password) values
 ('e7900000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','op@example.test',now(),'{}','{}','x');
insert into public.user_roles(user_id,role) values ('e7900000-0000-4000-8000-000000000001','admin') on conflict do nothing;
insert into public.service_categories(id,name) values ('rp-cat','Repro category') on conflict do nothing;
insert into public.services_catalog(id,name,category_id,is_active) values ('rp-live','Repro live','rp-cat',true);
insert into public.contractors(id,name,bio,services,is_active,marketing_enabled) values
 ('e7920000-0000-4000-8000-00000000000a','Repro Excluded Sample','Desc.','{rp-live}',true,true),
 ('e7920000-0000-4000-8000-00000000000b','Repro Unlisted Legacy','Desc.','{rp-live}',true,false);
insert into public.vendor_packages(id,contractor_id,service_id,name,pricing_mode,is_active,needs_review) values
 ('e7930000-0000-4000-8000-00000000000a','e7920000-0000-4000-8000-00000000000a','rp-live','Mock package','fixed',true,false),
 ('e7930000-0000-4000-8000-00000000000b','e7920000-0000-4000-8000-00000000000b','rp-live','Legacy package','fixed',true,false);
insert into public.package_tiers(package_id,name,price) values
 ('e7930000-0000-4000-8000-00000000000a','Basic',99),('e7930000-0000-4000-8000-00000000000b','Basic',149);
begin;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"e7900000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
select public.r0_set_public_listing_exclusion('e7920000-0000-4000-8000-00000000000a',true,'repro');
commit;
-- Positive control: a legacy active provider with content and no exclusion is listable.
insert into public.contractors(id,name,bio,services,is_active,marketing_enabled) values ('e7920000-0000-4000-8000-00000000000c','Repro Listed Provider','Desc.','{rp-live}',true,true);
insert into public.vendor_packages(id,contractor_id,service_id,name,pricing_mode,is_active,needs_review) values ('e7930000-0000-4000-8000-00000000000c','e7920000-0000-4000-8000-00000000000c','rp-live','Listed package','fixed',true,false);
insert into public.package_tiers(package_id,name,price) values ('e7930000-0000-4000-8000-00000000000c','Basic',120);
