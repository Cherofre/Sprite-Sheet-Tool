import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import type { FrameItem } from '@shared/types'

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
  onSelectFrame: (event: React.MouseEvent<HTMLButtonElement>, frameId: string) => void
}

function SortableFrameCard({ currentFrame, frame, index, isSelected, onSelectFrame }: SortableFrameCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: frame.id })

  return (
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
      type="button"
    >
      <img alt={frame.name} className="timeline-thumb" draggable={false} src={frame.dataUrl} />
      <div className="timeline-meta">
        <strong>{index + 1}</strong>
        <span>{frame.name}</span>
        <small>
          {frame.width} x {frame.height}
        </small>
      </div>
    </button>
  )
}

export function FrameTimeline({
  currentFrame,
  frames,
  onMoveFrame,
  onSelectFrame,
  selectedFrameIds
}: FrameTimelineProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const handleDragEnd = (event: DragEndEvent) => {
    if (!event.over || event.active.id === event.over.id) {
      return
    }

    onMoveFrame(String(event.active.id), String(event.over.id))
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
                  onSelectFrame={(event, frameId) => onSelectFrame(frameId, event.metaKey || event.ctrlKey, event.shiftKey)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </section>
  )
}
