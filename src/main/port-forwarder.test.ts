/**
 * Unit tests for PortForwarder state transitions (no real SSH needed).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createServer } from 'node:net'
import { PortForwarder } from './port-forwarder.js'

describe('PortForwarder', () => {
  let pf: PortForwarder
  const getClient = vi.fn(() => null)

  beforeEach(() => {
    getClient.mockReturnValue(null)
    pf = new PortForwarder(getClient)
  })

  afterEach(() => {
    pf.destroyAll()
  })

  it('rejects duplicate local ports', async () => {
    await pf.add({ localPort: 39111, remoteHost: '127.0.0.1', remotePort: 80 })
    await expect(
      pf.add({ localPort: 39111, remoteHost: '127.0.0.1', remotePort: 81 })
    ).rejects.toMatchObject({ code: 'PORT_IN_USE' })
  })

  it('rejects EADDRINUSE when the OS port is taken', async () => {
    const blocker = createServer()
    await new Promise<void>((resolve, reject) => {
      blocker.listen(39112, '127.0.0.1', () => resolve())
      blocker.once('error', reject)
    })
    try {
      await expect(
        pf.add({ localPort: 39112, remoteHost: '127.0.0.1', remotePort: 80 })
      ).rejects.toMatchObject({ code: 'PORT_IN_USE' })
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()))
    }
  })

  it('marks forwards stopped on dropActiveTunnels and listening on resumeAll', async () => {
    await pf.add({ localPort: 39113, remoteHost: '127.0.0.1', remotePort: 80 })
    expect(pf.list()[0].state).toBe('listening')
    expect(pf.list()[0].direction).toBe('local')
    expect(pf.list()[0].enabled).toBe(true)

    pf.dropActiveTunnels()
    expect(pf.list()[0].state).toBe('stopped')
    expect(pf.list()[0].error).toMatch(/reconnect/i)

    pf.resumeAll()
    expect(pf.list()[0].state).toBe('listening')
    expect(pf.list()[0].error).toBeUndefined()
  })

  it('destroyAll clears the list', async () => {
    await pf.add({ localPort: 39114, remoteHost: '127.0.0.1', remotePort: 80 })
    pf.destroyAll()
    expect(pf.list()).toEqual([])
  })

  it('auto-assigns local port when localPort is 0', async () => {
    const rule = await pf.add({ localPort: 0, remoteHost: '127.0.0.1', remotePort: 80 })
    expect(rule.localPort).toBeGreaterThan(0)
    const status = pf.list()[0]
    expect(status.effectiveLocalPort).toBe(rule.localPort)
    expect(status.localPort).toBe(rule.localPort)
  })

  it('exportSpecs preserves rules across destroy patterns', async () => {
    await pf.add({
      localPort: 39115,
      remoteHost: '127.0.0.1',
      remotePort: 3000,
      label: 'vite'
    })
    const specs = pf.exportSpecs()
    expect(specs).toHaveLength(1)
    expect(specs[0]?.remotePort).toBe(3000)
    expect(specs[0]?.label).toBe('vite')
  })

  it('setEnabled pauses and resumes a rule', async () => {
    const rule = await pf.add({ localPort: 39116, remoteHost: '127.0.0.1', remotePort: 80 })
    expect(pf.list()[0].state).toBe('listening')

    await pf.setEnabled(rule.id, false)
    expect(pf.list()[0].state).toBe('paused')
    expect(pf.list()[0].enabled).toBe(false)
    expect(pf.claimedLocalPorts()).not.toContain(39116)

    await pf.setEnabled(rule.id, true)
    expect(pf.list()[0].state).toBe('listening')
    expect(pf.list()[0].enabled).toBe(true)
    expect(pf.claimedLocalPorts()).toContain(39116)
  })

  it('suspendAll stops listeners but keeps rule definitions', async () => {
    await pf.add({ localPort: 39117, remoteHost: '127.0.0.1', remotePort: 80 })
    await pf.suspendAll()
    expect(pf.list()).toHaveLength(1)
    expect(pf.list()[0].state).toBe('stopped')
    // Local server should be closed — rebind can start again.
    await pf.rebindAll()
    // Without an SSH client reverse is N/A; local rebind should listen again.
    expect(pf.list()[0].state).toBe('listening')
  })

  it('adds a dynamic SOCKS listener and claims the local port', async () => {
    const rule = await pf.add({
      direction: 'dynamic',
      localPort: 39118,
      remoteHost: 'ignored',
      remotePort: 0,
      label: 'socks'
    })
    expect(rule.direction).toBe('dynamic')
    expect(rule.remoteHost).toBe('socks5')
    const st = pf.list()[0]
    expect(st.state).toBe('listening')
    expect(st.bytesUp).toBe(0)
    expect(st.bytesDown).toBe(0)
    expect(pf.claimedLocalPorts()).toContain(39118)
  })

  it('exportSpecs preserves dynamic direction', async () => {
    await pf.add({
      direction: 'dynamic',
      localPort: 39119,
      remoteHost: 'x',
      remotePort: 1
    })
    const specs = pf.exportSpecs()
    expect(specs[0]?.direction).toBe('dynamic')
    expect(specs[0]?.remotePort).toBe(0)
  })

  it('resetStats zeroes counters', async () => {
    await pf.add({ localPort: 39120, remoteHost: '127.0.0.1', remotePort: 80 })
    // Manually poke counters via list shape (internal — set through reset only).
    pf.resetStats()
    expect(pf.list()[0].bytesUp).toBe(0)
    expect(pf.list()[0].bytesDown).toBe(0)
  })
})
