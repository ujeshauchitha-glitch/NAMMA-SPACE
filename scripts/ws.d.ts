/**
 * T19 — minimal ambient declarations for `ws`.
 *
 * The repo ships `ws@^8.22.0` as an approved runtime dependency but has no
 * `@types/ws` (contract: no new dependencies without a decision entry).
 * This shim declares only the surface `scripts/ws-signalling-plugin.ts`
 * actually uses, so `tsc -b` (tsconfig.node.json) passes without pulling
 * a type package. It is a declaration file: no top-level import/export,
 * so it stays an ambient script.
 */
declare module 'ws' {
  import type { IncomingMessage } from 'node:http';
  import type { Duplex } from 'node:stream';

  export class WebSocket {
    static readonly CONNECTING: number;
    static readonly OPEN: number;
    static readonly CLOSING: number;
    static readonly CLOSED: number;

    readyState: number;
    send(data: string): void;
    close(code?: number, reason?: string): void;
    /** Forcibly destroy the underlying socket (used on relay teardown). */
    terminate(): void;
    on(event: 'message', listener: (data: Buffer | ArrayBuffer | string, isBinary: boolean) => void): this;
    on(event: 'close', listener: (code: number, reason: Buffer) => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
  }

  export class WebSocketServer {
    constructor(options: { noServer?: boolean });
    handleUpgrade(
      request: IncomingMessage,
      socket: Duplex,
      head: Buffer,
      callback: (client: WebSocket, request: IncomingMessage) => void,
    ): void;
    emit(event: 'connection', client: WebSocket, request: IncomingMessage): boolean;
    on(event: 'connection', listener: (client: WebSocket, request: IncomingMessage) => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
    close(callback?: () => void): void;
    /** Tracked live clients (ws `clientTracking` defaults to true). */
    clients: Set<WebSocket>;
  }
}
