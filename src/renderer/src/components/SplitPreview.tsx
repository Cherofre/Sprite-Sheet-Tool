import { useEffect, useMemo, useState } from 'react'

import { buildSplitPreviewSampleIndices } from '@features/split/preview'
import type { ImportedFilePayload } from '@shared/types'

import { loadImageElement } from '@lib/image/browser'

interface SplitPreviewProps {
  canApply: boolean
  columns: number
  frameHeight: number
  frameWidth: number
  predictedFrameCount: number
  rows: number
  source: ImportedFilePayload
}

interface PreviewThumb {
  dataUrl: string
  index: number
}

const PREVIEW_THUMB_SIZE = 88

export function SplitPreview({
  canApply,
  columns,
  frameHeight,
  frameWidth,
  predictedFrameCount,
  rows,
  source
}: SplitPreviewProps) {
  const [sampleThumbs, setSampleThumbs] = useState<PreviewThumb[]>([])
  const sampleIndices = useMemo(
    () => buildSplitPreviewSampleIndices(predictedFrameCount, 6),
    [predictedFrameCount]
  )

  useEffect(() => {
    let isCancelled = false

    const generateThumbs = async () => {
      if (!canApply || predictedFrameCount === 0) {
        setSampleThumbs([])
        return
      }

      const image = await loadImageElement(source.dataUrl)
      const thumbs = await Promise.all(
        sampleIndices.map(async (index) => {
          const row = Math.floor(index / columns)
          const column = index % columns
          const scale = Math.min(PREVIEW_THUMB_SIZE / frameWidth, PREVIEW_THUMB_SIZE / frameHeight)
          const canvas = document.createElement('canvas')
          canvas.width = Math.max(24, Math.round(frameWidth * scale))
          canvas.height = Math.max(24, Math.round(frameHeight * scale))

          const context = canvas.getContext('2d')
          if (!context) {
            throw new Error('Canvas is unavailable')
          }

          context.clearRect(0, 0, canvas.width, canvas.height)
          context.drawImage(
            image,
            column * frameWidth,
            row * frameHeight,
            frameWidth,
            frameHeight,
            0,
            0,
            canvas.width,
            canvas.height
          )

          return {
            dataUrl: canvas.toDataURL('image/png'),
            index
          }
        })
      )

      if (!isCancelled) {
        setSampleThumbs(thumbs)
      }
    }

    void generateThumbs()

    return () => {
      isCancelled = true
    }
  }, [canApply, columns, frameHeight, frameWidth, predictedFrameCount, sampleIndices, source.dataUrl])

  const overlayStyle =
    rows > 0 && columns > 0
      ? {
          backgroundImage:
            'linear-gradient(to right, rgba(255,138,77,0.7) 1px, transparent 1px), linear-gradient(to bottom, rgba(94,209,177,0.7) 1px, transparent 1px)',
          backgroundSize: `${100 / columns}% 100%, 100% ${100 / rows}%`
        }
      : undefined

  return (
    <div className="split-preview-stack">
      <div className="section-heading compact">
        <span className="eyebrow">预览</span>
        <h3>拆分结果</h3>
      </div>

      <div className="sheet-preview-stage">
        <img alt={source.name} className="sheet-preview-image" src={source.dataUrl} />
        {overlayStyle ? <div className="sheet-preview-overlay" style={overlayStyle} /> : null}
      </div>

      {canApply ? (
        <div className="split-sample-grid">
          {sampleThumbs.map((thumb) => (
            <div className="split-sample-card" key={thumb.index}>
              <img alt={`拆分预览 ${thumb.index + 1}`} src={thumb.dataUrl} />
              <span>#{thumb.index + 1}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="hint-card">
          <span className="eyebrow">检查</span>
          <p>当前行列或帧尺寸还不能整除源图，请继续调整。</p>
        </div>
      )}
    </div>
  )
}
