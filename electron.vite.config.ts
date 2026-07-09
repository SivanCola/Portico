import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

/**
 * Compile-time release channel.
 *
 * `PORTICO_RELEASE_CHANNEL=beta npm run dev:beta` (or build:beta) injects the
 * string `'beta'` here so shared/main/renderer code branches on a constant that
 * is tree-shaken per build. Defaults to `'stable'`.
 */
const RELEASE_CHANNEL = process.env['PORTICO_RELEASE_CHANNEL'] === 'beta' ? 'beta' : 'stable'

const channelDefine = {
  // Consumed by src/shared/channel.ts via globalThis.__PORTICO_CHANNEL__.
  // `JSON.stringify` keeps it a proper string literal in the output.
  'globalThis.__PORTICO_CHANNEL__': JSON.stringify(RELEASE_CHANNEL)
}

export default defineConfig({
  main: {
    define: channelDefine,
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    }
  },
  preload: {
    define: channelDefine,
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    }
  },
  renderer: {
    define: channelDefine,
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@renderer': resolve(__dirname, 'src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
