import { describe, it, expect } from 'vitest'
import {
  Osc52Filter,
  decodeBase64Utf8,
  encodeOsc52
} from './osc52.js'

describe('decodeBase64Utf8', () => {
  it('decodes UTF-8 text', () => {
    const b64 = Buffer.from('hello 世界', 'utf8').toString('base64')
    expect(decodeBase64Utf8(b64)).toBe('hello 世界')
  })
  it('rejects garbage', () => {
    expect(decodeBase64Utf8('$$$')).toBeNull()
  })
})

describe('Osc52Filter', () => {
  it('extracts clipboard write and strips from passthrough', () => {
    const f = new Osc52Filter()
    const seq = encodeOsc52('remote copy')
    const r = f.feed(`before${seq}after`)
    expect(r.clipboardWrites).toEqual(['remote copy'])
    expect(r.passthrough).toBe('beforeafter')
  })

  it('handles ST terminator', () => {
    const f = new Osc52Filter()
    const seq = encodeOsc52('st-term', 'c', false)
    const r = f.feed(seq)
    expect(r.clipboardWrites).toEqual(['st-term'])
    expect(r.passthrough).toBe('')
  })

  it('holds incomplete sequences across chunks', () => {
    const f = new Osc52Filter()
    const full = encodeOsc52('split')
    const mid = Math.floor(full.length / 2)
    const r1 = f.feed('x' + full.slice(0, mid))
    expect(r1.clipboardWrites).toEqual([])
    expect(r1.passthrough).toBe('x')
    const r2 = f.feed(full.slice(mid) + 'y')
    expect(r2.clipboardWrites).toEqual(['split'])
    expect(r2.passthrough).toBe('y')
  })

  it('ignores query form', () => {
    const f = new Osc52Filter()
    const r = f.feed('\x1b]52;c;?\x07')
    expect(r.clipboardWrites).toEqual([])
  })

  it('treats empty Pd as clear', () => {
    const f = new Osc52Filter()
    const r = f.feed('\x1b]52;c;\x07')
    expect(r.clipboardWrites).toEqual([''])
  })

  it('accepts empty Pc as clipboard', () => {
    const f = new Osc52Filter()
    const b64 = Buffer.from('ok', 'utf8').toString('base64')
    const r = f.feed(`\x1b]52;;${b64}\x07`)
    expect(r.clipboardWrites).toEqual(['ok'])
  })
})
