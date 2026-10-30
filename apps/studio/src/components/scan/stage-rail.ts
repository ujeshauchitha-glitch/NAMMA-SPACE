/**
 * Stage-rail derivation (T20 / design §5.17) — pure, DOM-free, SSR-testable.
 *
 * The rail is a fixed six-row narrative (IDLE → PAIRING → LIVE → CAPTURING →
 * STAGED → OFFLINE/ERROR). Only `PairingStatus.state` plus its optional
 * fields exist, so the rail never invents per-stage history: the active row
 * is exact, earlier rows are the only defensible "done" inference, and the
 * terminal row always renders (honest states §3.2).
 */
import type { PairingStatus, PairingState } from '../../state/types';

export type RailStageStatus = 'done' | 'active' | 'pending' | 'failed';

export type RailStageKey =
  | 'IDLE'
  | 'PAIRING'
  | 'LIVE'
  | 'CAPTURING'
  | 'STAGED'
  | 'TERMINAL';

export type RailStage = {
  key: RailStageKey;
  /** Display label — the current state name on an active terminal row. */
  label: string;
  status: RailStageStatus;
  /** Honest context: deviceId on LIVE, scan % on PAIRING, reason on failure. */
  detail?: string;
  /** Present only when the row is active and `updatedAt > 0`. */
  timestamp?: number;
};

/** The five progressive stages, in rail order. */
const PROGRESSIVE: { key: RailStageKey; state: PairingState }[] = [
  { key: 'IDLE', state: 'IDLE' },
  { key: 'PAIRING', state: 'PAIRING' },
  { key: 'LIVE', state: 'LIVE' },
  { key: 'CAPTURING', state: 'CAPTURING' },
  { key: 'STAGED', state: 'STAGED' },
];

const TERMINAL_STATES: readonly PairingState[] = ['OFFLINE', 'ERROR'];

function isTerminal(state: PairingState): boolean {
  return TERMINAL_STATES.includes(state);
}

/**
 * Map the one canonical `PairingStatus` onto the six rail rows.
 *
 * Non-terminal states sit on the linear path (`< idx` done, `==` active,
 * `>` pending). Terminal states mark the terminal row failed with reason +
 * timestamp, then apply a documented prefix heuristic: a device was seen
 * (deviceId present) → IDLE/PAIRING/LIVE read done; never seen → IDLE/PAIRING
 * only. Per-stage history does not exist, so CAPTURING/STAGED after a drop
 * stay pending — the rail never fabricates a capture it cannot prove.
 */
export function deriveRailStages(pairing: PairingStatus): RailStage[] {
  const { state } = pairing;
  const activeIndex = PROGRESSIVE.findIndex((stage) => stage.state === state);
  const deviceId = pairing.deviceId ?? '';

  const progressive = PROGRESSIVE.map((stage, index): RailStage => {
    const base: RailStage = { key: stage.key, label: stage.key, status: 'pending' };

    if (!isTerminal(state)) {
      if (index < activeIndex) return { ...base, status: 'done' };
      if (index === activeIndex) {
        let detail: string | undefined;
        if (stage.state === 'LIVE' && deviceId) detail = deviceId;
        if (stage.state === 'PAIRING' && typeof pairing.progress === 'number') {
          // `progress` is documented 0..1 (types.ts) — render as whole percent.
          detail = `${Math.round(pairing.progress * 100)}%`;
        }
        const timestamp =
          pairing.updatedAt > 0 ? pairing.updatedAt : undefined;
        return { ...base, status: 'active', detail, timestamp };
      }
      return base;
    }

    // Terminal fallback: infer only what the status fields can defend.
    const reached = deviceId ? 3 : 2;
    return index < reached ? { ...base, status: 'done' } : base;
  });

  const terminalLabel = state === 'OFFLINE' || state === 'ERROR' ? state : 'OFFLINE/ERROR';
  const terminal: RailStage = isTerminal(state)
    ? {
        key: 'TERMINAL',
        label: terminalLabel,
        status: 'failed',
        detail: pairing.reason,
        timestamp: pairing.updatedAt > 0 ? pairing.updatedAt : undefined,
      }
    : { key: 'TERMINAL', label: 'OFFLINE/ERROR', status: 'pending' };

  return [...progressive, terminal];
}

/** Local `HH:MM:SS` for the rail's active-row timestamp (mono, tabular). */
export function formatStageTime(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
