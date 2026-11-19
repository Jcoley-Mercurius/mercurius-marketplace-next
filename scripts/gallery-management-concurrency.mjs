// TRACE-156: only the disposable CI stack; no hosted connection or production configuration.
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

function sql(source) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["exec", "-i", "supabase_db_mercurius-phase5-isolated", "psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"]);
    let output = "", errors = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { errors += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(output.trim()) : reject(new Error(errors)));
    child.stdin.end(source);
  });
}
const user = "9c210000-0000-4000-8000-000000000001";
const vendor = "9c220000-0000-4000-8000-000000000001";
const photos = [1, 2, 3].map((n) => `9c240000-0000-4000-8000-${String(n).padStart(12, "0")}`);
const array = (ids) => `array[${ids.map((id) => `'${id}'::uuid`).join(",")}]`;
const asVendor = (command) => sql(`begin; set local statement_timeout='10s'; set local role authenticated;
  set local request.jwt.claims='{"role":"authenticated","sub":"${user}"}'; ${command}; commit;`);
const settle = (promise) => promise.then((value) => ({ ok: true, value }), (error) => ({ ok: false, message: error.message }));

assert.equal(await sql(`select count(*) from auth.users where id='${user}'`), "0", "Run on a fresh isolated stack");
await sql(`begin;
  insert into auth.users(id,email) values('${user}','gallery-concurrency@example.invalid');
  delete from public.user_roles where user_id='${user}';
  insert into public.user_roles(user_id,role) values('${user}','vendor');
  insert into public.service_categories(id,name) values('t156-race','Synthetic gallery race');
  insert into public.services_catalog(id,name,category_id,is_active) values
    ('t156-race-pool','Synthetic pool','t156-race',true),('t156-race-lawn','Synthetic lawn','t156-race',true);
  insert into public.contractors(id,user_id,name,is_active,marketing_enabled,services)
    values('${vendor}','${user}','Synthetic gallery concurrency',false,false,array['t156-race-pool','t156-race-lawn']);
  insert into public.contractor_gallery(id,contractor_id,image_url,caption,sort_order) values
    ${photos.map((id, i) => `('${id}','${vendor}','https://synthetic.invalid/${i}.jpg','Original',${i})`).join(",")};
  commit;`);
try {
  const captions = await Promise.all(Array.from({ length: 8 }, (_, i) => settle(asVendor(`select public.save_contractor_gallery_caption('${photos[0]}','Caption ${i}','Original')`))));
  assert.equal(captions.filter((r) => r.ok).length, 1, "Only one caption wins the expected-value race");
  assert.ok(captions.filter((r) => !r.ok).every((r) => r.message.includes("changed elsewhere")));
  console.log("PASS: concurrent caption edits reject stale saves");

  const orders = await Promise.all([
    settle(asVendor(`select public.reorder_contractor_gallery('${vendor}',${array(photos)},${array([photos[1], photos[0], photos[2]])})`)),
    settle(asVendor(`select public.reorder_contractor_gallery('${vendor}',${array(photos)},${array([...photos].reverse())})`)),
  ]);
  assert.equal(orders.filter((r) => r.ok).length, 1, "Only one reorder wins");
  assert.ok(orders.find((r) => !r.ok).message.includes("gallery changed"));
  assert.equal(await sql(`select count(distinct sort_order) from public.contractor_gallery where contractor_id='${vendor}'`), "3");
  console.log("PASS: concurrent reorders preserve one complete order");

  const pairs = await Promise.all([
    settle(asVendor(`select title from public.create_contractor_gallery_pair('${vendor}','${photos[0]}','${photos[1]}','First')`)),
    settle(asVendor(`select title from public.create_contractor_gallery_pair('${vendor}','${photos[1]}','${photos[2]}','Second')`)),
  ]);
  assert.equal(pairs.filter((r) => r.ok).length, 1, "A photo cannot race into two projects across before/after roles");
  assert.equal(await sql(`select count(*) from public.contractor_gallery_pairs where contractor_id='${vendor}'`), "1");
  console.log("PASS: overlapping pairs serialize across both photo roles");

  await Promise.all([
    asVendor(`select count(*) from public.bulk_contractor_gallery_services('${vendor}',${array(photos)},array['t156-race-pool'],'replace')`),
    asVendor(`select count(*) from public.bulk_contractor_gallery_services('${vendor}',${array(photos)},array['t156-race-lawn'],'add')`),
  ]);
  assert.equal(await sql(`select count(distinct labels) from (select gallery_id,string_agg(service_id,',' order by service_id) labels
    from public.contractor_gallery_services where contractor_id='${vendor}' group by gallery_id) s`), "1");
  assert.equal(await sql(`select count(distinct gallery_id) from public.contractor_gallery_services where contractor_id='${vendor}'`), "3");
  console.log("PASS: concurrent bulk edits never split the batch");
} finally {
  await sql(`begin; delete from public.contractor_gallery where contractor_id='${vendor}';
    delete from public.contractors where id='${vendor}'; delete from auth.users where id='${user}';
    delete from public.services_catalog where category_id='t156-race'; delete from public.service_categories where id='t156-race'; commit;`);
}
