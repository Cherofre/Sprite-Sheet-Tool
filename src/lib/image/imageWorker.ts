/// <reference lib="webworker" />

import type { FrameItem, ImportedFilePayload, RotationStep, TaskProgress } from '@shared/types'

import { stripExtension } from '@lib/fs/fileNames'
import { maybeYieldToBrowser, shouldReportProgress } from '@lib/image/taskScheduler'

import type { ComposeSheetWorkerResult, ImageWorkerRequest, ImageWorkerResponse } from './imageWorkerTypes'

const workerScope = self as DedicatedWorkerGlobalScope

const blobToDataUrl = async (blob: Blob): Promise<string> => {
  if (typeof FileReaderSync !== 'undefined') {
    return new FileReaderSync().readAsDataURL(blob)
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }

      reject(new Error('Failed to encode blob as data URL'))
    }
    reader.onerror = () => reject(new Error('Failed to encode blob as data URL'))
    reader.readAsDataURL(blob)
  })
}

const dataUrlToBlob = async (dataUrl: string): Promise<Blob> => {
  const response = await fetch(dataUrl)
  return response.blob()
}

const loadBitmap = async (dataUrl: string): Promise<ImageBitmap> => {
  const blob = await dataUrlToBlob(dataUrl)
  return createImageBitmap(blob)
}

const createCanvas = (width: number, height: number): OffscreenCanvas => new OffscreenCanvas(width, height)

const toPngDataUrl = async (canvas: OffscreenCanvas): Promise<string> => {
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return blobToDataUrl(blob)
}

const postProgress = async (id: string, progress: TaskProgress) => {
  workerScope.postMessage({
    id,
    progress,
    type: 'progress'
  } satisfies ImageWorkerResponse)
}

const splitSheetInWorker = async (
  id: string,
  payload: ImportedFilePayload,
  rows: number,
  columns: number,
  frameWidth: number,
  frameHeight: number
): Promise<FrameItem[]> => {
  const image = await loadBitmap(payload.dataUrl)
  const frames: FrameItem[] = []
  const totalFrames = rows * columns

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const canvas = createCanvas(frameWidth, frameHeight)
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
        dataUrl: await toPngDataUrl(canvas),
        height: frameHeight,
        id: crypto.randomUUID(),
        name: `${stripExtension(payload.name)}_${String(index + 1).padStart(String(totalFrames).length, '0')}`,
        sourcePath: payload.path,
        sourceType: 'sheet',
        width: frameWidth
      })

      const processed = index + 1
      if (shouldReportProgress(processed, totalFrames)) {
        await postProgress(id, {
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

const rotateFramesInWorker = async (id: string, frames: FrameItem[], rotation: RotationStep): Promise<FrameItem[]> => {
  if (rotation === 0) {
    return frames
  }

  const rotatedFrames: FrameItem[] = []

  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index]
    const image = await loadBitmap(frame.dataUrl)
    const quarterTurn = rotation === 90 || rotation === 270
    const canvas = createCanvas(quarterTurn ? image.height : image.width, quarterTurn ? image.width : image.height)
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('Canvas is unavailable')
    }

    context.translate(canvas.width / 2, canvas.height / 2)
    context.rotate((rotation * Math.PI) / 180)
    context.drawImage(image, -image.width / 2, -image.height / 2)

    rotatedFrames.push({
      ...frame,
      dataUrl: await toPngDataUrl(canvas),
      height: canvas.height,
      width: canvas.width
    })

    const processed = index + 1
    if (shouldReportProgress(processed, frames.length)) {
      await postProgress(id, {
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

const composeSheetInWorker = async (
  id: string,
  frames: FrameItem[],
  rows: number,
  columns: number
): Promise<ComposeSheetWorkerResult> => {
  const cellWidth = Math.max(...frames.map((frame) => frame.width))
  const cellHeight = Math.max(...frames.map((frame) => frame.height))
  const canvas = createCanvas(cellWidth * columns, cellHeight * rows)
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Canvas is unavailable')
  }

  context.clearRect(0, 0, canvas.width, canvas.height)

  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index]
    const image = await loadBitmap(frame.dataUrl)
    const row = Math.floor(index / columns)
    const column = index % columns
    const scale = Math.min(cellWidth / image.width, cellHeight / image.height, 1)
    const drawWidth = Math.max(1, Math.round(image.width * scale))
    const drawHeight = Math.max(1, Math.round(image.height * scale))
    const x = column * cellWidth + Math.floor((cellWidth - drawWidth) / 2)
    const y = row * cellHeight + Math.floor((cellHeight - drawHeight) / 2)

    context.drawImage(image, x, y, drawWidth, drawHeight)

    const processed = index + 1
    if (shouldReportProgress(processed, frames.length)) {
      await postProgress(id, {
        current: processed,
        percent: (processed / frames.length) * 100,
        stage: 'compose-sheet',
        total: frames.length
      })
    }

    await maybeYieldToBrowser(processed)
  }

  return {
    cellHeight,
    cellWidth,
    dataUrl: await toPngDataUrl(canvas)
  }
}

workerScope.addEventListener('message', async (event: MessageEvent<ImageWorkerRequest>) => {
  const request = event.data

  try {
    let result: ComposeSheetWorkerResult | FrameItem[]

    switch (request.kind) {
      case 'split-sheet':
        result = await splitSheetInWorker(
          request.id,
          request.payload,
          request.rows,
          request.columns,
          request.frameWidth,
          request.frameHeight
        )
        break
      case 'rotate-frames':
        result = await rotateFramesInWorker(request.id, request.frames, request.rotation)
        break
      case 'compose-sheet':
        result = await composeSheetInWorker(request.id, request.frames, request.rows, request.columns)
        break
      default:
        throw new Error('Unknown image worker task')
    }

    workerScope.postMessage({
      id: request.id,
      result,
      type: 'result'
    } satisfies ImageWorkerResponse)
  } catch (error) {
    workerScope.postMessage({
      error: error instanceof Error ? error.message : 'Image worker failed',
      id: request.id,
      type: 'error'
    } satisfies ImageWorkerResponse)
  }
})
