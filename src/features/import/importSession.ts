import type { GridCandidate, ImportedFilePayload, PlaybackSettings, ProgressCallback, SheetState } from '@shared/types'

import { DEFAULT_PLAYBACK } from '@shared/constants'

import { createEmptySheetState } from '@features/history/history'
import {
  detectGridHintFromName,
  detectRegularGrid,
  rankGridCandidatesWithInkProfiles,
  shouldAutoApplyGrid
} from '@lib/grid/detectRegularGrid'
import { decodeGifToFrames } from '@lib/image/gif'
import { convertPayloadsToFrames, filePayloadToFrame, inspectImage, splitSheetToFrames } from '@lib/image/browser'
import { naturalSort } from '@lib/sort/naturalSort'

export interface ImportSession {
  frames: Awaited<ReturnType<typeof filePayloadToFrame>>[]
  importPrompt?: SingleImageImportPrompt
  playback: PlaybackSettings
  sheet: SheetState
}

export interface SingleImageImportPrompt {
  candidates: GridCandidate[]
  columns: number
  frameCount: number
  frameHeight: number
  frameWidth: number
  rows: number
  sourceHeight: number
  sourceName: string
  sourceWidth: number
}

export interface SheetImportGeometry {
  columns: number
  frameHeight: number
  frameWidth: number
  mode: SheetState['mode']
  rows: number
}

export const buildSingleImageImportPromptFromSheet = (
  sheet: SheetState,
  minimumConfidence = 0
): SingleImageImportPrompt | undefined => {
  const source = sheet.source
  const bestCandidate = sheet.candidates[0]
  if (!source || !bestCandidate || bestCandidate.confidence < minimumConfidence) {
    return undefined
  }

  return {
    candidates: sheet.candidates,
    columns: bestCandidate.columns,
    frameCount: bestCandidate.rows * bestCandidate.columns,
    frameHeight: bestCandidate.frameHeight,
    frameWidth: bestCandidate.frameWidth,
    rows: bestCandidate.rows,
    sourceHeight: sheet.sourceHeight,
    sourceName: source.name,
    sourceWidth: sheet.sourceWidth
  }
}

const buildSheetState = async (payload: ImportedFilePayload, onProgress?: ProgressCallback): Promise<ImportSession> => {
  await onProgress?.({
    percent: 10,
    stage: 'measure-sheet'
  })
  const inspection = await inspectImage(payload)
  const { height, width } = inspection

  await onProgress?.({
    percent: 25,
    stage: 'rank-grid'
  })
  const hintedCandidate = detectGridHintFromName(payload.name, width, height)
  const heuristicCandidates = detectRegularGrid(width, height)
  const rankedHeuristicCandidates = rankGridCandidatesWithInkProfiles(heuristicCandidates, inspection)
  const dedupedHeuristicCandidates = rankedHeuristicCandidates.filter(
    (candidate) => !hintedCandidate || candidate.rows !== hintedCandidate.rows || candidate.columns !== hintedCandidate.columns
  )
  const candidates = hintedCandidate ? [hintedCandidate, ...dedupedHeuristicCandidates] : dedupedHeuristicCandidates
  const bestCandidate = hintedCandidate ?? candidates[0]
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

  const importPrompt = !hintedCandidate && autoApply ? buildSingleImageImportPromptFromSheet(sheet) : undefined

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
    importPrompt,
    playback: {
      ...DEFAULT_PLAYBACK,
      currentFrame: 0,
      endFrame: Math.max(0, frames.length - 1),
      isPlaying: frames.length > 1
    },
    sheet
  }
}

export const buildSingleFrameImportSession = async (session: ImportSession): Promise<ImportSession> => {
  const source = session.sheet.source
  if (!source) {
    return {
      ...session,
      importPrompt: undefined
    }
  }

  return {
    frames: [await filePayloadToFrame(source)],
    importPrompt: undefined,
    playback: {
      ...DEFAULT_PLAYBACK,
      currentFrame: 0,
      endFrame: 0,
      isPlaying: false
    },
    sheet: {
      ...session.sheet,
      autoApplied: false
    }
  }
}

export const buildSheetImportSession = async (
  session: ImportSession,
  geometry: SheetImportGeometry,
  onProgress?: ProgressCallback
): Promise<ImportSession> => {
  const source = session.sheet.source
  if (!source) {
    return {
      ...session,
      importPrompt: undefined
    }
  }

  const frames = await splitSheetToFrames(
    source,
    geometry.rows,
    geometry.columns,
    geometry.frameWidth,
    geometry.frameHeight,
    onProgress
  )

  return {
    frames,
    importPrompt: undefined,
    playback: {
      ...DEFAULT_PLAYBACK,
      currentFrame: 0,
      endFrame: Math.max(0, frames.length - 1),
      fps: session.playback.fps,
      isPlaying: frames.length > 1
    },
    sheet: {
      ...session.sheet,
      autoApplied: true,
      columns: geometry.columns,
      enabled: true,
      frameHeight: geometry.frameHeight,
      frameWidth: geometry.frameWidth,
      mode: geometry.mode,
      rows: geometry.rows
    }
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

  if (sortedPayloads.every((payload) => payload.extension !== 'gif')) {
    const frames = await convertPayloadsToFrames(sortedPayloads, 'file', async (progress) => {
      await onProgress?.({
        current: progress.current,
        percent: 15 + ((progress.percent ?? 0) * 0.85),
        stage: 'convert-files',
        total: progress.total
      })
    })

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
