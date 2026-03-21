interface ImportPanelProps {
  canClear: boolean
  canRedo: boolean
  canUndo: boolean
  frameCount: number
  isBusy: boolean
  onClearWorkspace: () => void
  onDeleteSelected: () => void
  onDropFiles: (files: File[]) => void
  onImportFiles: () => void
  onImportFolder: () => void
  onRedo: () => void
  onReverse: () => void
  onRotate: (rotation: 90 | 180 | 270) => void
  onUndo: () => void
  selectedCount: number
  statusMessage: string
}

export function ImportPanel({
  canClear,
  canRedo,
  canUndo,
  frameCount,
  isBusy,
  onClearWorkspace,
  onDeleteSelected,
  onDropFiles,
  onImportFiles,
  onImportFolder,
  onRedo,
  onReverse,
  onRotate,
  onUndo,
  selectedCount,
  statusMessage
}: ImportPanelProps) {
  const handleDrop: React.DragEventHandler<HTMLDivElement> = (event) => {
    event.preventDefault()
    event.stopPropagation()
    const droppedFiles = Array.from(event.dataTransfer.files)

    if (droppedFiles.length > 0) {
      onDropFiles(droppedFiles)
    }
  }

  return (
    <section className="panel stack">
      <div className="section-heading">
        <span className="eyebrow">导入</span>
        <h2>资源导入</h2>
      </div>

      <div
        className="drop-panel"
        onDragOver={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onDrop={handleDrop}
      >
        <strong>将文件或文件夹拖到这里</strong>
        <p>支持 PNG、JPG、WEBP、GIF。规则序列图会尽量自动识别，并在高置信度下直接开始播放。</p>
      </div>

      <div className="button-grid">
        <button className="primary-button" disabled={isBusy} onClick={onImportFiles} type="button">
          导入文件
        </button>
        <button className="secondary-button" disabled={isBusy} onClick={onImportFolder} type="button">
          导入文件夹
        </button>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <span>帧数</span>
          <strong>{frameCount}</strong>
        </div>
        <div className="stat-card">
          <span>已选中</span>
          <strong>{selectedCount}</strong>
        </div>
      </div>

      <div className="section-heading compact">
        <span className="eyebrow">编辑</span>
        <h3>快捷操作</h3>
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
        <button className="secondary-button" disabled={!canClear || isBusy} onClick={onClearWorkspace} type="button">
          清空
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
      <div className="hint-card">
        <span className="eyebrow">快捷键</span>
        <p>空格播放 / 左右切帧 / Delete 删选中 / Ctrl+Z 撤销 / Ctrl+Shift+O 导入文件夹 / Esc 取消任务</p>
      </div>
    </section>
  )
}
