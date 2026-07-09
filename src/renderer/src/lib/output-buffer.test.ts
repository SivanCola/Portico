import { describe, it, expect, vi } from 'vitest'
import { OutputBuffer } from './output-buffer.js'

describe('OutputBuffer', () => {
  it('coalesces chunks within the delay window', () => {
    const out: string[] = []
    let tick: (() => void) | undefined
    const buf = new OutputBuffer((s) => out.push(s), {
      delayMs: 10,
      schedule: (fn) => {
        tick = fn as () => void
        return 1 as unknown as ReturnType<typeof setTimeout>
      },
      clearSchedule: () => {
        tick = undefined
      }
    })
    buf.push('a')
    buf.push('b')
    expect(out).toEqual([])
    tick!()
    expect(out).toEqual(['ab'])
  })

  it('force-flushes when maxChunks is hit', () => {
    const out: string[] = []
    const buf = new OutputBuffer((s) => out.push(s), {
      maxChunks: 2,
      delayMs: 1000,
      schedule: () => 1 as unknown as ReturnType<typeof setTimeout>,
      clearSchedule: () => {}
    })
    buf.push('x')
    buf.push('y')
    expect(out).toEqual(['xy'])
  })

  it('flush on dispose', () => {
    const out: string[] = []
    const buf = new OutputBuffer((s) => out.push(s), {
      delayMs: 1000,
      schedule: () => 1 as unknown as ReturnType<typeof setTimeout>,
      clearSchedule: vi.fn()
    })
    buf.push('z')
    buf.dispose()
    expect(out).toEqual(['z'])
  })
})
