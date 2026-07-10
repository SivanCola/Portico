/**
 * Clipboard + image normalization (main process only).
 *
 * Reads the Electron clipboard (nativeImage) and produces a NormalizedImage:
 *  - PNG sources are kept as PNG when under the byte cap.
 *  - Oversized images are downscaled (long edge) and recompressed to JPEG so
 *    they fit the upload cap; if they still exceed the cap they are rejected
 *    with a clear message.
 *
 * Also handles *copied image file(s)* from the clipboard (e.g. Finder multi-
 * select copy), reading and normalizing those files instead.
 */
import { clipboard, nativeImage } from 'electron'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_LONG_EDGE,
  MAX_PASTE_IMAGES,
  RECOMPRESS_JPEG_QUALITY,
  SUPPORTED_IMAGE_EXTS,
  type ImageExt
} from '@shared/constants.js'
import type { NormalizedImage } from '@shared/types.js'

export function clipboardHasImage(): boolean {
  // Prefer a real bitmap; also treat copied image *file(s)* as present.
  const img = clipboard.readImage()
  if (!img.isEmpty()) return true
  return filePathsFromClipboard().some(isSupportedImagePath)
}

/** Read whatever single image the clipboard currently holds, or null. */
export async function readClipboardImage(): Promise<NormalizedImage | null> {
  const imgs = await readClipboardImages()
  return imgs[0] ?? null
}

/**
 * Read all images currently on the clipboard.
 *
 * Priority:
 *  1. Two or more copied image files → load each file (Finder multi-select).
 *  2. Otherwise a direct bitmap (screenshot / "Copy Image").
 *  3. Otherwise a single copied image file.
 */
export async function readClipboardImages(): Promise<NormalizedImage[]> {
  const paths = filePathsFromClipboard().filter(isSupportedImagePath)

  // Multi-file copy: ignore any thumbnail bitmap and load every image file.
  if (paths.length > 1) {
    const limited = paths.slice(0, MAX_PASTE_IMAGES)
    const out: NormalizedImage[] = []
    for (const p of limited) {
      try {
        const norm = await readImageFile(p)
        if (norm) out.push(norm)
      } catch {
        /* skip unreadable files */
      }
    }
    return out
  }

  // 1) Direct bitmap (screenshot, "Copy Image" from an app).
  const ni = clipboard.readImage()
  if (!ni.isEmpty()) {
    return [normalizeNative(ni)]
  }

  // 2) Single copied image *file*.
  if (paths.length === 1) {
    try {
      const norm = await readImageFile(paths[0])
      if (norm) return [norm]
    } catch {
      /* not a readable image file */
    }
  }
  return []
}

/**
 * Best-effort detection of a single copied file path (first image-or-any path).
 * Prefer `filePathsFromClipboard` when multi-select matters.
 */
export function filePathFromClipboard(): string | null {
  return filePathsFromClipboard()[0] ?? null
}

/**
 * All filesystem paths present on the clipboard (deduped, order preserved).
 * Sources: macOS file-url / NSFilenames, Linux/Windows URI-list, FileName(W).
 */
export function filePathsFromClipboard(): string[] {
  const seen = new Set<string>()
  const out: string[] = []

  const push = (p: string | null | undefined) => {
    if (!p) return
    if (seen.has(p)) return
    seen.add(p)
    out.push(p)
  }

  const tryFormats = [
    'public.file-url', // macOS (often first file only)
    'text/uri-list', // Linux / some Windows apps / multi-line
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
      push(resolveCandidate(c))
    }
  }

  // macOS multi-file pasteboard: often a binary or XML property list of paths.
  for (const p of pathsFromNsFilenames()) {
    push(p)
  }

  return out
}

/**
 * Parse NSFilenamesPboardType (XML or binary-ish buffer) for absolute paths.
 * Best-effort; no external plist dependency.
 */
function pathsFromNsFilenames(): string[] {
  const found: string[] = []

  // Text form (XML plist) when Electron can decode it.
  const asText = readClipboardTextFormat('NSFilenamesPboardType')
  if (asText) {
    found.push(...extractPathsFromPlistText(asText))
  }

  // Binary buffer form (common on modern macOS).
  try {
    const buf = clipboard.readBuffer('NSFilenamesPboardType')
    if (buf && buf.byteLength > 0) {
      const text = buf.toString('utf8')
      // XML plist embedded in buffer
      if (text.includes('<plist') || text.includes('<string>')) {
        found.push(...extractPathsFromPlistText(text))
      } else {
        found.push(...extractAbsolutePathsFromBinary(buf))
      }
    }
  } catch {
    /* format unsupported */
  }

  return found
}

/** Pull `<string>/abs/path</string>` entries from an XML plist. */
export function extractPathsFromPlistText(text: string): string[] {
  const out: string[] = []
  const re = /<string>([^<]+)<\/string>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const raw = m[1].trim()
    // Unescape minimal XML entities.
    const decoded = raw
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
    const resolved = resolveCandidate(decoded) ?? (decoded.startsWith('/') ? decoded : null)
    if (resolved) out.push(resolved)
  }
  return out
}

/**
 * Scan a binary plist-ish buffer for absolute path strings that look like
 * filesystem paths (macOS NSFilenames). Conservative regex; may miss odd paths.
 */
export function extractAbsolutePathsFromBinary(buf: Buffer): string[] {
  const text = buf.toString('utf8')
  const out: string[] = []
  const seen = new Set<string>()
  // Absolute Unix paths; stop at C0 controls / high controls used as separators.
  const re = /(\/(?:[^\x00-\x1f]+)+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const candidate = m[1].replace(/\0+$/, '').trim()
    if (!candidate || seen.has(candidate)) continue
    // Skip obvious non-paths (plist type tags etc.)
    if (candidate.length < 2) continue
    if (!candidate.includes('/')) continue
    seen.add(candidate)
    out.push(candidate)
  }
  return out
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
