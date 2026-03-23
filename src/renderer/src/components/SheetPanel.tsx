import { useCallback, useEffect, useMemo, useState } from 'react'

import type { ExportSettings, GridCandidate, SheetState } from '@shared/types'
import { getGridFrameMetrics } from '@lib/grid/sheetGeometry'

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
  appliedGeometrySignature: string | null
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

type ApplyState = 'clean' | 'invalid' | 'pending' | 'unapplied'

const DEBOUNCE_MS = 260

const parsePositiveInteger = (value: string): number | null => {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

const buildDraftGeometry = (sourceWidth: number, sourceHeight: number, draft: SheetDraft): SheetGeometryPreview => {
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
  const { canApply, frameHeight, frameWidth } = getGridFrameMetrics(sourceWidth, sourceHeight, rows, columns)

  return {
    canApply,
    columns,
    frameHeight,
    frameWidth,
    predictedFrameCount: Math.max(0, rows * columns),
    rows
  }
}

const describeExportSettings = (exportSettings: ExportSettings) =>
  `当前会复用统一导出设置：${exportSettings.imageFormat.toUpperCase()}，前缀“${exportSettings.fileNamePrefix}”，补零 ${exportSettings.padding} 位，跳帧 ${exportSettings.exportSkip}。`

const buildGeometrySignature = (
  source: SheetState['source'],
  geometry: Pick<SheetGeometryPreview, 'canApply' | 'columns' | 'frameHeight' | 'frameWidth' | 'rows'>
): string | null => {
  if (!source || !geometry.canApply) {
    return null
  }

  return [source.path || source.name, geometry.rows, geometry.columns, geometry.frameWidth, geometry.frameHeight].join('|')
}

const getApplyState = (
  source: SheetState['source'],
  geometry: SheetGeometryPreview,
  appliedGeometrySignature: string | null
): ApplyState => {
  if (!source) {
    return 'clean'
  }

  if (!geometry.canApply) {
    return 'invalid'
  }

  const currentSignature = buildGeometrySignature(source, geometry)
  if (!appliedGeometrySignature) {
    return 'unapplied'
  }

  return currentSignature === appliedGeometrySignature ? 'clean' : 'pending'
}

const getApplyNotice = (applyState: ApplyState): { body: string; title: string } | null => {
  switch (applyState) {
    case 'invalid':
      return {
        body: '当前参数还不能拆分，请检查行列或帧尺寸是否能整除原图。',
        title: '当前参数不可应用'
      }
    case 'pending':
      return {
        body: '已修改，未应用到时间轴。',
        title: '待应用'
      }
    case 'unapplied':
      return {
        body: '当前网格尚未应用到时间轴。',
        title: '未应用'
      }
    default:
      return null
  }
}

export function SheetPanel({
  appliedGeometrySignature,
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

  const applyState = useMemo(
    () => getApplyState(sheet.source, geometry, appliedGeometrySignature),
    [appliedGeometrySignature, geometry, sheet.source]
  )
  const applyNotice = useMemo(() => getApplyNotice(applyState), [applyState])

  const syncDraftToStore = useCallback(
    (recordHistory = false) => {
      if (!sheet.source) {
        return
      }

      if (draft.mode === 'cell') {
        const nextFrameWidth = parsePositiveInteger(draft.frameWidth)
        const nextFrameHeight = parsePositiveInteger(draft.frameHeight)
        if (!nextFrameWidth || !nextFrameHeight) {
          return
        }

        const nextRows = Math.max(0, Math.floor(sheet.sourceHeight / nextFrameHeight))
        const nextColumns = Math.max(0, Math.floor(sheet.sourceWidth / nextFrameWidth))
        if (
          sheet.mode === 'cell' &&
          sheet.rows === nextRows &&
          sheet.columns === nextColumns &&
          sheet.frameWidth === nextFrameWidth &&
          sheet.frameHeight === nextFrameHeight
        ) {
          return
        }

        onUpdateSheet(
          {
            columns: nextColumns,
            frameHeight: nextFrameHeight,
            frameWidth: nextFrameWidth,
            mode: 'cell',
            rows: nextRows
          },
          recordHistory
        )
        return
      }

      const nextRows = parsePositiveInteger(draft.rows)
      const nextColumns = parsePositiveInteger(draft.columns)
      if (!nextRows || !nextColumns) {
        return
      }

      const { frameHeight: nextFrameHeight, frameWidth: nextFrameWidth } = getGridFrameMetrics(
        sheet.sourceWidth,
        sheet.sourceHeight,
        nextRows,
        nextColumns
      )
      if (
        sheet.mode === 'grid' &&
        sheet.rows === nextRows &&
        sheet.columns === nextColumns &&
        sheet.frameWidth === nextFrameWidth &&
        sheet.frameHeight === nextFrameHeight
      ) {
        return
      }

      onUpdateSheet(
        {
          columns: nextColumns,
          frameHeight: nextFrameHeight,
          frameWidth: nextFrameWidth,
          mode: 'grid',
          rows: nextRows
        },
        recordHistory
      )
    },
    [draft, onUpdateSheet, sheet]
  )

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
      <section className="panel sheet-panel">
        <div className="stack sheet-panel-scroll">
          <div className="section-heading">
            <span className="eyebrow">拆分</span>
            <h2>图集识别</h2>
          </div>
          <p className="muted-copy">导入单张图后，可以预览规则图集的拆分结果，并手动覆盖行列或帧尺寸。</p>
        </div>
      </section>
    )
  }

  return (
    <section className="panel sheet-panel">
      <div className="stack sheet-panel-scroll">
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
          predictedFrameCount={geometry.predictedFrameCount}
          rows={geometry.rows}
          source={sheet.source}
        />

        <div className="hint-card">
          <span className="eyebrow">导出设置</span>
          <p>{describeExportSettings(exportSettings)}</p>
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
      </div>

      {applyNotice ? (
        <div
          aria-live="polite"
          className={`sheet-floating-notice sheet-floating-notice-${applyState}`}
          role="status"
        >
          <strong>{applyNotice.title}</strong>
          <span>{applyNotice.body}</span>
        </div>
      ) : null}

      <div className="sheet-action-bar">
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
      </div>
    </section>
  )
}
