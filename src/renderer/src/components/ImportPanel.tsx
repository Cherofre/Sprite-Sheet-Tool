interface ImportPanelProps {
  canClear?: boolean
  canRedo: boolean
  canUndo: boolean
  frameCount: number
  isBusy: boolean
  onClearWorkspace?: () => void
  onDeleteSelected: () => void
  onDropFiles?: (files: File[]) => void
  onImportFiles?: () => void
  onImportFolder?: () => void
  onRedo: () => void
  onReverse: () => void
  onRotate: (rotation: 90 | 180 | 270) => void
  onUndo: () => void
  selectedCount: number
  statusMessage: string
}

export function ImportPanel({
  canRedo,
  canUndo,
  frameCount,
  isBusy,
  onDeleteSelected,
  onRedo,
  onReverse,
  onRotate,
  onUndo,
  selectedCount,
  statusMessage
}: ImportPanelProps) {
  if (frameCount === 0) {
    return null
  }

  return (
    <section className="panel stack">
      <div className="section-heading">
        <span className="eyebrow">序列</span>
        <h2>快捷编辑</h2>
      </div>

      <div className="button-grid action-grid-three">
        <button className="secondary-button" disabled={frameCount < 2 || isBusy} onClick={onReverse} type="button">
          倒序
        </button>
        <button className="secondary-button" disabled={selectedCount === 0 || isBusy} onClick={onDeleteSelected} type="button">
          删选中
        </button>
        <button className="secondary-button" disabled={frameCount === 0 || isBusy} onClick={() => onRotate(90)} type="button">
          转 90°
        </button>
        <button className="secondary-button" disabled={frameCount === 0 || isBusy} onClick={() => onRotate(180)} type="button">
          转 180°
        </button>
        <button className="secondary-button" disabled={frameCount === 0 || isBusy} onClick={() => onRotate(270)} type="button">
          转 270°
        </button>
      </div>

      <div className="button-grid">
        <button className="secondary-button" disabled={!canUndo || isBusy} onClick={onUndo} type="button">
          撤销
        </button>
        <button className="secondary-button" disabled={!canRedo || isBusy} onClick={onRedo} type="button">
          重做
        </button>
      </div>

      <div className="hint-card slim-status">
        <span className="eyebrow">状态</span>
        <span>{statusMessage}</span>
      </div>
    </section>
  )
}
