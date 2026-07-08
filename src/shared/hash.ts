import { createHash } from 'node:crypto'
import type { ImageExt } from './constants.js'

/** sha256 hex digest of the given bytes — the content-addressed blob key. */
export function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

/**
 * Compose the remote blob path: `~/.portico/blobs/<hash>.<ext>`.
 *
 * `ext` is lower-cased and the leading dot stripped if present, so callers can
 * pass either `"png"` or `".PNG"`. The path always uses the canonical dir and
 * never a leading slash, so the remote ~ stays meaningful.
 */
export function blobPath(dir: string, hash: string, ext: ImageExt | string): string {
  const cleanExt = ext.replace(/^\./, '').toLowerCase()
  return `${dir.replace(/\/$/, '')}/${hash}.${cleanExt}`
}

/**
 * Quote a remote path for safe use in a shell / AI prompt.
 * Wraps in single quotes and escapes embedded single quotes as `'\''`.
 * Paths with spaces and non-ASCII are handled correctly.
 */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/**
 * Return a prompt-friendly unquoted form of the path (no shell quoting) for
 * cases where the value is being handed to an AI inside a natural-language
 * prompt rather than evaluated by a shell.
 */
export function unquotedPath(s: string): string {
  return s
}
