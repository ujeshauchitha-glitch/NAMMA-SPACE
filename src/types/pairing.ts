/**
 * Pairing wire schemas (T18) — additive, nothing here replaces `scene.ts`.
 *
 * Two families share one file because they are one protocol surface:
 *
 *  1. **Datachannel messages** — phone → desktop over the `capture` channel
 *     (`capture-state` + `frame-chunk` header). Chunks carry a header only;
 *     frame bytes travel as binary on the same channel (T22 assembles them).
 *  2. **Signalling envelopes** — relayed verbatim by the T19 `/ws` server.
 *     Rooms hold exactly two peers, so messages need no `from` rewrite.
 *
 * Every inbound message is `safeParse`d: a malformed frame is reported as
 * `malformed`, never thrown through the socket handler and never silently
 * coerced into a valid one.
 */
import { z } from 'zod';

/* ------------------------------------------------------------------ *
 * datachannel messages (phone → desktop, channel label `capture`)
 * ------------------------------------------------------------------ */

/** Phone-side capture lifecycle, mirrored into the T9 `CAPTURING` state. */
export const CaptureStateSchema = z.object({
  type: z.literal('capture-state'),
  status: z.enum(['idle', 'capturing', 'staged']),
  /** Present once the phone has begun emitting chunks for a frame. */
  frameId: z.string().min(1).optional(),
  /** Phone clock in ms — provenance only, never used for ordering. */
  at: z.number().int().nonnegative(),
});
export type CaptureStateMessage = z.infer<typeof CaptureStateSchema>;

/**
 * Header for one chunk of a JPEG frame. `index` is 0-based; the final chunk
 * (`index === total - 1`) carries `sha256` of the complete frame so the
 * desktop can verify assembly before staging (§5.19 provenance).
 *
 * The cross-field rule is enforced by `superRefine`: `index < total`, and
 * `sha256` is present iff the chunk is final — a non-final chunk carrying a
 * digest (or a final chunk missing one) is malformed, not merely suspicious.
 */
export const FrameChunkHeaderSchema = z
  .object({
    type: z.literal('frame-chunk'),
    frameId: z.string().min(1),
    index: z.number().int().nonnegative(),
    total: z.number().int().positive(),
    /** Byte length of this chunk's payload. */
    bytes: z.number().int().positive(),
    /** sha-256 (hex) of the whole frame — final chunk only. */
    sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/, 'sha256 must be 64 lowercase hex chars')
      .optional(),
  })
  .superRefine((header, ctx) => {
    if (header.index >= header.total) {
      ctx.addIssue({ code: 'custom', path: ['index'], message: 'index must be less than total' });
      return;
    }
    const isFinal = header.index === header.total - 1;
    if (isFinal && header.sha256 === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['sha256'],
        message: 'final chunk must carry sha256 of the complete frame',
      });
    } else if (!isFinal && header.sha256 !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['sha256'], message: 'sha256 is only valid on the final chunk' });
    }
  });
export type FrameChunkHeader = z.infer<typeof FrameChunkHeaderSchema>;

/** Discriminated union of everything allowed on the `capture` channel. */
export const PairingMessageSchema = z.discriminatedUnion('type', [
  CaptureStateSchema,
  FrameChunkHeaderSchema,
]);
export type PairingMessage = z.infer<typeof PairingMessageSchema>;

/* ------------------------------------------------------------------ *
 * signalling envelopes (`/ws?session=TOKEN`, relayed verbatim)
 * ------------------------------------------------------------------ */

/** ICE candidate as it crosses the wire (matches RTCIceCandidateInit). */
export const IceCandidateSchema = z.object({
  candidate: z.string(),
  sdpMid: z.string().nullable().optional(),
  sdpMLineIndex: z.number().nullable().optional(),
  usernameFragment: z.string().nullable().optional(),
});
export type IceCandidateInit = z.infer<typeof IceCandidateSchema>;

/** SDP offer/answer as it crosses the wire (matches RTCSessionDescriptionInit). */
export const SessionDescriptionSchema = z.object({
  type: z.enum(['offer', 'answer']),
  sdp: z.string().min(1),
});
export type SessionDescriptionInit = z.infer<typeof SessionDescriptionSchema>;

export const SignalMessageSchema = z.discriminatedUnion('type', [
  /** First message on every socket; the server replies `peer-joined`. */
  z.object({ type: z.literal('join'), session: z.string().min(1) }),
  /** Room now holds two peers; `peerId` is server-generated. */
  z.object({ type: z.literal('peer-joined'), peerId: z.string().min(1) }),
  z.object({ type: z.literal('sdp'), description: SessionDescriptionSchema }),
  z.object({ type: z.literal('ice'), candidate: IceCandidateSchema }),
  /** Either peer may leave; the T19 server closes the room on it. */
  z.object({ type: z.literal('leave') }),
]);
export type SignalMessage = z.infer<typeof SignalMessageSchema>;

/** Parse one signalling frame; `null` means malformed (never coerced). */
export function parseSignalMessage(raw: string): SignalMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = SignalMessageSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Parse one datachannel frame; `null` means malformed (never coerced). */
export function parsePairingMessage(raw: string): PairingMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = PairingMessageSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
