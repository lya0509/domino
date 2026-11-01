import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptPayload, fromBase64Url, importEphemeralKeys, toBase64Url, vapidAuthorization } from '../supabase/functions/send-push/webpush.ts';

// RFC 8291, appendix A
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  message:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

test('encryption matches the example in the standard byte by byte', async () => {
  const keys = await importEphemeralKeys(RFC.asPublic, RFC.asPrivate);
  const out = await encryptPayload(new TextEncoder().encode(RFC.plaintext), RFC.uaPublic, RFC.auth, fromBase64Url(RFC.salt), keys);
  assert.equal(toBase64Url(out), RFC.message);
});

test('two sends of the same text look different', async () => {
  const text = new TextEncoder().encode('hola');
  const a = await encryptPayload(text, RFC.uaPublic, RFC.auth);
  const b = await encryptPayload(text, RFC.uaPublic, RFC.auth);
  assert.notEqual(toBase64Url(a), toBase64Url(b));
});

test('the sender signature verifies with the public key and names the push service', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const publicKey = toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));

  const now = Date.parse('2026-11-01T12:00:00Z');
  const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', { publicKey, privateKey: jwk.d, subject: 'https://domino-mauve.vercel.app' }, now);
  const [, token, key] = header.match(/^vapid t=(.+), k=(.+)$/);
  assert.equal(key, publicKey);

  const [head, claims, signature] = token.split('.');
  const verified = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, fromBase64Url(signature), new TextEncoder().encode(`${head}.${claims}`));
  assert.equal(verified, true);

  const decoded = JSON.parse(new TextDecoder().decode(fromBase64Url(claims)));
  assert.equal(decoded.aud, 'https://fcm.googleapis.com');
  assert.equal(decoded.exp, now / 1000 + 12 * 3600);
});
