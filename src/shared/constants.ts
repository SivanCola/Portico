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

/** Image formats we accept as canonical blob extensions. */
export const SUPPORTED_IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp'] as const
export type ImageExt = (typeof SUPPORTED_IMAGE_EXTS)[number]
