# Review reproduction for P4-R2. Fixed isolated local database only.
# Commits temporary synthetic fixtures, rolls back both actions, then removes only its fixtures.
import subprocess, time
CMD=['docker','exec','-i','supabase_db_mercurius-phase5-isolated','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At']
job='f4000000-0000-4000-8000-000000000004'
owner='f4000000-0000-4000-8000-000000000001'
vendor='f4000000-0000-4000-8000-000000000002'
admin='f4000000-0000-4000-8000-000000000003'
contractor='f4000000-0000-4000-8000-000000000005'
def sql(value):
 r=subprocess.run(CMD,input=value,text=True,capture_output=True,timeout=20)
 if r.returncode: raise RuntimeError(r.stderr)
 return r.stdout
# Fixed synthetic IDs must be unused; insert errors rather than reuse owner data.
setup=f"""begin;
insert into auth.users(id,raw_user_meta_data) values ('{owner}','{{"full_name":"Synthetic lock owner"}}'),('{vendor}','{{"full_name":"Synthetic lock vendor"}}'),('{admin}','{{"full_name":"Synthetic lock admin"}}');
insert into public.user_roles(user_id,role) values ('{admin}','admin'),('{vendor}','vendor');
insert into public.contractors(id,user_id,name) values ('{contractor}','{vendor}','Synthetic lock provider');
insert into public.service_requests(id,customer_id,contractor_id,service_type,address,status) values ('{job}','{owner}','{contractor}','Synthetic lock probe','Synthetic fixture','in_progress'); commit;"""
sql(setup)
a=b=None
try:
 a=subprocess.Popen(CMD,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
 a.stdin.write(f"begin; set local application_name='phase4_review_lock_a'; set local role authenticated; select set_config('request.jwt.claims','{{\"role\":\"authenticated\",\"sub\":\"{admin}\"}}',true); select pg_advisory_xact_lock(hashtextextended('{job}',0));\n\\echo A_LOCKED\n".replace('\"','"'))
 a.stdin.flush()
 while True:
  line=a.stdout.readline()
  if 'A_LOCKED' in line: break
  if not line: raise RuntimeError('Session A ended before lock: '+a.stderr.read())
 b=subprocess.Popen(CMD,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 b.stdin.write(f"begin; set local application_name='phase4_review_lock_b'; set local role authenticated; select set_config('request.jwt.claims','{{\"role\":\"authenticated\",\"sub\":\"{vendor}\"}}',true); select public.vendor_complete_job('{job}',array['synthetic-proof']); rollback;\n".replace('\"','"'));b.stdin.close();b.stdin=None
 deadline=time.monotonic()+10
 while time.monotonic()<deadline:
  if 'advisory' in sql("select wait_event from pg_stat_activity where application_name='phase4_review_lock_b';"):break
  time.sleep(.05)
 else:raise RuntimeError('Session B never waited on advisory lock')
 a.stdin.write(f"select public.transition_job_status('{job}','pending','Synthetic concurrent correction'); rollback;\n");a.stdin.close();a.stdin=None
 ao,ae=a.communicate(timeout=10);bo,be=b.communicate(timeout=10)
 print('Completion versus admin correction deadlock:', 'CONFIRMED' if 'deadlock detected' in ae+be else 'NOT REPRODUCED')
 print(ae+be)
 if 'deadlock detected' not in ae+be:raise RuntimeError('Expected deadlock missing')
finally:
 for process in (a,b):
  if process and process.poll() is None:process.kill();process.wait()
 sql(f"begin; delete from public.service_requests where id='{job}'; delete from public.contractors where id='{contractor}'; delete from auth.users where id in ('{owner}','{vendor}','{admin}'); commit;")
 print('Synthetic fixture cleanup complete')
