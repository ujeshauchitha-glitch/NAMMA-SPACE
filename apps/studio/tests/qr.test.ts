import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  PAIR_PORT,
  QR_QUIET_ZONE_PX,
  buildPairUrl,
  formatCountdown,
  loadQrEncoder,
  makeQrMatrix,
  type QrFactory,
} from '../src/components/scan/qr-code';
import {
  deriveRailStages,
  formatStageTime,
  type RailStageStatus,
} from '../src/components/scan/stage-rail';
import { QrPairingCard, QrSvg } from '../src/components/scan/QrPairingCard';
import { StageRail } from '../src/components/scan/StageRail';
import type { PairingStatus } from '../src/state/types';

/**
 * T20 — QR pairing card + stage rail.
 *
 * Pure helpers are tested directly; the components are asserted through SSR
 * markup (renderToStaticMarkup) because the unit suite has no DOM: effects
 * never run under SSR, so the QR area is honestly still on its skeleton and
 * the assertions target text/testid/aria — never CSS class strings.
 *
 * The encoder check is a real decode: format info (BCH-validated), mask
 * removal, zigzag read and a payload comparison — not just "it rendered
 * something square".
 */

const PAIR_URL = 'https://a.local:5173/?pair=NS-4F2A';
const PAIR_TOKEN = 'NS-4F2A';

function markup(node: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(node);
}

// ---------------------------------------------------------------------------
// QR decode — standard reader for a known typeNumber/ECC matrix.
// ---------------------------------------------------------------------------

/** BCH(15,5) remainder generator used by the QR format-information code. */
function formatRemainder(top5: number): number {
  let rem = top5;
  for (let i = 0; i < 10; i += 1) {
    rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  }
  return rem;
}

/**
 * Read + validate the 15-bit format information (both copies), returning the
 * mask pattern. Throws when the copies disagree or fail BCH — a real decode,
 * not a permissive best-effort.
 */
function readFormatMask(matrix: boolean[][]): number {
  const size = matrix.length;
  const copy1: number[] = [];
  const copy2: number[] = [];

  for (let i = 0; i <= 5; i += 1) copy1[i] = matrix[i][8] ? 1 : 0;
  copy1[6] = matrix[7][8] ? 1 : 0;
  copy1[7] = matrix[8][8] ? 1 : 0;
  copy1[8] = matrix[8][7] ? 1 : 0;
  for (let i = 9; i < 15; i += 1) copy1[i] = matrix[8][14 - i] ? 1 : 0;

  for (let i = 0; i < 8; i += 1) copy2[i] = matrix[8][size - 1 - i] ? 1 : 0;
  for (let i = 8; i < 15; i += 1) copy2[i] = matrix[size - 15 + i][8] ? 1 : 0;

  const toInt = (bits: number[]): number =>
    bits.reduce((value, bit, index) => value | (bit << index), 0);

  const raw1 = toInt(copy1);
  const raw2 = toInt(copy2);
  expect(raw2).toBe(raw1); // copies must agree exactly

  const d = raw1 ^ 0x5412;
  expect(d & 0x3ff).toBe(formatRemainder(d >>> 10)); // BCH valid
  expect((d >>> 13) & 3).toBe(0b00); // ECC level M
  return (d >>> 10) & 7; // mask pattern 0..7 (low 3 bits of the 5-bit data field)
}

function maskPredicate(mask: number, row: number, col: number): boolean {
  switch (mask) {
    case 0:
      return (row + col) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return col % 3 === 0;
    case 3:
      return (row + col) % 3 === 0;
    case 4:
      return (Math.floor(col / 3) + Math.floor(row / 2)) % 2 === 0;
    case 5:
      return ((col * row) % 2) + ((col * row) % 3) === 0;
    case 6:
      return (((col * row) % 2) + ((col * row) % 3)) % 2 === 0;
    case 7:
      return (((row + col) % 2) + ((col * row) % 3)) % 2 === 0;
    default:
      throw new Error(`mask out of range: ${mask}`);
  }
}

/** Mark every non-data (function) module for a version-1..6 matrix. */
function functionModules(size: number): boolean[][] {
  const fn: boolean[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => false),
  );
  const mark = (row0: number, col0: number, rows: number, cols: number): void => {
    for (let r = row0; r < row0 + rows; r += 1) {
      for (let c = col0; c < col0 + cols; c += 1) {
        if (fn[r]?.[c] !== undefined) fn[r][c] = true;
      }
    }
  };
  // Finder patterns + separators (three 8×8 corners).
  mark(0, 0, 8, 8);
  mark(0, size - 8, 8, 8);
  mark(size - 8, 0, 8, 8);
  // Timing patterns.
  for (let i = 0; i < size; i += 1) {
    fn[6][i] = true;
    fn[i][6] = true;
  }
  // Format information (both copies + dark module).
  for (let i = 0; i <= 8; i += 1) fn[i][8] = true;
  for (let i = 0; i <= 8; i += 1) fn[8][i] = true;
  for (let i = size - 8; i < size; i += 1) fn[i][8] = true;
  for (let i = size - 8; i < size; i += 1) fn[8][i] = true;
  // Alignment pattern — version 3 has exactly one at centre (22, 22).
  mark(20, 20, 5, 5);
  return fn;
}

/** Decode a version-3, ECC-M matrix back to its byte-mode payload. */
function decodeQrV3(matrix: boolean[][]): string {
  const size = matrix.length;
  expect(size).toBe(29); // version 3 (29×29) — pinned in the encoder call

  const mask = readFormatMask(matrix);
  const fn = functionModules(size);

  // Unmask every data module in place (read-only copy below).
  const data = matrix.map((rowArr, row) =>
    rowArr.map((dark, col) => (fn[row][col] ? dark : dark !== maskPredicate(mask, row, col))),
  );

  // Zigzag read: column pairs right→left, skipping the timing column at 6.
  const bits: number[] = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    const pairRight = right === 6 ? 5 : right;
    const upward = ((pairRight + 1) & 2) === 0;
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const col = pairRight - j;
        const row = upward ? size - 1 - vert : vert;
        if (col >= 0 && !fn[row][col]) bits.push(data[row][col] ? 1 : 0);
      }
    }
  }

  // Version 3-M = 44 data codewords (single block).
  const codewords: number[] = [];
  for (let i = 0; i + 8 <= 44 * 8; i += 8) {
    let byte = 0;
    for (let b = 0; b < 8; b += 1) byte = (byte << 1) | bits[i + b];
    codewords.push(byte);
  }

  // Byte mode: 4-bit mode indicator + 8-bit length + payload.
  expect(codewords[0] >> 4).toBe(0b0100);
  const length = ((codewords[0] & 0x0f) << 4) | (codewords[1] >> 4);
  const out: number[] = [];
  for (let i = 0; i < length; i += 1) {
    const hi = codewords[1 + i] & 0x0f;
    const lo = codewords[2 + i] >> 4;
    out.push((hi << 4) | lo);
  }
  return Buffer.from(out).toString('utf8');
}

// ---------------------------------------------------------------------------

describe('buildPairUrl / constants', () => {
  it('builds the exact §5.18 pairing URL', () => {
    expect(buildPairUrl('a.local', PAIR_TOKEN)).toBe(PAIR_URL);
    expect(PAIR_PORT).toBe('5173');
  });

  it('honours an explicit port override', () => {
    expect(buildPairUrl('a.local', PAIR_TOKEN, '8443')).toBe(
      'https://a.local:8443/?pair=NS-4F2A',
    );
  });

  it('matches the SESSION token pattern', () => {
    expect(/^[A-Za-z0-9]+$/.test(PAIR_TOKEN.replace('NS-', ''))).toBe(true);
    expect(PAIR_TOKEN).toMatch(/^NS-[A-Z0-9]{4}$/);
  });
});

describe('formatCountdown', () => {
  it('renders mm:ss with ceil semantics', () => {
    expect(formatCountdown(600_000)).toBe('10:00');
    expect(formatCountdown(61_000)).toBe('01:01');
    expect(formatCountdown(1)).toBe('00:01');
    expect(formatCountdown(0)).toBe('00:00');
    expect(formatCountdown(-5_000)).toBe('00:00');
  });
});

describe('QR encode → decode round-trip', () => {
  it('encodes the pair URL at ECC M and decodes it back', async () => {
    const factory: QrFactory = await loadQrEncoder();
    const matrix = makeQrMatrix(factory, PAIR_URL, { typeNumber: 3, ecc: 'M' });
    expect(matrix).toHaveLength(29);
    expect(matrix.every((row) => row.length === 29)).toBe(true);
    expect(decodeQrV3(matrix)).toBe(PAIR_URL);
  });
});

describe('QrSvg (SSR)', () => {
  it('renders crisp black-on-white with an accessible label', () => {
    const matrix = [
      [true, false],
      [false, true],
    ];
    const html = markup(createElement(QrSvg, { matrix, label: 'Pairing QR for NS-4F2A' }));
    expect(html).toContain('viewBox="0 0 2 2"');
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Pairing QR for NS-4F2A"');
    expect(html).toContain('fill="#FFFFFF"');
    // exactly two dark modules for a 2×2 checkerboard
    expect(html.match(/fill="#000000"/g)).toHaveLength(2);
    expect(html).toContain('shape-rendering="crispEdges"');
  });

  it('QR frame CSS keeps the §5.18 8 px quiet zone', () => {
    const css = readFileSync(
      resolve(__dirname, '../src/components/scan/QrPairingCard.module.css'),
      'utf8',
    );
    const frame = css.match(/\.qrFrame\s*\{[^}]*\}/);
    expect(frame).not.toBeNull();
    expect(frame?.[0]).toMatch(new RegExp(`padding:\\s*${QR_QUIET_ZONE_PX}px\\s*;`));
    expect(frame?.[0]).toMatch(/background:\s*#FFFFFF\s*;/);
  });
});

describe('QrPairingCard (SSR)', () => {
  it('shows the honest no-host state when no hostname is known', () => {
    const html = markup(createElement(QrPairingCard, { token: PAIR_TOKEN }));
    expect(html).toContain('data-testid="pair-card"');
    expect(html).toContain('data-testid="pair-no-host"');
    expect(html).toContain('Network unknown — pairing link unavailable.');
    // no window in node → NETWORK falls back to the placeholder, no QR
    expect(html).toContain('data-testid="pair-network"');
    expect(html).not.toContain('data-testid="pair-qr"');
    expect(html).not.toContain('data-testid="pair-qr-skeleton"');
  });

  it('renders the mono key/value rows verbatim', () => {
    const html = markup(createElement(QrPairingCard, { token: PAIR_TOKEN }));
    expect(html).toContain('>SESSION<');
    expect(html).toContain('>EXPIRES<');
    expect(html).toContain('>NETWORK<');
    expect(html).toContain('data-testid="pair-session"');
    expect(html).toContain('NS-4F2A');
    expect(html).toContain('This device and the phone must be on the same local network.');
  });

  it('never marks the countdown as a live region', () => {
    const html = markup(createElement(QrPairingCard, { token: PAIR_TOKEN }));
    expect(html).not.toContain('aria-live');
  });

  it('stays on the encoder skeleton under SSR (effects never run)', () => {
    const html = markup(
      createElement(QrPairingCard, { token: PAIR_TOKEN, hostname: 'a.local' }),
    );
    expect(html).toContain('data-testid="pair-qr-skeleton"');
    expect(html).toContain('Preparing code…');
    expect(html).toContain('data-testid="pair-network"');
    expect(html).not.toContain('data-testid="pair-qr"');
    expect(html).not.toContain('data-testid="pair-expired"');
    expect(html).toContain('10:00');
  });

  it('renders the expired state with a countdown of 00:00 and a refresh', () => {
    const html = markup(
      createElement(QrPairingCard, {
        token: PAIR_TOKEN,
        hostname: 'a.local',
        expiresAt: Date.now() - 1_000,
      }),
    );
    expect(html).toContain('data-testid="pair-expired"');
    expect(html).toContain('Session expired — generate a new code before scanning.');
    expect(html).toContain('data-testid="pair-countdown"');
    expect(html).toContain('>00:00<');
    expect(html).toContain('data-testid="pair-refresh"');
    expect(html).not.toContain('data-testid="pair-qr"');
  });

  it('surfaces the refresh button once the session is urgent', () => {
    const html = markup(
      createElement(QrPairingCard, {
        token: PAIR_TOKEN,
        hostname: 'a.local',
        expiresAt: Date.now() + 30_000,
      }),
    );
    const countdown = html.match(/data-testid="pair-countdown"[^>]*>([^<]*)</)?.[1];
    expect(countdown).toMatch(/^\d{2}:\d{2}$/);
    expect(countdown).toBe('00:30');
    expect(countdown).not.toBe('10:00');
    expect(html).toContain('data-testid="pair-refresh"');
    expect(html).toContain('Refresh');
  });

  it('keeps refresh absent while the session is fresh', () => {
    const html = markup(
      createElement(QrPairingCard, {
        token: PAIR_TOKEN,
        hostname: 'a.local',
        expiresAt: Date.now() + 300_000,
      }),
    );
    expect(html).not.toContain('data-testid="pair-refresh"');
    expect(html).toContain('>05:00<');
  });

  it('shows the relay caveat only when signalling is down', () => {
    const down = markup(
      createElement(QrPairingCard, { token: PAIR_TOKEN, signallingStatus: 'down' }),
    );
    expect(down).toContain('data-testid="pair-relay-note"');
    expect(down).toContain('Relay disconnected');

    const open = markup(
      createElement(QrPairingCard, { token: PAIR_TOKEN, signallingStatus: 'open' }),
    );
    expect(open).not.toContain('pair-relay-note');
  });
});

// ---------------------------------------------------------------------------

function statuses(stages: { status: RailStageStatus }[]): RailStageStatus[] {
  return stages.map((stage) => stage.status);
}

describe('deriveRailStages', () => {
  const T0 = 1_700_000_000_000;

  it('IDLE: active first row, everything else pending, no timestamps', () => {
    const stages = deriveRailStages({ state: 'IDLE', updatedAt: 0 });
    expect(stages).toHaveLength(6);
    expect(statuses(stages)).toEqual([
      'active',
      'pending',
      'pending',
      'pending',
      'pending',
      'pending',
    ]);
    expect(stages.every((stage) => stage.timestamp === undefined)).toBe(true);
    expect(stages[5].label).toBe('OFFLINE/ERROR');
  });

  it('LIVE: done prefix, device detail, timestamp on the active row', () => {
    const stages = deriveRailStages({
      state: 'LIVE',
      deviceId: 'pixel-7',
      updatedAt: T0,
    });
    expect(statuses(stages)).toEqual([
      'done',
      'done',
      'active',
      'pending',
      'pending',
      'pending',
    ]);
    expect(stages[2].detail).toBe('pixel-7');
    expect(stages[2].timestamp).toBe(T0);
    expect(stages[0].timestamp).toBeUndefined();
  });

  it('PAIRING: progress renders as whole percent (0..1 → %)', () => {
    const stages = deriveRailStages({ state: 'PAIRING', progress: 0.42, updatedAt: 0 });
    expect(statuses(stages)[1]).toBe('active');
    expect(stages[1].detail).toBe('42%');
    expect(stages[2].detail).toBeUndefined();
  });

  it('CAPTURING: three done, active row without a percent detail', () => {
    const stages = deriveRailStages({
      state: 'CAPTURING',
      deviceId: 'pixel-7',
      updatedAt: T0,
    });
    expect(statuses(stages)).toEqual([
      'done',
      'done',
      'done',
      'active',
      'pending',
      'pending',
    ]);
    expect(stages[3].detail).toBeUndefined();
    expect(stages[3].timestamp).toBe(T0);
  });

  it('STAGED: four done, last progressive row active', () => {
    const stages = deriveRailStages({ state: 'STAGED', updatedAt: 0 });
    expect(statuses(stages)).toEqual([
      'done',
      'done',
      'done',
      'done',
      'active',
      'pending',
    ]);
  });

  it('OFFLINE with a seen device: terminal failed + reason + timestamp', () => {
    const stages = deriveRailStages({
      state: 'OFFLINE',
      deviceId: 'pixel-7',
      reason: 'Peer hung up',
      updatedAt: T0,
    });
    expect(statuses(stages)).toEqual([
      'done',
      'done',
      'done',
      'pending',
      'pending',
      'failed',
    ]);
    expect(stages[5].label).toBe('OFFLINE');
    expect(stages[5].detail).toBe('Peer hung up');
    expect(stages[5].timestamp).toBe(T0);
  });

  it('ERROR without a device: only IDLE/PAIRING read done, label is ERROR', () => {
    const stages = deriveRailStages({ state: 'ERROR', reason: 'relay closed', updatedAt: 0 });
    expect(statuses(stages)).toEqual([
      'done',
      'done',
      'pending',
      'pending',
      'pending',
      'failed',
    ]);
    expect(stages[5].label).toBe('ERROR');
    expect(stages[5].detail).toBe('relay closed');
    expect(stages[5].timestamp).toBeUndefined();
  });
});

describe('formatStageTime', () => {
  it('renders local HH:MM:SS', () => {
    const at = new Date(2026, 0, 1, 9, 5, 3).getTime();
    expect(formatStageTime(at)).toBe('09:05:03');
    const late = new Date(2026, 0, 1, 23, 59, 9).getTime();
    expect(formatStageTime(late)).toBe('23:59:09');
  });
});

describe('StageRail (SSR)', () => {
  it('is one polite live region with six rows and a single step marker', () => {
    const pairing: PairingStatus = {
      state: 'LIVE',
      deviceId: 'pixel-7',
      updatedAt: new Date(2026, 0, 1, 9, 5, 3).getTime(),
    };
    const html = markup(createElement(StageRail, { pairing }));
    expect(html).toContain('data-testid="stage-rail"');
    expect(html).toContain('aria-live="polite"');
    expect(html.match(/<li /g)).toHaveLength(6);
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).toContain('data-stage="IDLE"');
    expect(html).toContain('data-stage="TERMINAL"');
    expect(html).toContain('data-status="active"');
    expect(html).toContain('pixel-7');
    expect(html).toContain('09:05:03');
  });

  it('marks the failed terminal row on an offline pairing', () => {
    const pairing: PairingStatus = {
      state: 'OFFLINE',
      reason: 'Peer hung up',
      updatedAt: 0,
    };
    const html = markup(createElement(StageRail, { pairing }));
    expect(html).toContain('data-stage="TERMINAL"');
    expect(html).toContain('data-status="failed"');
    expect(html).toContain('Peer hung up');
    expect(html).not.toContain('aria-current="step"');
  });
});
