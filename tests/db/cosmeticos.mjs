// Store and cosmetics on a local copy of the production database:
// what the new store does (wear, swap, take off, custom title) and that nobody wears what they did not buy.
import { ayudante, IDS } from './base.mjs';
import { crearCompleta } from './_completa.mjs';

const { A, B, X } = IDS;
const db = await crearCompleta();
const { ok, as, fin } = ayudante(db);

await db.exec(`UPDATE public.profiles SET betting_points=1000, equipped_items='{}'::jsonb, inventory='{}';
  UPDATE public.profiles SET inventory=ARRAY['title_veteran','border_veteran'] WHERE id='${A}';
  UPDATE public.profiles SET betting_points=600000 WHERE id='${B}';`);

const eq = async (id) => (await db.query(`SELECT equipped_items e FROM public.profiles WHERE id='${id}'`)).rows[0].e || {};
const inv = async (id) => (await db.query(`SELECT inventory i FROM public.profiles WHERE id='${id}'`)).rows[0].i || [];
const pts = async (id) => Number((await db.query(`SELECT betting_points p FROM public.profiles WHERE id='${id}'`)).rows[0].p);
// The store's "Ponérmelo" / "Quitar": save the whole equipped object on my own profile
const poner = (u, obj) => as('authenticated', u, `UPDATE public.profiles SET equipped_items='${JSON.stringify(obj).replace(/'/g, "''")}'::jsonb WHERE id='${u}' RETURNING equipped_items`);
const comprar = (u, item, texto) => as('authenticated', u, `SELECT public.buy_store_item('${item}'${texto ? `, '${texto}'` : ''}) r`);

// Veteran gifts
let r = await poner(A, { title: '🏅 Superviviente' });
ok('un veterano se pone "Superviviente"', (await eq(A)).title === '🏅 Superviviente', JSON.stringify(r));
r = await poner(A, { title: '🏅 Superviviente', border: '#94A3B8' });
ok('y el Marco Titanio', (await eq(A)).border === '#94A3B8', JSON.stringify(await eq(A)));
r = await poner(A, { title: '💰 Millonario', border: '#94A3B8' });
ok('no puede ponerse un título que no compró', (await eq(A)).title === '🏅 Superviviente', JSON.stringify(await eq(A)));
r = await poner(X, { title: '🏅 Superviviente' });
ok('quien no es veterano no puede ponerse "Superviviente"', !(await eq(X)).title, JSON.stringify(await eq(X)));
r = await poner(A, { title: null, border: '#94A3B8' });
ok('se lo quita', (await eq(A)).title === null && (await eq(A)).border === '#94A3B8', JSON.stringify(await eq(A)));

// Table colors
r = await comprar(B, 'table_green');
ok('comprar un tapete cobra 50.000 y lo deja puesto', !r.err && (await pts(B)) === 550000 && (await eq(B)).table_color === '#064e3b', JSON.stringify([r.err, await pts(B), await eq(B)]));
r = await comprar(B, 'table_red');
ok('comprar otro lo cambia', (await eq(B)).table_color === '#7f1d1d', JSON.stringify(await eq(B)));
r = await poner(B, { ...(await eq(B)), table_color: '#064e3b' });
ok('puede volver al que ya tenía', (await eq(B)).table_color === '#064e3b', JSON.stringify(await eq(B)));
r = await poner(B, { ...(await eq(B)), table_color: '#0f172a' });
ok('no puede ponerse el tapete negro sin comprarlo', (await eq(B)).table_color === '#064e3b', JSON.stringify(await eq(B)));
r = await poner(B, { ...(await eq(B)), table_color: null });
ok('puede quitarse el tapete', (await eq(B)).table_color === null, JSON.stringify(await eq(B)));
r = await comprar(B, 'table_red');
ok('no se cobra dos veces lo que ya tiene', !!r.err && (await pts(B)) === 450000, JSON.stringify([r, await pts(B)]));

// Custom title
r = await poner(B, { title: 'El Jefe' });
ok('sin la etiqueta personalizada no se inventa un título', (await eq(B)).title !== 'El Jefe', JSON.stringify(await eq(B)));
r = await comprar(B, 'title_custom', 'El Jefe');
ok('comprarla pone el texto como título', !r.err && (await eq(B)).title === 'El Jefe' && (await inv(B)).includes('title_custom'), JSON.stringify([r.err, await eq(B)]));
const antes = await pts(B);
r = await poner(B, { ...(await eq(B)), title: 'El Patrón' });
ok('después puede cambiar el texto gratis', (await eq(B)).title === 'El Patrón' && (await pts(B)) === antes, JSON.stringify(await eq(B)));

// Nobody gives themselves items or points
r = await as('authenticated', X, `UPDATE public.profiles SET inventory=ARRAY['color_rainbow'], betting_points=999999 WHERE id='${X}'`);
ok('nadie se regala artículos ni puntos', !(await inv(X)).includes('color_rainbow') && (await pts(X)) === 1000, JSON.stringify([await inv(X), await pts(X)]));
r = await poner(A, { title: '🏅 Superviviente' });
r = await as('authenticated', X, `UPDATE public.profiles SET equipped_items='{}'::jsonb WHERE id='${A}' RETURNING id`);
ok('nadie cambia lo que lleva puesto otro', (await eq(A)).title === '🏅 Superviviente', JSON.stringify(r));

fin();
