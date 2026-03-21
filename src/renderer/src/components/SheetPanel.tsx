import type { ExportSettings, GridCandidate, SheetState } from '@shared/types'

import { SplitPreview } from './SplitPreview'

interface SheetPanelProps {
  canApply: boolean
  columns: number
  exportSettings: ExportSettings
  frameHeight: number
  frameWidth: number
  isBusy?: boolean
  onApply: () => void
  onChooseCandidate: (candidate: GridCandidate) => void
  onExportSplitSequence: () => void
  onUpdateSheet: (patch: Partial<SheetState>, recordHistory?: boolean) => void
  predictedFrameCount: number
  rows: number
  sheet: SheetState
}

const parseInteger = (value: string): number => Math.max(1, Number.parseInt(value || '1', 10) || 1)

export function SheetPanel({
  canApply,
  columns,
  exportSettings,
  frameHeight,
  frameWidth,
  isBusy = false,
  onApply,
  onChooseCandidate,
  onExportSplitSequence,
  onUpdateSheet,
  predictedFrameCount,
  rows,
  sheet
}: SheetPanelProps) {
  if (!sheet.source) {
    return (
      <section className="panel stack">
        <div className="section-heading">
          <span className="eyebrow">拆分</span>
          <h2>图集识别</h2>
        </div>
        <p className="muted-copy">导入单张图后，可以按规则图集方式预览，并手动覆盖行列或帧尺寸。</p>
      </section>
    )
  }

  const syncGridValues = (nextRows: number, nextColumns: number) => {
    onUpdateSheet({
      columns: nextColumns,
      frameHeight: Math.floor(sheet.sourceHeight / nextRows),
      frameWidth: Math.floor(sheet.sourceWidth / nextColumns),
      mode: 'grid',
      rows: nextRows
    })
  }

  const syncCellValues = (nextFrameWidth: number, nextFrameHeight: number) => {
    onUpdateSheet({
      columns: Math.floor(sheet.sourceWidth / nextFrameWidth),
      frameHeight: nextFrameHeight,
      frameWidth: nextFrameWidth,
      mode: 'cell',
      rows: Math.floor(sheet.sourceHeight / nextFrameHeight)
    })
  }

  return (
    <section className="panel stack">
      <div className="section-heading">
        <span className="eyebrow">拆分</span>
        <h2>图集识别</h2>
      </div>

      <div className="hint-card">
        <span className="eyebrow">源图</span>
        <p>
          {sheet.source.name}
          <br />
          {sheet.sourceWidth} x {sheet.sourceHeight}
        </p>
      </div>

      <div className="toggle-group">
        <button
          className={sheet.mode === 'grid' ? 'toggle-button active' : 'toggle-button'}
          onClick={() => onUpdateSheet({ mode: 'grid' }, false)}
          type="button"
        >
          行列方式
        </button>
        <button
          className={sheet.mode === 'cell' ? 'toggle-button active' : 'toggle-button'}
          onClick={() => onUpdateSheet({ mode: 'cell' }, false)}
          type="button"
        >
          帧尺寸方式
        </button>
      </div>

      {sheet.mode === 'grid' ? (
        <div className="form-grid">
          <label>
            行
            <input
              className="number-input"
              min={1}
              onChange={(event) => syncGridValues(parseInteger(event.target.value), sheet.columns)}
              type="number"
              value={sheet.rows}
            />
          </label>
          <label>
            列
            <input
              className="number-input"
              min={1}
              onChange={(event) => syncGridValues(sheet.rows, parseInteger(event.target.value))}
              type="number"
              value={sheet.columns}
            />
          </label>
        </div>
      ) : (
        <div className="form-grid">
          <label>
            帧宽
            <input
              className="number-input"
              min={1}
              onChange={(event) => syncCellValues(parseInteger(event.target.value), sheet.frameHeight)}
              type="number"
              value={sheet.frameWidth}
            />
          </label>
          <label>
            帧高
            <input
              className="number-input"
              min={1}
              onChange={(event) => syncCellValues(sheet.frameWidth, parseInteger(event.target.value))}
              type="number"
              value={sheet.frameHeight}
            />
          </label>
        </div>
      )}

      <div className="stats-grid">
        <div className="stat-card">
          <span>帧尺寸</span>
          <strong>
            {sheet.frameWidth} x {sheet.frameHeight}
          </strong>
        </div>
        <div className="stat-card">
          <span>预计帧数</span>
          <strong>{predictedFrameCount}</strong>
        </div>
      </div>

      <SplitPreview
        canApply={canApply}
        columns={columns}
        frameHeight={frameHeight}
        frameWidth={frameWidth}
        predictedFrameCount={predictedFrameCount}
        rows={rows}
        source={sheet.source}
      />

      <div className="button-grid">
        <button className="primary-button" disabled={!canApply || isBusy} onClick={onApply} type="button">
          应用到时间轴
        </button>
        <button className="secondary-button" disabled={!canApply || isBusy} onClick={onExportSplitSequence} type="button">
          直接导出拆分序列
        </button>
      </div>

      <div className="hint-card">
        <span className="eyebrow">直接导出</span>
        <p>
          使用右侧输出设置：{exportSettings.imageFormat.toUpperCase()}，前缀“{exportSettings.fileNamePrefix}”，补零
          {` ${exportSettings.padding} `}
          位，跳帧 {exportSettings.exportSkip}。
        </p>
      </div>

      {sheet.candidates.length > 0 ? (
        <div className="control-block">
          <div className="section-heading compact">
            <span className="eyebrow">自动识别</span>
            <h3>候选方案</h3>
          </div>
          <select
            defaultValue=""
            onChange={(event) => {
              const selected = sheet.candidates.find((candidate) => candidate.label === event.target.value)
              if (selected) {
                onChooseCandidate(selected)
              }
              event.currentTarget.selectedIndex = 0
            }}
          >
            <option disabled value="">
              -- 选择其他候选方案 --
            </option>
            {sheet.candidates.map((candidate) => (
              <option key={candidate.label} value={candidate.label}>
                {candidate.label} (置信度 {(candidate.confidence * 100).toFixed(0)}%)
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </section>
  )
}
