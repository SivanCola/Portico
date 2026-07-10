import { describe, it, expect } from 'vitest'
import {
  DEFAULT_IMAGE_PROMPT_MULTI,
  DEFAULT_IMAGE_PROMPT_SINGLE,
  isStockImagePrompt,
  resolveImagePrompt,
  suggestCommitPrompt
} from './image-prompt.js'

describe('resolveImagePrompt', () => {
  it('uses singular stock when empty and one image', () => {
    expect(resolveImagePrompt('', 1)).toBe(DEFAULT_IMAGE_PROMPT_SINGLE)
    expect(resolveImagePrompt(undefined, 1)).toBe(DEFAULT_IMAGE_PROMPT_SINGLE)
  })

  it('uses plural stock when empty and multiple images', () => {
    expect(resolveImagePrompt('', 3)).toBe(DEFAULT_IMAGE_PROMPT_MULTI)
    expect(resolveImagePrompt(undefined, 2)).toBe(DEFAULT_IMAGE_PROMPT_MULTI)
  })

  it('upgrades stock singular to multi when count > 1', () => {
    expect(resolveImagePrompt(DEFAULT_IMAGE_PROMPT_SINGLE, 2)).toBe(DEFAULT_IMAGE_PROMPT_MULTI)
    expect(resolveImagePrompt('分析这张图片', 2)).toBe(DEFAULT_IMAGE_PROMPT_MULTI)
  })

  it('downgrades stock multi to singular when count is 1', () => {
    expect(resolveImagePrompt(DEFAULT_IMAGE_PROMPT_MULTI, 1)).toBe(DEFAULT_IMAGE_PROMPT_SINGLE)
  })

  it('keeps custom prompts unchanged', () => {
    expect(resolveImagePrompt('Fix the navbar spacing', 3)).toBe('Fix the navbar spacing')
    expect(resolveImagePrompt('对比这两张图的布局', 2)).toBe('对比这两张图的布局')
  })

  it('uses custom settings default when field is empty', () => {
    expect(resolveImagePrompt('', 1, 'Review this screenshot')).toBe('Review this screenshot')
    // Custom settings are not auto-pluralized (user chose the phrase).
    expect(resolveImagePrompt('', 2, 'Review this screenshot')).toBe('Review this screenshot')
  })

  it('treats settings stock default as stock when multi', () => {
    expect(resolveImagePrompt(DEFAULT_IMAGE_PROMPT_SINGLE, 2, DEFAULT_IMAGE_PROMPT_SINGLE)).toBe(
      DEFAULT_IMAGE_PROMPT_MULTI
    )
  })
})

describe('isStockImagePrompt', () => {
  it('detects empty and built-ins', () => {
    expect(isStockImagePrompt('')).toBe(true)
    expect(isStockImagePrompt(DEFAULT_IMAGE_PROMPT_SINGLE)).toBe(true)
    expect(isStockImagePrompt(DEFAULT_IMAGE_PROMPT_MULTI)).toBe(true)
    expect(isStockImagePrompt('  analyze this image  ')).toBe(true)
    expect(isStockImagePrompt('Look here')).toBe(false)
  })
})

describe('suggestCommitPrompt', () => {
  it('rewrites stock when staged count changes', () => {
    expect(suggestCommitPrompt(DEFAULT_IMAGE_PROMPT_SINGLE, 3, DEFAULT_IMAGE_PROMPT_SINGLE)).toBe(
      DEFAULT_IMAGE_PROMPT_MULTI
    )
  })

  it('does not rewrite custom text', () => {
    expect(suggestCommitPrompt('My custom note', 3, DEFAULT_IMAGE_PROMPT_SINGLE)).toBe(
      'My custom note'
    )
  })
})
