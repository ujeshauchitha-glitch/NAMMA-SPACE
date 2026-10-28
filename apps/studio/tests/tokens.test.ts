import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * GROUNDTRUTH token gate (DESIGN_HANDOFF §3.1 / §4).
 * Parses src/styles/tokens.css and proves every shipped text pair meets its
 * documented WCAG 2.1 ratio — the load-bearing accessibility claim of the
 * MERIDIAN palette.
 */

const css = readFileSync('src/styles/tokens.css', 'utf8');

function parseTokens(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of source.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    out[match[1]] = match[2].trim();
  }
  return out;
}

const tokens = parseTokens(css);

function hexChannels(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`not a 6-digit hex color: ${hex}`);
  const value = match[1];
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16)) as [number, number, number];
}

function linearize(channel255: number): number {
  const c = channel255 / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

function contrast(fg: [number, number, number], bg: [number, number, number]): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function composite(rgba: [number, number, number, number], over: [number, number, number]): [number, number, number] {
  const [r, g, b, a] = rgba;
  return [
    Math.round(r * a + over[0] * (1 - a)),
    Math.round(g * a + over[1] * (1 - a)),
    Math.round(b * a + over[2] * (1 - a)),
  ];
}

function tokenColor(name: string): [number, number, number] {
  const value = tokens[name];
  if (!value) throw new Error(`token --${name} missing from tokens.css`);
  return hexChannels(value);
}

function tokenRgba(name: string): [number, number, number, number] {
  const match = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/.exec(tokens[name] ?? '');
  if (!match) throw new Error(`token --${name} is not an rgba() color`);
  return [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])];
}

interface ShippedPair {
  label: string;
  fg: [number, number, number];
  bg: [number, number, number];
  documented: number;
  verdict: 'AAA' | 'AA';
}

// §3.1 computed contrast table — documented ratios verbatim from the handoff.
const pairs: ShippedPair[] = [
  { label: '--text on --surface-0', fg: tokenColor('text'), bg: tokenColor('surface-0'), documented: 14.03, verdict: 'AAA' },
  { label: '--text on --surface-1', fg: tokenColor('text'), bg: tokenColor('surface-1'), documented: 15.19, verdict: 'AAA' },
  { label: '--text on --surface-2', fg: tokenColor('text'), bg: tokenColor('surface-2'), documented: 16.13, verdict: 'AAA' },
  { label: '--text-muted on --surface-0', fg: tokenColor('text-muted'), bg: tokenColor('surface-0'), documented: 6.35, verdict: 'AA' },
  { label: '--text-muted on --surface-1', fg: tokenColor('text-muted'), bg: tokenColor('surface-1'), documented: 6.87, verdict: 'AA' },
  { label: '--text-dim on --surface-0', fg: tokenColor('text-dim'), bg: tokenColor('surface-0'), documented: 4.65, verdict: 'AA' },
  { label: '--text-dim on --surface-1', fg: tokenColor('text-dim'), bg: tokenColor('surface-1'), documented: 5.03, verdict: 'AA' },
  { label: '--text-dim on --surface-2', fg: tokenColor('text-dim'), bg: tokenColor('surface-2'), documented: 5.34, verdict: 'AA' },
  { label: '--accent-botanical on --surface-0 (links)', fg: tokenColor('accent-botanical'), bg: tokenColor('surface-0'), documented: 10.14, verdict: 'AAA' },
  { label: '#FFFFFF on --accent-botanical (primary button)', fg: hexChannels('#FFFFFF'), bg: tokenColor('accent-botanical'), documented: 11.66, verdict: 'AAA' },
  { label: '#FFFFFF on --accent-cobalt', fg: hexChannels('#FFFFFF'), bg: tokenColor('accent-cobalt'), documented: 7.4, verdict: 'AA' },
  { label: '--text on --accent-lime (badge fill)', fg: tokenColor('text'), bg: tokenColor('accent-lime'), documented: 8.71, verdict: 'AAA' },
  { label: '--success on --surface-1', fg: tokenColor('success'), bg: tokenColor('surface-1'), documented: 5.95, verdict: 'AA' },
  { label: '--warning on --surface-1', fg: tokenColor('warning'), bg: tokenColor('surface-1'), documented: 5.7, verdict: 'AA' },
  { label: '--error on --surface-1', fg: tokenColor('error'), bg: tokenColor('surface-1'), documented: 6.35, verdict: 'AA' },
  { label: '--blocked on --surface-1', fg: tokenColor('blocked'), bg: tokenColor('surface-1'), documented: 6.1, verdict: 'AA' },
];

// HUD chip: rgba(247,245,238,0.92) composited over pure black / pure white scene
// content — the §2.1 closed-form legibility guarantee (bounded #E3E1DB..#F8F6EF).
const hud = tokenRgba('hud-bg');
const chipOverBlack = composite(hud, [0, 0, 0]);
const chipOverWhite = composite(hud, [255, 255, 255]);
pairs.push(
  { label: 'HUD --text over pure-black scene', fg: tokenColor('text'), bg: chipOverBlack, documented: 12.33, verdict: 'AAA' },
  { label: 'HUD --text over pure-white scene', fg: tokenColor('text'), bg: chipOverWhite, documented: 14.92, verdict: 'AAA' },
  { label: 'HUD --text-muted over pure-black scene', fg: tokenColor('text-muted'), bg: chipOverBlack, documented: 5.58, verdict: 'AA' },
  { label: 'HUD --text-muted over pure-white scene', fg: tokenColor('text-muted'), bg: chipOverWhite, documented: 6.75, verdict: 'AA' },
);

describe('GROUNDTRUTH tokens.css', () => {
  it('parses and ships every required token family', () => {
    const required = [
      'surface-0', 'surface-1', 'surface-2', 'surface-inset', 'surface-skeleton', 'surface-skeleton-hi',
      'hud-bg', 'hud-bg-strong', 'line', 'line-strong', 'line-ink',
      'text', 'text-muted', 'text-dim', 'text-inverse',
      'accent-botanical', 'accent-lime', 'accent-cobalt',
      'success', 'warning', 'error', 'blocked',
      'font-ui', 'font-mono', 'text-display', 'text-title', 'text-heading', 'text-body', 'text-label', 'text-meta', 'text-micro',
      'space-1', 'space-2', 'space-3', 'space-4', 'space-5', 'space-6', 'space-8', 'space-10', 'space-12', 'space-16',
      'radius-1', 'radius-2', 'radius-3', 'radius-dot',
      'shadow-1', 'shadow-2', 'shadow-3', 'shadow-hud', 'inner-plate',
      'focus', 'focus-halo',
      'dur-instant', 'dur-fast', 'dur-base', 'dur-panel', 'dur-workspace', 'dur-scene',
      'ease-out', 'ease-in-out', 'stagger',
    ];
    for (const name of required) {
      expect(tokens[name], `token --${name} must exist`).toBeTruthy();
    }
  });

  it('keeps the legacy identity out of the token layer', () => {
    expect(css.toLowerCase()).not.toMatch(/0d100f|e9a54f|manrope|dm mono|@import/);
  });

  it('keeps the HUD chip opacity load-bearing at 0.92 (never lower)', () => {
    expect(tokenRgba('hud-bg')[3]).toBe(0.92);
  });

  it.each(pairs)('$label meets its documented WCAG 2.1 ratio', (pair) => {
    const ratio = contrast(pair.fg, pair.bg);
    // Every shipped pair must clear AA for normal text…
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    // …match the documented handoff ratio within ±0.1…
    expect(Math.abs(ratio - pair.documented)).toBeLessThanOrEqual(0.1);
    // …and documented-AAA pairs clear the 7:1 AAA bar.
    if (pair.verdict === 'AAA') {
      expect(ratio).toBeGreaterThanOrEqual(7);
    }
  });
});
