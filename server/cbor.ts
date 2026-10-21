// Minimal CBOR decoder (RFC 8949) for WebAuthn: attestationObject and COSE keys.
// Supports integers, byte and text strings, arrays, maps, true/false/null. No indefinite lengths, no floats.

export type CborValue = number | bigint | Uint8Array | string | CborValue[] | Map<CborValue, CborValue> | boolean | null;

export function decodeCbor(bytes: Uint8Array): CborValue {
  const r = decodeAt(bytes, 0);
  if (r.next !== bytes.length) throw new Error('CBOR: trailing bytes');
  return r.value;
}

/** decodes the first item and returns where it ends (authData holds CBOR followed by more data) */
export function decodeCborPrefix(bytes: Uint8Array, offset: number): { value: CborValue; next: number } {
  return decodeAt(bytes, offset);
}

function readLength(bytes: Uint8Array, offset: number, info: number): { len: number | bigint; next: number } {
  if (info < 24) return { len: info, next: offset };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (info === 24) return { len: bytes[offset], next: offset + 1 };
  if (info === 25) return { len: view.getUint16(offset), next: offset + 2 };
  if (info === 26) return { len: view.getUint32(offset), next: offset + 4 };
  if (info === 27) {
    const big = view.getBigUint64(offset);
    return { len: big <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(big) : big, next: offset + 8 };
  }
  throw new Error('CBOR: indefinite length not supported');
}

function decodeAt(bytes: Uint8Array, offset: number, depth = 0): { value: CborValue; next: number } {
  if (depth > 16) throw new Error('CBOR: nested too deeply');
  if (offset >= bytes.length) throw new Error('CBOR: unexpected end');
  const head = bytes[offset];
  const major = head >> 5;
  const info = head & 0x1f;
  const l = readLength(bytes, offset + 1, info);
  const n = l.len;
  let pos = l.next;
  switch (major) {
    case 0:
      return { value: n, next: pos };
    case 1:
      return { value: typeof n === 'bigint' ? -1n - n : -1 - n, next: pos };
    case 2:
    case 3: {
      if (typeof n === 'bigint' || pos + n > bytes.length) throw new Error('CBOR: string too long');
      const slice = bytes.slice(pos, pos + n);
      return { value: major === 2 ? slice : new TextDecoder().decode(slice), next: pos + n };
    }
    case 4: {
      if (typeof n === 'bigint' || n > 10000) throw new Error('CBOR: array too long');
      const arr: CborValue[] = [];
      for (let i = 0; i < n; i++) {
        const e = decodeAt(bytes, pos, depth + 1);
        arr.push(e.value);
        pos = e.next;
      }
      return { value: arr, next: pos };
    }
    case 5: {
      if (typeof n === 'bigint' || n > 10000) throw new Error('CBOR: map too large');
      const map = new Map<CborValue, CborValue>();
      for (let i = 0; i < n; i++) {
        const k = decodeAt(bytes, pos, depth + 1);
        const v = decodeAt(bytes, k.next, depth + 1);
        map.set(k.value, v.value);
        pos = v.next;
      }
      return { value: map, next: pos };
    }
    case 7:
      if (info === 20) return { value: false, next: offset + 1 };
      if (info === 21) return { value: true, next: offset + 1 };
      if (info === 22) return { value: null, next: offset + 1 };
      throw new Error('CBOR: unsupported simple value');
    default:
      throw new Error('CBOR: tags not supported');
  }
}
