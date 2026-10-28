/**
 * sha256 via WebCrypto (T11). The digest covers the **stored** bytes (the
 * re-encoded JPEG), so `meta.sha256` is verifiable against exactly what lands
 * in IndexedDB and in the T13 export bundle.
 */
import { IngestError } from './errors';

export async function sha256Hex(data: BufferSource): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new IngestError(
      'hash-failed',
      'Secure hashing is unavailable in this context — load the app over HTTPS or localhost to stage images.',
    );
  }
  try {
    const digest = await subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  } catch (error) {
    if (error instanceof IngestError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new IngestError(
      'hash-failed',
      `Secure hashing failed — the image was not staged. Technical detail: ${detail}`,
      { cause: error },
    );
  }
}
