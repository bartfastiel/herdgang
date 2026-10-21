// Software authenticator for tests: creates registrations and sign-ins like a real device (ES256 or Ed25519).
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

type Cbor = number | Uint8Array | string | Cbor[] | Map<Cbor, Cbor> | boolean | null;

function head(major: number, n: number): number[] {
  if (n < 24) return [(major << 5) | n];
  if (n < 256) return [(major << 5) | 24, n];
  if (n < 65536) return [(major << 5) | 25, n >> 8, n & 255];
  return [(major << 5) | 26, (n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function encodeCbor(v: Cbor): Uint8Array {
  const out: number[] = [];
  const enc = (x: Cbor) => {
    if (typeof x === 'number') out.push(...(x >= 0 ? head(0, x) : head(1, -1 - x)));
    else if (typeof x === 'string') {
      const b = new TextEncoder().encode(x);
      out.push(...head(3, b.length), ...b);
    } else if (x instanceof Uint8Array) out.push(...head(2, x.length), ...x);
    else if (Array.isArray(x)) {
      out.push(...head(4, x.length));
      x.forEach(enc);
    } else if (x instanceof Map) {
      out.push(...head(5, x.size));
      for (const [k, val] of x) {
        enc(k);
        enc(val);
      }
    } else if (x === true) out.push(0xf5);
    else if (x === false) out.push(0xf4);
    else out.push(0xf6);
  };
  enc(v);
  return new Uint8Array(out);
}

const sha256 = (b: Uint8Array | string) => new Uint8Array(createHash('sha256').update(b).digest());
const b64url = (b: Uint8Array) => Buffer.from(b).toString('base64url');

export class SoftAuthenticator {
  credentialId = new Uint8Array(createHash('sha256').update(String(Math.random())).digest()).slice(0, 16);
  private key: KeyObject;
  private publicJwk: { x: string; y?: string };
  counter = 0;
  flags = 0x01 | 0x04;
  readonly kind: 'es256' | 'ed25519';
  constructor(kind: 'es256' | 'ed25519' = 'es256') {
    this.kind = kind;
    const pair = kind === 'es256' ? generateKeyPairSync('ec', { namedCurve: 'P-256' }) : generateKeyPairSync('ed25519');
    this.key = pair.privateKey;
    this.publicJwk = pair.publicKey.export({ format: 'jwk' }) as { x: string; y?: string };
  }

  private cose(): Map<Cbor, Cbor> {
    const x = new Uint8Array(Buffer.from(this.publicJwk.x, 'base64url'));
    if (this.kind === 'ed25519') return new Map<Cbor, Cbor>([[1, 1], [3, -8], [-1, 6], [-2, x]]);
    const y = new Uint8Array(Buffer.from(this.publicJwk.y as string, 'base64url'));
    return new Map<Cbor, Cbor>([[1, 2], [3, -7], [-1, 1], [-2, x], [-3, y]]);
  }

  private authData(rpId: string, attested: boolean): Uint8Array {
    const parts: number[] = [...sha256(rpId), this.flags | (attested ? 0x40 : 0), (this.counter >>> 24) & 255, (this.counter >> 16) & 255, (this.counter >> 8) & 255, this.counter & 255];
    if (attested) {
      parts.push(...new Uint8Array(16), this.credentialId.length >> 8, this.credentialId.length & 255, ...this.credentialId, ...encodeCbor(this.cose()));
    }
    return new Uint8Array(parts);
  }

  register(opts: { challenge: string; origin: string; rpId: string }): { clientDataJSON: string; attestationObject: string } {
    const clientData = JSON.stringify({ type: 'webauthn.create', challenge: opts.challenge, origin: opts.origin });
    const att = encodeCbor(new Map<Cbor, Cbor>([['fmt', 'none'], ['attStmt', new Map()], ['authData', this.authData(opts.rpId, true)]]));
    return { clientDataJSON: b64url(new TextEncoder().encode(clientData)), attestationObject: b64url(att) };
  }

  login(opts: { challenge: string; origin: string; rpId: string; type?: string }): { id: string; clientDataJSON: string; authenticatorData: string; signature: string } {
    this.counter++;
    const clientData = new TextEncoder().encode(JSON.stringify({ type: opts.type || 'webauthn.get', challenge: opts.challenge, origin: opts.origin }));
    const auth = this.authData(opts.rpId, false);
    const signed = Buffer.concat([auth, sha256(clientData)]);
    const sig = sign(this.kind === 'es256' ? 'sha256' : null, signed, this.key);
    return { id: b64url(this.credentialId), clientDataJSON: b64url(clientData), authenticatorData: b64url(auth), signature: b64url(sig) };
  }
}
