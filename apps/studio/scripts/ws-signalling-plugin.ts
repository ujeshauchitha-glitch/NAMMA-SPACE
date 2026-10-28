/**
 * T19 — Vite plugin: dev-server signalling relay.
 *
 * Attaches one `ws` upgrade listener to the dev server's HTTP(S) server and
 * handles only pathname `/ws` (the T18 client's `/ws?session=TOKEN`).
 *
 * Coexistence with Vite's own HMR websocket (verified against the installed
 * Vite dist): Vite's upgrade listener only acts on `vite-hmr`/`vite-ping`
 * subprotocols + its HMR base path and otherwise leaves the socket alone,
 * and its proxy upgrade listener only runs for configured proxies (none
 * here). Listener order is therefore irrelevant — non-`/ws` sockets are
 * only destroyed after the whole `upgrade` emission has declined them, so a
 * socket Vite (or any later listener) claimed is never touched.
 * `server.httpServer` is null in middleware mode, which this plugin skips
 * (the contract's `configureServer` + null guard).
 */
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Plugin } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';
import { RELAY_PATH, SignallingRelay, type RelayClient } from './signalling-relay';

/** Structural server shape: `http.Server | https.Server` both emit `upgrade`. */
type UpgradableServer = {
  on(
    event: 'upgrade',
    listener: (req: IncomingMessage, socket: Duplex, head: Buffer) => void,
  ): unknown;
  once(event: 'close', listener: () => void): unknown;
};

export type SignallingRelayHandle = {
  readonly relay: SignallingRelay;
  close(): void;
};

/**
 * Attach the relay to an already-running HTTP(S) server. Exported so tests
 * can hang a real `node:http` server under it with two native `ws` clients.
 */
export function attachSignallingRelay(server: UpgradableServer): SignallingRelayHandle {
  const relay = new SignallingRelay();
  const wss = new WebSocketServer({ noServer: true });
  let closed = false;

  server.on('upgrade', (req, socket, head) => {
    let pathname = '';
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      socket.destroy(); // malformed URL — no listener can resolve a path
      return;
    }
    if (pathname !== RELAY_PATH) {
      // Not ours, but possibly Vite's HMR/proxy or a plugin listener
      // registered after this one. Defer past the whole `upgrade` emission
      // and destroy only when nobody claimed the socket: an upgrade no
      // listener answers never gets a 101 (or a 4xx) and hangs forever.
      setImmediate(() => {
        const claimed = (socket as Duplex & { bytesWritten?: number }).bytesWritten;
        if (!socket.destroyed && !socket.writableEnded && (claimed ?? 0) === 0) {
          socket.destroy();
        }
      });
      return;
    }
    wss.handleUpgrade(req, socket, head, (client, request) => {
      wss.emit('connection', client, request);
    });
  });

  wss.on('connection', (socket) => {
    const client: RelayClient = relay.createClient(
      (data) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(data);
      },
      (code, reason) => {
        socket.close(code, reason);
      },
    );
    socket.on('message', (data) => relay.handleMessage(client, data.toString()));
    socket.on('close', () => relay.handleClose(client));
    socket.on('error', () => relay.handleClose(client));
  });

  const handle: SignallingRelayHandle = {
    relay,
    close(): void {
      if (closed) return; // server `close` and an explicit call may both fire
      closed = true;
      // Terminate live peers first: `wss.close()` alone waits for them, and
      // the hosting `server.close()` would hang on the upgraded sockets.
      for (const client of wss.clients) client.terminate();
      wss.close();
    },
  };
  // D-013's teardown claim: the relay also closes with its hosting server.
  // Under `vite dev`, `createServerCloseFn` destroys tracked sockets before
  // `server.close()`, so this event is guaranteed to fire there; raw test
  // servers may call `handle.close()` explicitly first (guarded above).
  server.once('close', () => handle.close());
  return handle;
}

/** Vite plugin: `configureServer` hooks run with `httpServer` resolved. */
export default function wsSignallingPlugin(): Plugin {
  return {
    name: 'nammaspace:ws-signalling',
    configureServer(server) {
      if (!server.httpServer) return; // middleware mode — nothing to upgrade
      attachSignallingRelay(server.httpServer as UpgradableServer);
    },
  };
}
