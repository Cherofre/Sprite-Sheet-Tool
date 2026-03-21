import type { DesktopApi } from './types'

declare global {
  interface Window {
    desktopApi: DesktopApi
  }
}

export {}
