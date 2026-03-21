import type { DesktopApi } from './types'

declare global {
  interface Window {
    __spriteSheetSmoke?: {
      exportSequence: () => Promise<void>
      importPaths: (paths: string[]) => Promise<void>
    }
    desktopApi: DesktopApi
  }
}

export {}
