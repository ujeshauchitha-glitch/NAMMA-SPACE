import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseSignalMessage } from '../src/types/pairing';
import {
  PEER_LEFT_CLOSE_CODE,
  PEER_LEFT_REASON,
  RELAY_PATH,
  ROOM_FULL_CLOSE_CODE,
  ROOM_FULL_REASON,
  SignallingRelay,
  roomFullErrorFrame,
} from '../scripts/signalling-relay';
import { attachSignallingRelay } from '../scripts/ws-signalling-plugin';

/**
 * T19 — dev-server signalling relay suite.
 *
 * Part 1 drives the pure {@link SignallingRelay} with fake clients (room
 * semantics, no network). Part 2 hangs a real `node:http` server under
 * {@link attachSignallingRelay} and talks to it with real `ws` clients over
 * `/ws?session=TOKEN`, proving the Vite-plugin path end to end (minus Vite
 * itself, which has its own HMR upgrade listener that ignores `/ws`).
 *
 * Contract mirrored from the T18 mock hub (tests/pairing-protocol.test.ts):
 * join → peer-joined on the 1→2 transition, sdp/ice relayed verbatim to the
 * other member only, malformed frames dropped, room closes on either leave.
 */

/* ------------------------------------------------------------------ *
 * part 1 — pure room logic with fake clients
 * ------------------------------------------------------------------ */

type Fake = {
  client: ReturnType<SignallingRelay['createClient']>;
  sent: string[];
  closes: Array<{ code: number; reason: string }>;
};

function createFake(relay: SignallingRelay): Fake {
  const fake: Fake = { client: undefined as never, sent: [], closes: [] };
  fake.client = relay.createClient(
    (data) => fake.sent.push(data),
    (code, reason) => fake.closes.push({ code, reason }),
  );
  return fake;
}

function joinMessage(session: string): string {
  return JSON.stringify({ type: 'join', session });
}

const SDP_RAW = JSON.stringify({
  type: 'sdp',
  description: { type: 'offer', sdp: 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\n' },
});

const ICE_RAW = JSON.stringify({
  type: 'ice',
  candidate: { candidate: 'candidate:1 1 UDP 2122252543 192.168.1.7 54400 typ host' },
});

describe('SignallingRelay (pure)', () => {
  it('first join creates a room with no frames announced', () => {
    const relay = new SignallingRelay();
    const a = createFake(relay);
    relay.handleMessage(a.client, joinMessage('room-a'));

    expect(a.sent).toEqual([]);
    expect(relay.roomCount).toBe(1);
  });

  it('second join announces peer-joined to both members in insertion order (mock-hub semantics)', () => {
    const relay = new SignallingRelay();
    const a = createFake(relay);
    const b = createFake(relay);
    relay.handleMessage(a.client, joinMessage('room-a'));
    relay.handleMessage(b.client, joinMessage('room-a'));

    expect(a.sent).toEqual([JSON.stringify({ type: 'peer-joined', peerId: 'peer-1' })]);
    expect(b.sent).toEqual([JSON.stringify({ type: 'peer-joined', peerId: 'peer-2' })]);
    expect(relay.roomCount).toBe(1);
  });

  it('duplicate join is idempotent — no repeat announce', () => {
    const relay = new SignallingRelay();
    const a = createFake(relay);
    const b = createFake(relay);
    relay.handleMessage(a.client, joinMessage('room-a'));
    relay.handleMessage(b.client, joinMessage('room-a'));
    relay.handleMessage(a.client, joinMessage('room-a'));

    expect(a.sent).toHaveLength(1);
    expect(b.sent).toHaveLength(1);
    expect(relay.roomCount).toBe(1);
  });

  it('different sessions stay isolated rooms with no cross-announce', () => {
    const relay = new SignallingRelay();
    const a = createFake(relay);
    const c = createFake(relay);
    relay.handleMessage(a.client, joinMessage('room-a'));
    relay.handleMessage(c.client, joinMessage('room-c'));

    expect(a.sent).toEqual([]);
    expect(c.sent).toEqual([]);
    expect(relay.roomCount).toBe(2);
  });

  it('relays sdp/ice verbatim to the other member only', () => {
    const relay = new SignallingRelay();
    const a = createFake(relay);
    const b = createFake(relay);
    relay.handleMessage(a.client, joinMessage('room-a'));
    relay.handleMessage(b.client, joinMessage('room-a'));
    a.sent.length = 0;
    b.sent.length = 0;

    relay.handleMessage(a.client, SDP_RAW);
    relay.handleMessage(b.client, ICE_RAW);

    expect(b.sent).toEqual([SDP_RAW]); // exact inbound text, no re-serialization
    expect(a.sent).toEqual([ICE_RAW]);
  });

  it('drops sdp/ice before join — never relayed', () => {
    const relay = new SignallingRelay();
    const a = createFake(relay);
    const b = createFake(relay);
    relay.handleMessage(a.client, joinMessage('room-a'));
    relay.handleMessage(b.client, joinMessage('room-a'));
    a.sent.length = 0;
    b.sent.length = 0;

    const stranger = createFake(relay);
    relay.handleMessage(stranger.client, SDP_RAW);

    expect(a.sent).toEqual([]);
    expect(b.sent).toEqual([]);
    expect(stranger.sent).toEqual([]);
  });

  it('drops malformed and schema-invalid frames without relaying', () => {
    const relay = new SignallingRelay();
    const a = createFake(relay);
    const b = createFake(relay);
    relay.handleMessage(a.client, joinMessage('room-a'));
    relay.handleMessage(b.client, joinMessage('room-a'));
    a.sent.length = 0;
    b.sent.length = 0;

    relay.handleMessage(a.client, 'not json at all');
    relay.handleMessage(a.client, '{"type":"sdp"}'); // missing description
    relay.handleMessage(a.client, JSON.stringify({ type: 'nope' }));

    expect(a.sent).toEqual([]);
    expect(b.sent).toEqual([]);
  });

  it('third peer gets an honest ROOM_FULL error frame then close 4003', () => {
    const relay = new SignallingRelay();
    const a = createFake(relay);
    const b = createFake(relay);
    const c = createFake(relay);
    relay.handleMessage(a.client, joinMessage('room-a'));
    relay.handleMessage(b.client, joinMessage('room-a'));

    relay.handleMessage(c.client, joinMessage('room-a'));

    expect(c.sent).toEqual([roomFullErrorFrame()]);
    expect(c.closes).toEqual([{ code: ROOM_FULL_CLOSE_CODE, reason: ROOM_FULL_REASON }]);
    // The frame is deliberately outside the frozen T18 schema — the client
    // parses it to null and ignores it, observing only the close.
    expect(parseSignalMessage(roomFullErrorFrame())).toBeNull();
    expect(JSON.parse(roomFullErrorFrame())).toEqual({ type: 'error', code: 'ROOM_FULL' });
  });

  it('rejected third peer never joins — room still relays between the original two', () => {
    const relay = new SignallingRelay();
    const a = createFake(relay);
    const b = createFake(relay);
    const c = createFake(relay);
    relay.handleMessage(a.client, joinMessage('room-a'));
    relay.handleMessage(b.client, joinMessage('room-a'));
    relay.handleMessage(c.client, joinMessage('room-a'));
    a.sent.length = 0;
    b.sent.length = 0;

    relay.handleMessage(c.client, SDP_RAW); // still unjoined → dropped
    relay.handleMessage(a.client, SDP_RAW);

    expect(b.sent).toEqual([SDP_RAW]);
    expect(a.sent).toEqual([]);
    expect(relay.roomCount).toBe(1);
  });

  it('leave closes the whole room — remaining peer gets PEER_LEFT 4001', () => {
    const relay = new SignallingRelay();
    const a = createFake(relay);
    const b = createFake(relay);
    relay.handleMessage(a.client, joinMessage('room-a'));
    relay.handleMessage(b.client, joinMessage('room-a'));

    relay.handleMessage(a.client, JSON.stringify({ type: 'leave' }));

    expect(b.closes).toEqual([{ code: PEER_LEFT_CLOSE_CODE, reason: PEER_LEFT_REASON }]);
    expect(relay.roomCount).toBe(0);
  });

  it('socket drop (handleClose) is identical to leave', () => {
    const relay = new SignallingRelay();
    const a = createFake(relay);
    const b = createFake(relay);
    relay.handleMessage(a.client, joinMessage('room-a'));
    relay.handleMessage(b.client, joinMessage('room-a'));

    relay.handleClose(a.client);

    expect(b.closes).toEqual([{ code: PEER_LEFT_CLOSE_CODE, reason: PEER_LEFT_REASON }]);
    expect(relay.roomCount).toBe(0);
  });

  it('sessions are isolated — sdp never crosses rooms', () => {
    const relay = new SignallingRelay();
    const a = createFake(relay);
    const b = createFake(relay);
    const c = createFake(relay);
    const d = createFake(relay);
    relay.handleMessage(a.client, joinMessage('iso-1'));
    relay.handleMessage(b.client, joinMessage('iso-1'));
    relay.handleMessage(c.client, joinMessage('iso-2'));
    relay.handleMessage(d.client, joinMessage('iso-2'));
    for (const f of [a, b, c, d]) f.sent.length = 0;

    relay.handleMessage(a.client, SDP_RAW);

    expect(b.sent).toEqual([SDP_RAW]);
    expect(c.sent).toEqual([]);
    expect(d.sent).toEqual([]);
  });

  it('two rooms closing independently — one leave never touches the other room', () => {
    const relay = new SignallingRelay();
    const a = createFake(relay);
    const b = createFake(relay);
    const c = createFake(relay);
    const d = createFake(relay);
    relay.handleMessage(a.client, joinMessage('iso-1'));
    relay.handleMessage(b.client, joinMessage('iso-1'));
    relay.handleMessage(c.client, joinMessage('iso-2'));
    relay.handleMessage(d.client, joinMessage('iso-2'));

    relay.handleMessage(a.client, JSON.stringify({ type: 'leave' }));

    expect(b.closes).toEqual([{ code: PEER_LEFT_CLOSE_CODE, reason: PEER_LEFT_REASON }]);
    expect(c.closes).toEqual([]);
    expect(d.closes).toEqual([]);
    expect(relay.roomCount).toBe(1);
  });
});

/* ------------------------------------------------------------------ *
 * part 2 — real HTTP(S) server + real ws clients over /ws?session=TOKEN
 * ------------------------------------------------------------------ */

type WireClient = {
  ws: WebSocket;
  frames: string[];
  closed: { code: number; reason: string } | null;
};

function waitFor(predicate: () => boolean, what: string, ms = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = (): void => {
      if (predicate()) return resolve();
      if (Date.now() - start > ms) return reject(new Error(`timed out waiting for ${what}`));
      setTimeout(tick, 10);
    };
    tick();
  });
}

async function connect(port: number, query: string): Promise<WireClient> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${RELAY_PATH}?${query}`);
  const client: WireClient = { ws, frames: [], closed: null };
  ws.on('message', (data) => client.frames.push(String(data)));
  ws.on('close', (code, reason) => {
    client.closed = { code, reason: reason.toString() };
  });
  ws.on('error', () => {
    /* close-handshake noise is expected; assertions read `closed` */
  });
  await new Promise<void>((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return client;
}

describe('attachSignallingRelay (real server)', () => {
  let server: Server;
  let handle: ReturnType<typeof attachSignallingRelay>;
  let port = 0;

  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });
    handle = attachSignallingRelay(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    handle.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('pairs two peers over /ws?session=… announcing peer-joined (query ignored, join wins)', async () => {
    // Query tokens deliberately disagree with the join body: membership is
    // decided by the `join` message only, exactly like the T18 client's room.
    const a = await connect(port, 'session=TOK-A');
    const b = await connect(port, 'session=TOK-B');
    a.ws.send(joinMessage('wire-room-1'));
    b.ws.send(joinMessage('wire-room-1'));

    await waitFor(() => a.frames.length >= 1 && b.frames.length >= 1, 'peer-joined pair');
    expect(JSON.parse(a.frames[0]!)).toEqual({ type: 'peer-joined', peerId: 'peer-1' });
    expect(JSON.parse(b.frames[0]!)).toEqual({ type: 'peer-joined', peerId: 'peer-2' });

    // verbatim relay to the other member only
    a.frames.length = 0;
    b.frames.length = 0;
    a.ws.send(SDP_RAW);
    await waitFor(() => b.frames.length >= 1, 'sdp relay');
    expect(b.frames).toEqual([SDP_RAW]);
    expect(a.frames).toEqual([]);

    a.ws.close(1000, 'done');
    b.ws.close(1000, 'done');
    await waitFor(() => a.closed !== null && b.closed !== null, 'pair teardown');
  });

  it('rejects a third peer with error frame + close 4003 while the room keeps relaying', async () => {
    const before = handle.relay.roomCount;
    const a = await connect(port, 'session=TOK-A');
    const b = await connect(port, 'session=TOK-B');
    const c = await connect(port, 'session=TOK-C');
    a.ws.send(joinMessage('wire-room-2'));
    b.ws.send(joinMessage('wire-room-2'));
    await waitFor(() => a.frames.length >= 1, 'pair fill');

    c.ws.send(joinMessage('wire-room-2'));
    await waitFor(() => c.frames.length >= 1 && c.closed !== null, 'room-full rejection');

    expect(c.frames).toEqual([roomFullErrorFrame()]);
    expect(c.closed).toEqual({ code: ROOM_FULL_CLOSE_CODE, reason: ROOM_FULL_REASON });

    a.frames.length = 0;
    b.frames.length = 0;
    a.ws.send(ICE_RAW);
    await waitFor(() => b.frames.length >= 1, 'relay after rejection');
    expect(b.frames).toEqual([ICE_RAW]);

    a.ws.close(1000, 'done');
    b.ws.close(1000, 'done');
    await waitFor(() => a.closed !== null && b.closed !== null, 'pair teardown');
    await waitFor(() => handle.relay.roomCount === before, 'room cleanup');
  });

  it('leave closes the remaining peer with PEER_LEFT 4001', async () => {
    const before = handle.relay.roomCount;
    const a = await connect(port, 'session=TOK-A');
    const b = await connect(port, 'session=TOK-B');
    a.ws.send(joinMessage('wire-room-3'));
    b.ws.send(joinMessage('wire-room-3'));
    await waitFor(() => a.frames.length >= 1 && b.frames.length >= 1, 'pair fill');

    a.ws.send(JSON.stringify({ type: 'leave' }));
    await waitFor(() => b.closed !== null, 'PEER_LEFT close');
    expect(b.closed).toEqual({ code: PEER_LEFT_CLOSE_CODE, reason: PEER_LEFT_REASON });
    await waitFor(() => handle.relay.roomCount === before, 'room cleanup');
  });

  it('keeps sessions isolated across concurrent rooms', async () => {
    const before = handle.relay.roomCount;
    const a = await connect(port, 'session=TOK-A');
    const b = await connect(port, 'session=TOK-B');
    const c = await connect(port, 'session=TOK-C');
    const d = await connect(port, 'session=TOK-D');
    a.ws.send(joinMessage('wire-iso-1'));
    b.ws.send(joinMessage('wire-iso-1'));
    c.ws.send(joinMessage('wire-iso-2'));
    d.ws.send(joinMessage('wire-iso-2'));
    await waitFor(() => a.frames.length >= 1 && c.frames.length >= 1, 'two rooms filled');
    a.frames.length = 0;
    b.frames.length = 0;
    c.frames.length = 0;
    d.frames.length = 0;

    a.ws.send(SDP_RAW);
    await waitFor(() => b.frames.length >= 1, 'in-room relay');
    expect(b.frames).toEqual([SDP_RAW]);
    expect(c.frames).toEqual([]);
    expect(d.frames).toEqual([]);

    for (const client of [a, b, c, d]) client.ws.close(1000, 'done');
    await waitFor(() => handle.relay.roomCount === before, 'all rooms cleaned');
  });
});
