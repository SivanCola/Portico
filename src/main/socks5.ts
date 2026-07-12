/**
 * Minimal SOCKS5 server handshake (RFC 1928) — CONNECT only, no authentication.
 * Used by PortForwarder dynamic (−D) mode: after CONNECT succeeds the caller
 * opens an SSH `forwardOut` channel and pipes the remaining socket traffic.
 */
import type { Socket } from 'node:net'

export type Socks5Result =
  | { ok: true; host: string; port: number }
  | { ok: false; code: number; message: string }

const VER = 0x05
const CMD_CONNECT = 0x01
const ATYP_IPV4 = 0x01
const ATYP_DOMAIN = 0x03
const ATYP_IPV6 = 0x04

const REP_SUCCESS = 0x00
const REP_GENERAL = 0x01
const REP_NOT_ALLOWED = 0x02
const REP_NET_UNREACH = 0x03
const REP_HOST_UNREACH = 0x04
const REP_CONN_REFUSED = 0x05
const REP_CMD_NOT_SUPPORTED = 0x07
const REP_ATYP_NOT_SUPPORTED = 0x08

/** Reply buffer: VER REP RSV ATYP(IPv4) 0.0.0.0:0 */
function reply(rep: number): Buffer {
  return Buffer.from([VER, rep, 0x00, ATYP_IPV4, 0, 0, 0, 0, 0, 0])
}

function readExact(socket: Socket, n: number, timeoutMs = 10_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let got = 0
    const timer = setTimeout(() => {
      cleanup()
      reject(Object.assign(new Error('SOCKS5 handshake timed out'), { code: 'SOCKS_TIMEOUT' }))
    }, timeoutMs)

    const onData = (buf: Buffer) => {
      chunks.push(buf)
      got += buf.length
      if (got >= n) {
        cleanup()
        const all = Buffer.concat(chunks)
        const head = all.subarray(0, n)
        const rest = all.subarray(n)
        if (rest.length > 0) socket.unshift(rest)
        resolve(head)
      }
    }
    const onErr = (err: Error) => {
      cleanup()
      reject(err)
    }
    const onClose = () => {
      cleanup()
      reject(Object.assign(new Error('Socket closed during SOCKS5 handshake'), { code: 'SOCKS_CLOSED' }))
    }
    const cleanup = () => {
      clearTimeout(timer)
      socket.off('data', onData)
      socket.off('error', onErr)
      socket.off('close', onClose)
    }
    socket.on('data', onData)
    socket.on('error', onErr)
    socket.on('close', onClose)
  })
}

/**
 * Perform SOCKS5 greeting + CONNECT request on `socket`.
 * On success the socket is left ready for raw TCP payload (reply already sent).
 * On failure a reply is written (best-effort) and the result is ok:false.
 */
export async function socks5Handshake(socket: Socket): Promise<Socks5Result> {
  try {
    // --- greeting ---
    const hdr = await readExact(socket, 2)
    if (hdr[0] !== VER) {
      return fail(socket, REP_GENERAL, 'Not SOCKS5')
    }
    const nmethods = hdr[1]
    if (nmethods < 1) {
      return fail(socket, REP_GENERAL, 'No auth methods')
    }
    const methods = await readExact(socket, nmethods)
    // Prefer NO AUTH (0x00)
    if (!methods.includes(0x00)) {
      socket.write(Buffer.from([VER, 0xff]))
      return { ok: false, code: REP_NOT_ALLOWED, message: 'Only no-auth SOCKS5 is supported' }
    }
    socket.write(Buffer.from([VER, 0x00]))

    // --- request ---
    const req = await readExact(socket, 4)
    if (req[0] !== VER) {
      return fail(socket, REP_GENERAL, 'Bad request version')
    }
    if (req[1] !== CMD_CONNECT) {
      return fail(socket, REP_CMD_NOT_SUPPORTED, 'Only CONNECT is supported')
    }
    const atyp = req[3]
    let host: string
    if (atyp === ATYP_IPV4) {
      const addr = await readExact(socket, 4)
      host = `${addr[0]}.${addr[1]}.${addr[2]}.${addr[3]}`
    } else if (atyp === ATYP_DOMAIN) {
      const lenBuf = await readExact(socket, 1)
      const len = lenBuf[0]
      if (len < 1) return fail(socket, REP_GENERAL, 'Empty domain')
      const name = await readExact(socket, len)
      host = name.toString('utf8')
    } else if (atyp === ATYP_IPV6) {
      const addr = await readExact(socket, 16)
      const parts: string[] = []
      for (let i = 0; i < 16; i += 2) {
        parts.push(((addr[i] << 8) | addr[i + 1]).toString(16))
      }
      host = parts.join(':')
    } else {
      return fail(socket, REP_ATYP_NOT_SUPPORTED, 'Address type not supported')
    }

    const portBuf = await readExact(socket, 2)
    const port = (portBuf[0] << 8) | portBuf[1]
    if (port < 1 || port > 65535) {
      return fail(socket, REP_GENERAL, 'Invalid port')
    }

    // Success reply — caller will open the tunnel; if that fails they should
    // destroy the socket (client will see connection reset after CONNECT ok,
    // which is acceptable for MVP; we reply success only after tunnel opens
    // when using socks5HandshakeThen — see note below).
    // Here we only parse; reply is deferred to the caller via socks5Reply.
    return { ok: true, host, port }
  } catch (e) {
    return {
      ok: false,
      code: REP_GENERAL,
      message: (e as Error).message || 'SOCKS5 handshake failed'
    }
  }
}

export function socks5ReplySuccess(socket: Socket): void {
  try {
    socket.write(reply(REP_SUCCESS))
  } catch {
    /* ignore */
  }
}

export function socks5ReplyFailure(socket: Socket, code = REP_GENERAL): void {
  try {
    socket.write(reply(code))
  } catch {
    /* ignore */
  }
}

export function socks5MapError(err: Error): number {
  const msg = (err.message || '').toLowerCase()
  if (msg.includes('refused') || msg.includes('econnrefused')) return REP_CONN_REFUSED
  if (msg.includes('unreachable') || msg.includes('enetunreach')) return REP_NET_UNREACH
  if (msg.includes('host') || msg.includes('ehostunreach')) return REP_HOST_UNREACH
  return REP_GENERAL
}

function fail(socket: Socket, code: number, message: string): Socks5Result {
  socks5ReplyFailure(socket, code)
  return { ok: false, code, message }
}

/** Format byte counts for UI (e.g. 1.2 KB, 3.4 MB). */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) n = 0
  if (n < 1024) return `${Math.floor(n)} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
