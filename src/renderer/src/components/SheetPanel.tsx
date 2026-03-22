import { useCallback, useEffect, useMemo, useState } from 'react'

import type { ExportSettings, GridCandidate, SheetState } from '@shared/types'

import { SplitPreview } from './SplitPreview'

interface SheetGeometryPreview {
  canApply: boolean
  columns: number
  frameHeight: number
  frameWidth: number
  predictedFrameCount: number
  rows: number
}

interface SheetPanelProps {
  canApply: boolean
  columns: number
  exportSettings: ExportSettings
  frameHeight: number
  frameWidth: number
  isBusy?: boolean
  onApply: (geometry: SheetGeometryPreview) => void
  onChooseCandidate: (candidate: GridCandidate) => void
  onExportSplitSequence: (geometry: SheetGeometryPreview) => void
  onUpdateSheet: (patch: Partial<SheetState>, recordHistory?: boolean) => void
  predictedFrameCount: number
  rows: number
  sheet: SheetState
}

interface SheetDraft {
  columns: string
  frameHeight: string
  frameWidth: string
  mode: SheetState['mode']
  rows: string
}

const DEBOUNCE_MS = 260

const parsePositiveInteger = (value: string): number | null => {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

const buildDraftGeometry = (
  sourceWidth: number,
  sourceHeight: number,
  draft: SheetDraft
): SheetGeometryPreview => {
  if (draft.mode === 'cell') {
    const frameWidth = parsePositiveInteger(draft.frameWidth) ?? 0
    const frameHeight = parsePositiveInteger(draft.frameHeight) ?? 0
    const rows = frameHeight > 0 ? Math.floor(sourceHeight / frameHeight) : 0
    const columns = frameWidth > 0 ? Math.floor(sourceWidth / frameWidth) : 0
    const canApply =
      frameWidth > 0 &&
      frameHeight > 0 &&
      columns > 0 &&
      rows > 0 &&
      sourceWidth % frameWidth === 0 &&
      sourceHeight % frameHeight === 0

    return {
      canApply,
      columns,
      frameHeight,
      frameWidth,
      predictedFrameCount: Math.max(0, rows * columns),
      rows
    }
  }

  const rows = parsePositiveInteger(draft.rows) ?? 0
  const columns = parsePositiveInteger(draft.columns) ?? 0
  const canApply = rows > 0 && columns > 0 && sourceWidth % columns === 0 && sourceHeight % rows === 0
  const frameWidth = canApply ? Math.floor(sourceWidth / columns) : columns > 0 ? Math.floor(sourceWidth / columns) : 0
  const frameHeight = canApply ? Math.floor(sourceHeight / rows) : rows > 0 ? Math.floor(sourceHeight / rows) : 0

  return {
    canApply,
    columns,
    frameHeight,
    frameWidth,
    predictedFrameCount: Math.max(0, rows * columns),
    rows
  }
}

export function SheetPanel({
  exportSettings,
  isBusy = false,
  onApply,
  onChooseCandidate,
  onExportSplitSequence,
  onUpdateSheet,
  sheet
}: SheetPanelProps) {
  const draftFromSheet = useMemo(
    () => ({
      columns: String(sheet.columns || ''),
      frameHeight: String(sheet.frameHeight || ''),
      frameWidth: String(sheet.frameWidth || ''),
      mode: sheet.mode,
      rows: String(sheet.rows || '')
    }),
    [sheet.columns, sheet.frameHeight, sheet.frameWidth, sheet.mode, sheet.rows]
  )
  const [draft, setDraft] = useState<SheetDraft>(draftFromSheet)

  useEffect(() => {
    setDraft(draftFromSheet)
  }, [draftFromSheet])

  const geometry = useMemo(
    () => buildDraftGeometry(sheet.sourceWidth, sheet.sourceHeight, draft),
    [draft, sheet.sourceHeight, sheet.sourceWidth]
  )

  const syncDraftToStore = useCallback((recordHistory = false) => {
    if (!sheet.source) {
      return
    }

    if (draft.mode === 'cell') {
      const frameWidth = parsePositiveInteger(draft.frameWidth)
      const frameHeight = parsePositiveInteger(draft.frameHeight)
      if (!frameWidth || !frameHeight) {
        return
      }

      const rows = Math.max(0, Math.floor(sheet.sourceHeight / frameHeight))
      const columns = Math.max(0, Math.floor(sheet.sourceWidth / frameWidth))
      if (
        sheet.mode === 'cell' &&
        sheet.rows === rows &&
        sheet.columns === columns &&
        sheet.frameWidth === frameWidth &&
        sheet.frameHeight === frameHeight
      ) {
        return
      }

      onUpdateSheet(
        {
          columns,
          frameHeight,
          frameWidth,
          mode: 'cell',
          rows
        },
        recordHistory
      )
      return
    }

    const rows = parsePositiveInteger(draft.rows)
    const columns = parsePositiveInteger(draft.columns)
    if (!rows || !columns) {
      return
    }
    const frameWidth = Math.floor(sheet.sourceWidth / columns)
    const frameHeight = Math.floor(sheet.sourceHeight / rows)
    if (
      sheet.mode === 'grid' &&
      sheet.rows === rows &&
      sheet.columns === columns &&
      sheet.frameWidth === frameWidth &&
      sheet.frameHeight === frameHeight
    ) {
      return
    }

    onUpdateSheet(
      {
        columns,
        frameHeight,
        frameWidth,
        mode: 'grid',
        rows
      },
      recordHistory
    )
  }, [draft, onUpdateSheet, sheet])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      syncDraftToStore(false)
    }, DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timer)
    }
  }, [draft, syncDraftToStore])

  if (!sheet.source) {
    return (
      <section className="panel stack">
        <div className="section-heading">
          <span className="eyebrow">拆分</span>
          <h2>图集识别</h2>
        </div>
        <p className="muted-copy">导入单张图后，可以预览规则图集的拆分结果，并手动覆盖行列或帧尺寸。</p>
      </section>
    )
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
          className={draft.mode === 'grid' ? 'toggle-button active' : 'toggle-button'}
          onClick={() => {
            setDraft((current) => ({ ...current, mode: 'grid' }))
            onUpdateSheet({ mode: 'grid' }, false)
          }}
          type="button"
        >
          行列方式
        </button>
        <button
          className={draft.mode === 'cell' ? 'toggle-button active' : 'toggle-button'}
          onClick={() => {
            setDraft((current) => ({ ...current, mode: 'cell' }))
            onUpdateSheet({ mode: 'cell' }, false)
          }}
          type="button"
        >
          帧尺寸方式
        </button>
      </div>

      {draft.mode === 'grid' ? (
        <div className="form-grid">
          <label>
            行
            <input
              className="number-input"
              min={1}
              onBlur={() => syncDraftToStore(true)}
              onChange={(event) => setDraft((current) => ({ ...current, rows: event.target.value }))}
              type="number"
              value={draft.rows}
            />
          </label>
          <label>
            列
            <input
              className="number-input"
              min={1}
              onBlur={() => syncDraftToStore(true)}
              onChange={(event) => setDraft((current) => ({ ...current, columns: event.target.value }))}
              type="number"
              value={draft.columns}
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
              onBlur={() => syncDraftToStore(true)}
              onChange={(event) => setDraft((current) => ({ ...current, frameWidth: event.target.value }))}
              type="number"
              value={draft.frameWidth}
            />
          </label>
          <label>
            帧高
            <input
              className="number-input"
              min={1}
              onBlur={() => syncDraftToStore(true)}
              onChange={(event) => setDraft((current) => ({ ...current, frameHeight: event.target.value }))}
              type="number"
              value={draft.frameHeight}
            />
          </label>
        </div>
      )}

      <div className="stats-grid">
        <div className="stat-card">
          <span>帧尺寸</span>
          <strong>
            {geometry.frameWidth} x {geometry.frameHeight}
          </strong>
        </div>
        <div className="stat-card">
          <span>预计帧数</span>
          <strong>{geometry.predictedFrameCount}</strong>
        </div>
      </div>

      <SplitPreview
        canApply={geometry.canApply}
        columns={geometry.columns}
        frameHeight={geometry.frameHeight}
        frameWidth={geometry.frameWidth}
        predictedFrameCount={geometry.predictedFrameCount}
        rows={geometry.rows}
        source={sheet.source}
      />

      <div className="button-grid">
        <button
          className="primary-button"
          disabled={!geometry.canApply || isBusy}
          onClick={() => {
            syncDraftToStore(true)
            onApply(geometry)
          }}
          type="button"
        >
          应用到时间轴
        </button>
        <button
          className="secondary-button"
          disabled={!geometry.canApply || isBusy}
          onClick={() => {
            syncDraftToStore(true)
            onExportSplitSequence(geometry)
          }}
          type="button"
        >
          导出拆分序列
        </button>
      </div>

      <div className="hint-card">
        <span className="eyebrow">导出设置</span>
        <p>
          当前会复用统一导出设置：{exportSettings.imageFormat.toUpperCase()}，前缀“{exportSettings.fileNamePrefix}”，补零 {exportSettings.padding} 位，跳帧 {exportSettings.exportSkip}。
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
                {candidate.label}（置信度 {(candidate.confidence * 100).toFixed(0)}%）
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </section>
  )
}
