import { type CSSProperties, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

import { buildSplitPreviewSampleIndices } from '@features/split/preview'
import type { ImportedFilePayload } from '@shared/types'
import { buildGridSliceRects } from '@lib/grid/sheetGeometry'

import { loadImageElement } from '@lib/image/browser'

interface SplitPreviewProps {
  canApply: boolean
  columns: number
  predictedFrameCount: number
  rows: number
  source: ImportedFilePayload
}

interface PreviewThumb {
  dataUrl: string
  index: number
}

interface SourceDimensions {
  height: number
  width: number
}

interface ActivePreview {
  dataUrl: string
  overlayStyle?: CSSProperties
  title: string
}

const PREVIEW_THUMB_SIZE = 62
const PREVIEW_STAGE_MAX_HEIGHT = 140

export function SplitPreview({
  canApply,
  columns,
  predictedFrameCount,
  rows,
  source
}: SplitPreviewProps) {
  const [sampleThumbs, setSampleThumbs] = useState<PreviewThumb[]>([])
  const [activePreview, setActivePreview] = useState<ActivePreview | null>(null)
  const [sourceDimensions, setSourceDimensions] = useState<SourceDimensions | null>(null)
  const sampleIndices = useMemo(() => buildSplitPreviewSampleIndices(predictedFrameCount, 6), [predictedFrameCount])

  useEffect(() => {
    let isCancelled = false

    const loadSourceDimensions = async () => {
      const image = await loadImageElement(source.dataUrl)
      if (!isCancelled) {
        setSourceDimensions({
          height: image.naturalHeight,
          width: image.naturalWidth
        })
      }
    }

    void loadSourceDimensions()

    return () => {
      isCancelled = true
    }
  }, [source.dataUrl])

  useEffect(() => {
    let isCancelled = false

    const generateThumbs = async () => {
      if (!canApply || predictedFrameCount === 0) {
        setSampleThumbs([])
        return
      }

      const image = await loadImageElement(source.dataUrl)
      const sliceRects = buildGridSliceRects(image.naturalWidth, image.naturalHeight, rows, columns)
      const thumbs = await Promise.all(
        sampleIndices.map(async (index) => {
          const rect = sliceRects[index]
          if (!rect) {
            throw new Error('Split preview index is out of range')
          }

          const scale = Math.min(PREVIEW_THUMB_SIZE / rect.width, PREVIEW_THUMB_SIZE / rect.height)
          const canvas = document.createElement('canvas')
          canvas.width = Math.max(20, Math.round(rect.width * scale))
          canvas.height = Math.max(20, Math.round(rect.height * scale))

          const context = canvas.getContext('2d')
          if (!context) {
            throw new Error('Canvas is unavailable')
          }

          context.clearRect(0, 0, canvas.width, canvas.height)
          context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height)

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
  }, [canApply, columns, predictedFrameCount, rows, sampleIndices, source.dataUrl])

  const overlayStyle =
    rows > 0 && columns > 0
      ? {
          backgroundImage:
            'linear-gradient(to right, rgba(255,138,77,0.7) 1px, transparent 1px), linear-gradient(to bottom, rgba(94,209,177,0.7) 1px, transparent 1px)',
          backgroundSize: `${100 / columns}% 100%, 100% ${100 / rows}%`
        }
      : undefined

  const previewFrameStyle =
    sourceDimensions && sourceDimensions.width > 0 && sourceDimensions.height > 0
      ? {
          aspectRatio: `${sourceDimensions.width} / ${sourceDimensions.height}`,
          width: `min(100%, ${Math.round((sourceDimensions.width / sourceDimensions.height) * PREVIEW_STAGE_MAX_HEIGHT)}px)`
        }
      : undefined

  const previewModal =
    activePreview && typeof document !== 'undefined'
      ? createPortal(
          <div className="modal-overlay" onClick={() => setActivePreview(null)}>
            <div
              className="modal-card split-preview-modal-card"
              onClick={(event) => {
                event.stopPropagation()
              }}
            >
              <div className="modal-header">
                <div>
                  <span className="eyebrow">预览</span>
                  <h2>{activePreview.title}</h2>
                </div>
                <button className="secondary-button" onClick={() => setActivePreview(null)} type="button">
                  关闭
                </button>
              </div>

              <div className="split-preview-modal-body">
                <img alt={activePreview.title} className="split-preview-modal-image" src={activePreview.dataUrl} />
                {activePreview.overlayStyle ? <div className="split-preview-modal-overlay" style={activePreview.overlayStyle} /> : null}
              </div>
            </div>
          </div>,
          document.body
        )
      : null

  return (
    <>
      <div className="split-preview-stack">
        <div className="section-heading compact">
          <span className="eyebrow">预览</span>
          <h3>拆分结果</h3>
        </div>

        <button
          className="sheet-preview-stage split-preview-stage-button"
          onClick={() =>
            setActivePreview({
              dataUrl: source.dataUrl,
              overlayStyle,
              title: `${source.name} 拆分总览`
            })
          }
          type="button"
        >
          <div className="sheet-preview-frame" style={previewFrameStyle}>
            <img alt={source.name} className="sheet-preview-image" src={source.dataUrl} />
            {overlayStyle ? <div className="sheet-preview-overlay" style={overlayStyle} /> : null}
          </div>
        </button>

        {canApply ? (
          <div className="split-sample-grid">
            {sampleThumbs.map((thumb) => (
              <button
                className="split-sample-thumb"
                key={thumb.index}
                onClick={() =>
                  setActivePreview({
                    dataUrl: thumb.dataUrl,
                    title: `拆分帧 #${thumb.index + 1}`
                  })
                }
                title={`查看拆分帧 #${thumb.index + 1}`}
                type="button"
              >
                <img alt={`拆分预览 ${thumb.index + 1}`} src={thumb.dataUrl} />
                <span className="split-sample-index">#{thumb.index + 1}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="hint-card">
            <span className="eyebrow">检查</span>
            <p>当前行列或帧尺寸还不能整除源图，请继续调整。</p>
          </div>
        )}
      </div>
      {previewModal}
    </>
  )
}
