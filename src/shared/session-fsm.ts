/**
 * Connection lifecycle state machine (pure).
 *
 * Illegal transitions are rejected so the controller cannot silently jump
 * (e.g. reconnecting → connecting without teardown).
 */
import type { ConnectionState } from './types.js'

/** Allowed next states for each current state. Self-transitions are for
 *  reconnecting attempt/nextRetryIn updates without leaving the mode. */
const TRANSITIONS: Record<ConnectionState, ReadonlySet<ConnectionState>> = {
  disconnected: new Set(['connecting']),
  connecting: new Set(['connected', 'disconnected']),
  connected: new Set(['disconnected', 'reconnecting']),
  // reconnecting → connecting: user started a fresh connect while auto-reconnect runs
  reconnecting: new Set(['connected', 'disconnected', 'reconnecting', 'connecting'])
}

export type TransitionResult =
  | { ok: true; from: ConnectionState; to: ConnectionState }
  | { ok: false; from: ConnectionState; to: ConnectionState; reason: string }

/** Whether `from → to` is a legal lifecycle edge. */
export function canTransition(from: ConnectionState, to: ConnectionState): boolean {
  if (from === to) {
    // Only reconnecting may self-transition (attempt / countdown updates).
    return from === 'reconnecting'
  }
  return TRANSITIONS[from]?.has(to) ?? false
}

/**
 * Validate a transition. Callers should log and ignore illegal ones rather
 * than crashing the app.
 */
export function transition(
  from: ConnectionState,
  to: ConnectionState
): TransitionResult {
  if (canTransition(from, to)) {
    return { ok: true, from, to }
  }
  return {
    ok: false,
    from,
    to,
    reason: `illegal connection transition: ${from} → ${to}`
  }
}

/** True when the session is expected to accept terminal I/O. */
export function isTerminalLive(state: ConnectionState): boolean {
  return state === 'connected'
}

/** True when a connect or reconnect attempt is in flight. */
export function isConnectBusy(state: ConnectionState): boolean {
  return state === 'connecting' || state === 'reconnecting'
}
