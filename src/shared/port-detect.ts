/**
 * Detect likely HTTP/dev-server ports from terminal scrollback / PTY chunks.
 * Pure helpers — used by SessionHandle on the hot output path (throttled).
 */

export interface DetectedPort {
  /** Port number in 1..65535 (well-known system ports < 1024 are filtered). */
  port: number
  /** Best-effort host string from the match (often localhost / 127.0.0.1). */
  host: string
  /** Snippet that produced the match (for UI tooltips). */
  snippet: string
}

/** Dev / ephemeral ports only — skip SSH itself and privileged services. */
const MIN_PORT = 1024
const MAX_PORT = 65535

/**
 * Patterns for common CLI / framework banners:
 *  - http(s)://localhost:5173
 *  - 127.0.0.1:3000
 *  - 0.0.0.0:8080
 *  - [::1]:4173
 *  - Listening on port 3000 / listening at :5173
 *  - Local:   http://localhost:5173/
 */
const URL_HOST_PORT =
  /(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::(\d{2,5}))/gi

const BARE_HOST_PORT =
  /(?:^|[\s"'=(])((?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])):(\d{2,5})\b/gi

const LISTENING_ON_PORT =
  /(?:listening|running|serving|started|available)\s+(?:on|at)\s+(?:port\s+)?(?::)?(\d{2,5})\b/gi

const PORT_EQUALS = /\bPORT[=:]\s*(\d{2,5})\b/gi

function validDevPort(n: number): boolean {
  return Number.isInteger(n) && n >= MIN_PORT && n <= MAX_PORT
}

function push(
  out: Map<number, DetectedPort>,
  port: number,
  host: string,
  snippet: string
): void {
  if (!validDevPort(port)) return
  if (out.has(port)) return
  out.set(port, {
    port,
    host: host || '127.0.0.1',
    snippet: snippet.trim().slice(0, 120)
  })
}

/**
 * Scan a text chunk for candidate ports. Returns newest-looking order
 * (later matches first) capped at `limit`.
 */
export function detectPortsFromText(text: string, limit = 8): DetectedPort[] {
  if (!text) return []
  const found = new Map<number, DetectedPort>()

  // Work line-by-line so snippets stay readable.
  const lines = text.split(/\r?\n/)
  for (const line of lines) {
    if (!line || line.length > 4000) continue
    const cleaned = line.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')

    URL_HOST_PORT.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = URL_HOST_PORT.exec(cleaned)) !== null) {
      const port = Number(m[1])
      const hostPart = m[0].includes('0.0.0.0')
        ? '127.0.0.1'
        : m[0].includes('localhost')
          ? '127.0.0.1'
          : m[0].includes('[::1]')
            ? '127.0.0.1'
            : '127.0.0.1'
      push(found, port, hostPart, cleaned)
    }

    BARE_HOST_PORT.lastIndex = 0
    while ((m = BARE_HOST_PORT.exec(cleaned)) !== null) {
      const host = m[1] === '0.0.0.0' || m[1] === 'localhost' || m[1] === '[::1]'
        ? '127.0.0.1'
        : m[1]
      push(found, Number(m[2]), host, cleaned)
    }

    LISTENING_ON_PORT.lastIndex = 0
    while ((m = LISTENING_ON_PORT.exec(cleaned)) !== null) {
      push(found, Number(m[1]), '127.0.0.1', cleaned)
    }

    PORT_EQUALS.lastIndex = 0
    while ((m = PORT_EQUALS.exec(cleaned)) !== null) {
      push(found, Number(m[1]), '127.0.0.1', cleaned)
    }
  }

  // Reverse insertion order ≈ later in scrollback first.
  const list = [...found.values()].reverse()
  return list.slice(0, Math.max(1, limit))
}

/** Merge new detections into an existing list (dedupe by port, newest first). */
export function mergeDetectedPorts(
  existing: DetectedPort[],
  incoming: DetectedPort[],
  max = 12
): DetectedPort[] {
  const map = new Map<number, DetectedPort>()
  for (const d of incoming) map.set(d.port, d)
  for (const d of existing) {
    if (!map.has(d.port)) map.set(d.port, d)
  }
  return [...map.values()].slice(0, max)
}
