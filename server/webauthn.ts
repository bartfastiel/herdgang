// Passkey verification (WebAuthn level 2) with node:crypto only.
// Registration without attestation ("none": we trust the user's device, not the authenticator's vendor); sign-in checks
// signature, origin, RP ID hash, user presence and user verification (fingerprint, face or PIN).
import { createHash, createPublicKey, timingSafeEqual, verify, type JsonWebKey, type KeyObject } from 'node:crypto';
import { decodeCbor, decodeCborPrefix, type CborValue } from './cbor.ts';

export function b64url(buf: Uint8Array): string {
  return Buffer.from(buf).toString('base64url');
}

export function fromB64url(s: string): Uint8Array {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('not base64url');
  return new Uint8Array(Buffer.from(s, 'base64url'));
}

const sha256 = (b: Uint8Array | string) => new Uint8Array(createHash('sha256').update(b).digest());

function equal(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface AuthData {
  rpIdHash: Uint8Array;
  flags: number;
  signCount: number;
  credentialId?: Uint8Array;
  publicKey?: Map<CborValue, CborValue>;
}

const UP = 0x01;
const UV = 0x04;
const AT = 0x40;

export function parseAuthData(data: Uint8Array): AuthData {
  if (data.length < 37) throw new Error('authData too short');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out: AuthData = { rpIdHash: data.slice(0, 32), flags: data[32], signCount: view.getUint32(33) };
  if (out.flags & AT) {
    let pos = 37 + 16; // AAGUID
    const len = view.getUint16(pos);
    pos += 2;
    if (pos + len > data.length) throw new Error('credentialId too long');
    out.credentialId = data.slice(pos, pos + len);
    pos += len;
    const key = decodeCborPrefix(data, pos);
    if (!(key.value instanceof Map)) throw new Error('COSE key missing');
    out.publicKey = key.value;
  }
  return out;
}

/** COSE key → JWK (ES256, EdDSA/Ed25519, RS256) */
export function coseToJwk(cose: Map<CborValue, CborValue>): { jwk: JsonWebKey; alg: number } {
  const kty = cose.get(1);
  const alg = cose.get(3) as number;
  const bytes = (k: number) => {
    const v = cose.get(k);
    if (!(v instanceof Uint8Array)) throw new Error('COSE field missing');
    return b64url(v);
  };
  if (kty === 2 && alg === -7 && cose.get(-1) === 1) return { jwk: { kty: 'EC', crv: 'P-256', x: bytes(-2), y: bytes(-3) }, alg };
  if (kty === 1 && alg === -8 && cose.get(-1) === 6) return { jwk: { kty: 'OKP', crv: 'Ed25519', x: bytes(-2) }, alg };
  if (kty === 3 && alg === -257) return { jwk: { kty: 'RSA', n: bytes(-1), e: bytes(-2) }, alg };
  throw new Error('unsupported key type');
}

export function keyFromJwk(jwk: JsonWebKey): KeyObject {
  return createPublicKey({ key: jwk, format: 'jwk' });
}

interface ClientData {
  type: string;
  challenge: string;
  origin: string;
  crossOrigin?: boolean;
}

function checkClientData(raw: Uint8Array, type: string, challenge: string, origins: string[]): void {
  let cd: ClientData;
  try {
    cd = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new Error('invalid clientDataJSON');
  }
  if (cd.type !== type) throw new Error('wrong type');
  if (typeof cd.challenge !== 'string' || !equal(fromB64url(cd.challenge), fromB64url(challenge))) throw new Error('wrong challenge');
  if (origins.indexOf(cd.origin) < 0) throw new Error('wrong origin: ' + String(cd.origin).slice(0, 120));
  if (cd.crossOrigin) throw new Error('crossOrigin not allowed');
}

export interface RegistrationInput {
  clientDataJSON: string;
  attestationObject: string;
}

export interface VerifiedCredential {
  credentialId: string;
  jwk: JsonWebKey;
  alg: number;
  signCount: number;
}

export function verifyRegistration(input: RegistrationInput, expected: { challenge: string; origins: string[]; rpId: string }): VerifiedCredential {
  const clientData = fromB64url(input.clientDataJSON);
  checkClientData(clientData, 'webauthn.create', expected.challenge, expected.origins);
  const att = decodeCbor(fromB64url(input.attestationObject));
  if (!(att instanceof Map)) throw new Error('invalid attestationObject');
  const authBytes = att.get('authData');
  if (!(authBytes instanceof Uint8Array)) throw new Error('authData missing');
  const auth = parseAuthData(authBytes);
  if (!equal(auth.rpIdHash, sha256(expected.rpId))) throw new Error('wrong RP ID');
  if (!(auth.flags & UP) || !(auth.flags & UV)) throw new Error('user not verified');
  if (!auth.credentialId || !auth.publicKey) throw new Error('key missing');
  const { jwk, alg } = coseToJwk(auth.publicKey);
  keyFromJwk(jwk); // throws for an invalid key
  return { credentialId: b64url(auth.credentialId), jwk, alg, signCount: auth.signCount };
}

export interface AssertionInput {
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
}

/** verifies a sign-in; returns the new signature counter */
export function verifyAssertion(
  input: AssertionInput,
  stored: { jwk: JsonWebKey; alg: number; signCount: number },
  expected: { challenge: string; origins: string[]; rpId: string },
): number {
  const clientData = fromB64url(input.clientDataJSON);
  checkClientData(clientData, 'webauthn.get', expected.challenge, expected.origins);
  const authBytes = fromB64url(input.authenticatorData);
  const auth = parseAuthData(authBytes);
  if (!equal(auth.rpIdHash, sha256(expected.rpId))) throw new Error('wrong RP ID');
  if (!(auth.flags & UP) || !(auth.flags & UV)) throw new Error('user not verified');
  const signed = Buffer.concat([authBytes, sha256(clientData)]);
  const key = keyFromJwk(stored.jwk);
  const hash = stored.alg === -8 ? null : 'sha256';
  if (!verify(hash, signed, key, fromB64url(input.signature))) throw new Error('invalid signature');
  // A counter of 0 means the authenticator does not count (e.g. synced passkeys). Otherwise it must increase (cloned key?).
  if ((auth.signCount !== 0 || stored.signCount !== 0) && auth.signCount <= stored.signCount) throw new Error('signature counter did not increase');
  return auth.signCount;
}
