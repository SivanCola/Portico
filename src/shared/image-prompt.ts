/**
 * Default image-send prompt wording (single vs multi).
 *
 * Used by adapters, commit path, and the Image Shelf commit bar so the stock
 * singular default does not get injected when the user staged multiple images.
 */

/** Built-in English defaults (also the app-settings factory default). */
export const DEFAULT_IMAGE_PROMPT_SINGLE = 'Analyze this image'
export const DEFAULT_IMAGE_PROMPT_MULTI = 'Analyze these images'

/** Common localized / legacy stock singular prompts that auto-pluralize. */
const STOCK_SINGLE = new Set([
  DEFAULT_IMAGE_PROMPT_SINGLE.toLowerCase(),
  '分析这张图片',
  '分析这张图',
  '分析此图片'
])

/** Common stock multi prompts (kept as multi, singularized when only 1 image). */
const STOCK_MULTI = new Set([
  DEFAULT_IMAGE_PROMPT_MULTI.toLowerCase(),
  '分析这些图片',
  '分析这些图'
])

function norm(s: string): string {
  return s.trim().replace(/\s+/g, ' ')
}

function isStockSingle(t: string): boolean {
  return STOCK_SINGLE.has(t) || STOCK_SINGLE.has(t.toLowerCase())
}

function isStockMulti(t: string): boolean {
  return STOCK_MULTI.has(t) || STOCK_MULTI.has(t.toLowerCase())
}

/** True when the text is empty or a built-in single/multi default (not custom). */
export function isStockImagePrompt(prompt: string | undefined | null): boolean {
  if (prompt == null) return true
  const t = norm(prompt)
  if (!t) return true
  return isStockSingle(t) || isStockMulti(t)
}

/**
 * Resolve the prompt that should be injected for `imageCount` images.
 *
 * Rules:
 *  1. Empty / undefined → stock single or multi by count
 *  2. Stock singular + multi images → stock multi (and vice versa for 1 image)
 *  3. Settings default that is stock is treated like stock
 *  4. Any custom text (user-edited or custom settings) is kept as-is
 *
 * @param prompt          Text from the commit bar (may be empty)
 * @param imageCount      Number of images being sent
 * @param settingsDefault User's Settings "default send prompt"
 */
export function resolveImagePrompt(
  prompt: string | undefined | null,
  imageCount: number,
  settingsDefault: string = DEFAULT_IMAGE_PROMPT_SINGLE
): string {
  const multi = imageCount > 1
  const stock = multi ? DEFAULT_IMAGE_PROMPT_MULTI : DEFAULT_IMAGE_PROMPT_SINGLE
  const trimmed = prompt == null ? '' : norm(prompt)
  const settings = norm(settingsDefault)

  // Nothing typed — fall back to settings when custom, else stock by count.
  if (!trimmed) {
    if (settings && !isStockImagePrompt(settings)) return settings
    return stock
  }

  // Stock wording (or equals stock settings default) → adapt to image count.
  if (isStockImagePrompt(trimmed) || (settings && trimmed === settings && isStockImagePrompt(settings))) {
    return stock
  }

  // Custom prompt — keep verbatim.
  return trimmed
}

/**
 * Suggested prompt text for the commit bar when staged count changes.
 * Only rewrites when the current field is empty or still a stock default.
 */
export function suggestCommitPrompt(
  current: string,
  stagedCount: number,
  settingsDefault: string
): string {
  if (!isStockImagePrompt(current) && norm(current) !== norm(settingsDefault)) {
    return current
  }
  return resolveImagePrompt(current, stagedCount, settingsDefault)
}
