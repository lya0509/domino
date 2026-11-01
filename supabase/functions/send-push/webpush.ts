// Web Push with plain WebCrypto, so it runs the same in the Edge Function and in Node tests.
// Payload encryption is RFC 8291 (aes128gcm) and sender identification is RFC 8292 (VAPID).

const encoder = new TextEncoder();

export const fromBase64Url = (value: string): Uint8Array => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
};

export const toBase64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const hkdf = async (salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> => {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8);
  return new Uint8Array(bits);
};

const privateJwk = (publicKey: Uint8Array, privateKey: string, keyOps: string[]): JsonWebKey => ({
  kty: 'EC',
  crv: 'P-256',
  x: toBase64Url(publicKey.slice(1, 33)),
  y: toBase64Url(publicKey.slice(33, 65)),
  d: privateKey,
  ext: true,
  key_ops: keyOps,
});

export interface EphemeralKeys {
  publicKey: Uint8Array;
  privateKey: CryptoKey;
}

const newEphemeralKeys = async (): Promise<EphemeralKeys> => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return { publicKey: new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)), privateKey: pair.privateKey };
};

/** The optional arguments exist for the RFC 8291 test vector; real sends always use fresh ones. */
export const encryptPayload = async (
  plaintext: Uint8Array,
  p256dh: string,
  auth: string,
  salt: Uint8Array = crypto.getRandomValues(new Uint8Array(16)),
  ephemeral?: EphemeralKeys
): Promise<Uint8Array> => {
  const receiverPublic = fromBase64Url(p256dh);
  const server = ephemeral ?? (await newEphemeralKeys());

  const receiverKey = await crypto.subtle.importKey('raw', receiverPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: receiverKey }, server.privateKey, 256)
  );

  const keyInfo = concat(encoder.encode('WebPush: info\0'), receiverPublic, server.publicKey);
  const ikm = await hkdf(fromBase64Url(auth), sharedSecret, keyInfo, 32);
  const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);

  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const record = concat(plaintext, new Uint8Array([2]));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, record));

  const recordSize = new Uint8Array([0, 0, 16, 0]);
  return concat(salt, recordSize, new Uint8Array([server.publicKey.length]), server.publicKey, ciphertext);
};

export const importEphemeralKeys = async (publicKey: string, privateKey: string): Promise<EphemeralKeys> => {
  const raw = fromBase64Url(publicKey);
  return {
    publicKey: raw,
    privateKey: await crypto.subtle.importKey('jwk', privateJwk(raw, privateKey, ['deriveBits']), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']),
  };
};

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export const vapidAuthorization = async (endpoint: string, vapid: VapidKeys, now: number = Date.now()): Promise<string> => {
  const encodeJson = (value: unknown) => toBase64Url(encoder.encode(JSON.stringify(value)));
  const claims = { aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: vapid.subject };
  const unsigned = `${encodeJson({ typ: 'JWT', alg: 'ES256' })}.${encodeJson(claims)}`;

  const key = await crypto.subtle.importKey(
    'jwk',
    privateJwk(fromBase64Url(vapid.publicKey), vapid.privateKey, ['sign']),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(unsigned));
  return `vapid t=${unsigned}.${toBase64Url(new Uint8Array(signature))}, k=${vapid.publicKey}`;
};

export interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Returns the push service's status: 404 and 410 mean the subscription is gone for good. */
export const sendPush = async (subscription: PushSubscriptionRow, payload: unknown, vapid: VapidKeys): Promise<number> => {
  const body = await encryptPayload(encoder.encode(JSON.stringify(payload)), subscription.p256dh, subscription.auth);
  const response = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthorization(subscription.endpoint, vapid),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '3600',
      Urgency: 'high',
    },
    body,
  });
  return response.status;
};
