/**
 * Blob uploader.
 *
 * Turns a NormalizedImage into a remote UploadedBlob:
 *   1. validate size against the soft cap,
 *   2. sha256 the bytes (content-addressed),
 *   3. skip the network round-trip when the blob already exists remotely,
 *   4. otherwise upload via SFTP, atomically (temp + rename).
 *
 * Because names are content-addressed, re-uploading the same image is a no-op.
 */
import {
  MAX_IMAGE_BYTES,
  PORTICO_REMOTE_DIR,
  type ImageExt
} from '@shared/constants.js'
import { blobPath, sha256Hex } from '@shared/hash.js'
import type { NormalizedImage, UploadedBlob } from '@shared/types.js'
import type { SshSession } from './ssh-session.js'
import { getLogger } from './logger.js'

const log = getLogger()

export interface UploadResult {
  blob: UploadedBlob
  /** true if the file was actually written this call; false if it pre-existed. */
  transferred: boolean
}

export async function uploadBlob(
  session: SshSession,
  img: NormalizedImage,
  onProgress?: (sent: number, total: number) => void
): Promise<UploadResult> {
  if (img.data.byteLength > MAX_IMAGE_BYTES) {
    log.warn('upload', 'image rejected as too large', { bytes: img.data.byteLength, limit: MAX_IMAGE_BYTES })
    throw Object.assign(
      new Error(
        `Image is ${(img.data.byteLength / 1024 / 1024).toFixed(1)} MiB; limit is ${(
          MAX_IMAGE_BYTES /
          1024 /
          1024
        ).toFixed(0)} MiB. Recompress or capture a smaller region.`
      ),
      { code: 'IMAGE_TOO_LARGE' }
    )
  }

  const hash = sha256Hex(img.data)
  const relPath = blobPath(PORTICO_REMOTE_DIR, hash, img.ext)
  const absPath = session.resolveRemote(relPath)
  const remotePath = relPath // convention: report the ~ form to providers

  // Idempotency: stat first; if present, skip the upload entirely.
  const exists = await remoteExists(session, absPath)
  let transferred = false
  if (!exists) {
    log.info('upload', 'uploading blob', { hash, bytes: img.data.byteLength, ext: img.ext })
    onProgress?.(0, img.data.byteLength)
    await session.uploadBuffer(img.data, absPath)
    onProgress?.(img.data.byteLength, img.data.byteLength)
    transferred = true
  }

  const blob: UploadedBlob = {
    remotePath,
    hash,
    ext: img.ext as ImageExt,
    bytes: img.data.byteLength
  }
  return { blob, transferred }
}

/** Stat a remote path via SFTP; resolves false on any "not found" failure. */
async function remoteExists(session: SshSession, absPath: string): Promise<boolean> {
  try {
    // Use the exec path to avoid forcing an SFTP channel just for a probe when
    // one isn't open yet; if SFTP is already open this still works fine.
    const out = await session.runAndCapture(`test -f ${shellSingle(absPath)} && echo yes || echo no`)
    return out.trim() === 'yes'
  } catch {
    return false
  }
}

/** Minimal single-quote for embedding a path inside an ssh `test -f` command. */
function shellSingle(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}
