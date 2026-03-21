import { useState } from 'react'
import type { ExportSettings } from '@shared/types'

interface ExportPanelProps {
  exportFrameCount: number; exportSettings: ExportSettings; onExportGif: () => void; onExportSequence: () => void
  onExportSheet: () => void; onUpdateExport: (patch: Partial<ExportSettings>, recordHistory?: boolean) => void; recommendedLayout: { columns: number; rows: number }
}
const parseInteger = (value: string): number => Math.max(0, Number.parseInt(value || '0', 10) || 0)

export function ExportPanel({ exportFrameCount, exportSettings, onExportGif, onExportSequence, onExportSheet, onUpdateExport, recommendedLayout }: ExportPanelProps) {
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false)

  return (
    <section className="panel stack">
      <div className="section-heading">
        <span className="eyebrow">输出</span>
        <h2>快速导出</h2>
      </div>

      <div className="input-with-icon">
        <select onChange={(e) => onUpdateExport({ imageFormat: e.target.value as ExportSettings['imageFormat'] })} value={exportSettings.imageFormat}>
          <option value="png">格式：PNG</option>
          <option value="webp">格式：WEBP</option>
          <option value="jpeg">格式：JPEG</option>
        </select>
        <button className="secondary-button icon-btn" onClick={() => setIsAdvancedOpen(true)} title="高级输出设置" type="button">⚙️</button>
      </div>

      <div className="export-action-stack">
        <button className="primary-button" disabled={exportFrameCount === 0} onClick={onExportSequence} type="button">导出序列</button>
        <div className="dual-action-row">
          <button className="secondary-button" disabled={exportFrameCount === 0} onClick={onExportSheet} type="button">导出图集</button>
          <button className="secondary-button" disabled={exportFrameCount === 0} onClick={onExportGif} type="button">导出 GIF</button>
        </div>
      </div>

      {isAdvancedOpen ? (
        <div className="modal-overlay" onClick={() => setIsAdvancedOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ width: '420px' }}>
            <div className="modal-header">
              <div><span className="eyebrow">设置</span><h2>高级输出参数</h2></div>
              <button className="secondary-button" onClick={() => setIsAdvancedOpen(false)} type="button">关闭</button>
            </div>
            
            <div className="form-grid">
              <label>文件前缀<input onChange={(e) => onUpdateExport({ fileNamePrefix: e.target.value })} type="text" value={exportSettings.fileNamePrefix} /></label>
              <label>补零位数<input className="number-input" min={1} onChange={(e) => onUpdateExport({ padding: Math.max(1, parseInteger(e.target.value)) })} type="number" value={exportSettings.padding} /></label>
              <label>导出跳帧<input className="number-input" min={0} onChange={(e) => onUpdateExport({ exportSkip: parseInteger(e.target.value) })} type="number" value={exportSettings.exportSkip} /></label>
            </div>

            <div className="section-heading compact" style={{ marginTop: '0.5rem' }}><h3>图集自定义布局</h3></div>
            <div className="form-grid">
              <label>行数 (设为 0 自动计算)<input className="number-input" min={0} onChange={(e) => onUpdateExport({ spriteSheetRows: parseInteger(e.target.value) })} type="number" value={exportSettings.spriteSheetRows} /></label>
              <label>列数 (设为 0 自动计算)<input className="number-input" min={0} onChange={(e) => onUpdateExport({ spriteSheetColumns: parseInteger(e.target.value) })} type="number" value={exportSettings.spriteSheetColumns} /></label>
            </div>

            <div className="hint-card">
              <span className="eyebrow">当前排版建议</span>
              <p>近似方形布局：{recommendedLayout.rows} 行 x {recommendedLayout.columns} 列<br />可导出帧数：{exportFrameCount}</p>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
