import { GIFEncoder, applyPalette, quantize } from 'gifenc'
import { decompressFrames, parseGIF } from 'gifuct-js'

import type { FrameItem, ImportedFilePayload, ProgressCallback } from '@shared/types'

import { stripExtension } from '@lib/fs/fileNames'

import { loadImageElement } from './browser'

const dataUrlToArrayBuffer = async (dataUrl: string): Promise<ArrayBuffer> => {
  const response = await fetch(dataUrl)
  return response.arrayBuffer()
}

export interface GifDecodeResult {
  averageDelayMs: number
  frames: FrameItem[]
}

export const decodeGifToFrames = async (
  payload: ImportedFilePayload,
  onProgress?: ProgressCallback
): Promise<GifDecodeResult> => {
  const gifBuffer = await dataUrlToArrayBuffer(payload.dataUrl)
  const parsedGif = parseGIF(gifBuffer)
  const parsedFrames = decompressFrames(parsedGif, true)
  const canvas = document.createElement('canvas')
  canvas.width = parsedGif.lsd.width
  canvas.height = parsedGif.lsd.height

  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Canvas is unavailable')
  }

  const resultFrames: FrameItem[] = []
  let delayTotal = 0

  for (let index = 0; index < parsedFrames.length; index += 1) {
    const frame = parsedFrames[index]
    const imageData = new ImageData(new Uint8ClampedArray(frame.patch), frame.dims.width, frame.dims.height)
    context.putImageData(imageData, frame.dims.left, frame.dims.top)

    resultFrames.push({
      dataUrl: canvas.toDataURL('image/png'),
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

    if (onProgress) {
      const processed = index + 1
      await onProgress({
        current: processed,
        percent: (processed / parsedFrames.length) * 100,
        stage: 'decode-gif',
        total: parsedFrames.length
      })
    }
  }

  return {
    averageDelayMs: parsedFrames.length > 0 ? delayTotal / parsedFrames.length : 100,
    frames: resultFrames
  }
}

export const encodeGif = async (
  frames: FrameItem[],
  fps: number,
  onProgress?: ProgressCallback
): Promise<Uint8Array> => {
  if (frames.length === 0) {
    throw new Error('There are no frames to export')
  }

  const width = Math.max(...frames.map((frame) => frame.width))
  const height = Math.max(...frames.map((frame) => frame.height))
  const encoder = GIFEncoder()
  const delay = Math.max(20, Math.round(1000 / Math.max(1, fps)))

  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index]
    const image = await loadImageElement(frame.dataUrl)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('Canvas is unavailable')
    }

    context.clearRect(0, 0, width, height)
    const offsetX = Math.floor((width - image.naturalWidth) / 2)
    const offsetY = Math.floor((height - image.naturalHeight) / 2)
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

    if (onProgress) {
      const processed = index + 1
      await onProgress({
        current: processed,
        percent: (processed / frames.length) * 100,
        stage: 'encode-gif',
        total: frames.length
      })
    }
  }

  encoder.finish()
  return encoder.bytes()
}
