/**
 * Clipboard + image normalization (main process only).
 *
 * Reads the Electron clipboard (nativeImage) and produces a NormalizedImage:
 *  - PNG sources are kept as PNG when under the byte cap.
 *  - Oversized images are downscaled (long edge) and recompressed to JPEG so
 *    they fit the upload cap; if they still exceed the cap they are rejected
 *    with a clear message.
 *
 * Also handles a *copied image file* path from the clipboard (e.g. Finder copy),
 * reading and normalizing that file instead.
 */
import { clipboard, nativeImage } from 'electron'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_LONG_EDGE,
  RECOMPRESS_JPEG_QUALITY,
  SUPPORTED_IMAGE_EXTS,
  type ImageExt
} from '@shared/constants.js'
import type { NormalizedImage } from '@shared/types.js'

export function clipboardHasImage(): boolean {
  // Prefer a real bitmap; also treat a copied image *file* as present.
  const img = clipboard.readImage()
  if (!img.isEmpty()) return true
  const path = filePathFromClipboard()
  if (!path) return false
  return isSupportedImagePath(path)
}

/** Read whatever image the clipboard currently holds, or null. */
export async function readClipboardImage(): Promise<NormalizedImage | null> {
  // 1) Direct bitmap (screenshot, "Copy Image" from an app).
  const ni = clipboard.readImage()
  if (!ni.isEmpty()) {
    return normalizeNative(ni)
  }

  // 2) Copied image *file* (Finder/Explorer "Copy"): try the common clipboard
  //    formats across platforms and read the referenced file from disk.
  const path = filePathFromClipboard()
  if (path) {
    try {
      const norm = await readImageFile(path)
      if (norm) return norm
    } catch {
      /* not a readable image file — fall through */
    }
  }
  return null
}

/**
 * Best-effort detection of a copied file path from the clipboard.
 * macOS exposes `public.file-url`; Windows/Linux expose text/URI-list or a
 * bare path. Returns null when nothing usable is present.
 */
export function filePathFromClipboard(): string | null {
  const tryFormats = [
    'public.file-url', // macOS
    'text/uri-list', // Linux / some Windows apps
    'FileNameW', // Windows
    'FileName' // Windows (ANSI / short path)
  ]
  for (const fmt of tryFormats) {
    const raw = readClipboardTextFormat(fmt)
    if (!raw) continue
    const candidates = raw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      // Skip URI-list comments.
      .filter((s) => !s.startsWith('#'))
    for (const c of candidates) {
      const resolved = resolveCandidate(c)
      if (resolved) return resolved
    }
  }
  return null
}

/** Read a clipboard text format portably; returns '' when unsupported. */
function readClipboardTextFormat(fmt: string): string {
  try {
    // `clipboard.read(format)` exists on all platforms; unsupported formats
    // yield an empty string rather than throwing.
    return clipboard.read(fmt)
  } catch {
    return ''
  }
}

/**
 * Turn a clipboard candidate (file URL or bare path) into a filesystem path.
 * Exported for unit tests — Windows `file:///C:/...` must not keep a leading `/`.
 */
export function resolveCandidate(c: string): string | null {
  if (c.startsWith('file:')) {
    let path: string | null = null
    try {
      // fileURLToPath correctly maps file:///Users/... → /Users/...
      // On Windows hosts it also maps file:///C:/... → C:\...
      // On Unix hosts the same Windows URL becomes "/C:/..." — normalize below.
      path = fileURLToPath(c)
    } catch {
      try {
        path = decodeURIComponent(new URL(c).pathname)
      } catch {
        return null
      }
    }
    return normalizeFsPath(path)
  }
  // Treat as a bare filesystem path if it looks absolute.
  if (c.startsWith('/')) return normalizeFsPath(c)
  // Windows drive path e.g. C:\...
  if (/^[A-Za-z]:[\\/]/.test(c)) return c
  return null
}

/** Strip a spurious leading slash before a Windows drive letter (Unix hosts). */
function normalizeFsPath(path: string): string {
  if (/^\/[A-Za-z]:[\\/]/.test(path)) return path.slice(1)
  return path
}

function isSupportedImagePath(path: string): boolean {
  const e = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  return (SUPPORTED_IMAGE_EXTS as readonly string[]).includes(e)
}

/** Read & normalize an image file from disk by path. */
export async function readImageFile(path: string): Promise<NormalizedImage | null> {
  const data = await readFile(path)
  const ni = nativeImage.createFromBuffer(data)
  if (ni.isEmpty()) return null
  const ext = extFromName(basename(path))
  return normalizeNative(ni, ext, basename(path))
}

function extFromName(name: string): ImageExt {
  const e = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  return (SUPPORTED_IMAGE_EXTS as readonly string[]).includes(e) ? (e as ImageExt) : 'png'
}

/** Normalize a nativeImage into bytes + metadata, recompressing if oversized. */
function normalizeNative(
  ni: Electron.NativeImage,
  preferExt: ImageExt = 'png',
  originalName?: string
): NormalizedImage {
  const size = ni.getSize()
  let img = ni

  // Downscale if the long edge exceeds the cap. (Only when bitmap is large.)
  const longEdge = Math.max(size.width, size.height)
  if (longEdge > MAX_IMAGE_LONG_EDGE) {
    const scale = MAX_IMAGE_LONG_EDGE / longEdge
    img = ni.resize({
      width: Math.max(1, Math.round(size.width * scale)),
      height: Math.max(1, Math.round(size.height * scale)),
      quality: 'good'
    })
  }

  // Keep PNG under the byte cap; otherwise JPEG. (preferExt used to bypass the
  // size check for PNG sources and could upload >8MiB blobs.)
  void preferExt
  let data: Buffer
  let ext: ImageExt
  const png = img.toPNG()
  if (png.byteLength <= MAX_IMAGE_BYTES) {
    data = png
    ext = 'png'
  } else {
    data = img.toJPEG(RECOMPRESS_JPEG_QUALITY)
    ext = 'jpg'
    if (data.byteLength > MAX_IMAGE_BYTES) {
      throw Object.assign(
        new Error(
          `Image still ${(data.byteLength / 1024 / 1024).toFixed(1)} MiB after compression; please capture a smaller region.`
        ),
        { code: 'IMAGE_TOO_LARGE' }
      )
    }
  }

  const out = img.getSize()
  return {
    data,
    ext,
    mime: ext === 'png' ? 'image/png' : 'image/jpeg',
    width: out.width,
    height: out.height,
    originalName
  }
}
