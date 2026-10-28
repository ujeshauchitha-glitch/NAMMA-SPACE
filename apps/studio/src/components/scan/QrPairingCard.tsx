/**
 * QR pairing card (T20 / design §5.18) — the "phone scans this" half of
 * Live Scan. Mints a session token, counts it down, lazily encodes the pair
 * URL, and degrades honestly: expired, host-less, mint-failed and
 * encoder-failed states each replace the QR with plain text instead of a
 * broken square.
 *
 * The countdown is intentionally NOT an aria-live region (T20 AC) — a
 * per-second announcement would drown a screen reader. Refresh is explicit
 * only: the card never rotates a code the user may be mid-scan with.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { Button } from '../ui/Button';
import {
  SESSION_TOKEN_PATTERN,
  SESSION_TTL_MS,
  generateSessionToken,
  type SignallingStatus,
} from '../../lib/pairing';
import {
  QR_ECC_LEVEL,
  QR_MIN_PX,
  type QrMatrix,
  buildPairUrl,
  formatCountdown,
  loadQrEncoder,
  makeQrMatrix,
  readNetworkHostname,
  readPairPort,
} from './qr-code';
import styles from './QrPairingCard.module.css';

/** Refresh affordance appears below this remaining lifetime (design §5.18). */
const URGENT_MS = 60_000;

/** Lime flash held on the QR column after an explicit refresh (§5.18). */
const FLASH_MS = 120;

/** Rendered where a value is genuinely absent — never an empty cell. */
const IDLE_PLACEHOLDER = '\u2014';

export type QrPairingCardProps = {
  /** Seed token (tests / hydration); a refresh always overrides it. */
  token?: string;
  /** Seed expiry (tests / hydration); a refresh always restarts the TTL. */
  expiresAt?: number;
  /** Pairing-machine signal status — `'down'` surfaces the relay caveat. */
  signallingStatus?: SignallingStatus;
  /** Overrides the detected hostname (tests / forced host). */
  hostname?: string;
  /**
   * Called after an explicit refresh with the freshly minted token, so the
   * session owner can restart its pairing session on the same room the QR
   * now encodes (token lift — a stale session under a fresh QR would be a
   * fake pairing surface).
   */
  onRefresh?: (token: string) => void;
  className?: string;
};

type MintResult = { token: string | null; error: string | null };

/** Seed first, mint second — a refresh always supersedes the seed. */
function mintToken(seed?: string): MintResult {
  if (seed && SESSION_TOKEN_PATTERN.test(seed)) return { token: seed, error: null };
  try {
    return { token: generateSessionToken(), error: null };
  } catch (error) {
    return { token: null, error: error instanceof Error ? error.message : String(error) };
  }
}

export type QrSvgProps = {
  matrix: QrMatrix;
  /** Rendered edge length of the module grid in CSS pixels (default 160). */
  size?: number;
  label: string;
};

/**
 * Pure QR renderer — black modules on a pure-white ground, no CSS colours
 * inside the SVG so the two-colour contract is assertable from the markup.
 */
export function QrSvg({ matrix, size = QR_MIN_PX, label }: QrSvgProps): ReactElement {
  const count = matrix.length;
  const modules: ReactElement[] = [];
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (matrix[row][col]) {
        modules.push(
          <rect key={`${row}:${col}`} x={col} y={row} width={1} height={1} fill="#000000" />,
        );
      }
    }
  }
  return (
    <svg
      className={styles.qrSvg}
      width={size}
      height={size}
      viewBox={`0 0 ${count} ${count}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={label}
    >
      <rect x={0} y={0} width={count} height={count} fill="#FFFFFF" />
      {modules}
    </svg>
  );
}

export function QrPairingCard({
  token,
  expiresAt,
  signallingStatus,
  hostname,
  onRefresh,
  className,
}: QrPairingCardProps): ReactElement {
  const [mint] = useState(() => mintToken(token));
  const [sessionToken, setSessionToken] = useState<string | null>(mint.token);
  const [mintError, setMintError] = useState<string | null>(mint.error);
  const [expiresAtMs, setExpiresAtMs] = useState(() => expiresAt ?? Date.now() + SESSION_TTL_MS);
  const [now, setNow] = useState(() => Date.now());
  const [flash, setFlash] = useState(false);
  const [matrix, setMatrix] = useState<QrMatrix | null>(null);
  const [encoderError, setEncoderError] = useState<string | null>(null);

  const expired = expiresAtMs <= now;
  const msLeft = Math.max(0, expiresAtMs - now);
  const urgent = msLeft < URGENT_MS;
  const host = hostname ?? readNetworkHostname();
  const port = readPairPort();
  const pairUrl = host && sessionToken ? buildPairUrl(host, sessionToken, port) : null;

  // Ticking clock — stops itself the moment the session expires.
  useEffect(() => {
    if (expired) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [expired, expiresAtMs]);

  // Refresh flash — exactly the §5.18 120 ms highlight, then quiet again.
  useEffect(() => {
    if (!flash) return undefined;
    const id = setTimeout(() => setFlash(false), FLASH_MS);
    return () => clearTimeout(id);
  }, [flash]);

  // Lazy encoder: never in the entry chunk (T25 bundle contract).
  useEffect(() => {
    let cancelled = false;
    setMatrix(null);
    setEncoderError(null);
    if (!host || !sessionToken) {
      return () => {
        cancelled = true;
      };
    }
    loadQrEncoder()
      .then((factory) =>
        makeQrMatrix(factory, buildPairUrl(host, sessionToken, port), { ecc: QR_ECC_LEVEL }),
      )
      .then((next) => {
        if (!cancelled) setMatrix(next);
      })
      .catch((error: unknown) => {
        if (!cancelled) setEncoderError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [sessionToken, host, port]);

  function handleRefresh(): void {
    try {
      const next = generateSessionToken();
      setSessionToken(next);
      setMintError(null);
      setExpiresAtMs(Date.now() + SESSION_TTL_MS);
      setNow(Date.now());
      setFlash(true);
      onRefresh?.(next);
    } catch (error) {
      // Never a silent failure — the card says why the code did not move.
      setMintError(error instanceof Error ? error.message : String(error));
    }
  }

  let qrArea: ReactElement;
  if (expired) {
    qrArea = (
      <p className={styles.note} data-testid="pair-expired">
        Session expired — generate a new code before scanning.
      </p>
    );
  } else if (!host) {
    qrArea = (
      <p className={styles.note} data-testid="pair-no-host">
        Network unknown — pairing link unavailable.
      </p>
    );
  } else if (mintError) {
    qrArea = (
      <p className={styles.note} data-testid="pair-mint-error">
        Pairing unavailable — {mintError}
      </p>
    );
  } else if (encoderError) {
    qrArea = (
      <p className={styles.note} data-testid="pair-qr-error">
        QR unavailable — open this link on the phone: <span className={styles.url}>{pairUrl}</span>
      </p>
    );
  } else if (matrix) {
    qrArea = (
      <div className={styles.qrFrame} data-testid="pair-qr">
        <QrSvg
          matrix={matrix}
          label={sessionToken ? `Pairing QR for ${sessionToken}` : 'Pairing QR'}
        />
      </div>
    );
  } else {
    qrArea = (
      <p className={styles.note} data-testid="pair-qr-skeleton">
        Preparing code…
      </p>
    );
  }

  return (
    <section
      className={[styles.card, className].filter(Boolean).join(' ')}
      data-testid="pair-card"
      aria-label="QR pairing"
    >
      <div className={styles.body}>
        <div
          className={[styles.qrCol, flash ? styles.flash : null].filter(Boolean).join(' ')}
        >
          {qrArea}
        </div>
        <dl className={styles.kv}>
          <div className={styles.row}>
            <dt className={styles.key}>SESSION</dt>
            <dd className={styles.value} data-testid="pair-session">
              {sessionToken ?? IDLE_PLACEHOLDER}
            </dd>
          </div>
          <div className={styles.row}>
            <dt className={styles.key}>EXPIRES</dt>
            <dd
              className={urgent ? `${styles.value} ${styles.warning}` : styles.value}
              data-testid="pair-countdown"
            >
              {formatCountdown(msLeft)}
            </dd>
          </div>
          <div className={styles.row}>
            <dt className={styles.key}>NETWORK</dt>
            <dd className={styles.value} data-testid="pair-network">
              {host || IDLE_PLACEHOLDER}
            </dd>
          </div>
        </dl>
      </div>
      <p className={styles.caveat}>
        This device and the phone must be on the same local network.
      </p>
      {urgent && (
        <Button variant="quiet" onClick={handleRefresh} data-testid="pair-refresh">
          Refresh
        </Button>
      )}
      {signallingStatus === 'down' && (
        <p className={styles.relayNote} data-testid="pair-relay-note">
          Relay disconnected — pairing won't connect until it recovers.
        </p>
      )}
    </section>
  );
}
