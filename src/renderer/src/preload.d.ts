import type { PorticoApi } from '@shared/ipc.js'

declare global {
  interface Window {
    portico: PorticoApi
  }
}

export {}
