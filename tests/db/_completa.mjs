// Full local database: base schema plus every migration in order, like production.
import { crearBase, sql } from './base.mjs';
import fs from 'node:fs';

export const cuerpo = (f) => sql(`supabase/migrations/${f}`).split('-- VERIFICACIÓN')[0].replace(/-- =+\s*$/, '');

export async function crearCompleta() {
  const db = await crearBase();
  const files = fs.readdirSync(new URL('../../supabase/migrations/', import.meta.url)).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (f.startsWith('20261001_00') || f.startsWith('20261031_02')) continue; // already in crearBase
    if (f.startsWith('20261031_01')) continue; // admin PIN lives in a private schema the tests do not need
    let body = cuerpo(f);
    if (f.startsWith('20261101_10')) {
      await db.exec(`CREATE SCHEMA IF NOT EXISTS net;
        CREATE OR REPLACE FUNCTION net.http_post(url text, body jsonb, headers jsonb) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;`);
      body = body.replace('CREATE EXTENSION IF NOT EXISTS pg_net;', '');
    }
    try {
      await db.exec(body);
    } catch (e) {
      throw new Error(`${f}: ${e.message}`);
    }
  }
  return db;
}
