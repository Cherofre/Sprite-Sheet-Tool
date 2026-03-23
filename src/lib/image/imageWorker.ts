/// <reference lib="webworker" />

import type { ExportImageFormat, FrameItem, ImportedFilePayload, RotationStep, TaskProgress } from '@shared/types'
import { GIFEncoder, applyPalette, quantize } from 'gifenc'
import { decompressFrames, parseGIF } from 'gifuct-js'

import { stripExtension } from '@lib/fs/fileNames'
import { buildGridSliceRects } from '@lib/grid/sheetGeometry'
import { dataUrlToArrayBuffer, dataUrlToBlob } from '@lib/image/dataUrl'
import { maybeYieldToBrowser, shouldReportProgress } from '@lib/image/taskScheduler'

import type {
  ComposeSheetWorkerResult,
  DecodeGifWorkerResult,
  EncodedFrameBatchResult,
  ImageInspectionResult,
  ImageWorkerRequest,
  ImageWorkerResponse
} from './imageWorkerTypes'

const workerScope = self as DedicatedWorkerGlobalScope
const MIME_BY_FORMAT: Record<ExportImageFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp'
}

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

const loadBuffer = async (dataUrl: string): Promise<ArrayBuffer> => dataUrlToArrayBuffer(dataUrl)

const loadBitmap = async (dataUrl: string): Promise<ImageBitmap> => {
  const blob = dataUrlToBlob(dataUrl)
  return createImageBitmap(blob)
}

const createCanvas = (width: number, height: number): OffscreenCanvas => new OffscreenCanvas(width, height)

const toPngDataUrl = async (canvas: OffscreenCanvas): Promise<string> => {
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return blobToDataUrl(blob)
}

const canvasToBytes = async (
  canvas: OffscreenCanvas,
  format: ExportImageFormat,
  quality = format === 'jpeg' ? 0.92 : undefined
): Promise<Uint8Array> => {
  const blob = await canvas.convertToBlob({
    quality,
    type: MIME_BY_FORMAT[format]
  })

  return new Uint8Array(await blob.arrayBuffer())
}

const postProgress = async (id: string, progress: TaskProgress) => {
  workerScope.postMessage({
    id,
    progress,
    type: 'progress'
  } satisfies ImageWorkerResponse)
}

const inspectImageInWorker = async (
  payload: ImportedFilePayload,
  maxSampleSize = 384
): Promise<ImageInspectionResult> => {
  const image = await loadBitmap(payload.dataUrl)
  const scale = Math.min(1, maxSampleSize / Math.max(image.width, image.height))
  const sampleWidth = Math.max(32, Math.round(image.width * scale))
  const sampleHeight = Math.max(32, Math.round(image.height * scale))
  const canvas = createCanvas(sampleWidth, sampleHeight)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    throw new Error('Canvas is unavailable')
  }

  context.clearRect(0, 0, sampleWidth, sampleHeight)
  context.drawImage(image, 0, 0, sampleWidth, sampleHeight)

  const { data } = context.getImageData(0, 0, sampleWidth, sampleHeight)
  const columnInk = new Array<number>(sampleWidth).fill(0)
  const rowInk = new Array<number>(sampleHeight).fill(0)
  const inkMap = new Array<number>(sampleWidth * sampleHeight).fill(0)
  let totalInk = 0

  for (let y = 0; y < sampleHeight; y += 1) {
    for (let x = 0; x < sampleWidth; x += 1) {
      const index = (y * sampleWidth + x) * 4
      const alpha = data[index + 3] / 255
      const brightness = (data[index] + data[index + 1] + data[index + 2]) / (255 * 3)
      const ink = (1 - brightness) * alpha

      columnInk[x] += ink
      rowInk[y] += ink
      inkMap[y * sampleWidth + x] = ink
      totalInk += ink
    }
  }

  return {
    columnInk: columnInk.map((value) => value / sampleHeight),
    height: image.height,
    inkMap,
    meanInk: totalInk / (sampleWidth * sampleHeight),
    rowInk: rowInk.map((value) => value / sampleWidth),
    sampleHeight,
    sampleWidth,
    width: image.width
  }
}

const convertPayloadsToFramesInWorker = async (
  id: string,
  payloads: ImportedFilePayload[],
  sourceType: FrameItem['sourceType']
): Promise<FrameItem[]> => {
  const frames: FrameItem[] = []

  for (let index = 0; index < payloads.length; index += 1) {
    const payload = payloads[index]
    const image = await loadBitmap(payload.dataUrl)

    frames.push({
      dataUrl: payload.dataUrl,
      height: image.height,
      id: crypto.randomUUID(),
      name: stripExtension(payload.name),
      sourcePath: payload.path,
      sourceType,
      width: image.width
    })

    const processed = index + 1
    if (shouldReportProgress(processed, payloads.length)) {
      await postProgress(id, {
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

const splitSheetInWorker = async (
  id: string,
  payload: ImportedFilePayload,
  rows: number,
  columns: number,
  _frameWidth: number,
  _frameHeight: number
): Promise<FrameItem[]> => {
  const image = await loadBitmap(payload.dataUrl)
  const frames: FrameItem[] = []
  const sliceRects = buildGridSliceRects(image.width, image.height, rows, columns)
  const totalFrames = sliceRects.length

  for (const rect of sliceRects) {
    const canvas = createCanvas(rect.width, rect.height)
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('Canvas is unavailable')
    }

    context.clearRect(0, 0, rect.width, rect.height)
    context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height)

    frames.push({
      dataUrl: await toPngDataUrl(canvas),
      height: rect.height,
      id: crypto.randomUUID(),
      name: `${stripExtension(payload.name)}_${String(rect.index + 1).padStart(String(totalFrames).length, '0')}`,
      sourcePath: payload.path,
      sourceType: 'sheet',
      width: rect.width
    })

    const processed = rect.index + 1
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

const decodeGifInWorker = async (id: string, payload: ImportedFilePayload): Promise<DecodeGifWorkerResult> => {
  const gifBuffer = await loadBuffer(payload.dataUrl)
  const parsedGif = parseGIF(gifBuffer)
  const parsedFrames = decompressFrames(parsedGif, true)
  const canvas = createCanvas(parsedGif.lsd.width, parsedGif.lsd.height)
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Canvas is unavailable')
  }

  const frames: FrameItem[] = []
  let delayTotal = 0

  for (let index = 0; index < parsedFrames.length; index += 1) {
    const frame = parsedFrames[index]
    const imageData = new ImageData(new Uint8ClampedArray(frame.patch), frame.dims.width, frame.dims.height)
    context.putImageData(imageData, frame.dims.left, frame.dims.top)

    frames.push({
      dataUrl: await toPngDataUrl(canvas),
      height: canvas.height,
      id: crypto.randomUUID(),
      name: `${stripExtension(payload.name)}_${String(index + 1).padStart(String(parsedFrames.length).length, '0')}`,
      sourcePath: payload.path,
      sourceType: 'gif',
      width: canvas.width
    })

    delayTotal += frame.delay || 100

    if (frame.disposalType === 2) {
      context.clearRect(frame.dims.left, frame.dims.top, frame.dims.width, frame.dims.height)
    }

    const processed = index + 1
    if (shouldReportProgress(processed, parsedFrames.length)) {
      await postProgress(id, {
        current: processed,
        percent: (processed / parsedFrames.length) * 100,
        stage: 'decode-gif',
        total: parsedFrames.length
      })
    }

    await maybeYieldToBrowser(processed)
  }

  return {
    averageDelayMs: parsedFrames.length > 0 ? delayTotal / parsedFrames.length : 100,
    frames
  }
}

const encodeGifInWorker = async (id: string, frames: FrameItem[], fps: number): Promise<Uint8Array> => {
  if (frames.length === 0) {
    throw new Error('There are no frames to export')
  }

  const width = Math.max(...frames.map((frame) => frame.width))
  const height = Math.max(...frames.map((frame) => frame.height))
  const encoder = GIFEncoder()
  const delay = Math.max(20, Math.round(1000 / Math.max(1, fps)))

  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index]
    const image = await loadBitmap(frame.dataUrl)
    const canvas = createCanvas(width, height)
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('Canvas is unavailable')
    }

    context.clearRect(0, 0, width, height)
    const offsetX = Math.floor((width - image.width) / 2)
    const offsetY = Math.floor((height - image.height) / 2)
    context.drawImage(image, offsetX, offsetY)
    const imageData = context.getImageData(0, 0, width, height)
    const palette = quantize(imageData.data, 256, {
      format: 'rgba4444',
      oneBitAlpha: true
    })
    const pixels = applyPalette(imageData.data, palette, 'rgba4444')

    encoder.writeFrame(pixels, width, height, {
      delay,
      dispose: 1,
      palette,
      repeat: 0,
      transparent: true,
      transparentIndex: 0
    })

    const processed = index + 1
    if (shouldReportProgress(processed, frames.length)) {
      await postProgress(id, {
        current: processed,
        percent: (processed / frames.length) * 100,
        stage: 'encode-gif',
        total: frames.length
      })
    }

    await maybeYieldToBrowser(processed)
  }

  encoder.finish()
  return encoder.bytes()
}

const encodeFramesInWorker = async (
  id: string,
  frames: FrameItem[],
  format: ExportImageFormat
): Promise<EncodedFrameBatchResult> => {
  const encodedFrames: Uint8Array[] = []

  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index]
    const image = await loadBitmap(frame.dataUrl)
    const canvas = createCanvas(frame.width, frame.height)
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('Canvas is unavailable')
    }

    context.clearRect(0, 0, frame.width, frame.height)
    context.drawImage(image, 0, 0, frame.width, frame.height)
    encodedFrames.push(await canvasToBytes(canvas, format))

    const processed = index + 1
    if (shouldReportProgress(processed, frames.length)) {
      await postProgress(id, {
        current: processed,
        percent: (processed / frames.length) * 100,
        stage: 'encode-frames',
        total: frames.length
      })
    }

    await maybeYieldToBrowser(processed)
  }

  return {
    encodedFrames
  }
}

workerScope.addEventListener('message', async (event: MessageEvent<ImageWorkerRequest>) => {
  const request = event.data

  try {
    let result:
      | ComposeSheetWorkerResult
      | DecodeGifWorkerResult
      | EncodedFrameBatchResult
      | FrameItem[]
      | ImageInspectionResult
      | Uint8Array

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
      case 'decode-gif':
        result = await decodeGifInWorker(request.id, request.payload)
        break
      case 'encode-gif':
        result = await encodeGifInWorker(request.id, request.frames, request.fps)
        break
      case 'encode-frames':
        result = await encodeFramesInWorker(request.id, request.frames, request.format)
        break
      case 'inspect-image':
        result = await inspectImageInWorker(request.payload, request.maxSampleSize)
        break
      case 'convert-payloads-to-frames':
        result = await convertPayloadsToFramesInWorker(request.id, request.payloads, request.sourceType)
        break
      default:
        throw new Error('Unknown image worker task')
    }

    if (result instanceof Uint8Array) {
      workerScope.postMessage(
        {
          id: request.id,
          result,
          type: 'result'
        } satisfies ImageWorkerResponse,
        [result.buffer]
      )
      return
    }

    if (
      typeof result === 'object' &&
      result !== null &&
      'encodedFrames' in result &&
      Array.isArray(result.encodedFrames)
    ) {
      workerScope.postMessage(
        {
          id: request.id,
          result,
          type: 'result'
        } satisfies ImageWorkerResponse,
        result.encodedFrames.map((frame) => frame.buffer)
      )
      return
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
