/**
 * QR pairing-card helpers (T20) — pure, DOM-light, no React.
 *
 * The encoder (`qrcode-generator`) is loaded through a memoised dynamic
 * `import()` so it never lands in the entry chunk (T25 bundle contract);
 * everything else here is synchronous and SSR-safe.
 */

/** ECC level fixed by the T20 spec — QR cards always encode at M. */
export const QR_ECC_LEVEL = 'M' as const;

/** Minimum rendered edge length of the QR module grid, in CSS pixels. */
export const QR_MIN_PX = 160;

/** Quiet zone around the QR, in CSS pixels (design §5.18: 8 px). */
export const QR_QUIET_ZONE_PX = 8;

/** Pairing URL port — the LAN dev server Vite serves T18–T22 on. */
export const PAIR_PORT = '5173';

export type QrEcc = 'L' | 'M' | 'Q' | 'H';

/** Structural face of a `qrcode-generator` instance (typed locally so the
 *  component does not depend on the package's ambient script typings). */
export type QrCodeLike = {
  addData(data: string, mode?: 'Numeric' | 'Alphanumeric' | 'Byte' | 'Kanji'): void;
  make(): void;
  getModuleCount(): number;
  isDark(row: number, col: number): boolean;
};

/** Factory shape exported by `qrcode-generator` (`typeNumber 0` = auto). */
export type QrFactory = (typeNumber: number, ecc: QrEcc) => QrCodeLike;

/** Square boolean grid: `true` = dark module. Row-major, includes no quiet zone. */
export type QrMatrix = boolean[][];

type QrEncoderModule = { default?: QrFactory } | QrFactory;

let encoderPromise: Promise<QrFactory> | null = null;

/**
 * Resolve the lazy encoder. Memoised: every card instance shares one chunk
 * load; a failure is cached too (an honest permanent error beats a retry loop).
 */
export function loadQrEncoder(): Promise<QrFactory> {
  encoderPromise ??= (async () => {
    const mod = (await import('qrcode-generator')) as unknown as QrEncoderModule;
    const factory = typeof mod === 'function' ? mod : mod.default;
    if (typeof factory !== 'function') {
      throw new Error('qrcode-generator: factory export not found');
    }
    return factory;
  })();
  return encoderPromise;
}

/**
 * Pair URL the QR encodes: `https://<hostname>:<port>/?pair=<token>`.
 * Pure string construction — callers decide how to react to an empty host.
 */
export function buildPairUrl(hostname: string, token: string, port: string = PAIR_PORT): string {
  return `https://${hostname}:${port}/?pair=${token}`;
}

/** Current page hostname, or `null` outside a browser (SSR/tests). */
export function readNetworkHostname(): string | null {
  if (typeof window === 'undefined' || !window.location.hostname) return null;
  return window.location.hostname;
}

/** Current page port, falling back to the pairing default (§5.18 URL). */
export function readPairPort(): string {
  if (typeof window === 'undefined') return PAIR_PORT;
  return window.location.port || PAIR_PORT;
}

/**
 * Build the module matrix for `text`.
 *
 * `typeNumber` defaults to `0` (qrcode-generator auto-selects the smallest
 * version that fits) — real hostnames vary in length, so the card never pins
 * a version. Tests pass an explicit version for deterministic decoding.
 */
export function makeQrMatrix(
  factory: QrFactory,
  text: string,
  options: { typeNumber?: number; ecc?: QrEcc } = {},
): QrMatrix {
  const qr = factory(options.typeNumber ?? 0, options.ecc ?? QR_ECC_LEVEL);
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  const matrix: QrMatrix = [];
  for (let row = 0; row < count; row++) {
    const cells: boolean[] = [];
    for (let col = 0; col < count; col++) cells.push(qr.isDark(row, col));
    matrix.push(cells);
  }
  return matrix;
}

/**
 * `mm:ss` for the EXPIRES row — ceil so the counter never shows `00:00`
 * while time remains; clamps at `00:00` for expired/negative input.
 */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
