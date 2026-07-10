/**
 * Persist and apply left-rail session list order (renderer-only).
 * Main process session ids are unchanged; this is pure UI preference.
 */

export const SESSION_ORDER_KEY = 'portico.sessionOrder'

export function loadSessionOrder(): string[] {
  try {
    const raw = localStorage.getItem(SESSION_ORDER_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string' && x.length > 0)
  } catch {
    return []
  }
}

export function saveSessionOrder(ids: string[]): void {
  try {
    localStorage.setItem(SESSION_ORDER_KEY, JSON.stringify(ids))
  } catch {
    /* quota / private mode */
  }
}

/** Stable reorder: known ids first in `order`, then any leftovers in original order. */
export function applySessionOrder<T extends { id: string }>(sessions: T[], order: string[]): T[] {
  if (sessions.length <= 1 || order.length === 0) return sessions
  const map = new Map(sessions.map((s) => [s.id, s]))
  const result: T[] = []
  for (const id of order) {
    const s = map.get(id)
    if (s) {
      result.push(s)
      map.delete(id)
    }
  }
  for (const s of sessions) {
    if (map.has(s.id)) {
      result.push(s)
      map.delete(s.id)
    }
  }
  return result
}

/**
 * Move `fromId` next to `toId` (before or after).
 * Returns a new id array, or the original if the move is a no-op / invalid.
 */
export function moveSessionId(
  ids: string[],
  fromId: string,
  toId: string,
  position: 'before' | 'after'
): string[] {
  if (fromId === toId) return ids
  const from = ids.indexOf(fromId)
  const to = ids.indexOf(toId)
  if (from < 0 || to < 0) return ids

  const next = [...ids]
  next.splice(from, 1)
  let insertAt = next.indexOf(toId)
  if (insertAt < 0) return ids
  if (position === 'after') insertAt += 1
  next.splice(insertAt, 0, fromId)
  return next
}
