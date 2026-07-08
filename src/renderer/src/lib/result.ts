import type { Result } from '@shared/types.js'

/** Convenience: unwrap a Result into a thrown error or its value. */
export function unwrap<T>(r: Result<T>): T {
  if (r.ok) return r.value
  const e = new Error(r.error.message) as Error & { code: string }
  e.code = r.error.code
  throw e
}

/** Human-friendly message for a Result error, or null when ok. */
export function errMsg<T>(r: Result<T>): string | null {
  return r.ok ? null : r.error.message
}
