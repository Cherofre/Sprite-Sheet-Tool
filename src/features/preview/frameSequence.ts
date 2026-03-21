import type { LoopMode } from '@shared/types'

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

export const normalizeFrameRange = (frameCount: number, startFrame: number, endFrame: number) => {
  if (frameCount <= 0) {
    return {
      endFrame: 0,
      startFrame: 0
    }
  }

  const maxFrame = frameCount - 1
  const normalizedStart = clamp(startFrame, 0, maxFrame)
  const normalizedEnd = clamp(Math.max(endFrame, normalizedStart), normalizedStart, maxFrame)

  return {
    endFrame: normalizedEnd,
    startFrame: normalizedStart
  }
}

export const buildFrameSequence = (
  frameCount: number,
  startFrame: number,
  endFrame: number,
  skip: number,
  reverse: boolean
): number[] => {
  if (frameCount <= 0) {
    return []
  }

  const { endFrame: normalizedEnd, startFrame: normalizedStart } = normalizeFrameRange(frameCount, startFrame, endFrame)
  const stride = Math.max(1, skip + 1)
  const frames: number[] = []

  for (let frame = normalizedStart; frame <= normalizedEnd; frame += stride) {
    frames.push(frame)
  }

  return reverse ? frames.reverse() : frames
}

export interface SequenceAdvanceResult {
  direction: 1 | -1
  position: number
  shouldStop: boolean
}

export const advanceSequencePosition = (
  sequenceLength: number,
  currentPosition: number,
  direction: 1 | -1,
  loopMode: LoopMode
): SequenceAdvanceResult => {
  if (sequenceLength <= 1) {
    return {
      direction: 1,
      position: 0,
      shouldStop: loopMode === 'once'
    }
  }

  const nextPosition = currentPosition + direction

  if (loopMode === 'loop') {
    return {
      direction,
      position: (nextPosition + sequenceLength) % sequenceLength,
      shouldStop: false
    }
  }

  if (loopMode === 'once') {
    if (nextPosition < 0 || nextPosition >= sequenceLength) {
      return {
        direction,
        position: clamp(currentPosition, 0, sequenceLength - 1),
        shouldStop: true
      }
    }

    return {
      direction,
      position: nextPosition,
      shouldStop: false
    }
  }

  if (nextPosition < 0 || nextPosition >= sequenceLength) {
    return {
      direction: (direction * -1) as 1 | -1,
      position: clamp(currentPosition + direction * -1, 0, sequenceLength - 1),
      shouldStop: false
    }
  }

  return {
    direction,
    position: nextPosition,
    shouldStop: false
  }
}
