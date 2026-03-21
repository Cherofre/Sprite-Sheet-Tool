import type { ExportSettings, GridCandidate, SheetState } from '@shared/types'
import { SplitPreview } from './SplitPreview'

interface SheetPanelProps {
  canApply: boolean; columns: number; exportSettings: ExportSettings; frameHeight: number; frameWidth: number
  onApply: () => void; onChooseCandidate: (candidate: GridCandidate) => void; onExportSplitSequence: () => void
  onUpdateSheet: (patch: Partial<SheetState>, recordHistory?: boolean) => void; predictedFrameCount: number; rows: number; sheet: SheetState; isBusy?: boolean
}

const parseInteger = (value: string): number => Math.max(1, Number.parseInt(value || '1', 10) || 1)

export function SheetPanel({
  canApply, columns, exportSettings, frameHeight, frameWidth, isBusy = false, onApply,
  onChooseCandidate, onExportSplitSequence, onUpdateSheet, predictedFrameCount, rows, sheet
}: SheetPanelProps) {
  if (!sheet.source) {
    return (
      <section className="panel stack">
        <div className="section-heading">
          <span className="eyebrow">拆分</span>
          <h2>图集检测</h2>
        </div>
        <p className="muted-copy">导入单张图像以进行自动检测拆分，支持覆盖行列数或单元格尺寸。</p>
      </section>
    )
  }

  const syncGridValues = (r: number, c: number) => onUpdateSheet({ columns: c, frameHeight: Math.floor(sheet.sourceHeight / r), frameWidth: Math.floor(sheet.sourceWidth / c), mode: 'grid', rows: r })
  const syncCellValues = (w: number, h: number) => onUpdateSheet({ columns: Math.floor(sheet.sourceWidth / w), frameHeight: h, frameWidth: w, mode: 'cell', rows: Math.floor(sheet.sourceHeight / h) })

  return (
    <section className="panel stack">
      <div className="section-heading">
        <span className="eyebrow">拆分</span>
        <h2>图集检测</h2>
      </div>

      <div className="hint-card slim">
        <span className="eyebrow">源文件</span>
        <strong>{sheet.sourceWidth} x {sheet.sourceHeight}</strong>
      </div>

      <div className="toggle-group">
        <button className={sheet.mode === 'grid' ? 'toggle-button active' : 'toggle-button'} onClick={() => onUpdateSheet({ mode: 'grid' }, false)} type="button">按行列设定</button>
        <button className={sheet.mode === 'cell' ? 'toggle-button active' : 'toggle-button'} onClick={() => onUpdateSheet({ mode: 'cell' }, false)} type="button">按尺寸设定</button>
      </div>

      {sheet.mode === 'grid' ? (
        <div className="form-grid">
          <label>行数<input className="number-input" min={1} onChange={(e) => syncGridValues(parseInteger(e.target.value), sheet.columns)} type="number" value={sheet.rows} /></label>
          <label>列数<input className="number-input" min={1} onChange={(e) => syncGridValues(sheet.rows, parseInteger(e.target.value))} type="number" value={sheet.columns} /></label>
        </div>
      ) : (
        <div className="form-grid">
          <label>单帧宽<input className="number-input" min={1} onChange={(e) => syncCellValues(parseInteger(e.target.value), sheet.frameHeight)} type="number" value={sheet.frameWidth} /></label>
          <label>单帧高<input className="number-input" min={1} onChange={(e) => syncCellValues(sheet.frameWidth, parseInteger(e.target.value))} type="number" value={sheet.frameHeight} /></label>
        </div>
      )}

      <div className="stats-grid">
        <div className="stat-card"><span>帧尺寸</span><strong>{sheet.frameWidth} x {sheet.frameHeight}</strong></div>
        <div className="stat-card"><span>预估帧数</span><strong>{predictedFrameCount}</strong></div>
      </div>

      <SplitPreview canApply={canApply} columns={columns} frameHeight={frameHeight} frameWidth={frameWidth} predictedFrameCount={predictedFrameCount} rows={rows} source={sheet.source} />

      <div className="button-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <button className="primary-button" disabled={!canApply || isBusy} onClick={onApply} type="button">应用至轴</button>
        <button className="secondary-button" disabled={!canApply || isBusy} onClick={onExportSplitSequence} type="button">直接导出序列</button>
      </div>

      {sheet.candidates.length > 0 ? (
        <div className="candidate-list">
          <div className="section-heading compact">
            <span className="eyebrow">自动检测</span>
            <h3>最佳匹配</h3>
          </div>
          {sheet.candidates.map((candidate) => (
            <button className="candidate-button" key={candidate.label} onClick={() => onChooseCandidate(candidate)} type="button">
              <strong>{candidate.label}</strong>
              <span>置信度 {(candidate.confidence * 100).toFixed(0)}%</span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  )
}
