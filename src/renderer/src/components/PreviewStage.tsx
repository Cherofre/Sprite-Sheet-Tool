import { useEffect, useRef, useState } from 'react'

import type { BackgroundMode, FrameItem } from '@shared/types'

interface PreviewStageProps {
  background: BackgroundMode
  frame?: FrameItem
  onZoomChange?: (zoom: number) => void
  zoom: number | 'fit'
}

const backgroundClassByMode: Record<BackgroundMode, string> = {
  black: 'preview-stage stage-black',
  checker: 'preview-stage stage-checker',
  white: 'preview-stage stage-white'
}

const clampZoom = (value: number): number => Math.min(800, Math.max(10, value))

export function PreviewStage({ background, frame, onZoomChange, zoom }: PreviewStageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [bounds, setBounds] = useState({ height: 0, width: 0 })

  useEffect(() => {
    const element = containerRef.current
    if (!element) {
      return undefined
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      setBounds({
        height: entry.contentRect.height,
        width: entry.contentRect.width
      })
    })

    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  let scale = 1
  if (frame) {
    scale =
      zoom === 'fit'
        ? Math.max(0.1, Math.min((bounds.width - 40) / frame.width || 1, (bounds.height - 40) / frame.height || 1))
        : zoom / 100
  }

  const handleWheel: React.WheelEventHandler<HTMLDivElement> = (event) => {
    if (!frame || !onZoomChange) {
      return
    }

    event.preventDefault()
    const baseZoom = zoom === 'fit' ? 100 : zoom
    const nextZoom = clampZoom(baseZoom + (event.deltaY < 0 ? 10 : -10))
    onZoomChange(nextZoom)
  }

  return (
    <section className="preview-shell">
      <div className="preview-stage-frame">
        <div
          className={backgroundClassByMode[background]}
          onWheel={handleWheel}
          ref={containerRef}
        >
          {frame ? (
            <img
              alt={frame.name}
              className="preview-image"
              src={frame.dataUrl}
              style={{
                height: frame.height * scale,
                width: frame.width * scale
              }}
            />
          ) : (
            <div className="preview-empty">
              <strong>还没有可预览的帧</strong>
              <p>导入序列或图集后，就可以在这里查看动画预览。</p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
