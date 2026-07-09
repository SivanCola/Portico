/**
 * Lightweight unit tests for PorticoController shelf / assert helpers that
 * don't need a live SSH session.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

vi.mock('electron', () => ({
  BrowserWindow: class {},
  clipboard: { readImage: () => ({ isEmpty: () => true }), read: () => '' },
  nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) }
}))

type ConnectResult = { initialCwd: string }

/** Shared mutable state for the SshSession mock (hoisted-safe). */
const mockState = {
  connectImpl: async (): Promise<ConnectResult> => ({ initialCwd: '/home/u' }),
  instances: [] as EventEmitter[]
}

vi.mock('./ssh-session.js', () => ({
  SshSession: class extends EventEmitter {
    connect = vi.fn(async () => mockState.connectImpl())
    disconnect = vi.fn(async () => {
      this.emit('close', { intentional: true })
    })
    isConnected = () => false
    getClient = () => null
    recentOutput = () => []
    resize = vi.fn()
    write = vi.fn()
    constructor(_target: unknown) {
      super()
      mockState.instances.push(this)
    }
  }
}))

vi.mock('./blob-uploader.js', () => ({
  uploadBlob: vi.fn()
}))

vi.mock('./clipboard.js', () => ({
  clipboardHasImage: () => false,
  readClipboardImage: async () => null,
  readImageFile: async () => null
}))

vi.mock('./port-forwarder.js', () => ({
  PortForwarder: class {
    on = vi.fn()
    destroyAll = vi.fn()
    dropActiveTunnels = vi.fn()
    resumeAll = vi.fn()
    list = () => []
  }
}))

const { PorticoController } = await import('./portico-controller.js')

describe('PorticoController shelf', () => {
  let c: InstanceType<typeof PorticoController>

  beforeEach(() => {
    c = new PorticoController(() => null)
    mockState.instances = []
    mockState.connectImpl = async () => ({ initialCwd: '/home/u' })
  })

  it('shelfRemove drops an item by id', () => {
    const list = c.shelfList()
    expect(list.ok).toBe(true)
    if (list.ok) expect(list.value).toEqual([])

    expect(c.shelfClear().ok).toBe(true)
    expect(c.shelfRemove('missing').ok).toBe(true)
  })

  it('assertTarget accepts agent auth', async () => {
    // Force connect to fail after assertTarget so we only check credential validation.
    mockState.connectImpl = async () => {
      throw Object.assign(new Error('no agent'), { code: 'SSH_AGENT' })
    }
    const r = await c.connect({
      id: 'u@h',
      host: 'example.com',
      user: 'u',
      port: 22,
      useAgent: true
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).not.toBe('INVALID_TARGET')
  })

  it('assertTarget rejects missing credentials', async () => {
    const r = await c.connect({
      id: 'u@h',
      host: 'example.com',
      user: 'u',
      port: 22
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.message).toMatch(/password|key|agent/i)
    }
  })
})

describe('PorticoController single-flight connect', () => {
  let c: InstanceType<typeof PorticoController>

  beforeEach(() => {
    c = new PorticoController(() => null)
    mockState.instances = []
  })

  it('rejects a second connect while the first is in flight', async () => {
    let release: (() => void) | null = null
    const gate = new Promise<void>((r) => {
      release = r
    })
    mockState.connectImpl = async () => {
      await gate
      return { initialCwd: '/home/u' }
    }

    const p1 = c.connect({
      id: 'u@h',
      host: 'example.com',
      user: 'u',
      port: 22,
      password: 'x'
    })
    const p2 = c.connect({
      id: 'u@h2',
      host: 'other.example',
      user: 'u',
      port: 22,
      password: 'x'
    })

    const r2 = await p2
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.error.code).toBe('BUSY')

    release!()
    const r1 = await p1
    expect(r1.ok).toBe(true)
  })

  it('setFeatureFlags disables image bridge', async () => {
    const r = c.setFeatureFlags({ imageBridge: false })
    expect(r.ok).toBe(true)
    const paste = await c.pasteImage({ prompt: 'x' })
    expect(paste.ok).toBe(false)
    if (!paste.ok) expect(paste.error.code).toBe('FEATURE_DISABLED')
  })
})

describe('PorticoController reconnect cancel race', () => {
  let c: InstanceType<typeof PorticoController>

  beforeEach(() => {
    c = new PorticoController(() => null)
    mockState.instances = []
    mockState.connectImpl = async () => ({ initialCwd: '/home/u' })
  })

  it('does not adopt a session that finished after cancelReconnect', async () => {
    let releaseConnect: (() => void) | null = null
    const connectGate = new Promise<void>((resolve) => {
      releaseConnect = resolve
    })

    // First connect succeeds immediately (establish a session + target).
    const connected = await c.connect({
      id: 'u@h',
      host: 'example.com',
      user: 'u',
      port: 22,
      password: 'x'
    })
    expect(connected.ok).toBe(true)

    // Next connect (reconnect) hangs until we release.
    mockState.connectImpl = async () => {
      await connectGate
      return { initialCwd: '/home/u' }
    }

    // Simulate unexpected close → startReconnect → attemptReconnect.
    const live = mockState.instances[mockState.instances.length - 1]
    live.emit('close', { intentional: false })

    // Wait a tick so attemptReconnect reaches the hanging connect().
    await new Promise((r) => setTimeout(r, 30))

    const cancel = await c.cancelReconnect()
    expect(cancel.ok).toBe(true)

    // Now the in-flight connect resolves — must not flip back to connected.
    releaseConnect!()
    await new Promise((r) => setTimeout(r, 30))

    const state = c.getConnectionState()
    expect(state.ok && state.value.state).toBe('disconnected')
    const connectedAfter = c.isConnected()
    expect(connectedAfter.ok && connectedAfter.value).toBe(false)
  })
})
