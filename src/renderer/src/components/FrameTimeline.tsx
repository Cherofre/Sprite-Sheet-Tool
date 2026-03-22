import * as ContextMenu from '@radix-ui/react-context-menu'
import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import type { FrameItem } from '@shared/types'

import { useEditorStore } from '../store/editorStore'

interface FrameTimelineProps {
  currentFrame: number
  frames: FrameItem[]
  onMoveFrame: (activeId: string, overId: string) => void
  onSelectFrame: (frameId: string, toggle?: boolean, range?: boolean) => void
  selectedFrameIds: string[]
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
  selectedFrameIds: string[]
}

const getContextTargetIds = (frameId: string, isSelected: boolean, selectedFrameIds: string[]): string[] =>
  isSelected ? selectedFrameIds : [frameId]

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
          onClick={(event) => onSelectFrame(event, frame.id)}
          ref={setNodeRef}
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
  const setStatusMessage = useEditorStore((state) => state.setStatusMessage)

  const handleDragEnd = (event: DragEndEvent) => {
    if (!event.over || event.active.id === event.over.id) {
      return
    }

    onMoveFrame(String(event.active.id), String(event.over.id))
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
                  selectedFrameIds={selectedFrameIds}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </section>
  )
}
