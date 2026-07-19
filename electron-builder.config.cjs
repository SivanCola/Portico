/**
 * electron-builder configuration, parameterized by release channel.
 *
 * Usage:
 *   PORTICO_RELEASE_CHANNEL=beta npm run dist:beta
 *   PORTICO_RELEASE_CHANNEL=stable npm run dist:stable   (default)
 *
 * Channel drives:
 *   - appId   (com.portico.app vs com.portico.app.beta)
 *   - productName (Portico vs Portico Beta)
 *   - output dir (dist/stable vs dist/beta)
 *   - publish channel (latest vs beta) on the GitHub provider
 *
 * The GitHub owner/repo is resolved automatically by electron-builder from the
 * git origin (SivanCola/Portico), so we don't hardcode it here.
 */
'use strict'

/** @returns {'stable' | 'beta'} */
function resolveChannel() {
  const raw = (process.env.PORTICO_RELEASE_CHANNEL || 'stable').toLowerCase()
  return raw === 'beta' ? 'beta' : 'stable'
}

const CHANNEL = resolveChannel()

const APP_ID = {
  stable: 'com.portico.app',
  beta: 'com.portico.app.beta'
}

const PRODUCT_NAME = {
  stable: 'Portico',
  beta: 'Portico Beta'
}

const UPDATE_CHANNEL = {
  stable: 'latest',
  beta: 'beta'
}

/** @type {import('electron-builder').Configuration} */
const config = {
  appId: APP_ID[CHANNEL],
  productName: PRODUCT_NAME[CHANNEL],
  // build/icon.png + build/icon.icns — Portico gateway mark
  directories: {
    output: `dist/${CHANNEL}`,
    buildResources: 'build'
  },
  icon: 'build/icon.png',
  // electron-vite externalizeDepsPlugin leaves runtime deps (ssh2, node-pty,
  // electron-updater, …) as bare imports. They MUST ship in node_modules —
  // never exclude them here (that caused ERR_MODULE_NOT_FOUND for ssh2).
  // electron-builder still prunes devDependencies from the production set.
  files: ['out/**/*', 'package.json'],
  // Native addons cannot load from asar; unpack them to app.asar.unpacked.
  asarUnpack: [
    '**/node_modules/node-pty/**/*',
    '**/node_modules/cpu-features/**/*',
    '**/node_modules/ssh2/**/*.node'
  ],
  // Always emit per-channel updater metadata (latest.yml / beta.yml) and the
  // blockmap files so the auto-updater has everything it needs on both channels.
  generateUpdatesFilesForAllChannels: true,
  publish: {
    provider: 'github',
    // Explicit channel: GitHub releases do not honor the version's prerelease
    // tag for updater-feed detection, so we must state it per build.
    channel: UPDATE_CHANNEL[CHANNEL]
  },
  mac: {
    icon: 'build/icon.icns',
    target: [
      { target: 'dmg', arch: ['x64', 'arm64'] },
      { target: 'zip', arch: ['x64', 'arm64'] }
    ],
    category: 'public.app-category.developer-tools'
  },
  win: {
    icon: 'build/icon.png',
    target: [{ target: 'nsis', arch: ['x64'] }]
  },
  linux: {
    icon: 'build/icon.png',
    // Required by fpm/.deb when packaging on CI (maintainer email).
    maintainer: 'SivanCola <liuxw96@foxmail.com>',
    target: [
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb', arch: ['x64'] }
    ],
    category: 'Development'
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true
  }
}

module.exports = config
