/**
 * Lightweight unit tests for PorticoController multi-session registry.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

vi.mock('electron', () => ({
  BrowserWindow: class {},
  clipboard: { readImage: () => ({ isEmpty: () => true }), read: () => '', writeText: () => {} },
  nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) },
  app: {
    getPath: (name: string) =>
      name === 'userData' ? require('node:os').tmpdir() + '/portico-test-userdata' : '/tmp'
  }
}))

type ConnectResult = { initialCwd: string }

/** Shared mutable state for the SshSession mock (hoisted-safe). */
type MockSession = EventEmitter & {
  _connected: boolean
  write: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  connect: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
}

const mockState = {
  connectImpl: async (): Promise<ConnectResult> => ({ initialCwd: '/home/u' }),
  instances: [] as MockSession[]
}

vi.mock('./ssh-session.js', () => ({
  SshSession: class extends EventEmitter {
    _connected = false
    connect = vi.fn(async () => {
      const r = await mockState.connectImpl()
      this._connected = true
      return r
    })
    disconnect = vi.fn(async () => {
      this._connected = false
      this.emit('close', { intentional: true })
    })
    isConnected = () => this._connected
    getClient = () => null
    recentOutput = () => []
    resize = vi.fn()
    write = vi.fn()
    runAndCapture = vi.fn(async () => '')
    deleteFilesIn = vi.fn(async () => 0)
    constructor(_target: unknown) {
      super()
      mockState.instances.push(this as never)
    }
  }
}))

vi.mock('./blob-uploader.js', () => ({
  uploadBlob: vi.fn()
}))

vi.mock('./clipboard.js', () => ({
  clipboardHasImage: () => false,
  readClipboardImage: async () => null,
  readClipboardImages: async () => [],
  readImageFile: async () => null
}))

vi.mock('./port-forwarder.js', () => ({
  PortForwarder: class {
    on = vi.fn()
    destroyAll = vi.fn()
    dropActiveTunnels = vi.fn()
    resumeAll = vi.fn()
    rebindAll = vi.fn(async () => {})
    exportSpecs = vi.fn(() => [])
    claimedLocalPorts = vi.fn(() => [])
    list = () => []
    add = vi.fn()
    remove = vi.fn()
    setEnabled = vi.fn(async () => null)
    resetStats = vi.fn()
  }
}))

vi.mock('./local-session.js', () => {
  const { EventEmitter } = require('node:events')
  return {
    LocalSession: class extends EventEmitter {
      connect = vi.fn(async () => {
        this.emit('ready')
        return { shell: '/bin/zsh', cwd: '/home/u' }
      })
      disconnect = vi.fn(async () => {
        this.emit('close', { intentional: true })
      })
      isConnected = () => true
      write = vi.fn()
      resize = vi.fn()
      shellName = () => 'zsh'
      recentOutput = () => []
    }
  }
})

const { PorticoController } = await import('./portico-controller.js')

const sampleTarget = (host = 'example.com') => ({
  id: `u@${host}`,
  host,
  user: 'u',
  port: 22,
  password: 'x'
})

describe('PorticoController shelf', () => {
  let c: InstanceType<typeof PorticoController>
  let sessionId: string

  beforeEach(() => {
    c = new PorticoController(() => null)
    mockState.instances = []
    mockState.connectImpl = async () => ({ initialCwd: '/home/u' })
    const list = c.listSessions()
    expect(list.ok).toBe(true)
    if (list.ok) sessionId = list.value[0].id
  })

  it('starts with one draft session', () => {
    const list = c.listSessions()
    expect(list.ok).toBe(true)
    if (list.ok) {
      expect(list.value).toHaveLength(1)
      expect(list.value[0].state).toBe('disconnected')
    }
  })

  it('shelfRemove drops an item by id', () => {
    const list = c.shelfList(sessionId)
    expect(list.ok).toBe(true)
    if (list.ok) expect(list.value).toEqual([])

    expect(c.shelfClear(sessionId).ok).toBe(true)
    expect(c.shelfRemove(sessionId, 'missing').ok).toBe(true)
  })

  it('assertTarget accepts agent auth', async () => {
    mockState.connectImpl = async () => {
      throw Object.assign(new Error('no agent'), { code: 'SSH_AGENT' })
    }
    const r = await c.connect(sessionId, {
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
    const r = await c.connect(sessionId, {
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

  it('unknown sessionId returns NOT_FOUND', async () => {
    const r = await c.connect('nope', sampleTarget())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND')
  })

  it('connectLocal opens a local session', async () => {
    const r = await c.connectLocal(sessionId)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.connected).toBe(true)
      expect(r.value.sessionId).toBe(sessionId)
    }
    const list = c.listSessions()
    expect(list.ok && list.value[0]?.kind).toBe('local')
  })
})

describe('PorticoController multi-session', () => {
  let c: InstanceType<typeof PorticoController>

  beforeEach(() => {
    c = new PorticoController(() => null)
    mockState.instances = []
    mockState.connectImpl = async () => ({ initialCwd: '/home/u' })
  })

  it('allows parallel connect on different sessions (not global BUSY)', async () => {
    let release: (() => void) | null = null
    const gate = new Promise<void>((r) => {
      release = r
    })
    mockState.connectImpl = async () => {
      await gate
      return { initialCwd: '/home/u' }
    }

    const list = c.listSessions()
    expect(list.ok).toBe(true)
    if (!list.ok) return
    const id1 = list.value[0].id
    const created = c.createSession()
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const id2 = created.value.id

    const p1 = c.connect(id1, sampleTarget('a.example'))
    const p2 = c.connect(id2, sampleTarget('b.example'))

    // Same-session second connect should BUSY; different sessions should both run.
    const pBusy = c.connect(id1, sampleTarget('c.example'))
    const busy = await pBusy
    expect(busy.ok).toBe(false)
    if (!busy.ok) expect(busy.error.code).toBe('BUSY')

    release!()
    const r1 = await p1
    const r2 = await p2
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
  })

  it('disconnect one session leaves the other connected', async () => {
    const list = c.listSessions()
    expect(list.ok).toBe(true)
    if (!list.ok) return
    const id1 = list.value[0].id
    const created = c.createSession()
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const id2 = created.value.id

    expect((await c.connect(id1, sampleTarget('a.example'))).ok).toBe(true)
    expect((await c.connect(id2, sampleTarget('b.example'))).ok).toBe(true)

    expect((await c.disconnect(id1)).ok).toBe(true)
    const a = c.isConnected(id1)
    const b = c.isConnected(id2)
    expect(a.ok && a.value).toBe(false)
    expect(b.ok && b.value).toBe(true)
  })

  it('routes output with sessionId', async () => {
    const list = c.listSessions()
    expect(list.ok).toBe(true)
    if (!list.ok) return
    const id1 = list.value[0].id

    const chunks: Array<{ sessionId: string; data: string }> = []
    c.outputListeners.add((p) => chunks.push(p))

    expect((await c.connect(id1, sampleTarget())).ok).toBe(true)
    const inst = mockState.instances[mockState.instances.length - 1]
    inst.emit('data', 'hello-from-a')

    expect(chunks.some((c) => c.sessionId === id1 && c.data === 'hello-from-a')).toBe(true)
  })

  it('applies dimensions received before the initial SSH connection is ready', async () => {
    const list = c.listSessions()
    expect(list.ok).toBe(true)
    if (!list.ok) return
    const id = list.value[0].id

    c.resize(id, 132, 41)
    expect((await c.connect(id, sampleTarget())).ok).toBe(true)

    const inst = mockState.instances[mockState.instances.length - 1]
    expect(inst.resize).toHaveBeenCalledWith({ cols: 132, rows: 41 })
  })

  it('closeSession recreates a draft when last session closed', async () => {
    const list = c.listSessions()
    expect(list.ok).toBe(true)
    if (!list.ok) return
    const id = list.value[0].id
    expect((await c.closeSession(id)).ok).toBe(true)
    const after = c.listSessions()
    expect(after.ok).toBe(true)
    if (after.ok) {
      expect(after.value).toHaveLength(1)
      expect(after.value[0].id).not.toBe(id)
      expect(after.value[0].state).toBe('disconnected')
    }
  })

  it('sendInput only writes to the target session', async () => {
    const list = c.listSessions()
    expect(list.ok).toBe(true)
    if (!list.ok) return
    const id1 = list.value[0].id
    const created = c.createSession()
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const id2 = created.value.id

    expect((await c.connect(id1, sampleTarget('a.example'))).ok).toBe(true)
    const inst1 = mockState.instances[mockState.instances.length - 1]
    expect((await c.connect(id2, sampleTarget('b.example'))).ok).toBe(true)
    const inst2 = mockState.instances[mockState.instances.length - 1]

    c.sendInput(id1, 'only-a')
    expect(inst1.write).toHaveBeenCalledWith('only-a')
    expect(inst2.write).not.toHaveBeenCalledWith('only-a')
  })
})

describe('PorticoController single-flight connect (per session)', () => {
  let c: InstanceType<typeof PorticoController>
  let sessionId: string

  beforeEach(() => {
    c = new PorticoController(() => null)
    mockState.instances = []
    const list = c.listSessions()
    if (list.ok) sessionId = list.value[0].id
  })

  it('rejects a second connect on the same session while in flight', async () => {
    let release: (() => void) | null = null
    const gate = new Promise<void>((r) => {
      release = r
    })
    mockState.connectImpl = async () => {
      await gate
      return { initialCwd: '/home/u' }
    }

    const p1 = c.connect(sessionId, sampleTarget('a.example'))
    const p2 = c.connect(sessionId, sampleTarget('b.example'))

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
    const paste = await c.pasteImage({ sessionId, prompt: 'x' })
    expect(paste.ok).toBe(false)
    if (!paste.ok) expect(paste.error.code).toBe('FEATURE_DISABLED')
  })
})

describe('PorticoController reconnect cancel race', () => {
  let c: InstanceType<typeof PorticoController>
  let sessionId: string

  beforeEach(() => {
    c = new PorticoController(() => null)
    mockState.instances = []
    mockState.connectImpl = async () => ({ initialCwd: '/home/u' })
    const list = c.listSessions()
    if (list.ok) sessionId = list.value[0].id
  })

  it('does not adopt a session that finished after cancelReconnect', async () => {
    let releaseConnect: (() => void) | null = null
    const connectGate = new Promise<void>((resolve) => {
      releaseConnect = resolve
    })

    const connected = await c.connect(sessionId, sampleTarget())
    expect(connected.ok).toBe(true)

    mockState.connectImpl = async () => {
      await connectGate
      return { initialCwd: '/home/u' }
    }

    const live = mockState.instances[mockState.instances.length - 1]
    live.emit('close', { intentional: false })

    await new Promise((r) => setTimeout(r, 30))

    const cancel = await c.cancelReconnect(sessionId)
    expect(cancel.ok).toBe(true)

    releaseConnect!()
    await new Promise((r) => setTimeout(r, 30))

    const state = c.getConnectionState(sessionId)
    expect(state.ok && state.value.state).toBe('disconnected')
    const connectedAfter = c.isConnected(sessionId)
    expect(connectedAfter.ok && connectedAfter.value).toBe(false)
  })
})
