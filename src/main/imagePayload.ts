import path from 'node:path'

import { decodeTga } from '@lunapaint/tga-codec'
import { decodeImage, parseDDSHeader } from 'dds-ktx-parser'
import sharp from 'sharp'

import { IMAGE_MIME_BY_EXTENSION, SUPPORTED_EXTENSIONS } from '@shared/constants'
import type { ImportedFilePayload } from '@shared/types'

const DISPLAY_MIME_TYPE = 'image/png'

const toDataUrl = (mimeType: string, data: Buffer): string => `data:${mimeType};base64,${data.toString('base64')}`

const rgbaToPng = async (rgba: Uint8Array | Buffer, width: number, height: number): Promise<Buffer> =>
  sharp(Buffer.from(rgba), {
    raw: {
      channels: 4,
      height,
      width
    }
  })
    .png()
    .toBuffer()

const decodeTgaToPng = async (data: Buffer): Promise<Buffer> => {
  const decoded = await decodeTga(data, { detectAmbiguousAlphaChannel: true })
  return rgbaToPng(decoded.image.data, decoded.image.width, decoded.image.height)
}

const decodeDdsToPng = async (data: Buffer): Promise<Buffer> => {
  const imageInfo = parseDDSHeader(data)
  const layer = imageInfo?.layers[0]
  if (!imageInfo || !layer) {
    throw new Error('无法解析这个 DDS 文件。当前版本支持常见的 DDS 贴图文件。')
  }

  try {
    const decoded = decodeImage(data, imageInfo.format, layer)
    return await rgbaToPng(decoded, layer.shape.width, layer.shape.height)
  } catch {
    throw new Error('当前 DDS 像素格式暂不支持导入。请先转换为 PNG 或 TGA 再试。')
  }
}

const buildDisplayPayload = async (extension: string, data: Buffer): Promise<{ dataUrl: string; mimeType: string }> => {
  switch (extension) {
    case 'dds':
      return {
        dataUrl: toDataUrl(DISPLAY_MIME_TYPE, await decodeDdsToPng(data)),
        mimeType: DISPLAY_MIME_TYPE
      }
    case 'tga':
      return {
        dataUrl: toDataUrl(DISPLAY_MIME_TYPE, await decodeTgaToPng(data)),
        mimeType: DISPLAY_MIME_TYPE
      }
    default: {
      const mimeType = IMAGE_MIME_BY_EXTENSION[extension] ?? 'application/octet-stream'
      return {
        dataUrl: toDataUrl(mimeType, data),
        mimeType
      }
    }
  }
}

export const isSupportedImageExtension = (extension: string): boolean =>
  SUPPORTED_EXTENSIONS.includes(extension.toLowerCase() as (typeof SUPPORTED_EXTENSIONS)[number])

export const isSupportedImageFile = (filePath: string): boolean => isSupportedImageExtension(path.extname(filePath).slice(1))

export const buildImportedFilePayload = async (input: {
  data: Buffer
  filePath: string
  size: number
}): Promise<ImportedFilePayload> => {
  const extension = path.extname(input.filePath).slice(1).toLowerCase()
  const displayPayload = await buildDisplayPayload(extension, input.data)

  return {
    dataUrl: displayPayload.dataUrl,
    extension,
    mimeType: displayPayload.mimeType,
    name: path.basename(input.filePath),
    path: input.filePath,
    size: input.size
  }
}
