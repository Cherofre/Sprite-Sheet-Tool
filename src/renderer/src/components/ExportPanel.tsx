import { useState } from 'react'
import { createPortal } from 'react-dom'

import type { ExportSettings } from '@shared/types'

interface ExportPanelProps {
  canExportSplitSequence?: boolean
  exportFrameCount: number
  exportSettings: ExportSettings
  isOpen?: boolean
  onExportGif: () => void
  onExportSequence: () => void
  onExportSplitSequence?: () => void
  onExportSheet: () => void
  onOpenChange?: (open: boolean) => void
  onUpdateExport: (patch: Partial<ExportSettings>, recordHistory?: boolean) => void
  recommendedLayout: { columns: number; rows: number }
}

const parseInteger = (value: string): number => Math.max(0, Number.parseInt(value || '0', 10) || 0)

export function ExportPanel({
  canExportSplitSequence = false,
  exportFrameCount,
  exportSettings,
  isOpen,
  onExportGif,
  onExportSequence,
  onExportSplitSequence,
  onExportSheet,
  onOpenChange,
  onUpdateExport,
  recommendedLayout
}: ExportPanelProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const currentOpen = isOpen ?? internalOpen

  const setOpen = (next: boolean) => {
    if (isOpen === undefined) {
      setInternalOpen(next)
    }

    onOpenChange?.(next)
  }

  if (exportFrameCount === 0 && !canExportSplitSequence && !currentOpen) {
    return null
  }

  const modal =
    currentOpen && typeof document !== 'undefined'
      ? createPortal(
          <div className="modal-overlay" onClick={() => setOpen(false)}>
            <div
              className="modal-card export-modal-card"
              onClick={(event) => {
                event.stopPropagation()
              }}
            >
              <div className="modal-header">
                <div>
                  <span className="eyebrow">导出</span>
                  <h2>高级导出设置</h2>
                </div>
                <button className="secondary-button" onClick={() => setOpen(false)} type="button">
                  关闭
                </button>
              </div>

              <div className="form-grid">
                <label>
                  输出格式
                  <select
                    onChange={(event) => onUpdateExport({ imageFormat: event.target.value as ExportSettings['imageFormat'] })}
                    value={exportSettings.imageFormat}
                  >
                    <option value="png">PNG</option>
                    <option value="webp">WEBP</option>
                    <option value="jpeg">JPEG</option>
                  </select>
                </label>
                <label>
                  文件前缀
                  <input
                    onChange={(event) => onUpdateExport({ fileNamePrefix: event.target.value })}
                    type="text"
                    value={exportSettings.fileNamePrefix}
                  />
                </label>
                <label>
                  补零位数
                  <input
                    className="number-input"
                    min={1}
                    onChange={(event) => onUpdateExport({ padding: Math.max(1, parseInteger(event.target.value)) })}
                    type="number"
                    value={exportSettings.padding}
                  />
                </label>
                <label>
                  导出跳帧
                  <input
                    className="number-input"
                    min={0}
                    onChange={(event) => onUpdateExport({ exportSkip: parseInteger(event.target.value) })}
                    type="number"
                    value={exportSettings.exportSkip}
                  />
                </label>
              </div>

              <div className="section-heading compact export-modal-section">
                <h3>图集布局</h3>
              </div>

              <div className="form-grid">
                <label>
                  图集行数（0 为自动）
                  <input
                    className="number-input"
                    min={0}
                    onChange={(event) => onUpdateExport({ spriteSheetRows: parseInteger(event.target.value) })}
                    type="number"
                    value={exportSettings.spriteSheetRows}
                  />
                </label>
                <label>
                  图集列数（0 为自动）
                  <input
                    className="number-input"
                    min={0}
                    onChange={(event) => onUpdateExport({ spriteSheetColumns: parseInteger(event.target.value) })}
                    type="number"
                    value={exportSettings.spriteSheetColumns}
                  />
                </label>
              </div>

              <div className="hint-card">
                <span className="eyebrow">建议</span>
                <p>
                  近似方形排版：{recommendedLayout.rows} 行 x {recommendedLayout.columns} 列。
                  <br />
                  当前可导出帧数：{exportFrameCount}。
                </p>
              </div>

              <div className="export-action-grid export-modal-actions">
                {exportFrameCount > 0 ? (
                  <>
                    <button
                      className="secondary-button"
                      onClick={() => {
                        setOpen(false)
                        onExportSheet()
                      }}
                      type="button"
                    >
                      导出序列图
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => {
                        setOpen(false)
                        onExportGif()
                      }}
                      type="button"
                    >
                      导出 GIF
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => {
                        setOpen(false)
                        onExportSequence()
                      }}
                      type="button"
                    >
                      导出单帧
                    </button>
                  </>
                ) : null}

                {canExportSplitSequence && onExportSplitSequence ? (
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setOpen(false)
                      onExportSplitSequence()
                    }}
                    type="button"
                  >
                    导出拆分
                  </button>
                ) : null}
              </div>
            </div>
          </div>,
          document.body
        )
      : null

  return (
    <>
      <section className="panel stack export-launcher">
        <button className="secondary-button full-width-button export-launcher-button" onClick={() => setOpen(true)} type="button">
          配置并导出
        </button>
      </section>
      {modal}
    </>
  )
}
