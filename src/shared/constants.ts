import type { BackgroundMode, ExportImageFormat, LoopMode } from './types'

export const APP_NAME = '序列图工具'

export const SUPPORTED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif'] as const

export const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp'
}

export const DEFAULT_PLAYBACK = {
  background: 'checker' as BackgroundMode,
  currentFrame: 0,
  endFrame: 0,
  fps: 12,
  isPlaying: false,
  loopMode: 'loop' as LoopMode,
  previewSkip: 0,
  reverse: false,
  startFrame: 0,
  zoom: 'fit' as number | 'fit'
}

export const DEFAULT_EXPORT = {
  exportSkip: 0,
  imageFormat: 'png' as ExportImageFormat,
  fileNamePrefix: 'frame',
  padding: 4,
  spriteSheetColumns: 0,
  spriteSheetRows: 0
}

export const HISTORY_LIMIT = 30

export const GRID_CANDIDATE_LIMIT = 5
