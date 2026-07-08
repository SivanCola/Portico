import { describe, it, expect } from 'vitest'
import { ok, err, isErr, unwrap } from './result.js'

describe('result helpers', () => {
  it('ok carries the value', () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 })
  })

  it('err carries a coded error', () => {
    expect(err('NO_IMAGE', 'empty')).toEqual({
      ok: false,
      error: { code: 'NO_IMAGE', message: 'empty' }
    })
  })

  it('isErr narrows', () => {
    expect(isErr(ok(1))).toBe(false)
    expect(isErr(err('X', 'y'))).toBe(true)
  })

  it('unwrap returns the value for ok and throws for err', () => {
    expect(unwrap(ok('v'))).toBe('v')
    let threw = false
    try {
      unwrap(err('CODE', 'boom'))
    } catch (e) {
      threw = true
      expect((e as Error).message).toBe('boom')
      expect((e as Error & { code: string }).code).toBe('CODE')
    }
    expect(threw).toBe(true)
  })
})
