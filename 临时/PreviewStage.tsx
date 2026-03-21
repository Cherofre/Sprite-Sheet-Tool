import { useEffect, useRef, useState } from 'react'
import type { BackgroundMode, FrameItem } from '@shared/types'

interface PreviewStageProps { background: BackgroundMode; frame?: FrameItem; zoom: number | 'fit' }
const backgroundClassByMode: Record<BackgroundMode, string> = { black: 'preview-stage stage-black', checker: 'preview-stage stage-checker', white: 'preview-stage stage-white' }

export function PreviewStage({ background, frame, zoom }: PreviewStageProps) {
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

  return (
    <section className="preview-shell">
      <div className="section-heading">
        <span className="eyebrow">视口</span>
        <h2>实时预览</h2>
      </div>

      <div className={backgroundClassByMode[background]} ref={containerRef}>
        {frame ? (
          <img alt={frame.name} className="preview-image" src={frame.dataUrl} style={{ height: frame.height * scale, width: frame.width * scale }} />
        ) : (
          <div className="preview-empty">
            <strong>未选择帧</strong>
            <p>导入序列或图集以开始预览动画。</p>
          </div>
        )}
      </div>

      {frame ? (
        <div className="hint-card slim">
          <span>{frame.name}</span>
          <strong>{frame.width} x {frame.height}</strong>
        </div>
      ) : null}
    </section>
  )
}
