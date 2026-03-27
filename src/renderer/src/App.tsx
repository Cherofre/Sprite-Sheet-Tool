import { startTransition, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'

import { DEFAULT_EXPORT, DEFAULT_PLAYBACK, SUPPORTED_EXTENSIONS } from '@shared/constants'
import type {
  ExportSettings,
  FrameItem,
  GridCandidate,
  ImportedFilePayload,
  PlaybackSettings,
  SheetState,
  TaskProgress,
  UpdateStatus
} from '@shared/types'

import { buildExternalEditTempFileName, buildReinjectedFrame } from '@features/edit/externalEditor'
import { buildExportFileName, buildExportSequence } from '@features/export/plans'
import { createEmptySheetState } from '@features/history/history'
import {
  buildSingleImageImportPromptFromSheet,
  buildImportSession,
  buildSheetImportSession,
  buildSingleFrameImportSession,
  type ImportSession,
  type SheetImportGeometry,
  type SingleImageImportPrompt
} from '@features/import/importSession'
import { normalizeSheetLayout, recommendSheetLayout } from '@features/merge/layout'
import { advanceSequencePosition, buildFrameSequence } from '@features/preview/frameSequence'
import { getGridFrameMetrics } from '@lib/grid/sheetGeometry'
import { canvasToBytes, composeSpriteSheet, encodeFramesToBytesBatch, filePayloadToFrame, rotateFrames, splitSheetToFrames } from '@lib/image/browser'
import { dataUrlToBytes } from '@lib/image/dataUrl'
import { encodeGif } from '@lib/image/gif'

import { ExportPanel } from './components/ExportPanel'
import { FrameTimeline } from './components/FrameTimeline'
import { type GuideModalReason, GuideModal, type GuideSectionId } from './components/GuideModal'
import { ImportPanel } from './components/ImportPanel'
import { PlaybackPanel } from './components/PlaybackPanel'
import { PreviewStage } from './components/PreviewStage'
import { type UiPreferences, SettingsPanel } from './components/SettingsPanel'
import { SheetPanel } from './components/SheetPanel'
import { UpdateReminderCard } from './components/UpdateReminderCard'
import { useCanRedo, useCanUndo, useEditorStore } from './store/editorStore'

const OPERATION_CANCELLED = '__OPERATION_CANCELLED__'
const DRAWER_OPEN_DELAY_MS = 150
const EXTERNAL_EDIT_POLL_INTERVAL_MS = 1200
const EXPORT_ENCODE_BATCH_SIZE = 8
const EAGER_SINGLE_IMAGE_PROMPT_CONFIDENCE = 0.5
const SINGLE_IMAGE_MODAL_CANDIDATE_LIMIT = 4
const UPDATE_STATUS_POLL_INTERVAL_MS = 800
const UI_PREFERENCES_KEY = 'sprite-sheet-tool.ui-preferences.v1'
const GUIDE_LAST_SEEN_VERSION_KEY = 'sprite-sheet-tool.guide.last-seen-version.v1'
const IGNORED_UPDATE_VERSION_KEY = 'sprite-sheet-tool.updates.ignored-version.v1'
const PLAYBACK_PREFERENCES_KEY = 'sprite-sheet-tool.playback-preferences.v1'
const EXPORT_PREFERENCES_KEY = 'sprite-sheet-tool.export-preferences.v1'
const DEFAULT_UI_PREFERENCES: UiPreferences = {
  drawerBlurDelayMs: 400,
  drawerFixedMode: 'none',
  guideAutoShow: true,
  photoshopPath: ''
}
const DEFAULT_UPDATE_STATUS: UpdateStatus = {
  canCheck: false,
  canDownload: false,
  canInstall: false,
  currentVersion: '...',
  downloadProgressPercent: null,
  downloadUrl: null,
  latestVersion: null,
  message: '正在读取更新信息...',
  mode: 'disabled',
  phase: 'idle'
}

const saveFiltersByFormat = {
  gif: [{ extensions: ['gif'], name: 'GIF 动图' }],
  jpeg: [{ extensions: ['jpg', 'jpeg'], name: 'JPEG 图片' }],
  png: [{ extensions: ['png'], name: 'PNG 图片' }],
  webp: [{ extensions: ['webp'], name: 'WEBP 图片' }]
}

interface OperationProgressState {
  cancellable: boolean
  detail: string
  percent: number | null
  title: string
}

interface OperationController {
  cancelled: boolean
  id: number
}

interface OperationConfig {
  cancelledMessage?: string
  onCancelled?: () => Promise<void>
}

interface DrawerOpenState {
  left: boolean
  right: boolean
}

interface ExportNotice {
  label: string
  targetPath: string
}

type GuideDismissMode = 'never-auto-show' | 'normal'

type ImportMode = 'append' | 'replace' | 'replace-current'

interface PendingImportPrompt {
  currentFrameCount: number
  currentFrameIndex: number
  sourceLabel: string
}

type PendingSingleImageImportPrompt = SingleImageImportPrompt

interface PendingSingleImageImportDraft {
  columns: string
  frameHeight: string
  frameWidth: string
  mode: SheetState['mode']
  rows: string
}

interface PendingSingleImageGeometry extends SheetImportGeometry {
  canApply: boolean
  predictedFrameCount: number
}

interface ExternalEditSession {
  filePath: string
  lastFailedModifiedTimeMs?: number
  lastModifiedTimeMs: number
}

interface PersistedExportPreferences {
  exportSettings: ExportSettings
  lastDirectory: string | null
}

type PersistedPlaybackPreferences = Pick<PlaybackSettings, 'background' | 'fps' | 'loopMode' | 'previewSkip' | 'reverse' | 'zoom'>

interface SheetGeometryState {
  canApply: boolean
  columns: number
  frameHeight: number
  frameWidth: number
  predictedFrameCount: number
  rows: number
}

interface SmokeBridge {
  exportGif: () => Promise<void>
  exportSequence: () => Promise<void>
  getSnapshot: () => {
    frameCount: number
    playback: {
      currentFrame: number
      fps: number
      isPlaying: boolean
    }
    sheet: {
      autoApplied: boolean
      columns: number
      enabled: boolean
      rows: number
    }
  }
  importPaths: (paths: string[]) => Promise<void>
}

const shortcutRows = [
  ['F1', '打开快捷键说明'],
  ['Space', '播放 / 暂停'],
  ['F', '视图重置到适应'],
  ['A / D / ← / → / ↑ / ↓', '上一帧 / 下一帧'],
  ['Home / End', '跳到首帧 / 末帧'],
  ['Delete / Backspace', '删除选中帧'],
  ['Ctrl/Cmd + A', '全选时间轴帧'],
  ['Ctrl/Cmd + Z', '撤销'],
  ['Ctrl/Cmd + Shift + Z', '重做'],
  ['Ctrl/Cmd + O', '导入文件'],
  ['Ctrl/Cmd + Shift + O', '导入文件夹'],
  ['Ctrl/Cmd + V', '从剪贴板导入图片'],
  ['Ctrl/Cmd + E', '打开导出设置'],
  ['Ctrl/Cmd + ,', '打开设置'],
  ['Esc', '关闭说明或取消当前任务']
] as const

const guideShortcutRows = shortcutRows.map(([shortcut, description]) => ({
  description,
  shortcut
}))

const joinPath = (directory: string, fileName: string): string => `${directory.replace(/[\\/]+$/, '')}/${fileName}`

const hasFileDrag = (dataTransfer?: DataTransfer | null): boolean =>
  Array.from(dataTransfer?.types ?? []).includes('Files')

const isSupportedDroppedFile = (fileName: string): boolean => {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? ''
  return SUPPORTED_EXTENSIONS.includes(extension as (typeof SUPPORTED_EXTENSIONS)[number])
}

const readFileAsDataUrl = async (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }

      reject(new Error('无法读取拖入文件。'))
    }
    reader.onerror = () => reject(new Error('无法读取拖入文件。'))
    reader.readAsDataURL(file)
  })

const getExtensionFromMimeType = (mimeType: string): string => {
  const normalized = mimeType.toLowerCase()
  switch (normalized) {
    case 'image/gif':
      return 'gif'
    case 'image/jpeg':
      return 'jpg'
    case 'image/png':
      return 'png'
    case 'image/webp':
      return 'webp'
    default: {
      const rawExtension = normalized.split('/')[1]?.split('+')[0]
      return rawExtension && isSupportedDroppedFile(`file.${rawExtension}`) ? rawExtension : 'png'
    }
  }
}

const buildImportedPayloadFromFile = async (file: File, fallbackName?: string): Promise<ImportedFilePayload> => {
  const derivedExtension = file.name.split('.').pop()?.toLowerCase()
  const extension = derivedExtension && isSupportedDroppedFile(`file.${derivedExtension}`) ? derivedExtension : getExtensionFromMimeType(file.type)
  const safeName = file.name || fallbackName || `imported-image.${extension}`

  return {
    dataUrl: await readFileAsDataUrl(file),
    extension,
    mimeType: file.type || `image/${extension}`,
    name: safeName.includes('.') ? safeName : `${safeName}.${extension}`,
    path: '',
    size: file.size
  }
}

const extractClipboardImageFiles = (clipboardData: DataTransfer | null): File[] =>
  Array.from(clipboardData?.items ?? [])
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file))

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  const tagName = target.tagName
  return target.isContentEditable || tagName === 'INPUT' || tagName === 'SELECT' || tagName === 'TEXTAREA'
}

const isDrawerStickyFocusTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  const tagName = target.tagName
  return tagName === 'INPUT' || tagName === 'SELECT' || tagName === 'TEXTAREA'
}

const getSheetGeometry = (sheet: SheetState): SheetGeometryState => {
  if (!sheet.source || sheet.sourceWidth <= 0 || sheet.sourceHeight <= 0) {
    return {
      canApply: false,
      columns: 0,
      frameHeight: 0,
      frameWidth: 0,
      predictedFrameCount: 0,
      rows: 0
    }
  }

  if (sheet.mode === 'cell') {
    const validCell = sheet.frameWidth > 0 && sheet.frameHeight > 0
    const exact = validCell && sheet.sourceWidth % sheet.frameWidth === 0 && sheet.sourceHeight % sheet.frameHeight === 0
    const columns = exact ? Math.floor(sheet.sourceWidth / sheet.frameWidth) : Math.floor(sheet.sourceWidth / Math.max(1, sheet.frameWidth))
    const rows = exact ? Math.floor(sheet.sourceHeight / sheet.frameHeight) : Math.floor(sheet.sourceHeight / Math.max(1, sheet.frameHeight))

    return {
      canApply: exact && rows > 0 && columns > 0,
      columns,
      frameHeight: sheet.frameHeight,
      frameWidth: sheet.frameWidth,
      predictedFrameCount: Math.max(0, rows * columns),
      rows
    }
  }

  const { canApply, frameHeight, frameWidth } = getGridFrameMetrics(
    sheet.sourceWidth,
    sheet.sourceHeight,
    sheet.rows,
    sheet.columns
  )

  return {
    canApply,
    columns: sheet.columns,
    frameHeight,
    frameWidth,
    predictedFrameCount: canApply ? sheet.rows * sheet.columns : 0,
    rows: sheet.rows
  }
}

const parsePositiveInteger = (value: string): number | null => {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

const buildPendingSingleImageDraft = (
  prompt: PendingSingleImageImportPrompt
): PendingSingleImageImportDraft => ({
  columns: String(prompt.columns || ''),
  frameHeight: String(prompt.frameHeight || ''),
  frameWidth: String(prompt.frameWidth || ''),
  mode: 'grid',
  rows: String(prompt.rows || '')
})

const getPendingSingleImageGeometry = (
  prompt: PendingSingleImageImportPrompt,
  draft: PendingSingleImageImportDraft
): PendingSingleImageGeometry => {
  if (draft.mode === 'cell') {
    const frameWidth = parsePositiveInteger(draft.frameWidth) ?? 0
    const frameHeight = parsePositiveInteger(draft.frameHeight) ?? 0
    const rows = frameHeight > 0 ? Math.floor(prompt.sourceHeight / frameHeight) : 0
    const columns = frameWidth > 0 ? Math.floor(prompt.sourceWidth / frameWidth) : 0
    const canApply =
      frameWidth > 0 &&
      frameHeight > 0 &&
      columns > 0 &&
      rows > 0 &&
      prompt.sourceWidth % frameWidth === 0 &&
      prompt.sourceHeight % frameHeight === 0

    return {
      canApply,
      columns,
      frameHeight,
      frameWidth,
      mode: 'cell',
      predictedFrameCount: Math.max(0, rows * columns),
      rows
    }
  }

  const rows = parsePositiveInteger(draft.rows) ?? 0
  const columns = parsePositiveInteger(draft.columns) ?? 0
  const { canApply, frameHeight, frameWidth } = getGridFrameMetrics(prompt.sourceWidth, prompt.sourceHeight, rows, columns)

  return {
    canApply,
    columns,
    frameHeight,
    frameWidth,
    mode: 'grid',
    predictedFrameCount: Math.max(0, rows * columns),
    rows
  }
}

const matchesSheetImportGeometry = (session: ImportSession, geometry: SheetImportGeometry): boolean =>
  session.sheet.mode === geometry.mode &&
  session.sheet.rows === geometry.rows &&
  session.sheet.columns === geometry.columns &&
  session.sheet.frameWidth === geometry.frameWidth &&
  session.sheet.frameHeight === geometry.frameHeight

const isApproximateGridCandidate = (prompt: PendingSingleImageImportPrompt, candidate: GridCandidate): boolean =>
  prompt.sourceWidth % candidate.columns !== 0 || prompt.sourceHeight % candidate.rows !== 0

const formatGridCandidateDetail = (prompt: PendingSingleImageImportPrompt, candidate: GridCandidate): string =>
  `${candidate.rows * candidate.columns} 帧 · ${isApproximateGridCandidate(prompt, candidate) ? '约 ' : ''}${candidate.frameWidth} x ${candidate.frameHeight}`

const buildProgressState = (progress: TaskProgress): OperationProgressState => {
  const formattedCount =
    typeof progress.current === 'number' && typeof progress.total === 'number'
      ? ` (${progress.current}/${progress.total})`
      : ''

  switch (progress.stage) {
    case 'measure-sheet':
      return { cancellable: true, detail: '正在读取图像尺寸与基础信息...', percent: progress.percent ?? 10, title: '正在分析图集' }
    case 'rank-grid':
      return { cancellable: true, detail: '正在评估规则网格候选...', percent: progress.percent ?? 25, title: '正在分析图集' }
    case 'split-sheet':
      return { cancellable: true, detail: `正在切出图集帧${formattedCount}`, percent: progress.percent ?? null, title: '正在拆分图集' }
    case 'decode-gif':
      return { cancellable: true, detail: `正在解析 GIF 帧${formattedCount}`, percent: progress.percent ?? null, title: '正在导入 GIF' }
    case 'convert-files':
      return { cancellable: true, detail: `正在生成帧数据${formattedCount}`, percent: progress.percent ?? null, title: '正在导入资源' }
    case 'rotate-frames':
      return { cancellable: true, detail: `正在旋转帧${formattedCount}`, percent: progress.percent ?? null, title: '正在旋转序列' }
    case 'compose-sheet':
      return { cancellable: true, detail: `正在合并图集帧${formattedCount}`, percent: progress.percent ?? null, title: '正在导出序列图' }
    case 'encode-gif':
      return { cancellable: true, detail: `正在编码 GIF${formattedCount}`, percent: progress.percent ?? null, title: '正在导出 GIF' }
    case 'export-sequence':
      return { cancellable: true, detail: `正在导出图片序列${formattedCount}`, percent: progress.percent ?? null, title: '正在导出图片' }
    case 'export-split-sequence':
      return { cancellable: true, detail: `正在导出拆分序列${formattedCount}`, percent: progress.percent ?? null, title: '正在导出拆分结果' }
    default:
      return { cancellable: true, detail: progress.detail ?? '正在处理，请稍候...', percent: progress.percent ?? null, title: '正在处理图像' }
  }
}

const isCancelledError = (error: unknown): boolean =>
  error instanceof Error && error.message === OPERATION_CANCELLED

const clampFps = (value: number): number => Math.max(1, Math.min(60, Math.round(value)))

const getExportOperationTitle = (stage: 'export-sequence' | 'export-split-sequence'): string =>
  stage === 'export-sequence' ? '正在导出图片' : '正在导出拆分结果'

const HandleLockIcon = ({ locked }: { locked: boolean }) =>
  locked ? (
    <svg aria-hidden="true" className="handle-lock-icon" viewBox="0 0 24 24">
      <path
        d="M7 10V8a5 5 0 0 1 10 0v2h1a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h1Zm2 0h6V8a3 3 0 1 0-6 0v2Zm3 3a2 2 0 0 1 1 3.732V19h-2v-2.268A2 2 0 0 1 12 13Z"
        fill="currentColor"
      />
    </svg>
  ) : (
    <svg aria-hidden="true" className="handle-lock-icon" viewBox="0 0 24 24">
      <path
        d="M17 8V7a5 5 0 0 0-9.2-2.8 1 1 0 1 0 1.7 1 3 3 0 0 1 5.5 1.8v1H8a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1Zm1 11H8v-9h10v9Zm-6-6a2 2 0 0 1 1 3.732V18h-2v-1.268A2 2 0 0 1 12 13Z"
        fill="currentColor"
      />
    </svg>
  )

const toggleFixedMode = (currentMode: UiPreferences['drawerFixedMode'], side: 'left' | 'right'): UiPreferences['drawerFixedMode'] => {
  if (side === 'left') {
    switch (currentMode) {
      case 'none':
        return 'left'
      case 'left':
        return 'none'
      case 'right':
        return 'both'
      case 'both':
        return 'right'
      default:
        return currentMode
    }
  }

  switch (currentMode) {
    case 'none':
      return 'right'
    case 'right':
      return 'none'
    case 'left':
      return 'both'
    case 'both':
      return 'left'
    default:
      return currentMode
  }
}

const buildSheetGeometrySignature = (
  source: SheetState['source'],
  geometry: Pick<SheetGeometryState, 'canApply' | 'columns' | 'frameHeight' | 'frameWidth' | 'rows'>
): string | null => {
  if (!source || !geometry.canApply) {
    return null
  }

  return [
    source.path || source.name,
    geometry.rows,
    geometry.columns,
    geometry.frameWidth,
    geometry.frameHeight
  ].join('|')
}

const loadStoredStringPreference = (key: string): string | null => {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const rawValue = window.localStorage.getItem(key)
    return rawValue?.trim() ? rawValue.trim() : null
  } catch {
    return null
  }
}

const loadUiPreferences = (): UiPreferences => {
  if (typeof window === 'undefined') {
    return DEFAULT_UI_PREFERENCES
  }

  try {
    const rawValue = window.localStorage.getItem(UI_PREFERENCES_KEY)
    if (!rawValue) {
      return DEFAULT_UI_PREFERENCES
    }

    const parsed = JSON.parse(rawValue) as Partial<UiPreferences>
    return {
      drawerBlurDelayMs:
        typeof parsed.drawerBlurDelayMs === 'number' ? Math.max(0, Math.min(3000, parsed.drawerBlurDelayMs)) : DEFAULT_UI_PREFERENCES.drawerBlurDelayMs,
      drawerFixedMode:
        parsed.drawerFixedMode === 'left' || parsed.drawerFixedMode === 'right' || parsed.drawerFixedMode === 'both'
          ? parsed.drawerFixedMode
          : DEFAULT_UI_PREFERENCES.drawerFixedMode,
      guideAutoShow: typeof parsed.guideAutoShow === 'boolean' ? parsed.guideAutoShow : DEFAULT_UI_PREFERENCES.guideAutoShow,
      photoshopPath: typeof parsed.photoshopPath === 'string' ? parsed.photoshopPath.trim() : DEFAULT_UI_PREFERENCES.photoshopPath
    }
  } catch {
    return DEFAULT_UI_PREFERENCES
  }
}

const clampPersistedZoom = (value: unknown): number | 'fit' => {
  if (value === 'fit') {
    return 'fit'
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(10, Math.min(800, Math.round(value)))
  }

  return DEFAULT_PLAYBACK.zoom
}

const loadPlaybackPreferences = (): PersistedPlaybackPreferences => {
  if (typeof window === 'undefined') {
    return {
      background: DEFAULT_PLAYBACK.background,
      fps: DEFAULT_PLAYBACK.fps,
      loopMode: DEFAULT_PLAYBACK.loopMode,
      previewSkip: DEFAULT_PLAYBACK.previewSkip,
      reverse: DEFAULT_PLAYBACK.reverse,
      zoom: DEFAULT_PLAYBACK.zoom
    }
  }

  try {
    const rawValue = window.localStorage.getItem(PLAYBACK_PREFERENCES_KEY)
    if (!rawValue) {
      return {
        background: DEFAULT_PLAYBACK.background,
        fps: DEFAULT_PLAYBACK.fps,
        loopMode: DEFAULT_PLAYBACK.loopMode,
        previewSkip: DEFAULT_PLAYBACK.previewSkip,
        reverse: DEFAULT_PLAYBACK.reverse,
        zoom: DEFAULT_PLAYBACK.zoom
      }
    }

    const parsed = JSON.parse(rawValue) as Partial<PersistedPlaybackPreferences>
    return {
      background: parsed.background === 'black' || parsed.background === 'white' ? parsed.background : DEFAULT_PLAYBACK.background,
      fps: typeof parsed.fps === 'number' ? clampFps(parsed.fps) : DEFAULT_PLAYBACK.fps,
      loopMode:
        parsed.loopMode === 'once' || parsed.loopMode === 'pingpong' ? parsed.loopMode : DEFAULT_PLAYBACK.loopMode,
      previewSkip:
        typeof parsed.previewSkip === 'number' ? Math.max(0, Math.min(99, Math.round(parsed.previewSkip))) : DEFAULT_PLAYBACK.previewSkip,
      reverse: typeof parsed.reverse === 'boolean' ? parsed.reverse : DEFAULT_PLAYBACK.reverse,
      zoom: clampPersistedZoom(parsed.zoom)
    }
  } catch {
    return {
      background: DEFAULT_PLAYBACK.background,
      fps: DEFAULT_PLAYBACK.fps,
      loopMode: DEFAULT_PLAYBACK.loopMode,
      previewSkip: DEFAULT_PLAYBACK.previewSkip,
      reverse: DEFAULT_PLAYBACK.reverse,
      zoom: DEFAULT_PLAYBACK.zoom
    }
  }
}

const loadExportPreferences = (): PersistedExportPreferences => {
  if (typeof window === 'undefined') {
    return {
      exportSettings: DEFAULT_EXPORT,
      lastDirectory: null
    }
  }

  try {
    const rawValue = window.localStorage.getItem(EXPORT_PREFERENCES_KEY)
    if (!rawValue) {
      return {
        exportSettings: DEFAULT_EXPORT,
        lastDirectory: null
      }
    }

    const parsed = JSON.parse(rawValue) as Partial<PersistedExportPreferences> & { exportSettings?: Partial<ExportSettings> }
    const rawExport: Partial<ExportSettings> = parsed.exportSettings ?? {}

    return {
      exportSettings: {
        exportSkip:
          typeof rawExport.exportSkip === 'number' ? Math.max(0, Math.min(99, Math.round(rawExport.exportSkip))) : DEFAULT_EXPORT.exportSkip,
        fileNamePrefix: typeof rawExport.fileNamePrefix === 'string' && rawExport.fileNamePrefix.trim() ? rawExport.fileNamePrefix : DEFAULT_EXPORT.fileNamePrefix,
        imageFormat:
          rawExport.imageFormat === 'jpeg' || rawExport.imageFormat === 'webp' ? rawExport.imageFormat : DEFAULT_EXPORT.imageFormat,
        padding: typeof rawExport.padding === 'number' ? Math.max(1, Math.min(8, Math.round(rawExport.padding))) : DEFAULT_EXPORT.padding,
        spriteSheetColumns:
          typeof rawExport.spriteSheetColumns === 'number' ? Math.max(0, Math.round(rawExport.spriteSheetColumns)) : DEFAULT_EXPORT.spriteSheetColumns,
        spriteSheetRows:
          typeof rawExport.spriteSheetRows === 'number' ? Math.max(0, Math.round(rawExport.spriteSheetRows)) : DEFAULT_EXPORT.spriteSheetRows
      },
      lastDirectory: typeof parsed.lastDirectory === 'string' && parsed.lastDirectory.trim() ? parsed.lastDirectory : null
    }
  } catch {
    return {
      exportSettings: DEFAULT_EXPORT,
      lastDirectory: null
    }
  }
}

const getDirectoryFromPath = (targetPath: string): string | null => {
  const normalized = targetPath.replace(/[\\/]+$/, '')
  const lastSlashIndex = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  if (lastSlashIndex <= 0) {
    return null
  }

  return normalized.slice(0, lastSlashIndex)
}

const joinDefaultFilePath = (directory: string | null, fileName: string): string => {
  if (!directory) {
    return fileName
  }

  return `${directory.replace(/[\\/]+$/, '')}/${fileName}`
}

export default function App() {
  const frames = useEditorStore((state) => state.frames)
  const playback = useEditorStore((state) => state.playback)
  const exportSettings = useEditorStore((state) => state.exportSettings)
  const sheet = useEditorStore((state) => state.sheet)
  const selectedFrameIds = useEditorStore((state) => state.selectedFrameIds)
  const statusMessage = useEditorStore((state) => state.statusMessage)
  const errorMessage = useEditorStore((state) => state.errorMessage)
  const isBusy = useEditorStore((state) => state.isBusy)
  const applyImportSession = useEditorStore((state) => state.applyImportSession)
  const clearError = useEditorStore((state) => state.clearError)
  const deleteSelectedFrames = useEditorStore((state) => state.deleteSelectedFrames)
  const moveFrame = useEditorStore((state) => state.moveFrame)
  const redo = useEditorStore((state) => state.redo)
  const replaceFrame = useEditorStore((state) => state.replaceFrame)
  const replaceFrames = useEditorStore((state) => state.replaceFrames)
  const resetWorkspace = useEditorStore((state) => state.resetWorkspace)
  const reverseFrames = useEditorStore((state) => state.reverseFrames)
  const selectFrame = useEditorStore((state) => state.selectFrame)
  const setBusy = useEditorStore((state) => state.setBusy)
  const setCurrentFrame = useEditorStore((state) => state.setCurrentFrame)
  const setErrorMessage = useEditorStore((state) => state.setErrorMessage)
  const setIsPlaying = useEditorStore((state) => state.setIsPlaying)
  const setSelectedFrames = useEditorStore((state) => state.setSelectedFrames)
  const setStatusMessage = useEditorStore((state) => state.setStatusMessage)
  const undo = useEditorStore((state) => state.undo)
  const updateExportSettings = useEditorStore((state) => state.updateExportSettings)
  const updatePlaybackSettings = useEditorStore((state) => state.updatePlaybackSettings)
  const updateSheetSettings = useEditorStore((state) => state.updateSheetSettings)
  const canUndo = useCanUndo()
  const canRedo = useCanRedo()

  const currentFrame = frames[playback.currentFrame]
  const canClear = frames.length > 0 || sheet.enabled
  const [drawerLocks, setDrawerLocks] = useState<DrawerOpenState>({ left: false, right: false })
  const [drawerOpen, setDrawerOpen] = useState<DrawerOpenState>({ left: false, right: false })
  const [isExportPanelOpen, setIsExportPanelOpen] = useState(false)
  const [guideReason, setGuideReason] = useState<GuideModalReason | null>(null)
  const [guideSection, setGuideSection] = useState<GuideSectionId>('quick-start')
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [pingPongDirection, setPingPongDirection] = useState<1 | -1>(1)
  const [isWindowDragActive, setIsWindowDragActive] = useState(false)
  const [operationProgress, setOperationProgress] = useState<OperationProgressState | null>(null)
  const [pendingImportPrompt, setPendingImportPrompt] = useState<PendingImportPrompt | null>(null)
  const [pendingSingleImageImportPrompt, setPendingSingleImageImportPrompt] = useState<PendingSingleImageImportPrompt | null>(null)
  const [pendingSingleImageImportDraft, setPendingSingleImageImportDraft] = useState<PendingSingleImageImportDraft | null>(null)
  const [isSingleImageManualEntryOpen, setIsSingleImageManualEntryOpen] = useState(false)
  const [uiPreferences, setUiPreferences] = useState<UiPreferences>(() => loadUiPreferences())
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>(DEFAULT_UPDATE_STATUS)
  const [isUpdateActionPending, setIsUpdateActionPending] = useState(false)
  const [lastSeenGuideVersion, setLastSeenGuideVersion] = useState<string | null>(() => loadStoredStringPreference(GUIDE_LAST_SEEN_VERSION_KEY))
  const [ignoredUpdateVersion, setIgnoredUpdateVersion] = useState<string | null>(() => loadStoredStringPreference(IGNORED_UPDATE_VERSION_KEY))
  const [dismissedUpdateVersionForSession, setDismissedUpdateVersionForSession] = useState<string | null>(null)
  const [persistedPlaybackPreferences] = useState<PersistedPlaybackPreferences>(() => loadPlaybackPreferences())
  const [persistedExportPreferences] = useState<PersistedExportPreferences>(() => loadExportPreferences())
  const [exportNotice, setExportNotice] = useState<ExportNotice | null>(null)
  const [pendingSplitExportGeometry, setPendingSplitExportGeometry] = useState<SheetGeometryState | null>(null)
  const [appliedSheetGeometrySignature, setAppliedSheetGeometrySignature] = useState<string | null>(null)
  const [resetViewNonce, setResetViewNonce] = useState(0)
  const [lastExportDirectory, setLastExportDirectory] = useState<string | null>(persistedExportPreferences.lastDirectory)
  const operationRef = useRef<OperationController | null>(null)
  const pendingImportActionRef = useRef<((mode: ImportMode) => Promise<void>) | null>(null)
  const pendingSingleImageImportRef = useRef<{ mode: ImportMode; session: ImportSession } | null>(null)
  const smokeFnsRef = useRef<SmokeBridge | null>(null)
  const drawerCloseTimersRef = useRef<{ left: number | null; right: number | null }>({ left: null, right: null })
  const drawerOpenTimersRef = useRef<{ left: number | null; right: number | null }>({ left: null, right: null })
  const drawerRefs = useRef<{ left: HTMLElement | null; right: HTMLElement | null }>({ left: null, right: null })
  const didHydratePersistentPreferencesRef = useRef(false)
  const didAttemptStartupUpdateCheckRef = useRef(false)
  const externalEditPollActiveRef = useRef(false)
  const externalEditSessionsRef = useRef<Map<string, ExternalEditSession>>(new Map())
  const windowDragDepthRef = useRef(0)
  const currentAppVersion = updateStatus.currentVersion !== '...' ? updateStatus.currentVersion : null
  const isGuideOpen = guideReason !== null

  useEffect(() => {
    if (!pendingSingleImageImportPrompt) {
      setPendingSingleImageImportDraft(null)
      setIsSingleImageManualEntryOpen(false)
      return
    }

    setPendingSingleImageImportDraft(buildPendingSingleImageDraft(pendingSingleImageImportPrompt))
    setIsSingleImageManualEntryOpen(false)
  }, [pendingSingleImageImportPrompt])

  const clearWindowDragState = useEffectEvent(() => {
    windowDragDepthRef.current = 0
    setIsWindowDragActive(false)
  })

  const pollExternalEditSessions = useEffectEvent(async () => {
    if (externalEditPollActiveRef.current) {
      return
    }

    const sessions = Array.from(externalEditSessionsRef.current.entries())
    if (sessions.length === 0) {
      return
    }

    externalEditPollActiveRef.current = true

    try {
      for (const [frameId, session] of sessions) {
        const currentFrameForSession = frames.find((frame) => frame.id === frameId)
        if (!currentFrameForSession) {
          externalEditSessionsRef.current.delete(frameId)
          continue
        }

        const modifiedTimeMs = await window.desktopApi.getFileModifiedTime(session.filePath)
        if (modifiedTimeMs === null || modifiedTimeMs <= session.lastModifiedTimeMs + 1) {
          continue
        }

        try {
          const payloads = await window.desktopApi.loadFiles([session.filePath])
          const payload = payloads[0]
          if (!payload) {
            throw new Error('无法读取 Photoshop 保存后的帧文件。')
          }

          const editedFrame = await filePayloadToFrame(payload, 'file')
          replaceFrame(frameId, buildReinjectedFrame(currentFrameForSession, editedFrame, session.filePath))
          session.lastFailedModifiedTimeMs = undefined
          session.lastModifiedTimeMs = modifiedTimeMs
          setStatusMessage(`已同步 Photoshop 修改：${currentFrameForSession.name}`)
        } catch (error) {
          if (session.lastFailedModifiedTimeMs !== modifiedTimeMs) {
            session.lastFailedModifiedTimeMs = modifiedTimeMs
            const message = error instanceof Error ? error.message : '重新载入 Photoshop 修改失败。'
            setErrorMessage(`“${currentFrameForSession.name}”回灌失败：${message}`)
          }
        }
      }
    } finally {
      externalEditPollActiveRef.current = false
    }
  })

  const isDrawerFixed = (side: 'left' | 'right'): boolean =>
    uiPreferences.drawerFixedMode === 'both' || uiPreferences.drawerFixedMode === side

  const isDrawerPinned = (side: 'left' | 'right'): boolean => isDrawerFixed(side) || drawerLocks[side]

  const isDrawerVisible = (side: 'left' | 'right'): boolean => isDrawerPinned(side) || drawerOpen[side]

  const playbackSequence = useMemo(
    () => buildFrameSequence(frames.length, playback.startFrame, playback.endFrame, playback.previewSkip, playback.reverse),
    [frames.length, playback.endFrame, playback.previewSkip, playback.reverse, playback.startFrame]
  )

  const exportSequence = useMemo(
    () => buildExportSequence(frames.length, playback, exportSettings),
    [exportSettings, frames.length, playback]
  )

  const exportFrames = exportSequence
    .map((index) => frames[index])
    .filter((frame): frame is FrameItem => Boolean(frame))

  const recommendedLayout = recommendSheetLayout(exportFrames.length)
  const sheetGeometry = getSheetGeometry(sheet)
  const pendingSingleImageGeometry = useMemo(
    () =>
      pendingSingleImageImportPrompt && pendingSingleImageImportDraft
        ? getPendingSingleImageGeometry(pendingSingleImageImportPrompt, pendingSingleImageImportDraft)
        : null,
    [pendingSingleImageImportDraft, pendingSingleImageImportPrompt]
  )
  const modalSingleImageCandidates = useMemo(
    () => pendingSingleImageImportPrompt?.candidates.slice(0, SINGLE_IMAGE_MODAL_CANDIDATE_LIMIT) ?? [],
    [pendingSingleImageImportPrompt]
  )
  const hasSheetSource = Boolean(sheet.source)
  const hasWorkspaceContent = frames.length > 0 || hasSheetSource
  const leftDrawerFixed = hasWorkspaceContent && isDrawerFixed('left')
  const rightDrawerFixed = hasWorkspaceContent && isDrawerFixed('right')

  useEffect(() => {
    window.localStorage.setItem(UI_PREFERENCES_KEY, JSON.stringify(uiPreferences))
  }, [uiPreferences])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    if (lastSeenGuideVersion) {
      window.localStorage.setItem(GUIDE_LAST_SEEN_VERSION_KEY, lastSeenGuideVersion)
      return
    }

    window.localStorage.removeItem(GUIDE_LAST_SEEN_VERSION_KEY)
  }, [lastSeenGuideVersion])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    if (ignoredUpdateVersion) {
      window.localStorage.setItem(IGNORED_UPDATE_VERSION_KEY, ignoredUpdateVersion)
      return
    }

    window.localStorage.removeItem(IGNORED_UPDATE_VERSION_KEY)
  }, [ignoredUpdateVersion])

  useEffect(() => {
    let isCancelled = false

    const loadUpdateStatus = async () => {
      try {
        const nextStatus = await window.desktopApi.getUpdateStatus()
        if (!isCancelled) {
          setUpdateStatus(nextStatus)
        }
      } catch (error) {
        if (!isCancelled) {
          const message = error instanceof Error ? error.message : '无法读取更新状态。'
          setUpdateStatus({
            ...DEFAULT_UPDATE_STATUS,
            message,
            phase: 'error'
          })
        }
      }
    }

    void loadUpdateStatus()

    return () => {
      isCancelled = true
    }
  }, [])

  useEffect(() => {
    if (dismissedUpdateVersionForSession && dismissedUpdateVersionForSession !== updateStatus.latestVersion) {
      setDismissedUpdateVersionForSession(null)
    }
  }, [dismissedUpdateVersionForSession, updateStatus.latestVersion])

  useEffect(() => {
    if (!currentAppVersion || !uiPreferences.guideAutoShow || isGuideOpen || isSettingsOpen || pendingImportPrompt || pendingSingleImageImportPrompt) {
      return
    }

    if (lastSeenGuideVersion === currentAppVersion) {
      return
    }

    setGuideSection('quick-start')
    setGuideReason(lastSeenGuideVersion ? 'update' : 'welcome')
  }, [currentAppVersion, guideReason, isGuideOpen, isSettingsOpen, lastSeenGuideVersion, pendingImportPrompt, pendingSingleImageImportPrompt, uiPreferences.guideAutoShow])

  useEffect(() => {
    if (didAttemptStartupUpdateCheckRef.current || !currentAppVersion || isGuideOpen || isSettingsOpen || pendingImportPrompt || pendingSingleImageImportPrompt) {
      return
    }

    if (!updateStatus.canCheck || updateStatus.mode === 'disabled') {
      return
    }

    didAttemptStartupUpdateCheckRef.current = true
    let isCancelled = false

    const runStartupUpdateCheck = async () => {
      try {
        const nextStatus = await window.desktopApi.checkForAppUpdates()
        if (!isCancelled && nextStatus.phase !== 'error') {
          setUpdateStatus(nextStatus)
        }
      } catch {
        // Silent startup checks should not interrupt the user flow.
      }
    }

    void runStartupUpdateCheck()

    return () => {
      isCancelled = true
    }
  }, [currentAppVersion, isGuideOpen, isSettingsOpen, pendingImportPrompt, pendingSingleImageImportPrompt, updateStatus.canCheck, updateStatus.mode])

  useEffect(() => {
    if (!isUpdateActionPending && updateStatus.phase !== 'checking' && updateStatus.phase !== 'downloading') {
      return
    }

    let isCancelled = false

    const pollUpdateStatus = async () => {
      try {
        const nextStatus = await window.desktopApi.getUpdateStatus()
        if (!isCancelled) {
          setUpdateStatus(nextStatus)
        }
      } catch {
        // Keep the current status when polling fails; the active action will surface the final error.
      }
    }

    void pollUpdateStatus()

    const timer = window.setInterval(() => {
      void pollUpdateStatus()
    }, UPDATE_STATUS_POLL_INTERVAL_MS)

    return () => {
      isCancelled = true
      window.clearInterval(timer)
    }
  }, [isUpdateActionPending, updateStatus.phase])

  useEffect(() => {
    const liveFrameIds = new Set(frames.map((frame) => frame.id))

    for (const frameId of Array.from(externalEditSessionsRef.current.keys())) {
      if (!liveFrameIds.has(frameId)) {
        externalEditSessionsRef.current.delete(frameId)
      }
    }
  }, [frames])

  useEffect(() => {
    const timer = window.setInterval(() => {
      void pollExternalEditSessions()
    }, EXTERNAL_EDIT_POLL_INTERVAL_MS)

    return () => {
      window.clearInterval(timer)
    }
  }, [pollExternalEditSessions])

  useEffect(() => {
    const editSessions = externalEditSessionsRef.current
    return () => {
      editSessions.clear()
    }
  }, [])

  useEffect(() => {
    if (didHydratePersistentPreferencesRef.current) {
      return
    }

    didHydratePersistentPreferencesRef.current = true
    updatePlaybackSettings(
      {
        background: persistedPlaybackPreferences.background,
        fps: persistedPlaybackPreferences.fps,
        loopMode: persistedPlaybackPreferences.loopMode,
        previewSkip: persistedPlaybackPreferences.previewSkip,
        reverse: persistedPlaybackPreferences.reverse,
        zoom: persistedPlaybackPreferences.zoom
      },
      false
    )
    updateExportSettings(persistedExportPreferences.exportSettings, false)
  }, [persistedExportPreferences.exportSettings, persistedPlaybackPreferences, updateExportSettings, updatePlaybackSettings])

  useEffect(() => {
    window.localStorage.setItem(
      PLAYBACK_PREFERENCES_KEY,
      JSON.stringify({
        background: playback.background,
        fps: playback.fps,
        loopMode: playback.loopMode,
        previewSkip: playback.previewSkip,
        reverse: playback.reverse,
        zoom: playback.zoom
      } satisfies PersistedPlaybackPreferences)
    )
  }, [playback.background, playback.fps, playback.loopMode, playback.previewSkip, playback.reverse, playback.zoom])

  useEffect(() => {
    window.localStorage.setItem(
      EXPORT_PREFERENCES_KEY,
      JSON.stringify({
        exportSettings,
        lastDirectory: lastExportDirectory
      } satisfies PersistedExportPreferences)
    )
  }, [exportSettings, lastExportDirectory])

  useEffect(() => {
    const drawerCloseTimers = drawerCloseTimersRef.current
    const drawerOpenTimers = drawerOpenTimersRef.current
    return () => {
      for (const timer of Object.values(drawerCloseTimers)) {
        if (timer !== null) {
          window.clearTimeout(timer)
        }
      }
      for (const timer of Object.values(drawerOpenTimers)) {
        if (timer !== null) {
          window.clearTimeout(timer)
        }
      }
    }
  }, [])

  const waitForPaint = async (): Promise<void> => {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve())
    })
  }

  const clearDrawerCloseTimer = (side: 'left' | 'right'): void => {
    const timer = drawerCloseTimersRef.current[side]
    if (timer !== null) {
      window.clearTimeout(timer)
      drawerCloseTimersRef.current[side] = null
    }
  }

  const clearDrawerOpenTimer = (side: 'left' | 'right'): void => {
    const timer = drawerOpenTimersRef.current[side]
    if (timer !== null) {
      window.clearTimeout(timer)
      drawerOpenTimersRef.current[side] = null
    }
  }

  const openDrawer = useEffectEvent((side: 'left' | 'right') => {
    clearDrawerOpenTimer(side)
    clearDrawerCloseTimer(side)
    setDrawerOpen((state) => ({ ...state, [side]: true }))
  })

  const scheduleDrawerOpen = useEffectEvent((side: 'left' | 'right') => {
    if (isDrawerVisible(side)) {
      openDrawer(side)
      return
    }

    clearDrawerCloseTimer(side)
    clearDrawerOpenTimer(side)
    drawerOpenTimersRef.current[side] = window.setTimeout(() => {
      setDrawerOpen((state) => ({ ...state, [side]: true }))
      drawerOpenTimersRef.current[side] = null
    }, DRAWER_OPEN_DELAY_MS)
  })

  const scheduleDrawerClose = useEffectEvent((side: 'left' | 'right') => {
    if (isDrawerPinned(side)) {
      return
    }

    const drawerElement = drawerRefs.current[side]
    const activeElement = document.activeElement
    if (drawerElement && isDrawerStickyFocusTarget(activeElement) && drawerElement.contains(activeElement)) {
      return
    }

    clearDrawerOpenTimer(side)
    clearDrawerCloseTimer(side)
    drawerCloseTimersRef.current[side] = window.setTimeout(() => {
      setDrawerOpen((state) => ({ ...state, [side]: false }))
      drawerCloseTimersRef.current[side] = null
    }, uiPreferences.drawerBlurDelayMs)
  })

  const toggleDrawerLock = useEffectEvent((side: 'left' | 'right') => {
    if (isDrawerFixed(side)) {
      return
    }

    clearDrawerOpenTimer(side)
    clearDrawerCloseTimer(side)
    setDrawerLocks((state) => {
      const nextLocked = !state[side]
      setDrawerOpen((openState) => ({ ...openState, [side]: nextLocked || openState[side] }))
      if (!nextLocked) {
        window.setTimeout(() => {
          const drawerElement = drawerRefs.current[side]
          const activeElement = document.activeElement
          if (drawerElement && !drawerElement.matches(':hover') && !drawerElement.contains(activeElement)) {
            scheduleDrawerClose(side)
          }
        }, 0)
      }
      return { ...state, [side]: nextLocked }
    })
  })

  const toggleDrawerFixed = useEffectEvent((side: 'left' | 'right') => {
    clearDrawerOpenTimer(side)
    clearDrawerCloseTimer(side)
    setDrawerOpen((state) => ({ ...state, [side]: true }))
    setDrawerLocks((state) => ({ ...state, [side]: false }))
    setUiPreferences((state) => ({
      ...state,
      drawerFixedMode: toggleFixedMode(state.drawerFixedMode, side)
    }))
  })

  const updateUiPreferences = (patch: Partial<UiPreferences>): void => {
    setUiPreferences((state) => ({
      ...state,
      ...patch
    }))
  }

  const closeGuide = useEffectEvent((mode: GuideDismissMode = 'normal') => {
    if (guideReason !== 'manual' && currentAppVersion) {
      setLastSeenGuideVersion(currentAppVersion)
    }

    if (mode === 'never-auto-show') {
      updateUiPreferences({ guideAutoShow: false })
    }

    setGuideReason(null)
  })

  const openGuide = useEffectEvent((reason: GuideModalReason, section: GuideSectionId = 'quick-start') => {
    setGuideSection(section)
    setGuideReason(reason)
  })

  const shouldShowUpdateReminder =
    !isGuideOpen &&
    !isSettingsOpen &&
    !isBusy &&
    !pendingImportPrompt &&
    !pendingSingleImageImportPrompt &&
    Boolean(updateStatus.latestVersion) &&
    updateStatus.latestVersion !== ignoredUpdateVersion &&
    (updateStatus.phase === 'downloaded' ||
      (updateStatus.latestVersion !== dismissedUpdateVersionForSession &&
        (updateStatus.phase === 'available' || updateStatus.phase === 'downloading')))

  const runUpdateAction = useEffectEvent(async <T extends UpdateStatus | void>(action: () => Promise<T>): Promise<T | undefined> => {
    setIsUpdateActionPending(true)

    try {
      const result = await action()
      if (result) {
        setUpdateStatus(result)
        if (result.message) {
          setStatusMessage(result.message)
        }
      }
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : '处理更新失败，请稍后重试。'
      setErrorMessage(message)
      return undefined
    } finally {
      setIsUpdateActionPending(false)
    }
  })

  const handleCheckForUpdates = useEffectEvent(async () => {
    setUpdateStatus((current) => ({
      ...current,
      canCheck: false,
      canDownload: false,
      canInstall: false,
      downloadProgressPercent: null,
      message: '正在检查更新...',
      phase: 'checking'
    }))
    await runUpdateAction(() => window.desktopApi.checkForAppUpdates())
  })

  const handleDownloadUpdate = useEffectEvent(async () => {
    setUpdateStatus((current) => ({
      ...current,
      canCheck: false,
      canDownload: false,
      canInstall: false,
      downloadProgressPercent: 0,
      message: '正在下载更新...',
      phase: 'downloading'
    }))
    await runUpdateAction(() => window.desktopApi.downloadAppUpdate())
  })

  const handleInstallDownloadedUpdate = useEffectEvent(async () => {
    setIsUpdateActionPending(true)

    try {
      setStatusMessage('正在准备安装更新，应用会自动重启。')
      await window.desktopApi.installDownloadedUpdate()
    } catch (error) {
      const message = error instanceof Error ? error.message : '安装更新失败，请稍后重试。'
      setErrorMessage(message)
    } finally {
      setIsUpdateActionPending(false)
    }
  })

  const handleOpenUpdateDownloadPage = useEffectEvent(async () => {
    setIsUpdateActionPending(true)

    try {
      await window.desktopApi.openUpdateDownloadPage()
      setStatusMessage('已打开新版本下载页。')
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法打开下载页。'
      setErrorMessage(message)
    } finally {
      setIsUpdateActionPending(false)
    }
  })

  const handleDismissUpdateReminder = useEffectEvent(() => {
    if (updateStatus.phase === 'downloaded') {
      return
    }

    if (updateStatus.latestVersion) {
      setDismissedUpdateVersionForSession(updateStatus.latestVersion)
    }
  })

  const handleIgnoreUpdateReminderVersion = useEffectEvent(() => {
    if (!updateStatus.latestVersion) {
      return
    }

    setIgnoredUpdateVersion(updateStatus.latestVersion)
    setDismissedUpdateVersionForSession(updateStatus.latestVersion)
    setStatusMessage(`已忽略 v${updateStatus.latestVersion} 的更新提醒。`)
  })

  const handleUpdateReminderPrimaryAction = useEffectEvent(async () => {
    if (updateStatus.mode === 'installed') {
      if (updateStatus.canInstall) {
        await handleInstallDownloadedUpdate()
        return
      }

      await handleDownloadUpdate()
      return
    }

    await handleOpenUpdateDownloadPage()
  })

  const choosePhotoshopExecutable = useEffectEvent(async (): Promise<string | null> => {
    try {
      const selectedPath = await window.desktopApi.choosePhotoshopExecutable(uiPreferences.photoshopPath || undefined)
      if (!selectedPath) {
        return null
      }

      updateUiPreferences({ photoshopPath: selectedPath })
      setStatusMessage('已更新 Photoshop 路径。')
      return selectedPath
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法选择 Photoshop 可执行文件。'
      setErrorMessage(message)
      return null
    }
  })

  const ensurePhotoshopPath = useEffectEvent(async (): Promise<string | null> => {
    const configuredPath = uiPreferences.photoshopPath.trim()
    if (configuredPath) {
      return configuredPath
    }

    const selectedPath = await choosePhotoshopExecutable()
    if (!selectedPath) {
      setStatusMessage('已取消选择 Photoshop 路径。')
    }

    return selectedPath
  })

  const prepareExternalEditSession = useEffectEvent(async (frame: FrameItem): Promise<ExternalEditSession> => {
    const existingSession = externalEditSessionsRef.current.get(frame.id)
    if (existingSession) {
      await window.desktopApi.writeBinaryFile({
        data: Array.from(dataUrlToBytes(frame.dataUrl)),
        filePath: existingSession.filePath
      })
      const latestModifiedTimeMs = await window.desktopApi.getFileModifiedTime(existingSession.filePath)
      if (latestModifiedTimeMs !== null) {
        existingSession.lastModifiedTimeMs = Math.max(existingSession.lastModifiedTimeMs, latestModifiedTimeMs)
      }
      return existingSession
    }

    const tempFile = await window.desktopApi.createTempBinaryFile({
      data: Array.from(dataUrlToBytes(frame.dataUrl)),
      extension: 'png',
      fileName: buildExternalEditTempFileName(frame)
    })

    const session: ExternalEditSession = {
      filePath: tempFile.filePath,
      lastModifiedTimeMs: tempFile.modifiedTimeMs
    }
    externalEditSessionsRef.current.set(frame.id, session)
    return session
  })

  const handleEditFrameInPhotoshop = useEffectEvent(async (frame: FrameItem) => {
    const frameIndex = frames.findIndex((item) => item.id === frame.id)
    if (frameIndex !== -1) {
      setIsPlaying(false)
      setCurrentFrame(frameIndex)
      setSelectedFrames([frame.id], frame.id)
    }

    const photoshopPath = await ensurePhotoshopPath()
    if (!photoshopPath) {
      return
    }

    try {
      const session = await prepareExternalEditSession(frame)
      await window.desktopApi.openInPhotoshop({
        filePath: session.filePath,
        photoshopPath
      })
      setStatusMessage(`已在 Photoshop 中打开“${frame.name}”，保存后会自动回灌到当前帧。`)
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法在 Photoshop 中打开当前帧。'
      setErrorMessage(message)
    }
  })

  const handleDrawerBlur = useEffectEvent(
    (side: 'left' | 'right', currentTarget: HTMLElement, relatedTarget: EventTarget | null) => {
      if (relatedTarget instanceof Node && currentTarget.contains(relatedTarget)) {
        return
      }

      window.setTimeout(() => {
        const activeElement = document.activeElement
        if (currentTarget.matches(':hover')) {
          return
        }
        if (currentTarget.contains(activeElement) && isDrawerStickyFocusTarget(activeElement)) {
          return
        }
        scheduleDrawerClose(side)
      }, 0)
    }
  )

  const openExportModal = useEffectEvent((options?: { collapseRightDrawer?: boolean; splitGeometry?: SheetGeometryState | null }) => {
    clearDrawerOpenTimer('right')
    clearDrawerCloseTimer('right')
    setPendingSplitExportGeometry(options?.splitGeometry ?? null)
    if (options?.collapseRightDrawer !== false) {
      setDrawerOpen((state) => ({ ...state, right: false }))
    }
    setIsExportPanelOpen(true)
  })

  const showExportNotice = (label: string, targetPath: string): void => {
    setExportNotice({
      label,
      targetPath
    })
  }

  const createCancelledError = (): Error => new Error(OPERATION_CANCELLED)

  const ensureOperationActive = (controller: OperationController): void => {
    if (controller.cancelled || operationRef.current?.id !== controller.id) {
      throw createCancelledError()
    }
  }

  const beginOperationProgress = (initial: OperationProgressState): OperationController => {
    const controller = {
      cancelled: false,
      id: Date.now() + Math.floor(Math.random() * 1000)
    }

    operationRef.current = controller
    clearError()
    setBusy(true)
    setOperationProgress(initial)
    return controller
  }

  const updateOperationProgress = async (
    controller: OperationController,
    next: OperationProgressState | TaskProgress
  ): Promise<void> => {
    ensureOperationActive(controller)
    setOperationProgress('stage' in next ? buildProgressState(next) : next)
    await waitForPaint()
    ensureOperationActive(controller)
  }

  const endOperationProgress = (controller: OperationController): void => {
    if (operationRef.current?.id !== controller.id) {
      return
    }

    operationRef.current = null
    setOperationProgress(null)
    setBusy(false)
  }

  const cancelCurrentOperation = useEffectEvent(() => {
    const controller = operationRef.current
    if (!controller || controller.cancelled) {
      return
    }

    controller.cancelled = true
    setOperationProgress({
      cancellable: false,
      detail: '正在尽快停止当前处理，请稍候...',
      percent: null,
      title: '正在取消任务'
    })
    setStatusMessage('正在取消当前任务...')
  })

  const withOperation = async <T,>(
    initial: OperationProgressState,
    task: (controller: OperationController) => Promise<T>,
    config: string | OperationConfig = '已取消当前任务。'
  ): Promise<T | undefined> => {
    const controller = beginOperationProgress(initial)
    const cancelledMessage = typeof config === 'string' ? config : (config.cancelledMessage ?? '已取消当前任务。')
    const onCancelled = typeof config === 'string' ? undefined : config.onCancelled

    try {
      await waitForPaint()
      const result = await task(controller)
      ensureOperationActive(controller)
      return result
    } catch (error) {
      if (isCancelledError(error)) {
        if (onCancelled) {
          setOperationProgress({
            cancellable: false,
            detail: '正在清理已写出的文件，请稍候...',
            percent: null,
            title: '正在收尾'
          })
          await waitForPaint()
          await onCancelled()
        }
        setStatusMessage(cancelledMessage)
        return undefined
      }

      const message = error instanceof Error ? error.message : '操作失败，请重试。'
      setErrorMessage(message)
      return undefined
    } finally {
      endOperationProgress(controller)
    }
  }

  const applyImportedSession = (session: ImportSession, mode: ImportMode): void => {
    if (mode === 'append' && frames.length > 0) {
      const nextFrames = [...frames, ...session.frames]
      const firstImportedFrame = session.frames[0]

      replaceFrames(nextFrames, {
        playbackPatch: {
          currentFrame: frames.length,
          endFrame: Math.max(0, nextFrames.length - 1),
          isPlaying: nextFrames.length > 1 ? playback.isPlaying || session.playback.isPlaying : false
        },
        recordHistory: true,
        sheet: createEmptySheetState()
      })

      if (firstImportedFrame) {
        setSelectedFrames([firstImportedFrame.id], firstImportedFrame.id)
      }

      setStatusMessage(`已将这次导入的 ${session.frames.length} 帧追加到当前序列。`)
      setAppliedSheetGeometrySignature(null)
      setPingPongDirection(1)
      return
    }

    if (mode === 'replace-current' && frames.length > 0) {
      const anchorIndex = Math.max(0, Math.min(playback.currentFrame, frames.length - 1))
      const nextFrames = [...frames.slice(0, anchorIndex), ...session.frames, ...frames.slice(anchorIndex + 1)]
      const importedFrameIds = session.frames.map((frame) => frame.id)
      const firstImportedFrameId = importedFrameIds[0] ?? null

      replaceFrames(nextFrames, {
        playbackPatch: {
          currentFrame: Math.min(anchorIndex, Math.max(0, nextFrames.length - 1)),
          endFrame: Math.max(0, nextFrames.length - 1),
          isPlaying: nextFrames.length > 1 ? playback.isPlaying || session.playback.isPlaying : false
        },
        recordHistory: true,
        sheet: createEmptySheetState()
      })

      if (firstImportedFrameId) {
        setSelectedFrames(importedFrameIds, importedFrameIds.at(-1) ?? firstImportedFrameId)
      }

      setStatusMessage(
        session.frames.length > 1 ? `已从当前帧开始替换，并插入 ${session.frames.length} 帧。` : '已替换当前帧。'
      )
      setAppliedSheetGeometrySignature(null)
      setPingPongDirection(1)
      return
    }

    applyImportSession(session)
    updatePlaybackSettings(
      {
        background: playback.background,
        fps: session.sheet.autoApplied || (session.frames.length === 1 && session.sheet.source?.extension === 'gif') ? session.playback.fps : playback.fps,
        loopMode: playback.loopMode,
        previewSkip: playback.previewSkip,
        reverse: playback.reverse,
        zoom: playback.zoom
      },
      false
    )
    setAppliedSheetGeometrySignature(
      session.sheet.autoApplied ? buildSheetGeometrySignature(session.sheet.source, getSheetGeometry(session.sheet)) : null
    )
    setPingPongDirection(1)
  }

  const importPayloads = async (
    payloads: ImportedFilePayload[],
    controller: OperationController,
    mode: ImportMode = 'replace'
  ): Promise<void> => {
    ensureOperationActive(controller)

    if (payloads.length === 0) {
      setStatusMessage('没有找到可导入的图片文件。')
      return
    }

    const session = await buildImportSession(payloads, async (progress) => {
      await updateOperationProgress(controller, progress)
    })
    const eagerPrompt =
      !session.importPrompt && mode === 'replace' && frames.length > 0
        ? buildSingleImageImportPromptFromSheet(session.sheet, EAGER_SINGLE_IMAGE_PROMPT_CONFIDENCE)
        : undefined

    ensureOperationActive(controller)
    if (session.importPrompt ?? eagerPrompt) {
      pendingSingleImageImportRef.current = { mode, session }
      setPendingSingleImageImportPrompt(session.importPrompt ?? eagerPrompt ?? null)
      return
    }

    applyImportedSession(session, mode)
  }

  const exportFramesToDirectory = async (
    directory: string,
    framesToWrite: FrameItem[],
    stage: 'export-sequence' | 'export-split-sequence',
    controller: OperationController,
    writtenPaths: string[] = []
  ): Promise<void> => {
    if (framesToWrite.length === 0) {
      return
    }

    const totalFrames = framesToWrite.length
    const totalUnits = totalFrames * 2
    const operationTitle = getExportOperationTitle(stage)

    for (let batchStart = 0; batchStart < totalFrames; batchStart += EXPORT_ENCODE_BATCH_SIZE) {
      ensureOperationActive(controller)

      const frameBatch = framesToWrite.slice(batchStart, batchStart + EXPORT_ENCODE_BATCH_SIZE)
      const encodedBatch = await encodeFramesToBytesBatch(frameBatch, exportSettings.imageFormat, async (progress) => {
        const encodedWithinBatch =
          typeof progress.current === 'number'
            ? progress.current
            : typeof progress.percent === 'number'
              ? (Math.max(0, progress.percent) / 100) * frameBatch.length
              : 0
        const safeEncodedWithinBatch = Math.max(0, Math.min(frameBatch.length, encodedWithinBatch))
        const previewCount = Math.min(totalFrames, batchStart + Math.max(1, Math.ceil(safeEncodedWithinBatch)))

        await updateOperationProgress(controller, {
          cancellable: true,
          detail: `正在编码图片 (${previewCount}/${totalFrames})`,
          percent: ((batchStart * 2 + safeEncodedWithinBatch) / totalUnits) * 100,
          title: operationTitle
        })
      })

      ensureOperationActive(controller)

      for (let batchIndex = 0; batchIndex < encodedBatch.length; batchIndex += 1) {
        const index = batchStart + batchIndex
        const fileName = buildExportFileName(exportSettings.fileNamePrefix, index, exportSettings.padding, exportSettings.imageFormat)
        const filePath = joinPath(directory, fileName)

        await window.desktopApi.writeBinaryFile({
          data: Array.from(encodedBatch[batchIndex]),
          filePath
        })
        writtenPaths.push(filePath)

        await updateOperationProgress(controller, {
          cancellable: true,
          detail: `正在写入文件 (${index + 1}/${totalFrames})`,
          percent: ((batchStart * 2 + frameBatch.length + batchIndex + 1) / totalUnits) * 100,
          title: operationTitle
        })
      }
    }
  }

  const cleanupExportArtifacts = async (writtenPaths: string[]): Promise<void> => {
    if (writtenPaths.length === 0) {
      return
    }

    await window.desktopApi.deletePaths(writtenPaths)
  }

  const importPaths = async (paths: string[], mode: ImportMode = 'replace'): Promise<void> => {
    const uniquePaths = Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)))
    if (uniquePaths.length === 0) {
      return
    }

    await withOperation(
      {
        cancellable: true,
        detail: '正在读取本地文件...',
        percent: null,
        title: '正在导入资源'
      },
      async (controller) => {
        const payloads = await window.desktopApi.loadPaths(uniquePaths)
        ensureOperationActive(controller)
        await importPayloads(payloads, controller, mode)
      },
      '已取消导入。'
    )
  }

  const importDroppedFiles = async (files: File[], mode: ImportMode = 'replace'): Promise<void> => {
    clearWindowDragState()

    const supportedFiles = files.filter((file) => isSupportedDroppedFile(file.name))
    if (supportedFiles.length === 0) {
      setStatusMessage('拖入内容里没有支持的图片文件。')
      return
    }

    const resolvedPaths = supportedFiles
      .map((file) => window.desktopApi.getPathForDroppedFile(file))
      .filter((value): value is string => Boolean(value))

    if (resolvedPaths.length === supportedFiles.length && resolvedPaths.length > 0) {
      await importPaths(resolvedPaths, mode)
      return
    }

    await withOperation(
      {
        cancellable: true,
        detail: '正在读取拖入文件...',
        percent: null,
        title: '正在导入资源'
      },
      async (controller) => {
        const payloads: ImportedFilePayload[] = []

        for (let index = 0; index < supportedFiles.length; index += 1) {
          const file = supportedFiles[index]
          ensureOperationActive(controller)

          await updateOperationProgress(controller, {
            cancellable: true,
            detail: `正在读取拖入文件 (${index + 1}/${supportedFiles.length})`,
            percent: ((index + 1) / supportedFiles.length) * 20,
            title: '正在导入资源'
          })

          payloads.push(await buildImportedPayloadFromFile(file))
        }

        await importPayloads(payloads, controller, mode)
      },
      '已取消导入。'
    )
  }

  const requestImportMode = useEffectEvent((sourceLabel: string, runImport: (mode: ImportMode) => Promise<void>) => {
    if (frames.length === 0) {
      void runImport('replace')
      return
    }

    pendingImportActionRef.current = runImport
    setPendingImportPrompt({
      currentFrameCount: frames.length,
      currentFrameIndex: playback.currentFrame + 1,
      sourceLabel
    })
  })

  const closePendingImportPrompt = useEffectEvent((cancelled = false) => {
    pendingImportActionRef.current = null
    setPendingImportPrompt(null)
    if (cancelled) {
      setStatusMessage('已取消这次导入。')
    }
  })

  const closePendingSingleImageImportPrompt = useEffectEvent((cancelled = false) => {
    pendingSingleImageImportRef.current = null
    setPendingSingleImageImportPrompt(null)
    setPendingSingleImageImportDraft(null)
    setIsSingleImageManualEntryOpen(false)
    if (cancelled) {
      setStatusMessage('已取消这次导入。')
    }
  })

  const handleImportDecision = useEffectEvent((mode: ImportMode) => {
    const pendingAction = pendingImportActionRef.current
    pendingImportActionRef.current = null
    setPendingImportPrompt(null)
    if (!pendingAction) {
      return
    }

    void pendingAction(mode)
  })

  const handleSingleImageImportDecision = useEffectEvent(
    (decision: { type: 'single' } | { geometry?: SheetImportGeometry; type: 'sheet' }) => {
      const pendingImport = pendingSingleImageImportRef.current
      pendingSingleImageImportRef.current = null
      setPendingSingleImageImportPrompt(null)
      setPendingSingleImageImportDraft(null)
      setIsSingleImageManualEntryOpen(false)
      if (!pendingImport) {
        return
      }

      if (decision.type === 'sheet') {
        const targetGeometry =
          decision.geometry ?? {
            columns: pendingImport.session.sheet.columns,
            frameHeight: pendingImport.session.sheet.frameHeight,
            frameWidth: pendingImport.session.sheet.frameWidth,
            mode: pendingImport.session.sheet.mode,
            rows: pendingImport.session.sheet.rows
          }

        if (matchesSheetImportGeometry(pendingImport.session, targetGeometry)) {
          applyImportedSession(pendingImport.session, pendingImport.mode)
          if (pendingImport.mode === 'replace') {
            setStatusMessage(`已按 ${targetGeometry.columns} x ${targetGeometry.rows} 序列导入，共 ${pendingImport.session.frames.length} 帧。`)
          }
          return
        }

        void withOperation(
          {
            cancellable: false,
            detail: '正在按选定方案准备导入...',
            percent: null,
            title: '正在导入资源'
          },
          async (controller) => {
            ensureOperationActive(controller)
            const sheetSession = await buildSheetImportSession(pendingImport.session, targetGeometry, async (progress) => {
              await updateOperationProgress(controller, progress)
            })
            ensureOperationActive(controller)
            applyImportedSession(sheetSession, pendingImport.mode)
            if (pendingImport.mode === 'replace') {
              setStatusMessage(`已按 ${targetGeometry.columns} x ${targetGeometry.rows} 序列导入，共 ${sheetSession.frames.length} 帧。`)
            }
          },
          '已取消导入。'
        )
        return
      }

      void withOperation(
        {
          cancellable: false,
          detail: '正在按单帧准备导入...',
          percent: null,
          title: '正在导入资源'
        },
        async (controller) => {
          ensureOperationActive(controller)
          const singleFrameSession = await buildSingleFrameImportSession(pendingImport.session)
          ensureOperationActive(controller)
          applyImportedSession(singleFrameSession, pendingImport.mode)
          if (pendingImport.mode === 'replace') {
            setStatusMessage('已按单帧导入。右侧仍保留图集识别结果，随时可以再应用到时间轴。')
          }
        },
        '已取消导入。'
      )
    }
  )

  const handleImportFiles = async (): Promise<void> => {
    const paths = await window.desktopApi.openFiles()
    if (!paths || paths.length === 0) {
      return
    }

    requestImportMode('选中的文件', async (mode) => {
      await importPaths(paths, mode)
    })
  }

  const handleImportFolder = async (): Promise<void> => {
    const directory = await window.desktopApi.openDirectory()
    if (!directory) {
      return
    }

    requestImportMode('选中的文件夹', async (mode) => {
      await importPaths([directory], mode)
    })
  }

  const handleReplaceCurrentFrameImport = async (): Promise<void> => {
    if (frames.length === 0) {
      return
    }

    const paths = await window.desktopApi.openFiles()
    if (!paths || paths.length === 0) {
      return
    }

    await importPaths(paths, 'replace-current')
  }

  const handleReplaceSpecificFrameImport = async (frameId: string): Promise<void> => {
    const frameIndex = frames.findIndex((frame) => frame.id === frameId)
    if (frameIndex === -1) {
      return
    }

    setCurrentFrame(frameIndex)
    setSelectedFrames([frameId], frameId)
    await handleReplaceCurrentFrameImport()
  }

  const handlePastePayloads = useEffectEvent((payloadsOrFiles: { files: File[] } | { payloads: ImportedFilePayload[] }) => {
    requestImportMode('剪贴板中的图片', async (mode) => {
      await withOperation(
        {
          cancellable: true,
          detail: '正在读取剪贴板图片...',
          percent: null,
          title: '正在导入资源'
        },
        async (controller) => {
          const payloads: ImportedFilePayload[] = []

          if ('payloads' in payloadsOrFiles) {
            payloads.push(...payloadsOrFiles.payloads)
            await updateOperationProgress(controller, {
              cancellable: true,
              current: payloads.length,
              detail: `正在读取剪贴板图片 (${payloads.length}/${payloads.length})`,
              percent: 20,
              stage: 'convert-files',
              total: payloads.length
            })
          } else {
            const { files } = payloadsOrFiles

            for (let index = 0; index < files.length; index += 1) {
              ensureOperationActive(controller)
              const file = files[index]
              const extension = getExtensionFromMimeType(file.type)
              payloads.push(
                await buildImportedPayloadFromFile(file, `pasted-image-${Date.now()}-${index + 1}.${extension}`)
              )

              await updateOperationProgress(controller, {
                cancellable: true,
                current: index + 1,
                detail: `正在读取剪贴板图片 (${index + 1}/${files.length})`,
                percent: ((index + 1) / files.length) * 20,
                stage: 'convert-files',
                total: files.length
              })
            }
          }

          await importPayloads(payloads, controller, mode)
        },
        '已取消导入。'
      )
    })
  })

  const handleUpdateSheet = (patch: Partial<SheetState>, recordHistory = true): void => {
    updateSheetSettings(
      {
        ...patch,
        autoApplied: false
      },
      recordHistory
    )
  }

  const handleChooseCandidate = (candidate: GridCandidate): void => {
    handleUpdateSheet(
      {
        columns: candidate.columns,
        frameHeight: candidate.frameHeight,
        frameWidth: candidate.frameWidth,
        mode: 'grid',
        rows: candidate.rows
      },
      false
    )
    setStatusMessage(`已切换到候选网格 ${candidate.columns} x ${candidate.rows}。`)
  }

  const handleApplySheet = async (geometryOverride?: SheetGeometryState): Promise<void> => {
    const geometry = geometryOverride ?? sheetGeometry
    if (!sheet.source || !geometry.canApply) {
      return
    }

    const source = sheet.source

    await withOperation(
      {
        cancellable: true,
        detail: '正在根据当前网格切出时间轴帧...',
        percent: 0,
        title: '正在拆分图集'
      },
      async (controller) => {
        const nextFrames = await splitSheetToFrames(
          source,
          geometry.rows,
          geometry.columns,
          geometry.frameWidth,
          geometry.frameHeight,
          async (progress) => {
            await updateOperationProgress(controller, progress)
          }
        )

        ensureOperationActive(controller)
        replaceFrames(nextFrames, {
          keepSelection: false,
          playbackPatch: {
            currentFrame: 0,
            endFrame: Math.max(0, nextFrames.length - 1),
            isPlaying: nextFrames.length > 1,
            startFrame: 0
          },
          sheet: {
            ...sheet,
            autoApplied: false,
            columns: geometry.columns,
            enabled: true,
            frameHeight: geometry.frameHeight,
            frameWidth: geometry.frameWidth,
            rows: geometry.rows
          }
        })
        setAppliedSheetGeometrySignature(buildSheetGeometrySignature(source, geometry))
        setPingPongDirection(1)
        setStatusMessage(`已按 ${geometry.columns} x ${geometry.rows} 拆分为 ${nextFrames.length} 帧。`)
      },
      '已取消拆分。'
    )
  }

  const handleRotate = async (rotation: 90 | 180 | 270): Promise<void> => {
    if (frames.length === 0) {
      return
    }

    await withOperation(
      {
        cancellable: true,
        detail: `正在准备将全部帧旋转 ${rotation}°...`,
        percent: 0,
        title: '正在旋转序列'
      },
      async (controller) => {
        const rotatedFrames = await rotateFrames(frames, rotation, async (progress) => {
          await updateOperationProgress(controller, progress)
        })

        ensureOperationActive(controller)
        replaceFrames(rotatedFrames, {
          keepSelection: true
        })
        setStatusMessage(`已将全部帧旋转 ${rotation}°。`)
      },
      '已取消旋转。'
    )
  }

  const stepSequence = (direction: 1 | -1): void => {
    if (playbackSequence.length === 0) {
      return
    }

    const currentPosition = playbackSequence.indexOf(playback.currentFrame)
    const basePosition =
      currentPosition === -1 ? (direction === 1 ? 0 : Math.max(0, playbackSequence.length - 1)) : currentPosition
    const nextPosition = (basePosition + direction + playbackSequence.length) % playbackSequence.length

    setCurrentFrame(playbackSequence[nextPosition] ?? 0)
    if (playback.loopMode === 'pingpong') {
      setPingPongDirection(direction)
    }
  }

  const handlePrevious = (): void => {
    stepSequence(-1)
  }

  const handleNext = (): void => {
    stepSequence(1)
  }

  const handleResetView = (): void => {
    setResetViewNonce((value) => value + 1)
    updatePlaybackSettings({ zoom: 'fit' }, false)
  }

  const handleTogglePlay = (): void => {
    if (frames.length === 0) {
      return
    }

    if (!playback.isPlaying && playbackSequence.length > 0 && !playbackSequence.includes(playback.currentFrame)) {
      setCurrentFrame(playbackSequence[0] ?? 0)
    }

    setIsPlaying(!playback.isPlaying)
  }

  const handleExportSequence = async (): Promise<void> => {
    if (exportFrames.length === 0) {
      return
    }

    const directory = await window.desktopApi.chooseDirectory({
      defaultPath: lastExportDirectory ?? undefined,
      title: '选择图片序列导出文件夹'
    })
    if (!directory) {
      return
    }

    const writtenPaths: string[] = []

    await withOperation(
      {
        cancellable: true,
        detail: '正在写入图片序列...',
        percent: 0,
        title: '正在导出图片'
      },
      async (controller) => {
        await exportFramesToDirectory(directory, exportFrames, 'export-sequence', controller, writtenPaths)
        setLastExportDirectory(directory)
        setStatusMessage(`已导出 ${exportFrames.length} 张图片到 ${directory}`)
        showExportNotice('单帧导出完成', directory)
      },
      {
        cancelledMessage: writtenPaths.length > 0 ? '已取消导出图片序列，并清理已写出的文件。' : '已取消导出图片序列。',
        onCancelled: async () => {
          await cleanupExportArtifacts(writtenPaths)
        }
      }
    )
  }

  const handleExportSplitSequence = async (geometryOverride?: SheetGeometryState): Promise<void> => {
    const geometry = geometryOverride ?? pendingSplitExportGeometry ?? sheetGeometry
    if (!sheet.source || !geometry.canApply) {
      return
    }

    const source = sheet.source

    const directory = await window.desktopApi.chooseDirectory({
      defaultPath: lastExportDirectory ?? undefined,
      title: '选择拆分结果导出文件夹'
    })
    if (!directory) {
      return
    }

    const writtenPaths: string[] = []

    await withOperation(
      {
        cancellable: true,
        detail: '正在根据当前拆分设置生成帧...',
        percent: 0,
        title: '正在导出拆分结果'
      },
      async (controller) => {
        const splitFrames = await splitSheetToFrames(
          source,
          geometry.rows,
          geometry.columns,
          geometry.frameWidth,
          geometry.frameHeight,
          async (progress) => {
            await updateOperationProgress(controller, progress)
          }
        )

        ensureOperationActive(controller)
        await exportFramesToDirectory(directory, splitFrames, 'export-split-sequence', controller, writtenPaths)
        setLastExportDirectory(directory)
        setStatusMessage(`已导出 ${splitFrames.length} 张拆分图片到 ${directory}`)
        showExportNotice('拆分导出完成', directory)
        setPendingSplitExportGeometry(null)
      },
      {
        cancelledMessage: writtenPaths.length > 0 ? '已取消拆分导出，并清理已写出的文件。' : '已取消拆分导出。',
        onCancelled: async () => {
          await cleanupExportArtifacts(writtenPaths)
        }
      }
    )
  }

  const handleExportSheet = async (): Promise<void> => {
    if (exportFrames.length === 0) {
      return
    }

    const layout = normalizeSheetLayout(
      exportFrames.length,
      exportSettings.spriteSheetRows,
      exportSettings.spriteSheetColumns
    )

    await withOperation(
      {
        cancellable: true,
        detail: `正在按 ${layout.columns} x ${layout.rows} 合并帧...`,
        percent: 0,
        title: '正在导出序列图'
      },
      async (controller) => {
        const { canvas } = await composeSpriteSheet(exportFrames, layout.rows, layout.columns, async (progress) => {
          const formattedCount =
            typeof progress.current === 'number' && typeof progress.total === 'number'
              ? ` (${progress.current}/${progress.total})`
              : ''

          await updateOperationProgress(controller, {
            cancellable: true,
            detail: `正在合并图集帧${formattedCount}`,
            percent: ((progress.percent ?? 0) / 100) * 78,
            title: '正在导出序列图'
          })
        })
        ensureOperationActive(controller)

        await updateOperationProgress(controller, {
          cancellable: true,
          detail: '正在编码图像...',
          percent: 84,
          title: '正在导出序列图'
        })

        const bytes = await canvasToBytes(canvas, exportSettings.imageFormat)
        ensureOperationActive(controller)

        await updateOperationProgress(controller, {
          cancellable: true,
          detail: '正在写入输出文件...',
          percent: 96,
          title: '正在导出序列图'
        })

        const savedPath = await window.desktopApi.saveBinaryFile({
          data: Array.from(bytes),
          defaultPath: joinDefaultFilePath(lastExportDirectory, `${exportSettings.fileNamePrefix}_sheet.${exportSettings.imageFormat}`),
          filters: saveFiltersByFormat[exportSettings.imageFormat],
          title: '导出序列图'
        })

        if (!savedPath) {
          setStatusMessage('已取消导出序列图。')
          return
        }

        setLastExportDirectory(getDirectoryFromPath(savedPath))
        setStatusMessage(`已导出序列图：${savedPath}`)
        showExportNotice('序列图导出完成', savedPath)
      },
      '已取消导出序列图。'
    )
  }

  const handleExportGif = async (): Promise<void> => {
    if (exportFrames.length === 0) {
      return
    }

    await withOperation(
      {
        cancellable: true,
        detail: '正在准备 GIF 编码...',
        percent: 0,
        title: '正在导出 GIF'
      },
      async (controller) => {
        const bytes = await encodeGif(exportFrames, playback.fps, async (progress) => {
          await updateOperationProgress(controller, progress)
        })

        ensureOperationActive(controller)
        await updateOperationProgress(controller, {
          cancellable: true,
          detail: '正在写入 GIF 文件...',
          percent: 96,
          title: '正在导出 GIF'
        })

        const savedPath = await window.desktopApi.saveBinaryFile({
          data: Array.from(bytes),
          defaultPath: joinDefaultFilePath(lastExportDirectory, `${exportSettings.fileNamePrefix}.gif`),
          filters: saveFiltersByFormat.gif,
          title: '导出 GIF'
        })

        if (!savedPath) {
          setStatusMessage('已取消导出 GIF。')
          return
        }

        setLastExportDirectory(getDirectoryFromPath(savedPath))
        setStatusMessage(`已导出 GIF：${savedPath}`)
        showExportNotice('GIF 导出完成', savedPath)
      },
      '已取消导出 GIF。'
    )
  }

  const handleClearWorkspace = (): void => {
    clearWindowDragState()
    setExportNotice(null)
    setIsExportPanelOpen(false)
    setPendingSplitExportGeometry(null)
    setAppliedSheetGeometrySignature(null)
    setPingPongDirection(1)
    resetWorkspace()
    updatePlaybackSettings(
      {
        background: playback.background,
        fps: playback.fps,
        loopMode: playback.loopMode,
        previewSkip: playback.previewSkip,
        reverse: playback.reverse,
        zoom: playback.zoom
      },
      false
    )
    updateExportSettings(exportSettings, false)
  }

  const handleRevealExportLocation = async (): Promise<void> => {
    if (!exportNotice) {
      return
    }

    try {
      await window.desktopApi.revealInFileExplorer(exportNotice.targetPath)
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法打开保存位置。'
      setErrorMessage(message)
    }
  }

  const handleGlobalKeydown = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === 'F1') {
      event.preventDefault()
      if (isGuideOpen) {
        closeGuide()
      } else {
        openGuide('manual', 'shortcuts')
      }
      return
    }

    if (event.key === 'Escape' && isSettingsOpen) {
      event.preventDefault()
      setIsSettingsOpen(false)
      return
    }

    if (event.key === 'Escape' && isGuideOpen) {
      event.preventDefault()
      closeGuide()
      return
    }

    if (isGuideOpen) {
      return
    }

    if (event.key === 'Escape' && pendingSingleImageImportPrompt) {
      event.preventDefault()
      closePendingSingleImageImportPrompt(true)
      return
    }

    if (pendingSingleImageImportPrompt) {
      return
    }

    if (event.key === 'Escape' && pendingImportPrompt) {
      event.preventDefault()
      closePendingImportPrompt(true)
      return
    }

    if (pendingImportPrompt) {
      return
    }

    if (event.key === 'Escape' && isBusy) {
      event.preventDefault()
      cancelCurrentOperation()
      return
    }

    if (isBusy) {
      return
    }

    if (isEditableTarget(event.target)) {
      return
    }

    const isPrimaryModifier = event.ctrlKey || event.metaKey

    if (isPrimaryModifier && event.key.toLowerCase() === 'o') {
      event.preventDefault()
      if (event.shiftKey) {
        void handleImportFolder()
      } else {
        void handleImportFiles()
      }
      return
    }

    if (isPrimaryModifier && event.key.toLowerCase() === 'a') {
      if (frames.length === 0) {
        return
      }
      event.preventDefault()
      setSelectedFrames(
        frames.map((frame) => frame.id),
        frames.at(-1)?.id ?? null
      )
      return
    }

    if (isPrimaryModifier && event.key.toLowerCase() === 'e') {
      if (frames.length === 0 && !sheetGeometry.canApply) {
        return
      }
      event.preventDefault()
      openExportModal()
      return
    }

    if (isPrimaryModifier && event.key === ',') {
      event.preventDefault()
      setIsSettingsOpen(true)
      return
    }

    if (isPrimaryModifier && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      if (event.shiftKey) {
        redo()
      } else {
        undo()
      }
      return
    }

    if (isPrimaryModifier && event.key.toLowerCase() === 'y') {
      event.preventDefault()
      redo()
      return
    }

    if (event.key === ' ' || event.code === 'Space') {
      event.preventDefault()
      handleTogglePlay()
      return
    }

    if (event.key.toLowerCase() === 'f' || (isPrimaryModifier && event.key === '0')) {
      event.preventDefault()
      handleResetView()
      return
    }

    if (event.key === 'Home') {
      if (playbackSequence.length === 0) {
        return
      }
      event.preventDefault()
      setCurrentFrame(playbackSequence[0] ?? 0)
      return
    }

    if (event.key === 'End') {
      if (playbackSequence.length === 0) {
        return
      }
      event.preventDefault()
      setCurrentFrame(playbackSequence.at(-1) ?? 0)
      return
    }

    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key.toLowerCase() === 'a') {
      event.preventDefault()
      handlePrevious()
      return
    }

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key.toLowerCase() === 'd') {
      event.preventDefault()
      handleNext()
      return
    }

    if ((event.key === 'Delete' || event.key === 'Backspace') && selectedFrameIds.length > 0 && !isBusy) {
      event.preventDefault()
      deleteSelectedFrames()
      return
    }
  })

  useEffect(() => {
    window.addEventListener('keydown', handleGlobalKeydown)
    return () => {
      window.removeEventListener('keydown', handleGlobalKeydown)
    }
  }, [handleGlobalKeydown])

  const handleWindowPaste = useEffectEvent((event: ClipboardEvent) => {
    if (isBusy || pendingImportPrompt || pendingSingleImageImportPrompt || isEditableTarget(event.target)) {
      return
    }

    const pastedFiles = extractClipboardImageFiles(event.clipboardData)
    void (async () => {
      const nativeClipboardPayload = await window.desktopApi.readClipboardImage().catch(() => null)
      if (nativeClipboardPayload) {
        event.preventDefault()
        handlePastePayloads({ payloads: [nativeClipboardPayload] })
        return
      }

      if (pastedFiles.length === 0) {
        return
      }

      event.preventDefault()
      handlePastePayloads({ files: pastedFiles })
    })()
  })

  useEffect(() => {
    window.addEventListener('paste', handleWindowPaste)
    return () => {
      window.removeEventListener('paste', handleWindowPaste)
    }
  }, [handleWindowPaste])

  const advancePlayback = useEffectEvent(() => {
    if (playbackSequence.length === 0) {
      return
    }

    const currentPosition = Math.max(0, playbackSequence.indexOf(playback.currentFrame))
    const result = advanceSequencePosition(
      playbackSequence.length,
      currentPosition,
      pingPongDirection,
      playback.loopMode
    )

    setPingPongDirection(result.direction)
    setCurrentFrame(playbackSequence[result.position] ?? playbackSequence[0] ?? 0)

    if (result.shouldStop) {
      setIsPlaying(false)
    }
  })

  useEffect(() => {
    if (!playback.isPlaying || playbackSequence.length === 0) {
      return undefined
    }

    const intervalMs = Math.max(16, Math.round(1000 / Math.max(1, playback.fps)))
    const timer = window.setInterval(() => {
      startTransition(() => {
        advancePlayback()
      })
    }, intervalMs)

    return () => {
      window.clearInterval(timer)
    }
  }, [advancePlayback, playback.fps, playback.isPlaying, playbackSequence.length])

  useEffect(() => {
    setPingPongDirection(1)
  }, [playback.reverse, playbackSequence.length])

  const handleWindowDrop = useEffectEvent((files: File[]) => {
    requestImportMode('拖入的图片', async (mode) => {
      await importDroppedFiles(files, mode)
    })
  })

  useEffect(() => {
    const onDragEnter = (event: DragEvent) => {
      if (isBusy || !hasFileDrag(event.dataTransfer)) {
        return
      }

      event.preventDefault()
      windowDragDepthRef.current += 1
      setIsWindowDragActive(true)
    }

    const onDragOver = (event: DragEvent) => {
      if (isBusy || !hasFileDrag(event.dataTransfer)) {
        return
      }

      event.preventDefault()
      if (!isWindowDragActive) {
        setIsWindowDragActive(true)
      }
    }

    const onDragLeave = (event: DragEvent) => {
      if (!hasFileDrag(event.dataTransfer)) {
        return
      }

      event.preventDefault()
      windowDragDepthRef.current = Math.max(0, windowDragDepthRef.current - 1)
      if (windowDragDepthRef.current === 0) {
        setIsWindowDragActive(false)
      }
    }

    const onDrop = (event: DragEvent) => {
      if (isBusy || !hasFileDrag(event.dataTransfer)) {
        return
      }

      event.preventDefault()
      clearWindowDragState()

      const droppedFiles = Array.from(event.dataTransfer?.files ?? [])
      if (droppedFiles.length > 0) {
        handleWindowDrop(droppedFiles)
      }
    }

    const onDragEnd = () => {
      clearWindowDragState()
    }

    const onWindowBlur = () => {
      clearWindowDragState()
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('dragend', onDragEnd)
    window.addEventListener('drop', onDrop)
    window.addEventListener('blur', onWindowBlur)

    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('dragend', onDragEnd)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('blur', onWindowBlur)
    }
  }, [clearWindowDragState, handleWindowDrop, isBusy, isWindowDragActive])

  smokeFnsRef.current = {
    exportGif: handleExportGif,
    exportSequence: handleExportSequence,
    getSnapshot: () => ({
      frameCount: frames.length,
      playback: {
        currentFrame: playback.currentFrame,
        fps: playback.fps,
        isPlaying: playback.isPlaying
      },
      sheet: {
        autoApplied: sheet.autoApplied,
        columns: sheet.columns,
        enabled: sheet.enabled,
        rows: sheet.rows
      }
    }),
    importPaths
  }

  useEffect(() => {
    const bridge: SmokeBridge = {
      exportGif: async () => {
        await smokeFnsRef.current?.exportGif()
      },
      exportSequence: async () => {
        await smokeFnsRef.current?.exportSequence()
      },
      getSnapshot: () =>
        smokeFnsRef.current?.getSnapshot() ?? {
          frameCount: 0,
          playback: {
            currentFrame: 0,
            fps: 0,
            isPlaying: false
          },
          sheet: {
            autoApplied: false,
            columns: 0,
            enabled: false,
            rows: 0
          }
        },
      importPaths: async (paths) => {
        await smokeFnsRef.current?.importPaths(paths)
      }
    }

    window.__spriteSheetSmoke = bridge
    return () => {
      delete window.__spriteSheetSmoke
    }
  }, [])

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-left">
          <span className="eyebrow-header">桌面工具链</span>
          <h1>序列图工具</h1>
        </div>
        <div className="app-header-right compact-header-actions">
          <button
            className="ghost-button"
            disabled={isBusy}
            onClick={() => {
              void handleImportFiles()
            }}
            type="button"
          >
            导入文件
          </button>
          <button
            className="ghost-button"
            disabled={isBusy}
            onClick={() => {
              void handleImportFolder()
            }}
            type="button"
          >
            导入文件夹
          </button>
          <button className="ghost-button" disabled={!canClear || isBusy} onClick={handleClearWorkspace} type="button">
            清空
          </button>
          <button
            className="ghost-button header-button"
            onClick={() => {
              if (isGuideOpen) {
                closeGuide()
                return
              }

              openGuide('manual')
            }}
            type="button"
          >
            <span>操作说明</span>
            <span className="shortcut-tag">F1</span>
          </button>
          <button className="ghost-button icon-only-button" onClick={() => setIsSettingsOpen(true)} title="设置" type="button">
            ⚙
          </button>
        </div>
      </header>

      {errorMessage ? (
        <div className="error-banner">
          <span>{errorMessage}</span>
          <button className="secondary-button" onClick={clearError} type="button">
            关闭
          </button>
        </div>
      ) : null}

      <div className="app-grid">
        <div
          className={[
            'app-workspace',
            leftDrawerFixed ? 'workspace-fixed-left' : '',
            rightDrawerFixed ? 'workspace-fixed-right' : ''
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <aside
            className={[
              'sidebar-drawer',
              'sidebar-drawer-left',
              isDrawerVisible('left') ? 'sidebar-drawer-open' : '',
              leftDrawerFixed ? 'sidebar-drawer-fixed' : ''
            ]
              .filter(Boolean)
              .join(' ')}
            ref={(element) => {
              drawerRefs.current.left = element
            }}
            onBlurCapture={(event) => {
              handleDrawerBlur('left', event.currentTarget, event.relatedTarget)
            }}
            onMouseEnter={() => scheduleDrawerOpen('left')}
            onMouseLeave={() => scheduleDrawerClose('left')}
            style={!hasWorkspaceContent ? { display: 'none' } : undefined}
          >
            <div className="drawer-content" onFocusCapture={() => openDrawer('left')} onMouseEnter={() => openDrawer('left')}>
              <div className="drawer-topbar">
                <span className="drawer-title">图集识别</span>
                <button
                  className={leftDrawerFixed ? 'drawer-lock-btn active' : 'drawer-lock-btn'}
                  onClick={() => toggleDrawerFixed('left')}
                  title={leftDrawerFixed ? '取消固定左侧区域' : '固定左侧区域'}
                  type="button"
                >
                  {leftDrawerFixed ? '已固定' : '固定'}
                </button>
              </div>
                <SheetPanel
                  appliedGeometrySignature={appliedSheetGeometrySignature}
                  canApply={sheetGeometry.canApply}
                  columns={sheetGeometry.columns}
                  frameHeight={sheetGeometry.frameHeight}
                  frameWidth={sheetGeometry.frameWidth}
                  isBusy={isBusy}
                onApply={(geometry) => {
                  void handleApplySheet(geometry)
                }}
                onChooseCandidate={handleChooseCandidate}
                onExportSplitSequence={(geometry) => {
                  openExportModal({ splitGeometry: geometry })
                }}
                onUpdateSheet={handleUpdateSheet}
                predictedFrameCount={sheetGeometry.predictedFrameCount}
                rows={sheetGeometry.rows}
                sheet={sheet}
              />
            </div>
            <div className="drawer-handle drawer-handle-left">
              <button
                className={drawerLocks.left ? 'handle-lock-button active' : 'handle-lock-button'}
                onClick={(event) => {
                  event.stopPropagation()
                  toggleDrawerLock('left')
                }}
                title={drawerLocks.left ? '取消临时锁定左侧抽屉' : '临时锁定左侧抽屉'}
                type="button"
              >
                <HandleLockIcon locked={drawerLocks.left} />
              </button>
              <div className="handle-activate-zone" onMouseEnter={() => scheduleDrawerOpen('left')}>
                <span className="handle-text">图集识别</span>
                <span className="handle-icon handle-icon-left">»</span>
              </div>
            </div>
          </aside>

          <main className="preview-column">
            {frames.length === 0 && !sheet.source ? (
              <div
                className="empty-workspace-drop"
                onDragOver={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  clearWindowDragState()
                  const droppedFiles = Array.from(event.dataTransfer.files)
                  if (droppedFiles.length > 0) {
                    void importDroppedFiles(droppedFiles)
                  }
                }}
              >
                <h2>开始创作</h2>
                <p>将图片、GIF 动图或文件夹拖拽至此</p>
                <div className="button-grid">
                  <button
                    className="primary-button"
                    onClick={() => {
                      void handleImportFiles()
                    }}
                    type="button"
                  >
                    选择文件
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      void handleImportFolder()
                    }}
                    type="button"
                  >
                    选择文件夹
                  </button>
                </div>
              </div>
            ) : (
              <>
                <PreviewStage
                  background={playback.background}
                  canClearWorkspace={canClear}
                  frame={currentFrame}
                  onEditFrameInPhotoshop={(frame) => {
                    void handleEditFrameInPhotoshop(frame)
                  }}
                  onReplaceCurrentFrame={(frame) => {
                    void handleReplaceSpecificFrameImport(frame.id)
                  }}
                  onRequestClearWorkspace={handleClearWorkspace}
                  resetViewNonce={resetViewNonce}
                  onZoomChange={(zoom) => updatePlaybackSettings({ zoom }, false)}
                  zoom={playback.zoom}
                />

                <div className="viewport-toolbar">
                  <div className="vt-left">
                    <select
                      onChange={(event) => updatePlaybackSettings({ background: event.target.value as typeof playback.background }, false)}
                      value={playback.background}
                    >
                      <option value="checker">棋盘</option>
                      <option value="black">纯黑</option>
                      <option value="white">纯白</option>
                    </select>
                    <select
                      onChange={(event) =>
                        updatePlaybackSettings(
                          { zoom: event.target.value === 'fit' ? 'fit' : Number(event.target.value) },
                          false
                        )
                      }
                      value={String(playback.zoom)}
                    >
                      {typeof playback.zoom === 'number' && ![50, 100, 200, 400].includes(playback.zoom) ? (
                        <option value={String(playback.zoom)}>{playback.zoom}%</option>
                      ) : null}
                      <option value="fit">适应</option>
                      <option value="50">50%</option>
                      <option value="100">100%</option>
                      <option value="200">200%</option>
                      <option value="400">400%</option>
                    </select>
                    <button
                      className="secondary-button toolbar-reset-btn"
                      onClick={handleResetView}
                      type="button"
                    >
                      <span>重置</span>
                      <span className="shortcut-tag">F</span>
                    </button>
                  </div>

                  <div className="vt-center">
                    <button className="secondary-button toolbar-nav-btn" disabled={frames.length === 0} onClick={handlePrevious} type="button">
                      |◀
                    </button>
                    <button className="play-action-btn" disabled={frames.length === 0} onClick={handleTogglePlay} type="button">
                      <span>{playback.isPlaying ? '暂停' : '播放'}</span>
                      <span className="shortcut-tag">Space</span>
                    </button>
                    <button className="secondary-button toolbar-nav-btn" disabled={frames.length === 0} onClick={handleNext} type="button">
                      ▶|
                    </button>
                    <div
                      className="fps-control"
                      title="鼠标在此处滚动可调节帧率"
                      onWheel={(event) => {
                        event.preventDefault()
                        const step = event.deltaY < 0 ? 1 : -1
                        updatePlaybackSettings({ fps: clampFps(playback.fps + step) })
                      }}
                    >
                      <span>FPS: {playback.fps}</span>
                      <input
                        max={60}
                        min={1}
                        onChange={(event) => updatePlaybackSettings({ fps: clampFps(Number(event.target.value)) })}
                        type="range"
                        value={playback.fps}
                      />
                      <input
                        aria-label="FPS 数值"
                        className="number-input fps-number-input"
                        max={60}
                        min={1}
                        onChange={(event) => updatePlaybackSettings({ fps: clampFps(Number(event.target.value || playback.fps)) })}
                        type="number"
                        value={playback.fps}
                      />
                    </div>
                  </div>

                  <div className="vt-right">
                    {currentFrame ? (
                      <>
                        <span className="compact-file-name" title={currentFrame.name}>
                          {currentFrame.name}
                        </span>
                        <span className="compact-file-resolution">{currentFrame.width}x{currentFrame.height}</span>
                      </>
                    ) : null}
                    <span className="compact-counter">{frames.length === 0 ? '0/0' : `${playback.currentFrame + 1}/${frames.length}`}</span>
                  </div>
                </div>
              </>
            )}
          </main>

          <aside
            className={[
              'sidebar-drawer',
              'sidebar-drawer-right',
              isDrawerVisible('right') ? 'sidebar-drawer-open' : '',
              rightDrawerFixed ? 'sidebar-drawer-fixed' : ''
            ]
              .filter(Boolean)
              .join(' ')}
            ref={(element) => {
              drawerRefs.current.right = element
            }}
            onBlurCapture={(event) => {
              handleDrawerBlur('right', event.currentTarget, event.relatedTarget)
            }}
            onMouseEnter={() => scheduleDrawerOpen('right')}
            onMouseLeave={() => scheduleDrawerClose('right')}
            style={frames.length === 0 && !sheet.source ? { display: 'none' } : undefined}
          >
            <div className="drawer-handle drawer-handle-right">
              <button
                className={drawerLocks.right ? 'handle-lock-button active' : 'handle-lock-button'}
                onClick={(event) => {
                  event.stopPropagation()
                  toggleDrawerLock('right')
                }}
                title={drawerLocks.right ? '取消临时锁定右侧抽屉' : '临时锁定右侧抽屉'}
                type="button"
              >
                <HandleLockIcon locked={drawerLocks.right} />
              </button>
              <div className="handle-activate-zone" onMouseEnter={() => scheduleDrawerOpen('right')}>
                <span className="handle-text">编辑与导出</span>
                <span className="handle-icon handle-icon-right">«</span>
              </div>
            </div>
            <div className="drawer-content" onFocusCapture={() => openDrawer('right')} onMouseEnter={() => openDrawer('right')}>
              <div className="drawer-topbar">
                <span className="drawer-title">编辑与导出</span>
                <button
                  className={rightDrawerFixed ? 'drawer-lock-btn active' : 'drawer-lock-btn'}
                  onClick={() => toggleDrawerFixed('right')}
                  title={rightDrawerFixed ? '取消固定右侧区域' : '固定右侧区域'}
                  type="button"
                >
                  {rightDrawerFixed ? '已固定' : '固定'}
                </button>
              </div>
              <div className="drawer-scroll-stack">
                <ImportPanel
                  canRedo={canRedo}
                  canUndo={canUndo}
                  frameCount={frames.length}
                  isBusy={isBusy}
                  onDeleteSelected={deleteSelectedFrames}
                  onRedo={redo}
                  onReverse={reverseFrames}
                  onRotate={(rotation) => {
                    void handleRotate(rotation)
                  }}
                  onUndo={undo}
                  selectedCount={selectedFrameIds.length}
                  statusMessage={statusMessage}
                />

                <PlaybackPanel
                  frameCount={frames.length}
                  onUpdatePlayback={updatePlaybackSettings}
                  playback={playback}
                />
              </div>

              <ExportPanel
                canExportSplitSequence={sheetGeometry.canApply}
                exportFrameCount={exportFrames.length}
                exportSettings={exportSettings}
                isOpen={isExportPanelOpen}
                onExportGif={() => {
                  void handleExportGif()
                }}
                onExportSequence={() => {
                  void handleExportSequence()
                }}
                onExportSplitSequence={() => {
                  void handleExportSplitSequence(pendingSplitExportGeometry ?? sheetGeometry)
                }}
                onExportSheet={() => {
                  void handleExportSheet()
                }}
                onOpenChange={(open) => {
                  setIsExportPanelOpen(open)
                  if (!open) {
                    setPendingSplitExportGeometry(null)
                  }
                }}
                onUpdateExport={updateExportSettings}
                recommendedLayout={recommendedLayout}
              />
            </div>
          </aside>
        </div>

        {!(frames.length === 0 && !sheet.source) ? (
          <FrameTimeline
            currentFrame={playback.currentFrame}
            frames={frames}
            onEditFrameInPhotoshop={(frame) => {
              void handleEditFrameInPhotoshop(frame)
            }}
            onMoveFrame={moveFrame}
            onReplaceCurrentFrame={(frame) => {
              void handleReplaceSpecificFrameImport(frame.id)
            }}
            onSelectFrame={selectFrame}
            selectedFrameIds={selectedFrameIds}
          />
        ) : null}
      </div>

      {isBusy && operationProgress ? (
        <div className="busy-overlay">
          <div className="busy-card">
            <strong>{operationProgress.title}</strong>
            <span>{operationProgress.detail}</span>
            <div className="busy-progress-track">
              <div
                className={operationProgress!.percent === null ? 'busy-progress-bar indeterminate' : 'busy-progress-bar'}
                style={
                  operationProgress!.percent === null
                    ? undefined
                    : { width: `${Math.max(0, Math.min(100, operationProgress!.percent!))}%` }
                }
              />
            </div>
            <small>
              {operationProgress!.percent === null
                ? '当前步骤无法精确估时，但任务仍在继续。'
                : `已完成 ${Math.round(operationProgress.percent)}%`}
            </small>
            {operationProgress!.cancellable ? (
              <div className="busy-card-actions">
                <button className="secondary-button" onClick={cancelCurrentOperation} type="button">
                  取消当前任务
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <GuideModal
        activeSection={guideSection}
        autoShowEnabled={uiPreferences.guideAutoShow}
        currentVersion={currentAppVersion ?? updateStatus.currentVersion}
        isOpen={isGuideOpen}
        onChangeSection={setGuideSection}
        onClose={() => closeGuide()}
        onConfirm={() => closeGuide()}
        onDisableAutoShow={() => closeGuide('never-auto-show')}
        onToggleAutoShow={(enabled) => updateUiPreferences({ guideAutoShow: enabled })}
        reason={guideReason ?? 'manual'}
        shortcutRows={guideShortcutRows}
      />

      {pendingImportPrompt ? (
        <div className="modal-overlay" onClick={() => closePendingImportPrompt(false)}>
          <div
            className="modal-card settings-modal-card"
            onClick={(event) => {
              event.stopPropagation()
            }}
          >
            <div className="modal-header">
              <div>
                <span className="eyebrow">导入方式</span>
                <h2>导入到当前序列？</h2>
              </div>
              <button className="secondary-button" onClick={() => closePendingImportPrompt(false)} type="button">
                取消
              </button>
            </div>

            <div className="hint-card">
              <span className="eyebrow">当前画布</span>
              <p>
                当前时间轴里已经有 {pendingImportPrompt.currentFrameCount} 帧。
                <br />
                这次要导入的是{pendingImportPrompt.sourceLabel}，你可以把它们追加到当前序列、替换第 {pendingImportPrompt.currentFrameIndex}{' '}
                帧，或者先清空当前画布再重新导入。
              </p>
            </div>

            <div className="button-grid action-grid-three">
              <button className="primary-button" onClick={() => handleImportDecision('append')} type="button">
                追加到当前序列
              </button>
              <button className="secondary-button" onClick={() => handleImportDecision('replace-current')} type="button">
                替换当前帧
              </button>
              <button className="secondary-button" onClick={() => handleImportDecision('replace')} type="button">
                清空后重新导入
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pendingSingleImageImportPrompt ? (
        <div className="modal-overlay">
          <div
            className="modal-card recognition-modal-card"
            onClick={(event) => {
              event.stopPropagation()
            }}
          >
            <div className="modal-header">
              <div className="recognition-modal-heading">
                <h2>这张图片如何导入？</h2>
              </div>
              <button className="secondary-button" onClick={() => closePendingSingleImageImportPrompt(false)} type="button">
                取消
              </button>
            </div>

            <div className="hint-card">
              <span className="eyebrow">推荐结果</span>
              <p>
                推荐把 {pendingSingleImageImportPrompt.sourceName} 当作 {pendingSingleImageImportPrompt.columns} x{' '}
                {pendingSingleImageImportPrompt.rows} 的序列图导入，预计会拆成 {pendingSingleImageImportPrompt.frameCount} 帧。
                <br />
                你也可以先自己决定拆法，或者改选其他候选方案后再导入。
              </p>
            </div>

            <button
              className="secondary-button recognition-option-button full-width-button"
              onClick={() => handleSingleImageImportDecision({ type: 'single' })}
              type="button"
            >
              <span className="recognition-option-topline">
                <span className="recognition-option-title">先按单帧导入</span>
                <span className="recognition-action-label">点击导入</span>
              </span>
              <span className="recognition-option-detail">不拆帧导入；右侧会保留识别结果，之后仍然可以一键应用为序列。</span>
            </button>

            <div className="control-block recognition-manual-block">
              <button
                className="secondary-button recognition-manual-trigger"
                onClick={() => setIsSingleImageManualEntryOpen((current) => !current)}
                type="button"
              >
                <span className="recognition-option-topline">
                  <span className="recognition-manual-title-row">
                    <span className="eyebrow">手动输入</span>
                    <span className="recognition-option-title">自己决定拆法</span>
                  </span>
                  <span className="recognition-action-label">{isSingleImageManualEntryOpen ? '点击收起' : '点击展开'}</span>
                </span>
                <span className="recognition-option-detail">
                  需要精确指定时，可以直接输入列数 / 行数，或者输入帧宽 / 帧高来导入。
                </span>
              </button>

              {isSingleImageManualEntryOpen && pendingSingleImageImportDraft && pendingSingleImageGeometry ? (
                <div className="recognition-manual-card">
                  <div className="toggle-group">
                    <button
                      className={pendingSingleImageImportDraft.mode === 'grid' ? 'toggle-button active' : 'toggle-button'}
                      onClick={() =>
                        setPendingSingleImageImportDraft((current) => (current ? { ...current, mode: 'grid' } : current))
                      }
                      type="button"
                    >
                      列行方式
                    </button>
                    <button
                      className={pendingSingleImageImportDraft.mode === 'cell' ? 'toggle-button active' : 'toggle-button'}
                      onClick={() =>
                        setPendingSingleImageImportDraft((current) => (current ? { ...current, mode: 'cell' } : current))
                      }
                      type="button"
                    >
                      帧尺寸方式
                    </button>
                  </div>

                  {pendingSingleImageImportDraft.mode === 'grid' ? (
                    <div className="form-grid">
                      <label>
                        列
                        <input
                          className="number-input"
                          min={1}
                          onChange={(event) =>
                            setPendingSingleImageImportDraft((current) => (current ? { ...current, columns: event.target.value } : current))
                          }
                          type="number"
                          value={pendingSingleImageImportDraft.columns}
                        />
                      </label>
                      <label>
                        行
                        <input
                          className="number-input"
                          min={1}
                          onChange={(event) =>
                            setPendingSingleImageImportDraft((current) => (current ? { ...current, rows: event.target.value } : current))
                          }
                          type="number"
                          value={pendingSingleImageImportDraft.rows}
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
                          onChange={(event) =>
                            setPendingSingleImageImportDraft((current) =>
                              current ? { ...current, frameWidth: event.target.value } : current
                            )
                          }
                          type="number"
                          value={pendingSingleImageImportDraft.frameWidth}
                        />
                      </label>
                      <label>
                        帧高
                        <input
                          className="number-input"
                          min={1}
                          onChange={(event) =>
                            setPendingSingleImageImportDraft((current) =>
                              current ? { ...current, frameHeight: event.target.value } : current
                            )
                          }
                          type="number"
                          value={pendingSingleImageImportDraft.frameHeight}
                        />
                      </label>
                    </div>
                  )}

                  <div className="stats-grid">
                    <div className="stat-card">
                      <span>帧尺寸</span>
                      <strong>
                        {pendingSingleImageGeometry.frameWidth} x {pendingSingleImageGeometry.frameHeight}
                      </strong>
                    </div>
                    <div className="stat-card">
                      <span>预计帧数</span>
                      <strong>{pendingSingleImageGeometry.predictedFrameCount}</strong>
                    </div>
                  </div>

                  <p className="muted-copy">
                    {pendingSingleImageGeometry.canApply
                      ? '将按这组参数直接导入为序列。'
                      : pendingSingleImageImportDraft.mode === 'cell'
                        ? '帧尺寸方式目前要求能整除原图。'
                        : '请输入有效的列数和行数。'}
                  </p>

                  <button
                    className="secondary-button full-width-button"
                    disabled={!pendingSingleImageGeometry.canApply}
                    onClick={() =>
                      handleSingleImageImportDecision({
                        geometry: {
                          columns: pendingSingleImageGeometry.columns,
                          frameHeight: pendingSingleImageGeometry.frameHeight,
                          frameWidth: pendingSingleImageGeometry.frameWidth,
                          mode: pendingSingleImageGeometry.mode,
                          rows: pendingSingleImageGeometry.rows
                        },
                        type: 'sheet'
                      })
                    }
                    type="button"
                  >
                    按手动输入导入
                  </button>
                </div>
              ) : null}
            </div>

            <div className="control-block">
              <div className="section-heading compact">
                <span className="eyebrow">候选方案</span>
                <h3>直接导入为序列</h3>
              </div>

              <div className="recognition-candidate-grid">
                {modalSingleImageCandidates.map((candidate) => {
                  const isRecommended =
                    candidate.rows === pendingSingleImageImportPrompt.rows && candidate.columns === pendingSingleImageImportPrompt.columns

                  return (
                    <button
                      key={`${candidate.rows}x${candidate.columns}`}
                      className={`secondary-button recognition-option-button${isRecommended ? ' recognition-option-recommended' : ''}`}
                      onClick={() =>
                        handleSingleImageImportDecision({
                          geometry: {
                            columns: candidate.columns,
                            frameHeight: candidate.frameHeight,
                            frameWidth: candidate.frameWidth,
                            mode: 'grid',
                            rows: candidate.rows
                          },
                          type: 'sheet'
                        })
                      }
                      type="button"
                    >
                      <span className="recognition-option-topline">
                        <span className="recognition-option-title">
                          {candidate.columns} x {candidate.rows}
                        </span>
                        <span className="recognition-option-actions">
                          {isRecommended ? <span className="recognition-badge">推荐</span> : null}
                          <span className="recognition-action-label">点击导入</span>
                        </span>
                      </span>
                      <span className="recognition-option-detail">
                        {formatGridCandidateDetail(pendingSingleImageImportPrompt, candidate)}
                      </span>
                    </button>
                  )
                })}
              </div>

              {pendingSingleImageImportPrompt.candidates.length > modalSingleImageCandidates.length ? (
                <p className="muted-copy">
                  这里先显示最常用的 {modalSingleImageCandidates.length} 个候选；更多方案仍然可以在右侧候选列表里继续切换。
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <SettingsPanel
        isOpen={isSettingsOpen}
        isUpdateActionPending={isUpdateActionPending}
        onCheckForUpdates={() => {
          void handleCheckForUpdates()
        }}
        onChoosePhotoshopPath={() => {
          void choosePhotoshopExecutable()
        }}
        onClearPhotoshopPath={() => {
          updateUiPreferences({ photoshopPath: '' })
          setStatusMessage('已清空 Photoshop 路径。')
        }}
        onClose={() => setIsSettingsOpen(false)}
        onDownloadUpdate={() => {
          void handleDownloadUpdate()
        }}
        onInstallDownloadedUpdate={() => {
          void handleInstallDownloadedUpdate()
        }}
        onOpenUpdateDownloadPage={() => {
          void handleOpenUpdateDownloadPage()
        }}
        onUpdate={updateUiPreferences}
        preferences={uiPreferences}
        updateStatus={updateStatus}
      />

      <UpdateReminderCard
        onDismiss={handleDismissUpdateReminder}
        onIgnoreVersion={handleIgnoreUpdateReminderVersion}
        onPrimaryAction={() => {
          void handleUpdateReminderPrimaryAction()
        }}
        status={updateStatus}
        visible={shouldShowUpdateReminder}
      />

      {exportNotice ? (
        <div className="export-toast">
          <div className="export-toast-body">
            <strong>{exportNotice.label}</strong>
            <span>{exportNotice.targetPath}</span>
          </div>
          <div className="export-toast-actions">
            <button className="secondary-button" onClick={() => void handleRevealExportLocation()} type="button">
              打开保存位置
            </button>
            <button className="secondary-button" onClick={() => setExportNotice(null)} type="button">
              完成
            </button>
          </div>
        </div>
      ) : null}

      {isWindowDragActive ? (
        <div className="drop-overlay">
          <div className="drop-overlay-card">
            <strong>松开即可导入</strong>
            <span>支持图片、GIF 和文件夹。检测到可能是序列图时，会先让你选择按单帧还是按序列导入。</span>
          </div>
        </div>
      ) : null}
    </div>
  )

  /*
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-left">
          <span className="eyebrow-header">桌面工具链</span>
          <h1>序列图工具</h1>
        </div>
        <div className="app-header-right">
          <p>面向游戏特效师的高密度桌面工作台，支持快速导入、自动识别、预览拆分与稳定导出。</p>
          <div className="header-actions">
            <div className="top-toolbar">
              <button
                className="secondary-button"
                disabled={isBusy}
                onClick={() => {
                  void handleImportFiles()
                }}
                type="button"
              >
                导入文件
              </button>
              <button
                className="secondary-button"
                disabled={isBusy}
                onClick={() => {
                  void handleImportFolder()
                }}
                type="button"
              >
                导入文件夹
              </button>
              <button
                className="secondary-button"
                disabled={!canClear || isBusy}
                onClick={handleClearWorkspace}
                type="button"
              >
                清空
              </button>
            </div>
            <button className="header-button" onClick={() => setIsHelpOpen(true)} type="button">
              快捷键 / 说明
            </button>
          </div>
        </div>
      </header>

      {errorMessage ? (
        <div className="error-banner">
          <span>{errorMessage}</span>
          <button className="secondary-button" onClick={clearError} type="button">
            关闭
          </button>
        </div>
      ) : null}

      <div className="app-grid">
        <aside className="sidebar-column">
          <ImportPanel
            canRedo={canRedo}
            canUndo={canUndo}
            frameCount={frames.length}
            isBusy={isBusy}
            onDeleteSelected={deleteSelectedFrames}
            onRedo={redo}
            onReverse={reverseFrames}
            onRotate={(rotation) => {
              void handleRotate(rotation)
            }}
            onUndo={undo}
            selectedCount={selectedFrameIds.length}
            statusMessage={statusMessage}
          />

          <SheetPanel
            canApply={sheetGeometry.canApply}
            columns={sheetGeometry.columns}
            exportSettings={exportSettings}
            frameHeight={sheetGeometry.frameHeight}
            frameWidth={sheetGeometry.frameWidth}
            isBusy={isBusy}
            onApply={() => {
              void handleApplySheet()
            }}
            onChooseCandidate={handleChooseCandidate}
            onExportSplitSequence={() => {
              void handleExportSplitSequence()
            }}
            onUpdateSheet={handleUpdateSheet}
            predictedFrameCount={sheetGeometry.predictedFrameCount}
            rows={sheetGeometry.rows}
            sheet={sheet}
          />
        </aside>

        <main className="preview-column">
          {frames.length === 0 && !sheet.source ? (
            <div
              className="empty-workspace-drop"
              onDragOver={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
              onDrop={(event) => {
                event.preventDefault()
                event.stopPropagation()
                const droppedFiles = Array.from(event.dataTransfer.files)
                if (droppedFiles.length > 0) {
                  void importDroppedFiles(droppedFiles)
                }
              }}
            >
              <h2>开始创作</h2>
              <p>将图片、GIF 动图或文件夹拖拽到这里</p>
              <div className="button-grid">
                <button
                  className="primary-button"
                  onClick={() => {
                    void handleImportFiles()
                  }}
                  type="button"
                >
                  选择文件
                </button>
                <button
                  className="secondary-button"
                  onClick={() => {
                    void handleImportFolder()
                  }}
                  type="button"
                >
                  选择文件夹
                </button>
              </div>
            </div>
          ) : (
            <>
              <PreviewStage background={playback.background} frame={currentFrame} zoom={playback.zoom} />

              <div className="viewport-toolbar">
                <div className="vt-group">
                  <select
                    className="toolbar-select"
                    onChange={(event) => updatePlaybackSettings({ background: event.target.value as typeof playback.background }, false)}
                    value={playback.background}
                  >
                    <option value="checker">背景: 棋盘</option>
                    <option value="black">背景: 纯黑</option>
                    <option value="white">背景: 纯白</option>
                  </select>
                  <select
                    className="toolbar-select"
                    onChange={(event) =>
                      updatePlaybackSettings(
                        { zoom: event.target.value === 'fit' ? 'fit' : Number(event.target.value) },
                        false
                      )
                    }
                    value={String(playback.zoom)}
                  >
                    <option value="fit">缩放: 适应</option>
                    <option value="50">50%</option>
                    <option value="100">100%</option>
                    <option value="200">200%</option>
                    <option value="400">400%</option>
                  </select>
                </div>

                <div className="vt-group vt-center">
                  <button className="toolbar-btn" disabled={frames.length === 0} onClick={handlePrevious} type="button">
                    |◀
                  </button>
                  <button className="toolbar-btn play-btn" disabled={frames.length === 0} onClick={handleTogglePlay} type="button">
                    {playback.isPlaying ? '暂停' : '播放'}
                  </button>
                  <button className="toolbar-btn" disabled={frames.length === 0} onClick={handleNext} type="button">
                    ▶|
                  </button>
                </div>

                <div className="vt-group vt-right">
                  <span>{frames.length === 0 ? '0 / 0' : `${playback.currentFrame + 1} / ${frames.length} 帧`}</span>
                </div>
              </div>

              <FrameTimeline
                currentFrame={playback.currentFrame}
                frames={frames}
                onMoveFrame={moveFrame}
                onSelectFrame={selectFrame}
                selectedFrameIds={selectedFrameIds}
              />
            </>
          )}
        </main>

        <aside className="sidebar-column">
          <PlaybackPanel
            frameCount={frames.length}
            onUpdatePlayback={updatePlaybackSettings}
            playback={playback}
          />

          <ExportPanel
            exportFrameCount={exportFrames.length}
            exportSettings={exportSettings}
            onExportGif={() => {
              void handleExportGif()
            }}
            onExportSequence={() => {
              void handleExportSequence()
            }}
            onExportSheet={() => {
              void handleExportSheet()
            }}
            onUpdateExport={updateExportSettings}
            recommendedLayout={recommendedLayout}
          />
        </aside>
      </div>

      {isBusy && operationProgress ? (
        <div className="busy-overlay">
          <div className="busy-card">
            <strong>{operationProgress.title}</strong>
            <span>{operationProgress.detail}</span>
            <div className="busy-progress-track">
              <div
                className={operationProgress!.percent === null ? 'busy-progress-bar indeterminate' : 'busy-progress-bar'}
                style={
                  operationProgress!.percent === null
                    ? undefined
                    : { width: `${Math.max(0, Math.min(100, operationProgress!.percent!))}%` }
                }
              />
            </div>
            <small>
              {operationProgress!.percent === null
                ? '当前步骤无法精确估时，但任务仍在继续。'
                : `已完成 ${Math.round(operationProgress.percent)}%`}
            </small>
            {operationProgress!.cancellable ? (
              <div className="busy-card-actions">
                <button className="secondary-button" onClick={cancelCurrentOperation} type="button">
                  取消当前任务
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {isHelpOpen ? (
        <div className="modal-overlay" onClick={() => setIsHelpOpen(false)}>
          <div
            className="modal-card"
            onClick={(event) => {
              event.stopPropagation()
            }}
          >
            <div className="modal-header">
              <div>
                <span className="eyebrow">帮助</span>
                <h2>快捷键与说明</h2>
              </div>
              <button className="secondary-button" onClick={() => setIsHelpOpen(false)} type="button">
                关闭
              </button>
            </div>

            <div className="help-grid">
              {shortcutRows.map(([shortcut, description]) => (
                <div className="help-row" key={shortcut}>
                  <kbd>{shortcut}</kbd>
                  <span>{description}</span>
                </div>
              ))}
            </div>

            <div className="hint-card">
              <span className="eyebrow">补充说明</span>
              <p>
                1. `Esc` 会优先关闭当前说明窗口，其次取消正在执行的长任务。
                <br />
                2. 图片序列与拆分序列导出如果中途取消，会自动清理这次已写出的半成品文件。
                <br />
                3. 在输入框或下拉框里编辑时，快捷键不会抢占你的输入。
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {isWindowDragActive ? (
        <div className="drop-overlay">
          <div className="drop-overlay-card">
            <strong>松开即可导入</strong>
            <span>支持图片、GIF 和文件夹。规则序列图会尽量自动识别，并在置信度足够时直接开始播放。</span>
          </div>
        </div>
      ) : null}
    </div>
  )
  */
}
