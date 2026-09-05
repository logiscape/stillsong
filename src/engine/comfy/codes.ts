// SSC1 composition blobs (mirror of comfy-overlay/ComfyUI-Stillsong/
// codes_format.py): "SSC1" + u16 version + u16 codebooks + u32 frames (LE),
// then frames×codebooks u16 LE. The engine never interprets code values —
// it only counts frames and slices prefixes for teacher forcing.

const MAGIC = 'SSC1';
const HEADER_BYTES = 12;
const VERSION = 1;

export interface CodesHeader {
  version: number;
  books: number;
  frames: number;
}

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(bin);
}

export function parseCodesHeader(bytes: Uint8Array): CodesHeader {
  if (bytes.length < HEADER_BYTES) throw new Error('codes blob too short');
  for (let i = 0; i < MAGIC.length; i++) {
    if (bytes[i] !== MAGIC.charCodeAt(i)) throw new Error('codes blob has a bad magic');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = { version: view.getUint16(4, true), books: view.getUint16(6, true), frames: view.getUint32(8, true) };
  if (header.version !== VERSION) throw new Error(`unsupported codes version ${header.version}`);
  if (bytes.length !== HEADER_BYTES + header.frames * header.books * 2) {
    throw new Error('codes blob length does not match its header');
  }
  return header;
}

/** First `frames` frames as a new SSC1 blob (the whole blob when frames covers it). */
export function sliceCodes(bytes: Uint8Array, frames: number): Uint8Array {
  const header = parseCodesHeader(bytes);
  const keep = Math.max(0, Math.min(frames, header.frames));
  if (keep === header.frames) return bytes;
  const out = new Uint8Array(HEADER_BYTES + keep * header.books * 2);
  out.set(bytes.subarray(0, HEADER_BYTES + keep * header.books * 2));
  new DataView(out.buffer).setUint32(8, keep, true);
  return out;
}
