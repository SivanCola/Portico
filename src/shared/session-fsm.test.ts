import { describe, it, expect } from 'vitest'
import {
  canTransition,
  transition,
  isTerminalLive,
  isConnectBusy
} from './session-fsm.js'

describe('session-fsm', () => {
  it('allows the happy path', () => {
    expect(canTransition('disconnected', 'connecting')).toBe(true)
    expect(canTransition('connecting', 'connected')).toBe(true)
    expect(canTransition('connected', 'reconnecting')).toBe(true)
    expect(canTransition('reconnecting', 'connected')).toBe(true)
    expect(canTransition('connected', 'disconnected')).toBe(true)
    expect(canTransition('reconnecting', 'connecting')).toBe(true)
  })

  it('rejects illegal jumps', () => {
    expect(canTransition('disconnected', 'connected')).toBe(false)
    expect(canTransition('disconnected', 'reconnecting')).toBe(false)
    expect(canTransition('connecting', 'reconnecting')).toBe(false)
    expect(transition('disconnected', 'connected').ok).toBe(false)
  })

  it('allows reconnecting self-updates only', () => {
    expect(canTransition('reconnecting', 'reconnecting')).toBe(true)
    expect(canTransition('connected', 'connected')).toBe(false)
    expect(canTransition('disconnected', 'disconnected')).toBe(false)
  })

  it('classifies live / busy helpers', () => {
    expect(isTerminalLive('connected')).toBe(true)
    expect(isTerminalLive('reconnecting')).toBe(false)
    expect(isConnectBusy('connecting')).toBe(true)
    expect(isConnectBusy('reconnecting')).toBe(true)
    expect(isConnectBusy('connected')).toBe(false)
  })
})
