import { describe, it, expect } from 'vitest'
import {
  APP_ID,
  APP_NAME,
  REMOTE_BLOB_DIR,
  UPDATE_CHANNEL,
  allowPrerelease,
  appName,
  channelFromVersion,
  remoteBlobDir,
  updateChannel,
  type ReleaseChannel
} from './channel.js'

describe('channelFromVersion', () => {
  it('classifies a plain semver as stable', () => {
    expect(channelFromVersion('0.1.1')).toBe('stable')
    expect(channelFromVersion('1.0.0')).toBe('stable')
  })

  it('classifies a v-prefixed tag as stable', () => {
    expect(channelFromVersion('v0.1.1')).toBe('stable')
    expect(channelFromVersion('v2.3.4')).toBe('stable')
  })

  it('classifies a -beta.N suffix as beta', () => {
    expect(channelFromVersion('0.1.1-beta.1')).toBe('beta')
    expect(channelFromVersion('v0.1.1-beta.2')).toBe('beta')
    expect(channelFromVersion('1.0.0-beta.10')).toBe('beta')
  })

  it('classifies a bare -beta suffix as beta', () => {
    expect(channelFromVersion('0.1.1-beta')).toBe('beta')
    expect(channelFromVersion('v1.0.0-beta')).toBe('beta')
  })

  it('treats non-beta prereleases as stable (alpha, rc are out of scope)', () => {
    expect(channelFromVersion('1.0.0-alpha.1')).toBe('stable')
    expect(channelFromVersion('1.0.0-rc.1')).toBe('stable')
  })

  it('is case-insensitive on the prerelease tag', () => {
    expect(channelFromVersion('0.1.1-BETA.3')).toBe('beta')
    expect(channelFromVersion('v0.1.1-Beta.1')).toBe('beta')
  })
})

describe('remote blob dir isolation', () => {
  it('stable and beta use distinct directories', () => {
    expect(REMOTE_BLOB_DIR.stable).toBe('~/.portico/blobs')
    expect(REMOTE_BLOB_DIR.beta).toBe('~/.portico-beta/blobs')
    expect(REMOTE_BLOB_DIR.stable).not.toBe(REMOTE_BLOB_DIR.beta)
  })

  it('remoteBlobDir maps each channel to its dir', () => {
    expect(remoteBlobDir('stable')).toBe('~/.portico/blobs')
    expect(remoteBlobDir('beta')).toBe('~/.portico-beta/blobs')
  })
})

describe('app identity per channel', () => {
  it('stable and beta have different names and appIds', () => {
    expect(APP_NAME.stable).toBe('Portico')
    expect(APP_NAME.beta).toBe('Portico Beta')
    expect(APP_ID.stable).toBe('com.portico.app')
    expect(APP_ID.beta).toBe('com.portico.app.beta')
  })

  it('appName() returns the name for a given channel', () => {
    expect(appName('stable')).toBe('Portico')
    expect(appName('beta')).toBe('Portico Beta')
  })
})

describe('update channel mapping', () => {
  it('stable maps to latest, beta maps to beta', () => {
    expect(UPDATE_CHANNEL.stable).toBe('latest')
    expect(UPDATE_CHANNEL.beta).toBe('beta')
    expect(updateChannel('stable')).toBe('latest')
    expect(updateChannel('beta')).toBe('beta')
  })
})

describe('allowPrerelease', () => {
  it('is false for stable and true for beta', () => {
    expect(allowPrerelease('stable' as ReleaseChannel)).toBe(false)
    expect(allowPrerelease('beta' as ReleaseChannel)).toBe(true)
  })
})
