import * as ContextMenu from '@radix-ui/react-context-menu'
import { createPortal } from 'react-dom'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEventHandler } from 'react'

import type { BackgroundMode, FrameItem } from '@shared/types'
import { dataUrlToBlob } from '@lib/image/dataUrl'

import { useEditorStore } from '../store/editorStore'

interface PreviewStageProps {
  background: BackgroundMode
  canClearWorkspace?: boolean
  frame?: FrameItem
  onEditFrameInPhotoshop?: (frame: FrameItem) => void
  onReplaceCurrentFrame?: (frame: FrameItem) => void
  onRequestClearWorkspace?: () => void
  resetViewNonce?: number
  onZoomChange?: (zoom: number) => void
  zoom: number | 'fit'
}

interface PanState {
  x: number
  y: number
}

const backgroundClassByMode: Record<BackgroundMode, string> = {
  black: 'preview-stage stage-black',
  checker: 'preview-stage stage-checker',
  white: 'preview-stage stage-white'
}

const clampZoom = (value: number): number => Math.min(800, Math.max(10, value))

const copyFrameToClipboard = async (frame: FrameItem): Promise<void> => {
  const blob = dataUrlToBlob(frame.dataUrl)

  if (!('clipboard' in navigator) || typeof ClipboardItem === 'undefined') {
    throw new Error('当前环境不支持写入系统剪贴板。')
  }

  await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
}

export function PreviewStage({
  background,
  canClearWorkspace = false,
  frame,
  onEditFrameInPhotoshop,
  onReplaceCurrentFrame,
  onRequestClearWorkspace,
  resetViewNonce = 0,
  onZoomChange,
  zoom
}: PreviewStageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const panStartRef = useRef<{ origin: PanState; startX: number; startY: number } | null>(null)
  const [bounds, setBounds] = useState({ height: 0, width: 0 })
  const [pan, setPan] = useState<PanState>({ x: 0, y: 0 })
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false)
  const [isPanning, setIsPanning] = useState(false)
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

  useEffect(() => {
    if (zoom === 'fit') {
      setPan({ x: 0, y: 0 })
    }
  }, [zoom])

  useEffect(() => {
    setPan({ x: 0, y: 0 })
  }, [resetViewNonce])

  useEffect(() => {
    const handlePointerMove = (event: globalThis.PointerEvent) => {
      if (!panStartRef.current) {
        return
      }

      setPan({
        x: panStartRef.current.origin.x + (event.clientX - panStartRef.current.startX),
        y: panStartRef.current.origin.y + (event.clientY - panStartRef.current.startY)
      })
    }

    const handlePointerUp = () => {
      panStartRef.current = null
      setIsPanning(false)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [])

  let scale = 1
  if (frame) {
    scale =
      zoom === 'fit'
        ? Math.max(0.1, Math.min((bounds.width - 40) / frame.width || 1, (bounds.height - 40) / frame.height || 1))
        : zoom / 100
  }

  const handleWheel: WheelEventHandler<HTMLDivElement> = (event) => {
    if (!frame || !onZoomChange) {
      return
    }

    event.preventDefault()
    const baseZoom = zoom === 'fit' ? 100 : zoom
    const nextZoom = clampZoom(baseZoom + (event.deltaY < 0 ? 10 : -10))
    onZoomChange(nextZoom)
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 1 || !frame) {
      return
    }

    event.preventDefault()
    panStartRef.current = {
      origin: pan,
      startX: event.clientX,
      startY: event.clientY
    }
    setIsPanning(true)
  }

  const confirmClearWorkspace = () => {
    setIsClearConfirmOpen(false)
    onRequestClearWorkspace?.()
  }

  const clearModal =
    isClearConfirmOpen && typeof document !== 'undefined'
      ? createPortal(
          <div className="modal-overlay" onClick={() => setIsClearConfirmOpen(false)}>
            <div
              className="modal-card settings-modal-card"
              onClick={(event) => {
                event.stopPropagation()
              }}
            >
              <div className="modal-header">
                <div>
                  <span className="eyebrow">确认</span>
                  <h2>清空当前工作区？</h2>
                </div>
                <button className="secondary-button" onClick={() => setIsClearConfirmOpen(false)} type="button">
                  取消
                </button>
              </div>

              <div className="hint-card">
                <span className="eyebrow">提醒</span>
                <p>这会清空当前时间轴、拆分设置和导出提示，但不会删除你磁盘上的源文件。</p>
              </div>

              <div className="button-grid">
                <button className="secondary-button" onClick={() => setIsClearConfirmOpen(false)} type="button">
                  取消
                </button>
                <button className="primary-button" onClick={confirmClearWorkspace} type="button">
                  确认清空
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
      : null

  return (
    <>
      <section className="preview-shell">
        <div className="preview-stage-frame">
          <ContextMenu.Root>
            <ContextMenu.Trigger asChild>
              <div
                className={[
                  backgroundClassByMode[background],
                  frame ? 'preview-stage-pannable' : '',
                  isPanning ? 'preview-stage-panning' : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
                onDragStart={(event) => {
                  event.preventDefault()
                }}
                onPointerDown={handlePointerDown}
                onWheel={handleWheel}
                ref={containerRef}
              >
                {frame ? (
                  <div
                    className="preview-canvas"
                    style={{
                      transform: `translate(${pan.x}px, ${pan.y}px)`
                    }}
                  >
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
                  </div>
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
                <ContextMenu.Item
                  className="ContextMenuItem"
                  disabled={!frame || !onEditFrameInPhotoshop}
                  onSelect={() => {
                    if (!frame || !onEditFrameInPhotoshop) {
                      return
                    }

                    onEditFrameInPhotoshop(frame)
                  }}
                >
                  用 Photoshop 修改当前帧...
                </ContextMenu.Item>
                <ContextMenu.Item
                  className="ContextMenuItem"
                  disabled={!frame || !onReplaceCurrentFrame}
                  onSelect={() => {
                    if (!frame || !onReplaceCurrentFrame) {
                      return
                    }

                    onReplaceCurrentFrame(frame)
                  }}
                >
                  导入并替换当前帧...
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
                    setPan({ x: 0, y: 0 })
                    updatePlaybackSettings({ zoom: 'fit' }, false)
                  }}
                >
                  缩放至适应
                </ContextMenu.Item>

                <ContextMenu.Separator className="ContextMenuSeparator" />

                <ContextMenu.Item
                  className="ContextMenuItem danger"
                  disabled={!canClearWorkspace || !onRequestClearWorkspace}
                  onSelect={() => {
                    if (!canClearWorkspace || !onRequestClearWorkspace) {
                      return
                    }
                    setIsClearConfirmOpen(true)
                  }}
                >
                  清空工作区...
                </ContextMenu.Item>
              </ContextMenu.Content>
            </ContextMenu.Portal>
          </ContextMenu.Root>
        </div>
      </section>

      {clearModal}
    </>
  )
}
