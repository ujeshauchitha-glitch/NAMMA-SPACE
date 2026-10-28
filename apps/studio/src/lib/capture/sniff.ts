/**
 * Magic-byte classification for capture intake (T11) — pure, DOM-free.
 *
 * Parity with `scripts/prepare_capture.py` (T3): bytes are authoritative —
 * a familiar extension never promotes content the signature check rejected.
 * Only JPEG, PNG and WebP are accepted for browser staging; HEIC/HEIF gets
 * the exact §9.1 remedy; everything else is honestly rejected.
 */

/** HEIC/HEIF brands recognized at the `ftyp` box (ISO-BMFF), same as the Python script. */
export const HEIC_BRANDS = ['heic', 'heix', 'hevc', 'heif', 'mif1'] as const;

/** §9.1 verbatim — never blame the user for a phone's default format. */
export const HEIC_REMEDY = 'This file is HEIC — export JPG or run the prepare script.';

export const UNSUPPORTED_TYPE_MESSAGE =
  'Unsupported file type — expected JPEG, PNG, or WebP.';

export type ImageKind = 'jpeg' | 'png' | 'webp' | 'heic';

export type ImageClassification =
  | { kind: 'jpeg' | 'png' | 'webp' }
  | { code: 'heic' | 'unsupported-type'; message: string };

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let out = '';
  for (let index = start; index < end && index < bytes.length; index += 1) {
    out += String.fromCharCode(bytes[index]);
  }
  return out;
}

/** Classify the first bytes of a file. `unknown` = not a staged format. */
export function sniffImageKind(header: Uint8Array): ImageKind | 'unknown' {
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
    return 'jpeg';
  }
  const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (header.length >= 8 && PNG_SIGNATURE.every((byte, index) => header[index] === byte)) {
    return 'png';
  }
  if (header.length >= 12 && ascii(header, 0, 4) === 'RIFF' && ascii(header, 8, 12) === 'WEBP') {
    return 'webp';
  }
  if (header.length >= 12 && ascii(header, 4, 8) === 'ftyp') {
    const brand = ascii(header, 8, 12);
    if ((HEIC_BRANDS as readonly string[]).includes(brand)) return 'heic';
  }
  return 'unknown';
}

/** Intake decision with attached honest copy. */
export function classifyImageBytes(header: Uint8Array): ImageClassification {
  const kind = sniffImageKind(header);
  if (kind === 'jpeg' || kind === 'png' || kind === 'webp') return { kind };
  if (kind === 'heic') return { code: 'heic', message: HEIC_REMEDY };
  return { code: 'unsupported-type', message: UNSUPPORTED_TYPE_MESSAGE };
}
