/**
 * Shared, environment-agnostic constants for Portico.
 * Safe to import from main, preload, and renderer.
 */
import { remoteBlobDir } from './channel.js'

/**
 * Directory on the remote host where uploaded blobs live.
 *
 * Channel-aware: stable uses `~/.portico/blobs`, beta uses
 * `~/.portico-beta/blobs`, so the two builds never share a cache. Resolved
 * from the compile-time channel (see `src/shared/channel.ts`).
 */
export const PORTICO_REMOTE_DIR = remoteBlobDir()

/** Version of the on-disk blob layout; bump if storage convention changes. */
export const PORTICO_BLOB_LAYOUT = 1

/** Soft size cap for a single image upload, in bytes (8 MiB). */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024

/** JPEG quality (0-100) used when recompressing oversized images. */
export const RECOMPRESS_JPEG_QUALITY = 80

/** Longest edge allowed before an image is downscaled. */
export const MAX_IMAGE_LONG_EDGE = 2560

/**
 * Max images accepted in one paste / drop / multi-file pick.
 * Caps runaway Finder multi-selects and keeps inject prompts readable.
 */
export const MAX_PASTE_IMAGES = 20

/** Image formats we accept as canonical blob extensions. */
export const SUPPORTED_IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp'] as const
export type ImageExt = (typeof SUPPORTED_IMAGE_EXTS)[number]

/**
 * Host→client sequences that clear sticky xterm modes left by Claude/tmux/etc.
 * Injected on disconnect / reconnect so mouse tracking does not keep dumping
 * SGR reports (e.g. `35;2;16M…`) into the new PTY as keyboard input.
 */
export const XTERM_MODE_SOFT_RESET =
  // Mouse tracking (X10 / VT200 / any-event / UTF-8 / SGR / urxvt)
  '\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1005l\x1b[?1006l\x1b[?1015l' +
  // Bracketed paste
  '\x1b[?2004l' +
  // Normal cursor keys, show cursor, leave alt screen, enable autowrap
  '\x1b[?1l\x1b[?25h\x1b[?1049l\x1b[?7h'
