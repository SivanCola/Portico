import { describe, it, expect } from 'vitest'
import { applySessionOrder, moveSessionId } from './session-order.js'

describe('applySessionOrder', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  it('returns original when order empty', () => {
    expect(applySessionOrder(items, [])).toEqual(items)
  })

  it('reorders known ids and appends new ones', () => {
    expect(applySessionOrder(items, ['c', 'a'])).toEqual([
      { id: 'c' },
      { id: 'a' },
      { id: 'b' }
    ])
  })

  it('ignores stale ids in order', () => {
    expect(applySessionOrder(items, ['x', 'b', 'a'])).toEqual([
      { id: 'b' },
      { id: 'a' },
      { id: 'c' }
    ])
  })
})

describe('moveSessionId', () => {
  const ids = ['a', 'b', 'c', 'd']

  it('moves before target', () => {
    expect(moveSessionId(ids, 'd', 'b', 'before')).toEqual(['a', 'd', 'b', 'c'])
  })

  it('moves after target', () => {
    expect(moveSessionId(ids, 'a', 'c', 'after')).toEqual(['b', 'c', 'a', 'd'])
  })

  it('no-ops same id', () => {
    expect(moveSessionId(ids, 'b', 'b', 'before')).toBe(ids)
  })

  it('no-ops unknown id', () => {
    expect(moveSessionId(ids, 'z', 'a', 'before')).toBe(ids)
  })
})
