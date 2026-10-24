import { readFileSync, readdirSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Button } from '../src/components/ui/Button';
import { Chip } from '../src/components/ui/Chip';
import { EmptyState } from '../src/components/ui/EmptyState';
import { MetadataKV } from '../src/components/ui/MetadataKV';
import { Modal } from '../src/components/ui/Modal';
import { destructiveConfirmCopy } from '../src/components/ui/destructiveCopy';import { STATUS_PILL_STATES, StatusPill } from '../src/components/ui/StatusPill';
import { Skeleton, SkeletonRows } from '../src/components/ui/Skeleton';
import { TOAST_AUTODISMISS_MS, ToastRegion, type ToastMessage } from '../src/components/ui/Toast';
import { SearchField, TextField } from '../src/components/ui/TextField';
import { Room } from '../src/components/icons/icons';

/**
 * UI primitive contract gate (DESIGN_HANDOFF §5) — attribute/contract level,
 * rendered with react-dom/server (jsdom-free per spec AC).
 */

function markup(node: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(node);
}

describe('Button (§5.1)', () => {
  it('renders a typed button per variant', () => {
    for (const variant of ['primary', 'secondary', 'signal', 'quiet', 'danger', 'icon'] as const) {
      const html = markup(<Button variant={variant}>Prepare</Button>);
      expect(html, variant).toContain('<button');
      expect(html, variant).toContain('type="button"');
    }
  });

  it('sets aria-busy and freezes to loading dots when loading', () => {
    const html = markup(<Button variant="primary" loading>Prepare capture</Button>);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('Prepare capture');
  });

  it('does not set aria-busy when idle', () => {
    expect(markup(<Button>Plot route</Button>)).not.toContain('aria-busy');
  });

  it('supports icon-only usage with an accessible name', () => {
    const html = markup(<Button variant="icon" aria-label="Reset viewpoint" />);
    expect(html).toContain('aria-label="Reset viewpoint"');
  });
});

describe('TextField / SearchField (§5.2)', () => {
  it('associates label and input', () => {
    const html = markup(<TextField label="Session token" />);
    const idMatch = /id="([^"]+)"/.exec(html);
    expect(idMatch).not.toBeNull();
    expect(html).toContain(`for="${idMatch![1]}"`);
  });

  it('marks invalid fields with aria-invalid and an alert error line', () => {
    const html = markup(<TextField label="Room name" invalid error="This file is HEIC — export JPG or run the prepare script." />);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('This file is HEIC');
    expect(html).toMatch(/aria-describedby="[^"]+-error"/);
  });

  it('omits invalid affordances when valid', () => {
    const html = markup(<TextField label="Room name" />);
    expect(html).not.toContain('aria-invalid');
    expect(html).not.toContain('role="alert"');
  });

  it('ships the search bed with a shortcut badge', () => {
    const html = markup(<SearchField aria-label="Search points of interest" />);
    expect(html).toContain('type="search"');
    expect(html).toContain('<kbd');
    expect(html).toContain('⌘K');
  });

  it('allows hiding the shortcut badge', () => {
    expect(markup(<SearchField shortcut={null} />)).not.toContain('<kbd');
  });
});

describe('StatusPill (§5.8 / §9.2)', () => {
  it('exposes exactly the schema-anchored state set', () => {
    expect([...STATUS_PILL_STATES]).toEqual(['validated', 'needs-review', 'failed', 'blocked', 'simulated', 'live']);
  });

  it.each(STATUS_PILL_STATES)('renders glyph + text for %s (never color-only)', (state) => {
    const html = markup(<StatusPill state={state} />);
    expect(html).toContain('aria-hidden="true"'); // redundant glyph channel
    expect(html.replace(/<[^>]+>/g, '').trim().length).toBeGreaterThan(1); // visible text label
    expect(html).toMatch(/aria-hidden="true">(✓|▲|✕|⊘|◇|●)</);
  });

  it('rejects tones outside the schema-anchored set', () => {
    expect(() => markup(<StatusPill state={'ready' as never} />)).toThrow(/not a schema-anchored state/);
  });

  it('allows an honest override label', () => {
    expect(markup(<StatusPill state="simulated">◇ SIMULATED</StatusPill>)).toContain('◇ SIMULATED');
  });
});

describe('Toast (§5.9)', () => {
  const toasts: ToastMessage[] = [
    { id: '1', tone: 'success', title: '14 images staged · 62.4 MB.' },
    { id: '2', tone: 'info', title: 'Route plotted', detail: 'ROUTE · 24 m · 11 cells · A*' },
    { id: '3', tone: 'error', title: 'Scene bundle failed validation' },
    { id: '4', tone: 'info', title: 'Fourth' },
    { id: '5', tone: 'info', title: 'Fifth' },
  ];

  it('renders polite and assertive live regions', () => {
    const html = markup(<ToastRegion toasts={toasts} onDismiss={() => {}} />);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-live="assertive"');
  });

  it('routes errors to the assertive region (after its marker)', () => {
    const html = markup(<ToastRegion toasts={toasts} onDismiss={() => {}} />);
    const assertiveAt = html.indexOf('aria-live="assertive"');
    const errorAt = html.indexOf('Scene bundle failed validation');
    const politeAt = html.indexOf('aria-live="polite"');
    expect(errorAt).toBeGreaterThan(assertiveAt);
    expect(html.indexOf('14 images staged')).toBeGreaterThan(politeAt);
    expect(html.indexOf('14 images staged')).toBeLessThan(assertiveAt);
  });

  it('stacks at most 3 toasts', () => {
    const html = markup(<ToastRegion toasts={toasts} onDismiss={() => {}} />);
    expect(html.match(/aria-label="Dismiss:/g)).toHaveLength(3);
  });

  it('auto-dismisses non-errors after 5 s (errors persistent)', () => {
    expect(TOAST_AUTODISMISS_MS).toBe(5_000);
  });
});

describe('Modal (§5.10)', () => {
  it('renders nothing when closed', () => {
    expect(markup(<Modal open={false} title="Delete room" onClose={() => {}} />)).toBe('');
  });

  it('exposes the dialog a11y contract', () => {
    const html = markup(
      <Modal open title="Delete Lab 201?" onClose={() => {}}>
        <p>Body</p>
      </Modal>,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toMatch(/aria-labelledby="[^"]+"/);
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('Delete Lab 201?');
  });

  it('follows the destructive copy pattern: object + consequence + irreversibility', () => {
    const copy = destructiveConfirmCopy('Delete **Lab 201**', 'and its 14 staged images?');
    expect(copy).toContain('Lab 201');
    expect(copy).toContain('14 staged images');
    expect(copy).toContain('This cannot be undone.');
  });
});

describe('Chip (§5.5)', () => {
  it('renders a toggle chip with aria-pressed', () => {
    const html = markup(<Chip toggle selected count={6} onClick={() => {}}>Front</Chip>);
    expect(html).toContain('<button');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('>6<');
  });

  it('renders a static chip when not toggleable', () => {
    const html = markup(<Chip filled={false} count={0}>Rear</Chip>);
    expect(html).toContain('<span');
    expect(html).not.toContain('<button');
    expect(html).toContain('>0<');
  });
});

describe('Skeleton (§5.12)', () => {
  it('renders hidden sweep blocks with fixed geometry', () => {
    const html = markup(<Skeleton width={96} height={72} />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('width:96px');
    expect(html).toContain('height:72px');
  });

  it('ships a rows convenience variant', () => {
    expect(markup(<SkeletonRows rows={3} />).match(/aria-hidden="true"/g)!.length).toBeGreaterThanOrEqual(3);
  });
});

describe('EmptyState (§5.11)', () => {
  it('renders icon + title + body + one action', () => {
    const html = markup(
      <EmptyState
        icon={Room}
        title="No rooms yet"
        body="Create a room, then assign staged images to view groups."
        action={<Button variant="primary">New room</Button>}
      />,
    );
    expect(html).toContain('No rooms yet');
    expect(html).toContain('Create a room');
    expect(html).toContain('New room');
    expect(html).toContain('aria-hidden="true"'); // icon channel
  });
});

describe('MetadataKV (§5.7)', () => {
  it('renders semantic key/value pairs', () => {
    const html = markup(<MetadataKV entries={[{ key: 'Pipeline', value: 'namma-space/prepare' }]} />);
    expect(html).toContain('<dl');
    expect(html).toContain('<dt');
    expect(html).toContain('<dd');
    expect(html).toContain('Pipeline');
  });

  it('gives long values a copy affordance and a polite live region', () => {
    const long = 'a'.repeat(48);
    const html = markup(<MetadataKV entries={[{ key: 'Frame sha256', value: long }]} />);
    expect(html).toContain('Copy');
    expect(html).toContain('aria-live="polite"');
  });

  it('omits the copy affordance for short values by default', () => {
    expect(markup(<MetadataKV entries={[{ key: 'Scale', value: 'Y-up · metre' }]} />)).not.toContain('Copy');
  });
});

describe('primitive layer token discipline', () => {
  const uiDir = 'src/components/ui';
  const cssFiles = readdirSync(uiDir).filter((file) => file.endsWith('.module.css'));

  it('ships a module stylesheet per primitive', () => {
    expect(cssFiles.length).toBeGreaterThanOrEqual(9);
  });

  it('contains no hardcoded color literals (tokens only)', () => {
    for (const file of cssFiles) {
      const css = readFileSync(`${uiDir}/${file}`, 'utf8');
      // strip comments, then look for hex or rgba() color literals
      const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
      const hexes = stripped.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
      const rgbas = stripped.match(/rgba?\([^)]*\)/g) ?? [];
      expect(hexes, `${file} hex literals`).toEqual([]);
      expect(rgbas, `${file} rgba literals`).toEqual([]);
    }
  });
});
