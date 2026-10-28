/**
 * T19 — pure signalling relay room logic.
 *
 * No sockets, no Vite, no DOM: the adapter in `ws-signalling-plugin.ts`
 * maps real `ws` connections onto {@link RelayClient} and feeds raw text
 * frames into {@link SignallingRelay.handleMessage}. The test suite drives
 * this exact class with fake clients, so the room semantics are verified
 * without any network.
 *
 * Protocol mirrors the T18 mock hub (tests/pairing-protocol.test.ts):
 *   - `join`     → room membership; when a room fills to exactly 2, each
 *                  member receives `{"type":"peer-joined","peerId":"peer-N"}`
 *                  in insertion order (global sequence, like the mock hub).
 *   - `sdp`/`ice`→ relayed verbatim (the exact inbound text) to the other
 *                  room member only.
 *   - `leave`    → member removed; a room that drops below 2 is closed with
 *                  PEER_LEFT (the remaining peer gets code 4001), so a room
 *                  can never linger half-open.
 *   - malformed frames (unparseable JSON / schema-invalid) are dropped and
 *     never relayed.
 *
 * Honest third-peer rejection: a join into a full room is refused with an
 * explicit `{"type":"error","code":"ROOM_FULL"}` frame followed by close
 * code 4003. The frame is deliberately outside `SignalMessageSchema` (the
 * frozen T18 protocol has no `error` variant), which the T18 client already
 * tolerates: `parseSignalMessage` returns null → the client ignores it and
 * observes the close instead.
 */
import { parseSignalMessage } from '../src/types/pairing';

/** Relay path — must match the T18 client default (`/ws?session=TOKEN`). */
export const RELAY_PATH = '/ws';

export const PEER_LEFT_CLOSE_CODE = 4001;
export const PEER_LEFT_REASON = 'PEER_LEFT';

export const ROOM_FULL_CLOSE_CODE = 4003;
export const ROOM_FULL_REASON = 'ROOM_FULL';

/** Honest error frame sent to a third peer before the close handshake. */
export function roomFullErrorFrame(): string {
  return JSON.stringify({ type: 'error', code: 'ROOM_FULL' });
}

/** Minimal client surface the relay needs; `ws` sockets adapt to this. */
export type RelayClient = {
  readonly id: string;
  send(data: string): void;
  close(code: number, reason: string): void;
};

type Room = {
  session: string;
  /** Insertion order — `peer-joined` ids and "other member" both use it. */
  members: RelayClient[];
};

export class SignallingRelay {
  private readonly rooms = new Map<string, Room>();
  /** clientId → session; membership is derived from `join`, never from the URL query. */
  private readonly membership = new Map<string, string>();
  private peerSeq = 0;
  private clientSeq = 0;

  /** Number of live rooms (exposed for tests/diagnostics). */
  get roomCount(): number {
    return this.rooms.size;
  }

  /** Create a relay client bound to send/close callbacks from the adapter. */
  createClient(send: (data: string) => void, close: (code: number, reason: string) => void): RelayClient {
    const client: RelayClient = { id: `client-${++this.clientSeq}`, send, close };
    return client;
  }

  /** Feed one raw text frame; malformed input is dropped, never relayed. */
  handleMessage(client: RelayClient, raw: string): void {
    const message = parseSignalMessage(raw);
    if (!message) return;

    if (message.type === 'join') {
      this.join(client, message.session);
      return;
    }

    if (message.type === 'leave') {
      this.leave(client);
      return;
    }

    // sdp / ice — verbatim to the other member of this client's room only.
    const session = this.membership.get(client.id);
    if (session === undefined) return;
    const room = this.rooms.get(session);
    if (!room) return;
    for (const member of room.members) {
      if (member !== client) member.send(raw);
    }
  }

  /** Socket closed or errored — identical to an explicit `leave`. */
  handleClose(client: RelayClient): void {
    this.leave(client);
  }

  private join(client: RelayClient, session: string): void {
    const current = this.membership.get(client.id);
    if (current === session) return; // duplicate join is idempotent (no re-announce)
    if (current !== undefined) this.leave(client); // switching sessions

    let room = this.rooms.get(session);
    if (!room) {
      room = { session, members: [] };
      this.rooms.set(session, room);
    }

    if (room.members.length >= 2) {
      // Honest rejection: error frame first, then the close handshake.
      client.send(roomFullErrorFrame());
      client.close(ROOM_FULL_CLOSE_CODE, ROOM_FULL_REASON);
      return;
    }

    room.members.push(client);
    this.membership.set(client.id, session);

    if (room.members.length === 2) {
      for (const member of room.members) {
        member.send(JSON.stringify({ type: 'peer-joined', peerId: `peer-${++this.peerSeq}` }));
      }
    }
  }

  private leave(client: RelayClient): void {
    const session = this.membership.get(client.id);
    if (session === undefined) return;
    this.membership.delete(client.id);

    const room = this.rooms.get(session);
    if (!room) return;
    room.members = room.members.filter((member) => member.id !== client.id);

    if (room.members.length === 0) {
      this.rooms.delete(session);
      return;
    }

    // Room dropped 2→1 — close the room honestly (PEER_LEFT to the remainder).
    const [remaining] = room.members;
    this.membership.delete(remaining.id);
    this.rooms.delete(session);
    remaining.close(PEER_LEFT_CLOSE_CODE, PEER_LEFT_REASON);
  }
}
