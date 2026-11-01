// Local Postgres built from the repo's real SQL files, so these tests run the same
// functions and triggers production uses. It simulates Supabase's roles and auth.
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

// Cuts one top-level statement out of a SQL file, from its first line through its closing line
const between = (text, start, end) => {
  const i = text.indexOf(start);
  if (i < 0) throw new Error(`No encontré: ${start}`);
  const j = text.indexOf(end, i);
  if (j < 0) throw new Error(`No encontré el final de: ${start}`);
  return text.slice(i, j + end.length);
};

const SCHEMA = `
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto SCHEMA extensions;
CREATE PUBLICATION supabase_realtime;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.uid',true),'')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.role',true),'') $$;
GRANT USAGE ON SCHEMA auth, storage, public TO anon, authenticated;
CREATE TABLE public.profiles(id uuid primary key, display_name text, initials text, betting_points numeric default 1000, is_admin boolean default false, achievements jsonb default '[]', inventory text[] default '{}', streak_count int default 0, last_streak_update_at date, last_daily_bonus_at timestamptz, equipped_title text, equipped_frame text, equipped_table_color text);
CREATE TABLE public.matches(id uuid primary key default gen_random_uuid(), status text default 'active', game_mode text default 'teams', limit_score int default 100, rounds jsonb default '[]', players_json jsonb default '[]', team1_player1 uuid references public.profiles(id), team1_player2 uuid references public.profiles(id), team2_player1 uuid references public.profiles(id), team2_player2 uuid references public.profiles(id), team1_total int default 0, team2_total int default 0, winner_team int, is_zapato boolean default false, substitutions jsonb default '[]', wager_amount numeric default 0, is_wager_match boolean default false, wager_settled boolean default false, tournament_id uuid, created_by uuid, created_at timestamptz default now());
CREATE TABLE public.bets(id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade, match_id uuid not null references public.matches(id) on delete cascade, bet_on_team int not null, amount_wagered int not null, multiplier numeric default 2.0, status text default 'pending', created_at timestamptz default now());
CREATE TABLE public.tournaments(id uuid primary key default gen_random_uuid(), name text not null, entry_fee numeric not null default 0, prize_pool numeric default 0, max_participants int not null default 8, status text not null default 'registration', created_by uuid references public.profiles(id), created_at timestamptz default now(), tournament_type text default 'brackets', entry_points numeric default 0, prize_paid boolean default false);
CREATE TABLE public.tournament_participants(id uuid primary key default gen_random_uuid(), tournament_id uuid references public.tournaments(id) on delete cascade, user_id uuid, partner_id uuid, partner_status text, payment_status text default 'pending', payout_details text);
CREATE TABLE public.tournament_brackets(id uuid primary key default gen_random_uuid(), tournament_id uuid references public.tournaments(id) on delete cascade, round_number int not null, match_number int not null, team1_player1 uuid, team1_player2 uuid, team2_player1 uuid, team2_player2 uuid, winner_team int, next_match_id uuid, live_match_id uuid references public.matches(id) on delete set null, created_at timestamptz default now());
CREATE TABLE public.waitlist(id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(), creator_id uuid not null references public.profiles(id), player1_id uuid not null references public.profiles(id), player2_id uuid not null references public.profiles(id), status text not null default 'waiting');
CREATE TABLE public.live_chat(id uuid primary key default gen_random_uuid(), user_id uuid, message text);
CREATE TABLE public.chat_messages(id uuid primary key default gen_random_uuid(), message text);
CREATE TABLE public.duos(id uuid primary key default gen_random_uuid(), player1_id uuid, player2_id uuid, is_active boolean default true);
CREATE TABLE storage.buckets(id text primary key, public boolean, file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
INSERT INTO storage.buckets VALUES('avatars',true,null,null),('ads',true,null,null),('receipts',true,null,null);
CREATE FUNCTION public.update_player_streaks_for_match(p_match_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN NULL; END $$;
`;

export async function crearBase() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(SCHEMA);

  await db.exec(sql('fix_points_security.sql').split('-- VERIFICACIÓN (mándame captura de las 3)')[0].replace(/-- =+\s*$/, ''));
  await db.exec(sql('fix_wager_consent.sql').split('-- VERIFICACIÓN (mándame captura de las 2)')[0].replace(/-- =+\s*$/, ''));
  await db.exec(sql('fix_wager_substitutes.sql').split('-- VERIFICACIÓN (mándame captura)')[0].replace(/-- =+\s*$/, ''));
  await db.exec(sql('fix_bets_rules.sql'));
  await db.exec(sql('fix_tournament_engine.sql').split('-- Permisos: los internos')[0]);

  const m = sql('supabase_maintenance_fix.sql');
  await db.exec(between(m, 'CREATE OR REPLACE FUNCTION public.trg_fn_settle_match_on_complete()', 'END;\n$$;'));
  await db.exec(between(m, 'DROP TRIGGER IF EXISTS trg_auto_resolve_match_bets', 'EXECUTE FUNCTION public.trg_fn_settle_match_on_complete();'));

  await db.exec(`GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
    ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;
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
