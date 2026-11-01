// Local Postgres built from the repo's migrations, so these tests run the same functions
// and triggers production uses. It simulates Supabase's roles and auth.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';

export const R = new URL('../../', import.meta.url).pathname;
export const sql = (f) => fs.readFileSync(R + f, 'utf8');
export const IDS = {
  A: '11111111-1111-1111-1111-111111111111',
  B: '22222222-2222-2222-2222-222222222222',
  C: '33333333-3333-3333-3333-333333333333',
  D: '44444444-4444-4444-4444-444444444444',
  X: '99999999-9999-9999-9999-999999999999',
  ADM: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
};

// What Supabase provides on its own, and the base schema on top of it
const SUPABASE = `
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto SCHEMA extensions;
CREATE PUBLICATION supabase_realtime;
CREATE TABLE auth.users(id uuid primary key, email text, phone text, encrypted_password text, raw_user_meta_data jsonb, banned_until timestamptz);
CREATE TABLE auth.identities(user_id uuid);
CREATE TABLE auth.sessions(user_id uuid);
CREATE TABLE auth.refresh_tokens(user_id text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.uid',true),'')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.role',true),'') $$;
GRANT USAGE ON SCHEMA auth, storage, public TO anon, authenticated;
CREATE TABLE storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
`;

export async function crearBase() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(SUPABASE);
  await db.exec(sql('supabase/migrations/20261001_00_esquema_base.sql'));
  await db.exec(`GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
    ALTER TABLE public.profiles DROP CONSTRAINT profiles_id_fkey;
    CREATE POLICY "Waitlist visible para todos" ON public.waitlist FOR SELECT USING (true);
    CREATE POLICY "Cualquiera con sesion edita" ON public.waitlist FOR UPDATE TO authenticated USING (true);`);
  await db.exec(`INSERT INTO public.profiles(id,display_name,initials,is_admin) VALUES
    ('${IDS.A}','A','A',false),('${IDS.B}','B','B',false),('${IDS.C}','C','C',false),
    ('${IDS.D}','D','D',false),('${IDS.X}','X','X',false),('${IDS.ADM}','Adm','AD',true);`);
  await db.exec(sql('supabase/migrations/20261031_02_cierre_urgente.sql'));
  return db;
}

export function ayudante(db) {
  const out = [];
  let pass = 0, fail = 0;
  const ok = (name, cond, extra = '') => {
    cond ? pass++ : fail++;
    out.push(`${cond ? '✅' : '❌'} ${name}${cond ? '' : '  -> ' + extra}`);
  };
  // Runs like a PostgREST request
  const as = async (role, uid, q) => {
    await db.exec(`SET request.role='${role}'; SET request.uid='${uid || ''}'; SET ROLE ${role};`);
    try {
      const r = await db.query(q);
      return { rows: r.rows, n: r.affectedRows ?? 0 };
    } catch (e) {
      return { err: e.message };
    } finally {
      await db.exec(`RESET ROLE; SET request.role=''; SET request.uid='';`);
    }
  };
  const fin = () => {
    console.log(out.join('\n'));
    console.log(`\nRESULTADO: ${pass} pasaron, ${fail} fallaron`);
    process.exit(fail ? 1 : 0);
  };
  return { ok, as, fin };
}
