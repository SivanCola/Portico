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
})
