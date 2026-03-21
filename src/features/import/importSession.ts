import type { ImportedFilePayload, PlaybackSettings, ProgressCallback, SheetState } from '@shared/types'

import { DEFAULT_PLAYBACK } from '@shared/constants'

import { createEmptySheetState } from '@features/history/history'
import {
  detectGridHintFromName,
  detectRegularGrid,
  rankGridCandidatesWithInkProfiles,
  shouldAutoApplyGrid
} from '@lib/grid/detectRegularGrid'
import { decodeGifToFrames } from '@lib/image/gif'
import { filePayloadToFrame, measureImage, sampleImageInkProfiles, splitSheetToFrames } from '@lib/image/browser'
import { naturalSort } from '@lib/sort/naturalSort'

export interface ImportSession {
  frames: Awaited<ReturnType<typeof filePayloadToFrame>>[]
  playback: PlaybackSettings
  sheet: SheetState
}

const buildSheetState = async (payload: ImportedFilePayload, onProgress?: ProgressCallback): Promise<ImportSession> => {
  await onProgress?.({
    percent: 10,
    stage: 'measure-sheet'
  })
  const { height, width } = await measureImage(payload.dataUrl)

  await onProgress?.({
    percent: 25,
    stage: 'rank-grid'
  })
  const hintedCandidate = detectGridHintFromName(payload.name, width, height)
  const heuristicCandidates = detectRegularGrid(width, height)
  const contentProfiles = await sampleImageInkProfiles(payload.dataUrl)
  const rankedHeuristicCandidates = rankGridCandidatesWithInkProfiles(heuristicCandidates, contentProfiles)
  const candidates = [hintedCandidate, ...rankedHeuristicCandidates]
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
    .filter(
      (candidate, index, list) =>
        list.findIndex((item) => item.rows === candidate.rows && item.columns === candidate.columns) === index
    )
    .sort((left, right) => right.score - left.score)
  const bestCandidate = candidates[0]
  const autoApply = Boolean(hintedCandidate) || shouldAutoApplyGrid(candidates)

  const sheet: SheetState = {
    autoApplied: autoApply,
    candidates,
    columns: bestCandidate?.columns ?? 1,
    enabled: true,
    frameHeight: bestCandidate?.frameHeight ?? height,
    frameWidth: bestCandidate?.frameWidth ?? width,
    mode: 'grid',
    rows: bestCandidate?.rows ?? 1,
    source: payload,
    sourceHeight: height,
    sourceWidth: width
  }

  const frames = autoApply && bestCandidate
    ? await splitSheetToFrames(
        payload,
        bestCandidate.rows,
        bestCandidate.columns,
        bestCandidate.frameWidth,
        bestCandidate.frameHeight,
        async (progress) => {
          await onProgress?.({
            current: progress.current,
            percent: 35 + ((progress.percent ?? 0) * 0.65),
            stage: 'split-sheet',
            total: progress.total
          })
        }
      )
    : [await filePayloadToFrame(payload)]

  return {
    frames,
    playback: {
      ...DEFAULT_PLAYBACK,
      currentFrame: 0,
      endFrame: Math.max(0, frames.length - 1),
      isPlaying: frames.length > 1
    },
    sheet
  }
}

const buildGifSession = async (payload: ImportedFilePayload, onProgress?: ProgressCallback): Promise<ImportSession> => {
  const { averageDelayMs, frames } = await decodeGifToFrames(payload, async (progress) => {
    await onProgress?.({
      current: progress.current,
      percent: 15 + ((progress.percent ?? 0) * 0.85),
      stage: 'decode-gif',
      total: progress.total
    })
  })
  const fps = Math.max(1, Math.round(1000 / Math.max(averageDelayMs, 1)))

  return {
    frames,
    playback: {
      ...DEFAULT_PLAYBACK,
      currentFrame: 0,
      endFrame: Math.max(0, frames.length - 1),
      fps,
      isPlaying: frames.length > 1
    },
    sheet: createEmptySheetState()
  }
}

export const buildImportSession = async (
  payloads: ImportedFilePayload[],
  onProgress?: ProgressCallback
): Promise<ImportSession> => {
  const sortedPayloads = naturalSort(payloads, (payload) => payload.name)

  if (sortedPayloads.length === 0) {
    return {
      frames: [],
      playback: { ...DEFAULT_PLAYBACK },
      sheet: createEmptySheetState()
    }
  }

  if (sortedPayloads.length === 1) {
    const singlePayload = sortedPayloads[0]
    if (singlePayload.extension === 'gif') {
      return buildGifSession(singlePayload, onProgress)
    }

    return buildSheetState(singlePayload, onProgress)
  }

  const frameGroups: Awaited<ReturnType<typeof filePayloadToFrame>>[][] = []

  for (let index = 0; index < sortedPayloads.length; index += 1) {
    const payload = sortedPayloads[index]
    if (payload.extension === 'gif') {
      const gifSession = await buildGifSession(payload)
      frameGroups.push(gifSession.frames)
    } else {
      frameGroups.push([await filePayloadToFrame(payload)])
    }

    await onProgress?.({
      current: index + 1,
      percent: 15 + (((index + 1) / sortedPayloads.length) * 85),
      stage: 'convert-files',
      total: sortedPayloads.length
    })
  }

  const frames = frameGroups.flat()

  return {
    frames,
    playback: {
      ...DEFAULT_PLAYBACK,
      currentFrame: 0,
      endFrame: Math.max(0, frames.length - 1),
      isPlaying: frames.length > 1
    },
    sheet: createEmptySheetState()
  }
}
