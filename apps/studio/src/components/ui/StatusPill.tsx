import styles from './StatusPill.module.css';

/**
 * Status pill (§5.8) — schema-anchored tones, never synonyms (§9.2).
 * Color is the third redundant channel: every pill carries glyph + text.
 * `simulated` is the mandatory synthetic-fixture label; `live`'s dot is the
 * only 999-radius element in the system.
 */
export const STATUS_PILL_STATES = ['validated', 'needs-review', 'failed', 'blocked', 'simulated', 'live'] as const;

export type StatusPillState = (typeof STATUS_PILL_STATES)[number];

/** Redundant glyph per state — shape carries the meaning, text confirms it. */
const STATE_GLYPH: Record<StatusPillState, string> = {
  validated: '✓',
  'needs-review': '▲',
  failed: '✕',
  blocked: '⊘',
  simulated: '◇',
  live: '●',
};

const STATE_LABEL: Record<StatusPillState, string> = {
  validated: 'Validated',
  'needs-review': 'Needs review',
  failed: 'Failed',
  blocked: 'Blocked',
  simulated: 'Simulated',
  live: 'Live',
};

export type StatusPillProps = {
  state: StatusPillState;
  /** Override the default state label (e.g. "Scene validated"). */
  children?: string;
  className?: string;
};

function isPillState(value: string): value is StatusPillState {
  return (STATUS_PILL_STATES as readonly string[]).includes(value);
}

export function StatusPill({ state, children, className }: StatusPillProps) {
  if (!isPillState(state)) {
    // States map 1:1 onto schema enums — never invent one (§9.2).
    throw new Error(`StatusPill: "${state}" is not a schema-anchored state (${STATUS_PILL_STATES.join(', ')})`);
  }
  const toneClass = state.replace(/[^a-z]/g, '');
  return (
    <span className={[styles.pill, styles[toneClass as keyof typeof styles] ?? '', className].filter(Boolean).join(' ')}>
      <span className={styles.glyph} aria-hidden="true">{STATE_GLYPH[state]}</span>
      {children ?? STATE_LABEL[state]}
    </span>
  );
}
