// Sends the rows waiting in notification_queue. The request carries no data: callers can only
// trigger the sending of what the database queued, so this function needs no login.
import { sendPush, VapidKeys } from './webpush.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID: VapidKeys = {
  publicKey: Deno.env.get('VAPID_PUBLIC_KEY')!,
  privateKey: Deno.env.get('VAPID_PRIVATE_KEY')!,
  subject: 'https://domino-mauve.vercel.app',
};

const rest = (path: string, init: RequestInit = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...init.headers,
    },
  });

const claimPending = async () => {
  const response = await rest('notification_queue?sent_at=is.null&order=created_at&limit=50', {
    method: 'PATCH',
    body: JSON.stringify({ sent_at: new Date().toISOString() }),
  });
  return response.ok ? await response.json() : [];
};

const deliver = async (row: any) => {
  const list = (row.user_ids || []).join(',');
  if (!list) return 0;
  const subscriptions = await (await rest(`push_subscriptions?user_id=in.(${list})&select=endpoint,p256dh,auth`)).json();
  const payload = { title: row.title, body: row.body, tag: row.tag };

  const results = await Promise.allSettled(
    subscriptions.map(async (subscription: any) => {
      const status = await sendPush(subscription, payload, VAPID);
      if (status === 404 || status === 410) {
        await rest(`push_subscriptions?endpoint=eq.${encodeURIComponent(subscription.endpoint)}`, { method: 'DELETE' });
      }
      return status;
    })
  );
  return results.filter((r) => r.status === 'fulfilled' && r.value >= 200 && r.value < 300).length;
};

Deno.serve(async () => {
  const rows = await claimPending();
  let delivered = 0;
  for (const row of rows) {
    delivered += await deliver(row);
    await rest(`notification_queue?id=eq.${row.id}`, { method: 'DELETE' });
  }
  return new Response(JSON.stringify({ notifications: rows.length, delivered }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
