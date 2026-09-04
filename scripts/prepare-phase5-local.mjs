import { mkdirSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
const target = '.phase5-local/supabase';
mkdirSync(target, { recursive: true });
const config = readFileSync('supabase/config.toml', 'utf8')
  .replace(/^project_id = .*/m, 'project_id = "mercurius-phase5-isolated"')
  .replaceAll('5542', '5552');
writeFileSync(`${target}/config.toml`, config);
for (const name of ['migrations', 'tests', 'seed.sql']) cpSync(`supabase/${name}`, `${target}/${name}`, { recursive: true });
console.log('Prepared synthetic-only Phase 5 stack config on ports 55520–55527. No provider environment copied.');
