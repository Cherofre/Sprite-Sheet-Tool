import * as ContextMenu from '@radix-ui/react-context-menu'
import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { FrameItem } from '@shared/types'

import { useEditorStore } from '../store/editorStore'

interface FrameTimelineProps {
  currentFrame: number
  frames: FrameItem[]
  onMoveFrame: (activeId: string, overId: string) => void
  onSelectFrame: (frameId: string, toggle?: boolean, range?: boolean) => void
  selectedFrameIds: string[]
}

interface MarqueeRect {
  height: number
  width: number
  x: number
  y: number
}

interface SortableFrameCardProps {
  currentFrame: number
  frame: FrameItem
  index: number
  isSelected: boolean
  onDeleteFrames: (frameIds: string[]) => void
  onDuplicateFrame: (frameId: string) => void
  onMoveFramesToEnd: (frameIds: string[]) => void
  onMoveFramesToStart: (frameIds: string[]) => void
  onSaveFrameAs: (frame: FrameItem) => void
  onSelectFrame: (event: React.MouseEvent<HTMLButtonElement>, frameId: string) => void
  registerCard: (frameId: string, node: HTMLButtonElement | null) => void
  selectedFrameIds: string[]
}

const getContextTargetIds = (frameId: string, isSelected: boolean, selectedFrameIds: string[]): string[] =>
  isSelected ? selectedFrameIds : [frameId]

const getSelectionBounds = (startX: number, startY: number, endX: number, endY: number): MarqueeRect => ({
  height: Math.abs(endY - startY),
  width: Math.abs(endX - startX),
  x: Math.min(startX, endX),
  y: Math.min(startY, endY)
})

const intersects = (
  a: { height: number; width: number; x: number; y: number },
  b: { height: number; width: number; x: number; y: number }
): boolean => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

function SortableFrameCard({
  currentFrame,
  frame,
  index,
  isSelected,
  onDeleteFrames,
  onDuplicateFrame,
  onMoveFramesToEnd,
  onMoveFramesToStart,
  onSaveFrameAs,
  onSelectFrame,
  registerCard,
  selectedFrameIds
}: SortableFrameCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: frame.id })
  const contextTargetIds = getContextTargetIds(frame.id, isSelected, selectedFrameIds)
  const deleteLabel = contextTargetIds.length > 1 ? '删除选中帧' : '删除当前帧'

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <button
          {...attributes}
          {...listeners}
          className={
            isSelected
              ? currentFrame === index
                ? 'timeline-card selected active'
                : 'timeline-card selected'
              : currentFrame === index
                ? 'timeline-card active'
                : 'timeline-card'
          }
          data-frame-id={frame.id}
          onClick={(event) => onSelectFrame(event, frame.id)}
          ref={(node) => {
            setNodeRef(node)
            registerCard(frame.id, node)
          }}
          style={{
            opacity: isDragging ? 0.6 : 1,
            transform: CSS.Transform.toString(transform),
            transition
          }}
          title={`${frame.name}\n尺寸: ${frame.width} x ${frame.height}`}
          type="button"
        >
          <span className="timeline-index">{index + 1}</span>
          <img alt={frame.name} className="timeline-thumb" draggable={false} src={frame.dataUrl} />
        </button>
      </ContextMenu.Trigger>

      <ContextMenu.Portal>
        <ContextMenu.Content className="ContextMenuContent">
          <ContextMenu.Item className="ContextMenuItem" onSelect={() => onMoveFramesToStart(contextTargetIds)}>
            将选中帧前移至开头
          </ContextMenu.Item>
          <ContextMenu.Item className="ContextMenuItem" onSelect={() => onMoveFramesToEnd(contextTargetIds)}>
            将选中帧后移至末尾
          </ContextMenu.Item>

          <ContextMenu.Separator className="ContextMenuSeparator" />

          <ContextMenu.Item className="ContextMenuItem" onSelect={() => onDuplicateFrame(frame.id)}>
            复制 / 克隆当前帧
          </ContextMenu.Item>
          <ContextMenu.Item className="ContextMenuItem" onSelect={() => onSaveFrameAs(frame)}>
            单帧另存为...
          </ContextMenu.Item>

          <ContextMenu.Separator className="ContextMenuSeparator" />

          <ContextMenu.Item className="ContextMenuItem danger" onSelect={() => onDeleteFrames(contextTargetIds)}>
            {deleteLabel}
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}

const frameDataUrlToBytes = async (dataUrl: string): Promise<Uint8Array> => {
  const response = await fetch(dataUrl)
  const arrayBuffer = await response.arrayBuffer()
  return new Uint8Array(arrayBuffer)
}

export function FrameTimeline({ currentFrame, frames, onMoveFrame, onSelectFrame, selectedFrameIds }: FrameTimelineProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const deleteFrames = useEditorStore((state) => state.deleteFrames)
  const duplicateFrame = useEditorStore((state) => state.duplicateFrame)
  const moveFramesToEnd = useEditorStore((state) => state.moveFramesToEnd)
  const moveFramesToStart = useEditorStore((state) => state.moveFramesToStart)
  const setErrorMessage = useEditorStore((state) => state.setErrorMessage)
  const setSelectedFrames = useEditorStore((state) => state.setSelectedFrames)
  const setStatusMessage = useEditorStore((state) => state.setStatusMessage)
  const timelineViewportRef = useRef<HTMLDivElement | null>(null)
  const cardRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const selectionOriginRef = useRef<{ x: number; y: number } | null>(null)
  const [marqueeRect, setMarqueeRect] = useState<MarqueeRect | null>(null)
  const [isSelecting, setIsSelecting] = useState(false)

  const registerCard = (frameId: string, node: HTMLButtonElement | null) => {
    cardRefs.current[frameId] = node
  }

  const updateSelectionFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const container = timelineViewportRef.current
      const origin = selectionOriginRef.current
      if (!container || !origin) {
        return
      }

      const containerRect = container.getBoundingClientRect()
      const currentX = clientX - containerRect.left + container.scrollLeft
      const currentY = clientY - containerRect.top + container.scrollTop
      const nextRect = getSelectionBounds(origin.x, origin.y, currentX, currentY)
      setMarqueeRect(nextRect)

      const nextSelected = frames
        .filter((frame) => {
          const node = cardRefs.current[frame.id]
          if (!node) {
            return false
          }

          const rect = node.getBoundingClientRect()
          const localBounds = {
            height: rect.height,
            width: rect.width,
            x: rect.left - containerRect.left + container.scrollLeft,
            y: rect.top - containerRect.top + container.scrollTop
          }

          return intersects(nextRect, localBounds)
        })
        .map((frame) => frame.id)

      setSelectedFrames(nextSelected, nextSelected.at(-1) ?? null)
    },
    [frames, setSelectedFrames]
  )

  useEffect(() => {
    if (!isSelecting) {
      return undefined
    }

    const handlePointerMove = (event: PointerEvent) => {
      updateSelectionFromPointer(event.clientX, event.clientY)
    }

    const handlePointerUp = () => {
      setIsSelecting(false)
      selectionOriginRef.current = null
      setMarqueeRect(null)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp, { once: true })

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [isSelecting, updateSelectionFromPointer])

  const handleDragEnd = (event: DragEndEvent) => {
    if (!event.over || event.active.id === event.over.id) {
      return
    }

    onMoveFrame(String(event.active.id), String(event.over.id))
  }

  const handleTimelinePointerDown: React.PointerEventHandler<HTMLDivElement> = (event) => {
    if (event.button !== 0) {
      return
    }

    if ((event.target as HTMLElement | null)?.closest('.timeline-card')) {
      return
    }

    const container = timelineViewportRef.current
    if (!container) {
      return
    }

    const rect = container.getBoundingClientRect()
    selectionOriginRef.current = {
      x: event.clientX - rect.left + container.scrollLeft,
      y: event.clientY - rect.top + container.scrollTop
    }
    setIsSelecting(true)
    setSelectedFrames([])
    updateSelectionFromPointer(event.clientX, event.clientY)
  }

  const handleTimelineWheel: React.WheelEventHandler<HTMLDivElement> = (event) => {
    const container = timelineViewportRef.current
    if (!container) {
      return
    }

    if (Math.abs(event.deltaY) < Math.abs(event.deltaX) && event.deltaX === 0) {
      return
    }

    event.preventDefault()
    container.scrollLeft += event.deltaY !== 0 ? event.deltaY : event.deltaX
  }

  const handleSaveFrameAs = async (frame: FrameItem): Promise<void> => {
    try {
      const bytes = await frameDataUrlToBytes(frame.dataUrl)
      const savedPath = await window.desktopApi.saveBinaryFile({
        data: Array.from(bytes),
        defaultPath: `${frame.name}.png`,
        filters: [{ extensions: ['png'], name: 'PNG 图片' }],
        title: '单帧另存为'
      })

      if (!savedPath) {
        return
      }

      setStatusMessage(`已保存单帧：${savedPath}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存单帧失败。'
      setErrorMessage(message)
    }
  }

  return (
    <section className="timeline-shell">
      <div className="section-heading compact">
        <span className="eyebrow">帧序列</span>
        <h3>时间轴</h3>
      </div>

      {frames.length === 0 ? (
        <div className="empty-timeline">导入后的帧会出现在这里，你可以直接拖动缩略图重新排序。</div>
      ) : (
        <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd} sensors={sensors}>
          <SortableContext items={frames.map((frame) => frame.id)} strategy={horizontalListSortingStrategy}>
            <div
              className={isSelecting ? 'timeline-grid-shell timeline-grid-shell-selecting' : 'timeline-grid-shell'}
              onPointerDown={handleTimelinePointerDown}
              onWheel={handleTimelineWheel}
              ref={timelineViewportRef}
            >
              <div className="timeline-grid">
                {frames.map((frame, index) => (
                  <SortableFrameCard
                    currentFrame={currentFrame}
                    frame={frame}
                    index={index}
                    isSelected={selectedFrameIds.includes(frame.id)}
                    key={frame.id}
                    onDeleteFrames={deleteFrames}
                    onDuplicateFrame={duplicateFrame}
                    onMoveFramesToEnd={moveFramesToEnd}
                    onMoveFramesToStart={moveFramesToStart}
                    onSaveFrameAs={(selectedFrame) => {
                      void handleSaveFrameAs(selectedFrame)
                    }}
                    onSelectFrame={(event, frameId) => onSelectFrame(frameId, event.metaKey || event.ctrlKey, event.shiftKey)}
                    registerCard={registerCard}
                    selectedFrameIds={selectedFrameIds}
                  />
                ))}
              </div>
              {marqueeRect ? (
                <div
                  className="timeline-marquee"
                  style={{
                    height: marqueeRect.height,
                    left: marqueeRect.x,
                    top: marqueeRect.y,
                    width: marqueeRect.width
                  }}
                />
              ) : null}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </section>
  )
}
