import type { FrameItem } from '@shared/types'

export const canEditFrameSourceFile = (frame: FrameItem): boolean =>
  frame.sourceType === 'file' && typeof frame.sourcePath === 'string' && frame.sourcePath.trim().length > 0

export const buildExternalEditTempFileName = (frame: FrameItem): string => `${frame.name || 'frame'}.png`

export const buildReinjectedFrame = (originalFrame: FrameItem, nextFrame: FrameItem, sourcePath: string): FrameItem => ({
  ...nextFrame,
  id: originalFrame.id,
  name: originalFrame.name,
  sourcePath,
  sourceType: 'file'
})
