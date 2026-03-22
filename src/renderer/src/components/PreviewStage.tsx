import * as ContextMenu from '@radix-ui/react-context-menu'
import { useEffect, useRef, useState } from 'react'

import type { BackgroundMode, FrameItem } from '@shared/types'

import { useEditorStore } from '../store/editorStore'

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

const copyFrameToClipboard = async (frame: FrameItem): Promise<void> => {
  const response = await fetch(frame.dataUrl)
  const blob = await response.blob()

  if (!('clipboard' in navigator) || typeof ClipboardItem === 'undefined') {
    throw new Error('当前环境不支持写入系统剪贴板。')
  }

  await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
}

export function PreviewStage({ background, frame, onZoomChange, zoom }: PreviewStageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [bounds, setBounds] = useState({ height: 0, width: 0 })
  const setErrorMessage = useEditorStore((state) => state.setErrorMessage)
  const setStatusMessage = useEditorStore((state) => state.setStatusMessage)
  const updatePlaybackSettings = useEditorStore((state) => state.updatePlaybackSettings)

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
        <ContextMenu.Root>
          <ContextMenu.Trigger asChild>
            <div
              className={backgroundClassByMode[background]}
              onDragStart={(event) => {
                event.preventDefault()
              }}
              onWheel={handleWheel}
              ref={containerRef}
            >
              {frame ? (
                <img
                  alt={frame.name}
                  className="preview-image"
                  draggable={false}
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
          </ContextMenu.Trigger>

          <ContextMenu.Portal>
            <ContextMenu.Content className="ContextMenuContent">
              <ContextMenu.Item
                className="ContextMenuItem"
                disabled={!frame}
                onSelect={() => {
                  if (!frame) {
                    return
                  }

                  void copyFrameToClipboard(frame)
                    .then(() => {
                      setStatusMessage('已复制当前帧到剪贴板。')
                    })
                    .catch((error) => {
                      const message = error instanceof Error ? error.message : '复制到剪贴板失败。'
                      setErrorMessage(message)
                    })
                }}
              >
                复制到剪贴板
              </ContextMenu.Item>

              <ContextMenu.Sub>
                <ContextMenu.SubTrigger className="ContextMenuSubTrigger">
                  背景切换
                  <span className="RightSlot">›</span>
                </ContextMenu.SubTrigger>
                <ContextMenu.Portal>
                  <ContextMenu.SubContent className="ContextMenuSubContent">
                    <ContextMenu.RadioGroup
                      onValueChange={(value) => updatePlaybackSettings({ background: value as BackgroundMode }, false)}
                      value={background}
                    >
                      <ContextMenu.RadioItem className="ContextMenuCheckboxItem" value="checker">
                        棋盘格
                      </ContextMenu.RadioItem>
                      <ContextMenu.RadioItem className="ContextMenuCheckboxItem" value="black">
                        纯黑
                      </ContextMenu.RadioItem>
                      <ContextMenu.RadioItem className="ContextMenuCheckboxItem" value="white">
                        纯白
                      </ContextMenu.RadioItem>
                    </ContextMenu.RadioGroup>
                  </ContextMenu.SubContent>
                </ContextMenu.Portal>
              </ContextMenu.Sub>

              <ContextMenu.Separator className="ContextMenuSeparator" />

              <ContextMenu.Item
                className="ContextMenuItem"
                onSelect={() => {
                  updatePlaybackSettings({ zoom: 'fit' }, false)
                }}
              >
                缩放至适应
              </ContextMenu.Item>
            </ContextMenu.Content>
          </ContextMenu.Portal>
        </ContextMenu.Root>
      </div>
    </section>
  )
}
