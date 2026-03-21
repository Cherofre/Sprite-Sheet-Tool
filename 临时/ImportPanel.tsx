interface ImportPanelProps {
  canRedo: boolean; canUndo: boolean; frameCount: number; isBusy: boolean
  onDeleteSelected: () => void; onDropPaths: (paths: string[]) => void; onImportFiles: () => void; onImportFolder: () => void
  onRedo: () => void; onReverse: () => void; onRotate: (rotation: 90 | 180 | 270) => void; onUndo: () => void; selectedCount: number; statusMessage: string
}

export function ImportPanel({
  canRedo, canUndo, frameCount, isBusy, onDeleteSelected, onDropPaths, onImportFiles, onImportFolder,
  onRedo, onReverse, onRotate, onUndo, selectedCount, statusMessage
}: ImportPanelProps) {
  const handleDrop: React.DragEventHandler<HTMLDivElement> = (event) => {
    event.preventDefault()
    const files = Array.from(event.dataTransfer.files)
    const droppedPaths = files.map((file) => window.desktopApi.getPathForDroppedFile(file)).filter((path): path is string => Boolean(path))
    if (droppedPaths.length > 0) onDropPaths([...new Set(droppedPaths)])
  }

  return (
    <section className="panel stack">
      <div className="section-heading">
        <span className="eyebrow">导入</span>
        <h2>源文件摄入</h2>
      </div>

      <div className="drop-panel" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
        <strong>拖拽文件/文件夹至此</strong>
        <p>支持 PNG, JPG, WEBP, GIF。<br/>规范的矩阵图集将触发自动检测。</p>
      </div>

      <div className="button-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <button className="primary-button" disabled={isBusy} onClick={onImportFiles} type="button">导入文件</button>
        <button className="secondary-button" disabled={isBusy} onClick={onImportFolder} type="button">导入文件夹</button>
      </div>

      <div className="stats-grid">
        <div className="stat-card"><span>总帧数</span><strong>{frameCount}</strong></div>
        <div className="stat-card"><span>已选定</span><strong>{selectedCount}</strong></div>
      </div>

      <div className="section-heading compact">
        <span className="eyebrow">编辑</span>
        <h3>快捷操作</h3>
      </div>

      <div className="button-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <button className="secondary-button" disabled={frameCount < 2 || isBusy} onClick={onReverse} type="button">倒序</button>
        <button className="secondary-button" disabled={selectedCount === 0 || isBusy} onClick={onDeleteSelected} type="button">删选</button>
        <button className="secondary-button" disabled={frameCount === 0 || isBusy} onClick={() => onRotate(90)} type="button">旋 90°</button>
        <button className="secondary-button" disabled={frameCount === 0 || isBusy} onClick={() => onRotate(180)} type="button">旋 180°</button>
        <button className="secondary-button" disabled={frameCount === 0 || isBusy} onClick={() => onRotate(270)} type="button">旋 270°</button>
      </div>

      <div className="button-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <button className="secondary-button" disabled={!canUndo || isBusy} onClick={onUndo} type="button">撤销</button>
        <button className="secondary-button" disabled={!canRedo || isBusy} onClick={onRedo} type="button">重做</button>
      </div>

      <div className="hint-card slim-status">
        <span className="eyebrow">状态</span>
        <span>{statusMessage || '就绪'}</span>
      </div>
    </section>
  )
}
