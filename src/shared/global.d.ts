import type { DesktopApi } from './types'

declare global {
  interface Window {
    __spriteSheetSmoke?: {
      exportGif: () => Promise<void>
      exportSequence: () => Promise<void>
      getSnapshot: () => {
        frameCount: number
        playback: {
          currentFrame: number
          fps: number
          isPlaying: boolean
        }
        sheet: {
          autoApplied: boolean
          columns: number
          enabled: boolean
          rows: number
        }
      }
      importPaths: (paths: string[]) => Promise<void>
    }
    desktopApi: DesktopApi
  }
}

export {}
