import { useEffect, useRef, useState } from 'react'
import type { BackgroundMode, FrameItem } from '@shared/types'

interface PreviewStageProps {
  background: BackgroundMode
  frame?: FrameItem
  zoom: number | 'fit'
  onZoomChange: (zoom: number | 'fit') => void
}

const backgroundClassByMode: Record<BackgroundMode, string> = {
  black: 'preview-stage stage-black', checker: 'preview-stage stage-checker', white: 'preview-stage stage-white'
}

export function PreviewStage({ background, frame, zoom, onZoomChange }: PreviewStageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [bounds, setBounds] = useState({ height: 0, width: 0 })

  useEffect(() => {
    const element = containerRef.current
    if (!element) return undefined
    const observer = new ResizeObserver((entries) => {
      setBounds({ height: entries[0].contentRect.height, width: entries[0].contentRect.width })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  let scale = 1
  if (frame) {
    scale = zoom === 'fit' ? Math.max(0.1, Math.min((bounds.width - 40) / frame.width || 1, (bounds.height - 40) / frame.height || 1)) : zoom / 100
  }

  // 核心：滚轮缩放逻辑
  const handleWheel = (e: React.WheelEvent) => {
    if (!frame) return
    const delta = e.deltaY < 0 ? 1 : -1
    const currentZoomPercent = zoom === 'fit' ? Math.round(scale * 100) : zoom
    const steps = [10, 25, 50, 75, 100, 150, 200, 300, 400, 600, 800]
    
    let nearestIndex = 0
    let minDiff = Infinity
    steps.forEach((s, i) => {
      const diff = Math.abs(s - currentZoomPercent)
      if (diff < minDiff) { minDiff = diff; nearestIndex = i }
    })
    
    const nextIndex = Math.max(0, Math.min(steps.length - 1, nearestIndex + delta))
    onZoomChange(steps[nextIndex])
  }

  return (
    <section className="preview-shell">
      <div className="section-heading compact">
        <span className="eyebrow">视口</span>
        <h3>动画预览</h3>
      </div>
      <div className={backgroundClassByMode[background]} ref={containerRef} onWheel={handleWheel}>
        {frame ? (
          <img alt={frame.name} className="preview-image" src={frame.dataUrl} style={{ height: frame.height * scale, width: frame.width * scale }} />
        ) : (
          <div className="preview-empty"><strong>还没有可预览的帧</strong></div>
        )}
      </div>
    </section>
  )
}
