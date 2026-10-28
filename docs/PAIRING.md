# PAIRING runbook — Live Scan phone ↔ studio over the LAN

Executable runbook for the studio's Live Scan pairing (`apps/studio`, T18–T20). Everything in *Verified 29 Oct 2026* was run for this document; anything not yet run is labelled **manual/untested**.

**One paragraph:** `npm run dev:lan` starts the Vite dev server on `0.0.0.0` with a self-signed HTTPS certificate (phone cameras require a secure context) and attaches a WebSocket signalling relay at `/ws?session=TOKEN` on the same origin. The laptop (host) and phone (joiner) each open a socket, are put in a room of exactly two, exchange SDP/ICE verbatim, and build a peer connection that tries **host (LAN) candidates only** first — so pairing itself needs no internet. Frames travel over the WebRTC datachannel as ≤1600 px JPEG chunks with a per-frame sha256 ack.

## Preconditions

- Laptop and phone on the **same LAN** (same Wi-Fi/router). The QR encodes `window.location.hostname`; the relay has no rendezvous server, so the phone must be able to reach the laptop's address directly. No internet is required for the first connection attempt.
- Node.js 20+ with npm; repo checked out; phone with a WebRTC-capable browser.
- One laptop browser tab and one phone session per pairing (rooms hold exactly **2** peers; a third gets an honest `ROOM_FULL` error and close code 4003).
- Network caveat (general, **not tested here**): guest Wi-Fi with *client/AP isolation* blocks host-to-host traffic; use a normal LAN or a hotspot.

## Laptop steps (all inside `apps/studio`)

```bash
cd apps/studio
npm ci                      # first time only (not re-run for the 29 Oct record; the existing install ran every command below)
npm run dev:lan             # VITE_LAN=1 vite — binds 0.0.0.0, HTTPS on
```

1. **Read the printed URLs — do not assume the port.** Example from 29 Oct 04:00 IST (5173 was already taken by an unrelated project's vite, so Vite fell back):
   ```text
   ➜  Local:    https://localhost:5174/
   ➜  Network:  https://10.68.49.201:5174/
   ```
   Expected on a free machine: `https://localhost:5173/` and `https://<your-lan-ip>:5173/`.
2. Confirm the server is up (replace the port; `-k` because the cert is self-signed):
   ```bash
   curl -k -s -o /dev/null -w "%{http_code}\n" https://127.0.0.1:5173/   # → 200
   ```
3. Open the **Network** URL in the laptop browser and accept the one-time certificate warning if asked. Stay on the plain `dev:lan` origin — the QR/session must come from the same server the phone will reach.
4. Switch to workspace **`03 Live Scan`** (tab `3`, or `Ctrl/Cmd+3`). The pairing card renders `QrPairingCard` + `StageRail`; the QR encodes `https://<hostname>:<port>/?pair=<token>` (hostname from `location.hostname`, port from `location.port`), and the card states verbatim: **"This device and the phone must be on the same local network."** (`data-testid="pair-network"` shows the network value).

## Phone steps

1. Join the **same Wi-Fi** as the laptop.
2. Scan the QR (or type `https://<lan-ip>:<port>/` manually).
3. Accept the certificate warning once (the cert is self-signed, issuer `CN=example.org` — expected; see *Verified 29 Oct 2026*).
4. Grant camera permission. If you skipped `dev:lan` and are on plain HTTP, the app refuses honestly instead of faking it: a `BLOCKED` screen with the exact remedy **"Run `npm run dev:lan` — phone cameras require HTTPS."** (derived from `window.isSecureContext === false`; presentation verdict only, never a machine state).
5. Both sides should advance `IDLE → PAIRING → LIVE`. Host-only ICE runs first (`iceServers: []`); only if that fails does the client retry once with the public STUN fallback `stun:stun.l.google.com:19302` (which needs internet).
6. Capture on the phone: frames are grabbed at ≤1600 px long edge (JPEG), chunked at 64 KiB, and each chunk's complete-frame sha256 must be acked before progress advances. On the laptop the received frames enter the staged-images flow with the source label **`● MEASURED · PHONE`** (`ThumbnailGrid.tsx`), and any export from that staging keeps the honest manifest note *"Staged frames and their manifest only — no poses or geometry are claimed."*

## Offline and degraded behaviour (what the code actually does)

| Situation | Behaviour | Source |
|---|---|---|
| Internet down, same LAN | First ICE attempt is host-only, so it can succeed with no internet. Only if host candidates fail does the STUN fallback engage — and that needs internet, then fails honestly. | `src/lib/pairing/peer.ts` |
| Laptop/phone Wi-Fi dropped mid-session | The signalling client reports `SIGNALING_DOWN` / `closed` and the pairing surface reports the failure honestly; no fake progress. The shell pill switches to `◇ OFFLINE` when `navigator.onLine` is false (measured, e2e-asserted). | `src/lib/pairing/signalling.ts`, `AppShell.tsx` |
| Session expires (10 min TTL, `SESSION_TTL_MS`) | `OFFLINE` is the **only** reachable transition after expiry; capture refuses to continue. | `src/lib/pairing/machine.ts` |
| Plain `npm run dev` (HTTP) on the LAN | UI shows the `BLOCKED` verdict with the `dev:lan` remedy; pairing is not offered. | `src/lib/pairing/secure-context.ts` |
| Static/production build (`import.meta.env.DEV` false) | The workspace shows *"Live Scan is development-only"* — *"Pairing needs the signalling relay that only `npm run dev:lan` runs. This hosted build has no relay, so Live Scan is disabled here."* | `LiveScanWorkspace.tsx` (`RELAY_UNAVAILABLE_BODY`) |
| Third peer tries to join a full room | Honest `{"type":"error","code":"ROOM_FULL"}` frame + close 4003; existing pair unaffected. | `scripts/signalling-relay.ts`, D-013 |
| Production deployment | The relay exists **only in the Vite dev server** — there is no production signalling endpoint. Offline-first app assets (self-hosted fonts, no runtime fetches) keep the rest of the app usable; pairing simply has nothing to connect to. | `vite.config.ts`, D-013 |

## Troubleshooting

- **Port not what you expected** → another process holds 5173; use the `Local:`/`Network:` lines Vite printed.
- **Phone can't open the page** → wrong network (guest vs. 2.4/5 GHz client isolation), typo'd IP, or laptop firewall blocking the port. Same-LAN is a hard requirement — there is no rendezvous server.
- **`BLOCKED` screen on the phone** → you are on HTTP; stop, run `npm run dev:lan`, and re-scan.
- **Stuck in `PAIRING`** → check both sides are in the same session; a fresh QR regenerates the token. After 10 minutes the session is expired by design and can only go `OFFLINE` — start a new pairing.
- **Self-signed cert warnings** → expected every time on a fresh device (basic-ssl does not install a CA). Repeated warnings on the *laptop* mean you opened the HTTP origin instead of the HTTPS one.

## Security posture (dev-only)

The session token travels in the `/ws?session=TOKEN` URL query and the relay performs **no `Origin` validation** — it is trusted-LAN-only and must never be exposed in production (D-013). `ws@^8` is a dependency of the app solely for this relay; the room logic (`scripts/signalling-relay.ts`) is pure and unit-tested.

## Verification status

- **Verified 29 Oct 2026 (04:01 IST)** on this machine, `npm run dev:lan` (vite 7.3.7, `@vitejs/plugin-basic-ssl`):
  - `curl -k … https://127.0.0.1:5174/` → **200**; certificate `issuer=CN=example.org, O=Test`, `notBefore=Oct 28 22:30:59 2026`, `notAfter=Nov 27 22:30:59 2026`.
  - `ws` client → `wss://127.0.0.1:5174/ws?session=…` → `WS_OPEN (101 upgrade ok, relay attached)`, `join` accepted, clean close. (Node needs `rejectUnauthorized: false` for the self-signed cert; browsers use the one-time warning instead.)
  - Unit suites green in the 542/542 run: `pairing-protocol`, `signalling-relay`, `qr`, `pairing-blocked` (see `apps/studio/VALIDATION.md`).
  - mkcert is not on PATH on this machine; the mkcert CA-install path was already rejected for needing sudo (D-013) — basic-ssl is the verified provider.
- **Manual / untested (pre-demo checklist):** a physical phone on the same Wi-Fi completing QR → camera permission → datachannel → frame acks end to end, and the offline (Wi-Fi off) sanity pass. Record the result in `apps/studio/VALIDATION.md` under the T27 release gate.
