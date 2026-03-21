import type { ExportSettings, PlaybackSettings } from '@shared/types'

import { buildPaddedIndex } from '@lib/fs/fileNames'

import { buildFrameSequence } from '@features/preview/frameSequence'

export const buildSampledIndices = (frameCount: number, skip: number): number[] => {
  const stride = Math.max(1, skip + 1)
  const indices: number[] = []

  for (let index = 0; index < frameCount; index += stride) {
    indices.push(index)
  }

  return indices
}

export const buildExportSequence = (
  frameCount: number,
  playback: PlaybackSettings,
  exportSettings: ExportSettings
): number[] =>
  buildFrameSequence(
    frameCount,
    playback.startFrame,
    playback.endFrame,
    exportSettings.exportSkip,
    playback.reverse
  )

export const buildExportFileName = (
  prefix: string,
  position: number,
  padding: number,
  extension: string
): string => `${prefix}_${buildPaddedIndex(position + 1, padding)}.${extension}`
