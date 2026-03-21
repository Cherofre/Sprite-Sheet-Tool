import type { ExportSettings } from '@shared/types'

interface ExportPanelProps {
  exportFrameCount: number; exportSettings: ExportSettings; onExportGif: () => void; onExportSequence: () => void
  onExportSheet: () => void; onUpdateExport: (patch: Partial<ExportSettings>, recordHistory?: boolean) => void; recommendedLayout: { columns: number; rows: number }
}
const parseInteger = (value: string): number => Math.max(0, Number.parseInt(value || '0', 10) || 0)

export function ExportPanel({ exportFrameCount, exportSettings, onExportGif, onExportSequence, onExportSheet, onUpdateExport, recommendedLayout }: ExportPanelProps) {
  return (
    <section className="panel stack">
      <div className="section-heading">
        <span className="eyebrow">导出</span>
        <h2>输出设置</h2>
      </div>

      <div className="form-grid">
        <label>文件前缀<input onChange={(e) => onUpdateExport({ fileNamePrefix: e.target.value })} type="text" value={exportSettings.fileNamePrefix} /></label>
        <label>补零位数<input className="number-input" min={1} onChange={(e) => onUpdateExport({ padding: Math.max(1, parseInteger(e.target.value)) })} type="number" value={exportSettings.padding} /></label>
        <label>导出跳帧<input className="number-input" min={0} onChange={(e) => onUpdateExport({ exportSkip: parseInteger(e.target.value) })} type="number" value={exportSettings.exportSkip} /></label>
        <label>图像格式
          <select onChange={(e) => onUpdateExport({ imageFormat: e.target.value as ExportSettings['imageFormat'] })} value={exportSettings.imageFormat}>
            <option value="png">PNG</option>
            <option value="webp">WEBP</option>
            <option value="jpeg">JPEG</option>
          </select>
        </label>
      </div>

      <div className="form-grid">
        <label>图集行数<input className="number-input" min={0} onChange={(e) => onUpdateExport({ spriteSheetRows: parseInteger(e.target.value) })} type="number" value={exportSettings.spriteSheetRows} /></label>
        <label>图集列数<input className="number-input" min={0} onChange={(e) => onUpdateExport({ spriteSheetColumns: parseInteger(e.target.value) })} type="number" value={exportSettings.spriteSheetColumns} /></label>
      </div>

      <div className="hint-card">
        <span className="eyebrow">排版建议</span>
        <p>最佳近似方形排版：{recommendedLayout.rows} 行 x {recommendedLayout.columns} 列<br />可导出帧总数：{exportFrameCount}</p>
      </div>

      <div className="button-grid" style={{ gridTemplateColumns: '1fr' }}>
        <button className="primary-button" disabled={exportFrameCount === 0} onClick={onExportSequence} type="button">导出单帧序列</button>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem' }}>
          <button className="primary-button" disabled={exportFrameCount === 0} onClick={onExportSheet} type="button">导出图集</button>
          <button className="primary-button" disabled={exportFrameCount === 0} onClick={onExportGif} type="button">导出 GIF</button>
        </div>
      </div>
    </section>
  )
}
