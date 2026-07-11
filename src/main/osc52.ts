/**
 * OSC 52 clipboard filter for remote → local copy.
 *
 * Sequence (xterm / tmux / vim):
 *   ESC ] 52 ; <Pc> ; <base64-or-?> BEL
 *   ESC ] 52 ; <Pc> ; <base64> ESC \
 *
 * Pc is typically `c` (CLIPBOARD). Empty Pc is treated as `c`.
 * Pd `?` is a clipboard *query* — ignored (we do not answer OSC 52 queries).
 *
 * Streaming: incomplete sequences are held in an internal buffer so partial
 * escape codes are not flashed into the terminal.
 */

/** Hard cap on held buffer (incomplete sequence) to bound memory. */
export const OSC52_PENDING_MAX = 512 * 1024
/** Max base64 payload we will decode (~768 KiB text). */
export const OSC52_B64_MAX = 1024 * 1024

const OSC_INTRO = '\x1b]52;'
/** BEL or ST (ESC \) */
const TERM_BEL = '\x07'
const TERM_ST = '\x1b\\'

export interface Osc52FeedResult {
  /** Bytes safe to show / forward to xterm (complete OSC 52 removed). */
  passthrough: string
  /** Decoded UTF-8 clipboard payloads (may be empty string for clear). */
  clipboardWrites: string[]
}

/**
 * Stateful filter: feed PTY chunks, get cleaned output + clipboard writes.
 */
/** Give up on an incomplete OSC 52 sequence after this many ms. */
const OSC52_PENDING_TIMEOUT_MS = 2000

export class Osc52Filter {
  private pending = ''
  private pendingSince = 0

  /** Reset when a new SSH session starts. */
  reset(): void {
    this.pending = ''
    this.pendingSince = 0
  }

  feed(chunk: string): Osc52FeedResult {
    if (!chunk && !this.pending) {
      return { passthrough: '', clipboardWrites: [] }
    }

    // Timeout: if we've been holding an incomplete sequence too long, give up.
    if (this.pending && this.pendingSince > 0) {
      const age = Date.now() - this.pendingSince
      if (age > OSC52_PENDING_TIMEOUT_MS) {
        // Flush stale pending as passthrough — the terminator never came.
        const stale = this.pending
        this.pending = ''
        this.pendingSince = 0
        return { passthrough: stale + chunk, clipboardWrites: [] }
      }
    }

    let data = this.pending + chunk
    this.pending = ''
    this.pendingSince = 0
    const writes: string[] = []
    let out = ''

    while (data.length > 0) {
      const start = data.indexOf(OSC_INTRO)
      if (start === -1) {
        // No intro — but a trailing incomplete ESC or ESC] might start next chunk.
        const hold = holdbackPrefix(data)
        out += data.slice(0, data.length - hold.length)
        if (hold) {
          this.pending = hold
          this.pendingSince = Date.now()
        }
        break
      }

      // Emit everything before the OSC.
      out += data.slice(0, start)
      const afterIntro = data.slice(start + OSC_INTRO.length)

      // Find terminator within afterIntro.
      const bel = afterIntro.indexOf(TERM_BEL)
      const st = afterIntro.indexOf(TERM_ST)
      let end = -1
      let termLen = 0
      if (bel !== -1 && (st === -1 || bel < st)) {
        end = bel
        termLen = 1
      } else if (st !== -1) {
        end = st
        termLen = 2
      }

      if (end === -1) {
        // Incomplete sequence — hold from OSC intro.
        const held = data.slice(start)
        if (held.length > OSC52_PENDING_MAX) {
          // Give up: treat as normal text to avoid unbounded growth.
          out += held.slice(0, OSC_INTRO.length)
          data = held.slice(OSC_INTRO.length)
          continue
        }
        this.pending = held
        this.pendingSince = Date.now()
        break
      }

      const body = afterIntro.slice(0, end)
      data = afterIntro.slice(end + termLen)

      // body = Pc ; Pd   (Pc may be empty)
      const semi = body.indexOf(';')
      if (semi === -1) {
        // Malformed — drop the OSC wrapper, keep nothing from body as text.
        continue
      }
      const pc = body.slice(0, semi) || 'c'
      const pd = body.slice(semi + 1)

      // Only CLIPBOARD / PRIMARY-style targets we care about for desktop paste.
      if (pc && pc !== 'c' && pc !== 'p' && pc !== 's') {
        continue
      }

      // Query form: OSC 52 ; c ; ?
      if (pd === '?' || pd === '') {
        // Empty Pd often means "clear clipboard" in some apps; ? is query.
        if (pd === '') {
          writes.push('')
        }
        continue
      }

      if (pd.length > OSC52_B64_MAX) {
        continue
      }

      const decoded = decodeBase64Utf8(pd)
      if (decoded !== null) {
        writes.push(decoded)
      }
    }

    return { passthrough: out, clipboardWrites: writes }
  }
}

/** Hold back a short suffix that might be the start of ESC ] 52. */
function holdbackPrefix(data: string): string {
  // Longest prefix of OSC_INTRO that is a suffix of data.
  for (let n = Math.min(OSC_INTRO.length - 1, data.length); n >= 1; n--) {
    if (data.endsWith(OSC_INTRO.slice(0, n))) {
      return data.slice(-n)
    }
  }
  return ''
}

/** Decode standard base64 to UTF-8; null if invalid. */
export function decodeBase64Utf8(b64: string): string | null {
  try {
    // Strip whitespace some clients insert.
    const clean = b64.replace(/\s+/g, '')
    if (!clean || !/^[A-Za-z0-9+/]*=*$/.test(clean)) return null
    const buf = Buffer.from(clean, 'base64')
    // Reject if re-encode diverges wildly (invalid padding noise).
    if (buf.length === 0 && clean.replace(/=/g, '').length > 0) return null
    return buf.toString('utf8')
  } catch {
    return null
  }
}

/** Build an OSC 52 sequence (for tests). */
export function encodeOsc52(text: string, pc = 'c', useBel = true): string {
  const b64 = Buffer.from(text, 'utf8').toString('base64')
  const term = useBel ? TERM_BEL : TERM_ST
  return `${OSC_INTRO}${pc};${b64}${term}`
}
