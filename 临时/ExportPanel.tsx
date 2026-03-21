import { useState } from 'react'
import type { ExportSettings } from '@shared/types'

interface ExportPanelProps { exportFrameCount: number; exportSettings: ExportSettings; onExportGif: () => void; onExportSequence: () => void; onExportSheet: () => void; onUpdateExport: (patch: Partial<ExportSettings>, recordHistory?: boolean) => void; recommendedLayout: { columns: number; rows: number } }
const parseInteger = (value: string): number => Math.max(0, Number.parseInt(value || '0', 10) || 0)

export function ExportPanel({ exportFrameCount, exportSettings, onExportGif, onExportSequence, onExportSheet, onUpdateExport, recommendedLayout }: ExportPanelProps) {
  const [isOpen, setIsOpen] = useState(false)
  if (exportFrameCount === 0) return null

  return (
    <section className="panel stack" style={{ background: 'transparent', border: 'none', padding: 0 }}>
      <button className="primary-button full-width-button" onClick={() => setIsOpen(true)} type="button" style={{ padding: '0.8rem', fontSize: '1rem' }}>
        🚀 配置并导出...
      </button>

      {isOpen ? (
        <div className="modal-overlay" onClick={() => setIsOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ width: '420px' }}>
            <div className="modal-header">
              <div><span className="eyebrow">输出</span><h2>高级导出设置</h2></div>
              <button className="secondary-button" onClick={() => setIsOpen(false)} type="button">关闭</button>
            </div>
            
            <div className="form-grid">
              <label>输出格式
                <select onChange={(e) => onUpdateExport({ imageFormat: e.target.value as any })} value={exportSettings.imageFormat}>
                  <option value="png">PNG</option><option value="webp">WEBP</option><option value="jpeg">JPEG</option>
                </select>
              </label>
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
              <span className="eyebrow">建议</span>
              <p>近似方形排版为 {recommendedLayout.rows} 行 x {recommendedLayout.columns} 列。共将输出 {exportFrameCount} 帧。</p>
            </div>

            <div className="export-action-stack" style={{ marginTop: '0.5rem' }}>
              <button className="primary-button" onClick={() => { setIsOpen(false); onExportSequence(); }} type="button">导出单帧序列</button>
              <div className="dual-action-row">
                <button className="secondary-button" onClick={() => { setIsOpen(false); onExportSheet(); }} type="button">导出大图集</button>
                <button className="secondary-button" onClick={() => { setIsOpen(false); onExportGif(); }} type="button">导出 GIF</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
