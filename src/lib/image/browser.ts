import type { ExportImageFormat, FrameItem, ImportedFilePayload, ProgressCallback, RotationStep } from '@shared/types'

import { stripExtension } from '@lib/fs/fileNames'
import { maybeYieldToBrowser, shouldReportProgress } from '@lib/image/taskScheduler'
import { runImageWorkerTask, supportsImageWorker } from '@lib/image/worker.client'

import type { ComposeSheetWorkerResult, ImageInspectionResult } from './imageWorkerTypes'

const MIME_BY_FORMAT: Record<ExportImageFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp'
}

export const loadImageElement = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Failed to load image'))
    image.src = src
  })

export const measureImage = async (dataUrl: string): Promise<{ height: number; width: number }> => {
  const image = await loadImageElement(dataUrl)
  return {
    height: image.naturalHeight,
    width: image.naturalWidth
  }
}

export const sampleImageInkProfiles = async (
  dataUrl: string,
  maxSampleSize = 384
): Promise<{
  columnInk: number[]
  inkMap?: number[]
  meanInk: number
  rowInk: number[]
  sampleHeight?: number
  sampleWidth?: number
}> => {
  const image = await loadImageElement(dataUrl)
  const scale = Math.min(1, maxSampleSize / Math.max(image.naturalWidth, image.naturalHeight))
  const sampleWidth = Math.max(32, Math.round(image.naturalWidth * scale))
  const sampleHeight = Math.max(32, Math.round(image.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = sampleWidth
  canvas.height = sampleHeight

  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    throw new Error('Canvas is unavailable')
  }

  context.clearRect(0, 0, sampleWidth, sampleHeight)
  context.drawImage(image, 0, 0, sampleWidth, sampleHeight)

  const { data } = context.getImageData(0, 0, sampleWidth, sampleHeight)
  const columnInk = new Array<number>(sampleWidth).fill(0)
  const inkMap = new Array<number>(sampleWidth * sampleHeight).fill(0)
  const rowInk = new Array<number>(sampleHeight).fill(0)
  let totalInk = 0

  for (let y = 0; y < sampleHeight; y += 1) {
    for (let x = 0; x < sampleWidth; x += 1) {
      const index = (y * sampleWidth + x) * 4
      const alpha = data[index + 3] / 255
      const brightness = (data[index] + data[index + 1] + data[index + 2]) / (255 * 3)
      const ink = (1 - brightness) * alpha

      columnInk[x] += ink
      inkMap[y * sampleWidth + x] = ink
      rowInk[y] += ink
      totalInk += ink
    }
  }

  const normalizedColumnInk = columnInk.map((value) => value / sampleHeight)
  const normalizedRowInk = rowInk.map((value) => value / sampleWidth)

  return {
    columnInk: normalizedColumnInk,
    inkMap,
    meanInk: totalInk / (sampleWidth * sampleHeight),
    rowInk: normalizedRowInk,
    sampleHeight,
    sampleWidth
  }
}

export const inspectImage = async (
  payload: ImportedFilePayload,
  maxSampleSize = 384
): Promise<ImageInspectionResult> => {
  if (supportsImageWorker()) {
    try {
      return await runImageWorkerTask<ImageInspectionResult>(
        {
          kind: 'inspect-image',
          maxSampleSize,
          payload
        }
      )
    } catch {
      // Fall through to the renderer path when workers are unavailable or fail.
    }
  }

  const [{ height, width }, profiles] = await Promise.all([
    measureImage(payload.dataUrl),
    sampleImageInkProfiles(payload.dataUrl, maxSampleSize)
  ])

  return {
    columnInk: profiles.columnInk,
    height,
    inkMap: profiles.inkMap ?? [],
    meanInk: profiles.meanInk,
    rowInk: profiles.rowInk,
    sampleHeight: profiles.sampleHeight ?? 0,
    sampleWidth: profiles.sampleWidth ?? 0,
    width
  }
}

const canvasToDataUrl = (canvas: HTMLCanvasElement): string => canvas.toDataURL('image/png')

export const canvasToBytes = async (
  canvas: HTMLCanvasElement,
  format: ExportImageFormat,
  quality = format === 'jpeg' ? 0.92 : undefined
): Promise<Uint8Array> => {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (value) => {
        if (value) {
          resolve(value)
          return
        }

        reject(new Error('Failed to encode canvas'))
      },
      MIME_BY_FORMAT[format],
      quality
    )
  })

  const arrayBuffer = await blob.arrayBuffer()
  return new Uint8Array(arrayBuffer)
}

export const frameToBytes = async (frame: FrameItem, format: ExportImageFormat): Promise<Uint8Array> => {
  const image = await loadImageElement(frame.dataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = frame.width
  canvas.height = frame.height
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Canvas is unavailable')
  }

  context.clearRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvasToBytes(canvas, format)
}

export const filePayloadToFrame = async (
  payload: ImportedFilePayload,
  sourceType: FrameItem['sourceType'] = 'file'
): Promise<FrameItem> => {
  const { height, width } = await measureImage(payload.dataUrl)

  return {
    dataUrl: payload.dataUrl,
    height,
    id: crypto.randomUUID(),
    name: stripExtension(payload.name),
    sourcePath: payload.path,
    sourceType,
    width
  }
}

export const convertPayloadsToFrames = async (
  payloads: ImportedFilePayload[],
  sourceType: FrameItem['sourceType'] = 'file',
  onProgress?: ProgressCallback
): Promise<FrameItem[]> => {
  if (payloads.length === 0) {
    return []
  }

  if (supportsImageWorker()) {
    try {
      return await runImageWorkerTask<FrameItem[]>(
        {
          kind: 'convert-payloads-to-frames',
          payloads,
          sourceType
        },
        onProgress
      )
    } catch {
      // Fall through to the renderer path when workers are unavailable or fail.
    }
  }

  const frames: FrameItem[] = []

  for (let index = 0; index < payloads.length; index += 1) {
    const payload = payloads[index]
    frames.push(await filePayloadToFrame(payload, sourceType))

    const processed = index + 1
    if (onProgress && shouldReportProgress(processed, payloads.length)) {
      await onProgress({
        current: processed,
        percent: (processed / payloads.length) * 100,
        stage: 'convert-files',
        total: payloads.length
      })
    }

    await maybeYieldToBrowser(processed)
  }

  return frames
}

const splitSheetToFramesInRenderer = async (
  payload: ImportedFilePayload,
  rows: number,
  columns: number,
  frameWidth: number,
  frameHeight: number,
  onProgress?: ProgressCallback
): Promise<FrameItem[]> => {
  const image = await loadImageElement(payload.dataUrl)
  const frames: FrameItem[] = []
  const totalFrames = rows * columns

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const canvas = document.createElement('canvas')
      canvas.width = frameWidth
      canvas.height = frameHeight

      const context = canvas.getContext('2d')
      if (!context) {
        throw new Error('Canvas is unavailable')
      }

      context.clearRect(0, 0, frameWidth, frameHeight)
      context.drawImage(
        image,
        column * frameWidth,
        row * frameHeight,
        frameWidth,
        frameHeight,
        0,
        0,
        frameWidth,
        frameHeight
      )

      const index = row * columns + column
      frames.push({
        dataUrl: canvasToDataUrl(canvas),
        height: frameHeight,
        id: crypto.randomUUID(),
        name: `${stripExtension(payload.name)}_${String(index + 1).padStart(String(totalFrames).length, '0')}`,
        sourcePath: payload.path,
        sourceType: 'sheet',
        width: frameWidth
      })

      const processed = index + 1
      if (onProgress && shouldReportProgress(processed, totalFrames)) {
        await onProgress({
          current: processed,
          percent: (processed / totalFrames) * 100,
          stage: 'split-sheet',
          total: totalFrames
        })
      }

      await maybeYieldToBrowser(processed)
    }
  }

  return frames
}

const rotateFramesInRenderer = async (
  frames: FrameItem[],
  rotation: RotationStep,
  onProgress?: ProgressCallback
): Promise<FrameItem[]> => {
  if (rotation === 0) {
    return frames
  }

  const rotatedFrames: FrameItem[] = []

  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index]
    const image = await loadImageElement(frame.dataUrl)
    const canvas = document.createElement('canvas')
    const quarterTurn = rotation === 90 || rotation === 270

    canvas.width = quarterTurn ? image.naturalHeight : image.naturalWidth
    canvas.height = quarterTurn ? image.naturalWidth : image.naturalHeight

    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('Canvas is unavailable')
    }

    context.translate(canvas.width / 2, canvas.height / 2)
    context.rotate((rotation * Math.PI) / 180)
    context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2)

    rotatedFrames.push({
      ...frame,
      dataUrl: canvasToDataUrl(canvas),
      height: canvas.height,
      width: canvas.width
    })

    const processed = index + 1
    if (onProgress && shouldReportProgress(processed, frames.length)) {
      await onProgress({
        current: processed,
        percent: (processed / frames.length) * 100,
        stage: 'rotate-frames',
        total: frames.length
      })
    }

    await maybeYieldToBrowser(processed)
  }

  return rotatedFrames
}

const composeSpriteSheetInRenderer = async (
  frames: FrameItem[],
  rows: number,
  columns: number,
  onProgress?: ProgressCallback
): Promise<{ canvas: HTMLCanvasElement; cellHeight: number; cellWidth: number }> => {
  const cellWidth = Math.max(...frames.map((frame) => frame.width))
  const cellHeight = Math.max(...frames.map((frame) => frame.height))
  const canvas = document.createElement('canvas')
  canvas.width = cellWidth * columns
  canvas.height = cellHeight * rows

  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Canvas is unavailable')
  }

  context.clearRect(0, 0, canvas.width, canvas.height)

  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index]
    const image = await loadImageElement(frame.dataUrl)
    const row = Math.floor(index / columns)
    const column = index % columns
    const scale = Math.min(cellWidth / image.naturalWidth, cellHeight / image.naturalHeight, 1)
    const drawWidth = Math.max(1, Math.round(image.naturalWidth * scale))
    const drawHeight = Math.max(1, Math.round(image.naturalHeight * scale))
    const x = column * cellWidth + Math.floor((cellWidth - drawWidth) / 2)
    const y = row * cellHeight + Math.floor((cellHeight - drawHeight) / 2)

    context.drawImage(image, x, y, drawWidth, drawHeight)

    const processed = index + 1
    if (onProgress && shouldReportProgress(processed, frames.length)) {
      await onProgress({
        current: processed,
        percent: (processed / frames.length) * 100,
        stage: 'compose-sheet',
        total: frames.length
      })
    }

    await maybeYieldToBrowser(processed)
  }

  return {
    canvas,
    cellHeight,
    cellWidth
  }
}

export const splitSheetToFrames = async (
  payload: ImportedFilePayload,
  rows: number,
  columns: number,
  frameWidth: number,
  frameHeight: number,
  onProgress?: ProgressCallback
): Promise<FrameItem[]> => {
  if (supportsImageWorker()) {
    try {
      return await runImageWorkerTask<FrameItem[]>(
        {
          columns,
          frameHeight,
          frameWidth,
          kind: 'split-sheet',
          payload,
          rows
        },
        onProgress
      )
    } catch {
      // Fall through to the main-thread implementation when workers are unavailable or fail.
    }
  }

  return splitSheetToFramesInRenderer(payload, rows, columns, frameWidth, frameHeight, onProgress)
}

export const rotateFrames = async (
  frames: FrameItem[],
  rotation: RotationStep,
  onProgress?: ProgressCallback
): Promise<FrameItem[]> => {
  if (supportsImageWorker()) {
    try {
      return await runImageWorkerTask<FrameItem[]>(
        {
          frames,
          kind: 'rotate-frames',
          rotation
        },
        onProgress
      )
    } catch {
      // Fall through to the main-thread implementation when workers are unavailable or fail.
    }
  }

  return rotateFramesInRenderer(frames, rotation, onProgress)
}

export const composeSpriteSheet = async (
  frames: FrameItem[],
  rows: number,
  columns: number,
  onProgress?: ProgressCallback
): Promise<{ canvas: HTMLCanvasElement; cellHeight: number; cellWidth: number }> => {
  if (supportsImageWorker()) {
    try {
      const workerResult = await runImageWorkerTask<ComposeSheetWorkerResult>(
        {
          columns,
          frames,
          kind: 'compose-sheet',
          rows
        },
        onProgress
      )

      const image = await loadImageElement(workerResult.dataUrl)
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext('2d')
      if (!context) {
        throw new Error('Canvas is unavailable')
      }

      context.clearRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0)

      return {
        canvas,
        cellHeight: workerResult.cellHeight,
        cellWidth: workerResult.cellWidth
      }
    } catch {
      // Fall through to the main-thread implementation when workers are unavailable or fail.
    }
  }

  return composeSpriteSheetInRenderer(frames, rows, columns, onProgress)
}
