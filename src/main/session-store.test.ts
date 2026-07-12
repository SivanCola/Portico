import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadSessionSnapshot,
  saveSessionSnapshot,
  normalizeSnapshot,
  targetToPersisted,
  canAutoConnectSsh
} from './session-store.js'

describe('normalizeSnapshot', () => {
  it('returns empty defaults for garbage', () => {
    expect(normalizeSnapshot(null).sessions).toEqual([])
    expect(normalizeSnapshot({}).restoreOnLaunch).toBe(true)
  })

  it('keeps ssh sessions with key/agent and drops password-only autoConnect', () => {
    const snap = normalizeSnapshot({
      sessions: [
        {
          id: 'a',
          title: 'htop',
          kind: 'ssh',
          target: { host: '1.2.3.4', user: 'root', port: 22, useAgent: true },
          tmuxSession: 'htop',
          autoConnect: true,
          titleUserSet: true,
          portForwards: [
            {
              localPort: 5173,
              remoteHost: '127.0.0.1',
              remotePort: 5173,
              label: 'vite'
            }
          ]
        },
        {
          id: 'b',
          title: 'pw',
          kind: 'ssh',
          target: { host: '1.2.3.4', user: 'root', port: 22 },
          autoConnect: true
        }
      ]
    })
    expect(snap.sessions[0]?.autoConnect).toBe(true)
    expect(snap.sessions[0]?.tmuxSession).toBe('htop')
    expect(snap.sessions[0]?.portForwards).toEqual([
      {
        direction: 'local',
        localPort: 5173,
        remoteHost: '127.0.0.1',
        remotePort: 5173,
        label: 'vite'
      }
    ])
    expect(snap.sessions[1]?.autoConnect).toBe(false)
  })

  it('persists dynamic SOCKS rules', () => {
    const snap = normalizeSnapshot({
      sessions: [
        {
          id: 's',
          title: 'socks',
          kind: 'ssh',
          target: { host: '1.2.3.4', user: 'u', port: 22, useAgent: true },
          autoConnect: true,
          portForwards: [
            { direction: 'dynamic', localPort: 1080, remoteHost: 'socks5', remotePort: 0 }
          ]
        }
      ]
    })
    expect(snap.sessions[0]?.portForwards?.[0]).toMatchObject({
      direction: 'dynamic',
      localPort: 1080,
      remotePort: 0
    })
  })
})

describe('targetToPersisted / canAutoConnectSsh', () => {
  it('strips password and reports agent/key capability', () => {
    const p = targetToPersisted({
      host: 'h',
      user: 'u',
      port: 22,
      password: 'secret',
      useAgent: true
    })
    expect((p as { password?: string }).password).toBeUndefined()
    expect(canAutoConnectSsh(p)).toBe(true)
    expect(canAutoConnectSsh({ host: 'h', user: 'u', port: 22 })).toBe(false)
  })
})

describe('load/save round-trip', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'portico-snap-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes and reads sessions.json', async () => {
    await saveSessionSnapshot(dir, {
      version: 1,
      restoreOnLaunch: true,
      sessions: [
        {
          id: 'x',
          title: 'noban',
          kind: 'ssh',
          target: {
            host: 'noban.example',
            user: 'root',
            port: 22,
            alias: 'noban-vm',
            useAgent: true
          },
          tmuxSession: 'main',
          autoConnect: true,
          titleUserSet: true
        }
      ]
    })
    expect(existsSync(join(dir, 'sessions.json'))).toBe(true)
    const loaded = loadSessionSnapshot(dir)
    expect(loaded.sessions).toHaveLength(1)
    expect(loaded.sessions[0]?.title).toBe('noban')
    expect(loaded.sessions[0]?.tmuxSession).toBe('main')
    expect(loaded.sessions[0]?.target?.alias).toBe('noban-vm')
    const raw = readFileSync(join(dir, 'sessions.json'), 'utf8')
    expect(raw).not.toMatch(/password/)
  })
})
