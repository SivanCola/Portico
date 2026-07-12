import { describe, it, expect } from 'vitest'
import { detectPortsFromText, mergeDetectedPorts } from './port-detect.js'

describe('detectPortsFromText', () => {
  it('finds vite-style Local: http://localhost:5173', () => {
    const text = '  ➜  Local:   http://localhost:5173/\n'
    const found = detectPortsFromText(text)
    expect(found.some((d) => d.port === 5173)).toBe(true)
  })

  it('finds 127.0.0.1 and 0.0.0.0 hosts', () => {
    const text = 'Listening on 0.0.0.0:3000\nServing at 127.0.0.1:8080\n'
    const ports = detectPortsFromText(text).map((d) => d.port).sort()
    expect(ports).toEqual([3000, 8080])
  })

  it('finds "listening on port N" and PORT=N', () => {
    const text = 'Server listening on port 4173\nPORT=9229 node debug\n'
    const ports = new Set(detectPortsFromText(text).map((d) => d.port))
    expect(ports.has(4173)).toBe(true)
    expect(ports.has(9229)).toBe(true)
  })

  it('ignores privileged ports and strips ansi', () => {
    const text = '\x1b[32mhttp://localhost:80\x1b[0m and http://localhost:3001\n'
    const found = detectPortsFromText(text)
    expect(found.every((d) => d.port >= 1024)).toBe(true)
    expect(found.some((d) => d.port === 3001)).toBe(true)
  })

  it('dedupes the same port', () => {
    const text = 'http://localhost:5173\nhttp://127.0.0.1:5173/\n'
    const found = detectPortsFromText(text)
    expect(found.filter((d) => d.port === 5173)).toHaveLength(1)
  })
})

describe('mergeDetectedPorts', () => {
  it('prefers incoming and caps length', () => {
    const existing = [
      { port: 3000, host: '127.0.0.1', snippet: 'a' },
      { port: 3001, host: '127.0.0.1', snippet: 'b' }
    ]
    const incoming = [{ port: 5173, host: '127.0.0.1', snippet: 'c' }]
    const m = mergeDetectedPorts(existing, incoming, 2)
    expect(m).toHaveLength(2)
    expect(m[0]?.port).toBe(5173)
  })
})
