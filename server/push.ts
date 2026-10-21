// Web Push without libraries: VAPID (RFC 8292) and message encryption aes128gcm (RFC 8291) with node:crypto.
// Used for kitchen timers: when a timer is due, the device that started it gets a notification even if the app sleeps.
import { createCipheriv, createECDH, createPrivateKey, generateKeyPairSync, hkdfSync, randomBytes, sign, type JsonWebKey } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export interface Vapid {
  /** uncompressed P-256 public key, base64url (the applicationServerKey of the browser) */
  publicKey: string;
  privateJwk: JsonWebKey;
}

export interface Subscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

const b64url = (b: Uint8Array) => Buffer.from(b).toString('base64url');

/** the server's VAPID key pair, created on first use and kept in the database */
export function vapidKeys(db: DatabaseSync): Vapid {
  const row = db.prepare("SELECT value FROM kv WHERE key = 'vapid'").get() as { value: string } | undefined;
  if (row) return JSON.parse(row.value) as Vapid;
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x as string, 'base64url'), Buffer.from(jwk.y as string, 'base64url')]);
  const v: Vapid = { publicKey: b64url(pub), privateJwk: jwk };
  db.prepare("INSERT INTO kv (key, value) VALUES ('vapid', ?)").run(JSON.stringify(v));
  return v;
}

/** encrypts one message for a subscription (single record, RFC 8291 / RFC 8188) */
export function encrypt(payload: Uint8Array, sub: { p256dh: string; auth: string }, salt = randomBytes(16)): Buffer {
  const uaPublic = Buffer.from(sub.p256dh, 'base64url');
  const authSecret = Buffer.from(sub.auth, 'base64url');
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

/** VAPID authorization header for the push service behind `endpoint` */
export function vapidHeader(v: Vapid, endpoint: string, subject: string, now = Date.now()): string {
  const aud = new URL(endpoint).origin;
  const enc = (o: unknown) => b64url(Buffer.from(JSON.stringify(o)));
  const data = enc({ typ: 'JWT', alg: 'ES256' }) + '.' + enc({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject });
  const key = createPrivateKey({ key: v.privateJwk, format: 'jwk' });
  const sig = sign('sha256', Buffer.from(data), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${data}.${b64url(sig)}, k=${v.publicKey}`;
}

export type Sender = (sub: Subscription, payload: unknown) => Promise<number>;

/** sends a message; returns the HTTP status of the push service (404/410: subscription is gone) */
export function createSender(v: Vapid, subject: string): Sender {
  return async (sub, payload) => {
    const body = encrypt(Buffer.from(JSON.stringify(payload)), sub);
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        TTL: '600',
        Urgency: 'high',
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        Authorization: vapidHeader(v, sub.endpoint, subject),
      },
      body: new Uint8Array(body),
    });
    return res.status;
  };
}
