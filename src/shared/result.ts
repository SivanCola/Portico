import type { PorticoError, Result } from './types.js'

export const ok = <T>(value: T): Result<T> => ({ ok: true, value })

export const err = (code: string, message: string): Result<never> => ({
  ok: false,
  error: { code, message }
})

export const isErr = <T>(r: Result<T>): r is { ok: false; error: PorticoError } =>
  r.ok === false

/** Convert a Result to a thrown error (handy inside async IPC handlers). */
export function unwrap<T>(r: Result<T>): T {
  if (r.ok) return r.value
  const e = new Error(r.error.message) as Error & { code: string }
  e.code = r.error.code
  throw e
}
