import { startTransition, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'

import { SUPPORTED_EXTENSIONS } from '@shared/constants'
import type { FrameItem, GridCandidate, ImportedFilePayload, SheetState, TaskProgress } from '@shared/types'

import { buildExportFileName, buildExportSequence } from '@features/export/plans'
import { buildImportSession } from '@features/import/importSession'
import { normalizeSheetLayout, recommendSheetLayout } from '@features/merge/layout'
import { advanceSequencePosition, buildFrameSequence } from '@features/preview/frameSequence'
import { canvasToBytes, composeSpriteSheet, frameToBytes, rotateFrames, splitSheetToFrames } from '@lib/image/browser'
import { encodeGif } from '@lib/image/gif'

import { ExportPanel } from './components/ExportPanel'
import { FrameTimeline } from './components/FrameTimeline'
import { ImportPanel } from './components/ImportPanel'
import { PlaybackPanel } from './components/PlaybackPanel'
import { PreviewStage } from './components/PreviewStage'
import { type UiPreferences, SettingsPanel } from './components/SettingsPanel'
import { SheetPanel } from './components/SheetPanel'
import { useCanRedo, useCanUndo, useEditorStore } from './store/editorStore'

const OPERATION_CANCELLED = '__OPERATION_CANCELLED__'
const UI_PREFERENCES_KEY = 'sprite-sheet-tool.ui-preferences.v1'
const DEFAULT_UI_PREFERENCES: UiPreferences = {
  drawerBlurDelayMs: 180,
  drawerFixedMode: 'none'
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
  ['Space', '播放 / 暂停'],
  ['Left / Right', '上一帧 / 下一帧'],
  ['Delete / Backspace', '删除选中帧'],
  ['Ctrl/Cmd + Z', '撤销'],
  ['Ctrl/Cmd + Shift + Z', '重做'],
  ['Ctrl/Cmd + Y', '重做'],
  ['Ctrl/Cmd + O', '导入文件'],
  ['Ctrl/Cmd + Shift + O', '导入文件夹'],
  ['Esc', '关闭说明或取消当前任务']
] as const

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

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  const tagName = target.tagName
  return target.isContentEditable || tagName === 'INPUT' || tagName === 'SELECT' || tagName === 'TEXTAREA'
}

const getSheetGeometry = (sheet: SheetState) => {
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

  const validGrid = sheet.rows > 0 && sheet.columns > 0
  const exact = validGrid && sheet.sourceWidth % sheet.columns === 0 && sheet.sourceHeight % sheet.rows === 0
  const frameWidth = exact ? Math.floor(sheet.sourceWidth / sheet.columns) : 0
  const frameHeight = exact ? Math.floor(sheet.sourceHeight / sheet.rows) : 0

  return {
    canApply: exact && frameWidth > 0 && frameHeight > 0,
    columns: sheet.columns,
    frameHeight,
    frameWidth,
    predictedFrameCount: exact ? sheet.rows * sheet.columns : 0,
    rows: sheet.rows
  }
}

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
          : DEFAULT_UI_PREFERENCES.drawerFixedMode
    }
  } catch {
    return DEFAULT_UI_PREFERENCES
  }
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
  const replaceFrames = useEditorStore((state) => state.replaceFrames)
  const resetWorkspace = useEditorStore((state) => state.resetWorkspace)
  const reverseFrames = useEditorStore((state) => state.reverseFrames)
  const selectFrame = useEditorStore((state) => state.selectFrame)
  const setBusy = useEditorStore((state) => state.setBusy)
  const setCurrentFrame = useEditorStore((state) => state.setCurrentFrame)
  const setErrorMessage = useEditorStore((state) => state.setErrorMessage)
  const setIsPlaying = useEditorStore((state) => state.setIsPlaying)
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
  const [isHelpOpen, setIsHelpOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [pingPongDirection, setPingPongDirection] = useState<1 | -1>(1)
  const [isWindowDragActive, setIsWindowDragActive] = useState(false)
  const [operationProgress, setOperationProgress] = useState<OperationProgressState | null>(null)
  const [uiPreferences, setUiPreferences] = useState<UiPreferences>(() => loadUiPreferences())
  const [exportNotice, setExportNotice] = useState<ExportNotice | null>(null)
  const operationRef = useRef<OperationController | null>(null)
  const smokeFnsRef = useRef<SmokeBridge | null>(null)
  const drawerCloseTimersRef = useRef<{ left: number | null; right: number | null }>({ left: null, right: null })
  const windowDragDepthRef = useRef(0)

  const clearWindowDragState = useEffectEvent(() => {
    windowDragDepthRef.current = 0
    setIsWindowDragActive(false)
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

  useEffect(() => {
    window.localStorage.setItem(UI_PREFERENCES_KEY, JSON.stringify(uiPreferences))
  }, [uiPreferences])

  useEffect(() => {
    const drawerCloseTimers = drawerCloseTimersRef.current
    return () => {
      for (const timer of Object.values(drawerCloseTimers)) {
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

  const openDrawer = useEffectEvent((side: 'left' | 'right') => {
    clearDrawerCloseTimer(side)
    setDrawerOpen((state) => ({ ...state, [side]: true }))
  })

  const scheduleDrawerClose = useEffectEvent((side: 'left' | 'right') => {
    if (isDrawerPinned(side)) {
      return
    }

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

    clearDrawerCloseTimer(side)
    setDrawerLocks((state) => {
      const nextLocked = !state[side]
      setDrawerOpen((openState) => ({ ...openState, [side]: nextLocked || openState[side] }))
      return { ...state, [side]: nextLocked }
    })
  })

  const updateUiPreferences = (patch: Partial<UiPreferences>): void => {
    setUiPreferences((state) => ({
      ...state,
      ...patch
    }))
  }

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

  const importPayloads = async (payloads: ImportedFilePayload[], controller: OperationController): Promise<void> => {
    ensureOperationActive(controller)

    if (payloads.length === 0) {
      setStatusMessage('没有找到可导入的图片或 GIF。')
      return
    }

    const session = await buildImportSession(payloads, async (progress) => {
      await updateOperationProgress(controller, progress)
    })

    ensureOperationActive(controller)
    applyImportSession(session)
    setPingPongDirection(1)
  }

  const exportFramesToDirectory = async (
    directory: string,
    framesToWrite: FrameItem[],
    stage: 'export-sequence' | 'export-split-sequence',
    controller: OperationController,
    writtenPaths: string[] = []
  ): Promise<void> => {
    for (let index = 0; index < framesToWrite.length; index += 1) {
      ensureOperationActive(controller)
      const frame = framesToWrite[index]
      const bytes = await frameToBytes(frame, exportSettings.imageFormat)
      ensureOperationActive(controller)

      const fileName = buildExportFileName(exportSettings.fileNamePrefix, index, exportSettings.padding, exportSettings.imageFormat)
      const filePath = joinPath(directory, fileName)
      await window.desktopApi.writeBinaryFile({
        data: Array.from(bytes),
        filePath
      })
      writtenPaths.push(filePath)

      await updateOperationProgress(controller, {
        current: index + 1,
        percent: ((index + 1) / framesToWrite.length) * 100,
        stage,
        total: framesToWrite.length
      })
    }
  }

  const cleanupExportArtifacts = async (writtenPaths: string[]): Promise<void> => {
    if (writtenPaths.length === 0) {
      return
    }

    await window.desktopApi.deletePaths(writtenPaths)
  }

  const importPaths = async (paths: string[]): Promise<void> => {
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
        await importPayloads(payloads, controller)
      },
      '已取消导入。'
    )
  }

  const importDroppedFiles = async (files: File[]): Promise<void> => {
    clearWindowDragState()

    const supportedFiles = files.filter((file) => isSupportedDroppedFile(file.name))
    if (supportedFiles.length === 0) {
      setStatusMessage('拖入内容里没有支持的图片或 GIF。')
      return
    }

    const resolvedPaths = supportedFiles
      .map((file) => window.desktopApi.getPathForDroppedFile(file))
      .filter((value): value is string => Boolean(value))

    if (resolvedPaths.length === supportedFiles.length && resolvedPaths.length > 0) {
      await importPaths(resolvedPaths)
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

          const extension = file.name.split('.').pop()?.toLowerCase() ?? 'png'
          payloads.push({
            dataUrl: await readFileAsDataUrl(file),
            extension,
            mimeType: file.type || `image/${extension}`,
            name: file.name,
            path: '',
            size: file.size
          })
        }

        await importPayloads(payloads, controller)
      },
      '已取消导入。'
    )
  }

  const handleImportFiles = async (): Promise<void> => {
    const paths = await window.desktopApi.openFiles()
    if (!paths || paths.length === 0) {
      return
    }

    await importPaths(paths)
  }

  const handleImportFolder = async (): Promise<void> => {
    const directory = await window.desktopApi.openDirectory()
    if (!directory) {
      return
    }

    await importPaths([directory])
  }

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
    setStatusMessage(`已切换到候选网格 ${candidate.rows} x ${candidate.columns}。`)
  }

  const handleApplySheet = async (): Promise<void> => {
    if (!sheet.source || !sheetGeometry.canApply) {
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
          sheetGeometry.rows,
          sheetGeometry.columns,
          sheetGeometry.frameWidth,
          sheetGeometry.frameHeight,
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
            columns: sheetGeometry.columns,
            enabled: true,
            frameHeight: sheetGeometry.frameHeight,
            frameWidth: sheetGeometry.frameWidth,
            rows: sheetGeometry.rows
          }
        })
        setPingPongDirection(1)
        setStatusMessage(`已按 ${sheetGeometry.rows} x ${sheetGeometry.columns} 拆分为 ${nextFrames.length} 帧。`)
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

    const directory = await window.desktopApi.chooseDirectory('选择图片序列导出文件夹')
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

  const handleExportSplitSequence = async (): Promise<void> => {
    if (!sheet.source || !sheetGeometry.canApply) {
      return
    }

    const source = sheet.source

    const directory = await window.desktopApi.chooseDirectory('选择拆分结果导出文件夹')
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
          sheetGeometry.rows,
          sheetGeometry.columns,
          sheetGeometry.frameWidth,
          sheetGeometry.frameHeight,
          async (progress) => {
            await updateOperationProgress(controller, progress)
          }
        )

        ensureOperationActive(controller)
        await exportFramesToDirectory(directory, splitFrames, 'export-split-sequence', controller, writtenPaths)
        setStatusMessage(`已导出 ${splitFrames.length} 张拆分图片到 ${directory}`)
        showExportNotice('拆分导出完成', directory)
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
        detail: `正在按 ${layout.rows} x ${layout.columns} 合并帧...`,
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
          defaultPath: `${exportSettings.fileNamePrefix}_sheet.${exportSettings.imageFormat}`,
          filters: saveFiltersByFormat[exportSettings.imageFormat],
          title: '导出序列图'
        })

        if (!savedPath) {
          setStatusMessage('已取消导出序列图。')
          return
        }

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
          defaultPath: `${exportSettings.fileNamePrefix}.gif`,
          filters: saveFiltersByFormat.gif,
          title: '导出 GIF'
        })

        if (!savedPath) {
          setStatusMessage('已取消导出 GIF。')
          return
        }

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
    setPingPongDirection(1)
    resetWorkspace()
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
    if (event.key === 'Escape' && isSettingsOpen) {
      event.preventDefault()
      setIsSettingsOpen(false)
      return
    }

    if (event.key === 'Escape' && isHelpOpen) {
      event.preventDefault()
      setIsHelpOpen(false)
      return
    }

    if (isHelpOpen) {
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

    if (event.key === 'F1') {
      event.preventDefault()
      setIsHelpOpen(true)
      return
    }

    if (isPrimaryModifier && event.key.toLowerCase() === 'o') {
      event.preventDefault()
      if (event.shiftKey) {
        void handleImportFolder()
      } else {
        void handleImportFiles()
      }
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

    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      handlePrevious()
      return
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault()
      handleNext()
      return
    }

    if ((event.key === 'Delete' || event.key === 'Backspace') && selectedFrameIds.length > 0 && !isBusy) {
      event.preventDefault()
      deleteSelectedFrames()
    }
  })

  useEffect(() => {
    window.addEventListener('keydown', handleGlobalKeydown)
    return () => {
      window.removeEventListener('keydown', handleGlobalKeydown)
    }
  }, [handleGlobalKeydown])

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
    void importDroppedFiles(files)
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
          <button className="ghost-button header-button" onClick={() => setIsHelpOpen(true)} type="button">
            快捷键说明
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
            isDrawerFixed('left') ? 'workspace-fixed-left' : '',
            isDrawerFixed('right') ? 'workspace-fixed-right' : ''
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <aside
            className={[
              'sidebar-drawer',
              'sidebar-drawer-left',
              isDrawerVisible('left') ? 'sidebar-drawer-open' : '',
              isDrawerFixed('left') ? 'sidebar-drawer-fixed' : ''
            ]
              .filter(Boolean)
              .join(' ')}
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                scheduleDrawerClose('left')
              }
            }}
            onFocusCapture={() => openDrawer('left')}
            onMouseEnter={() => openDrawer('left')}
            onMouseLeave={() => scheduleDrawerClose('left')}
            style={!sheet.source ? { display: 'none' } : undefined}
          >
            <div className="drawer-content">
              <div className="drawer-topbar">
                <span className="drawer-title">图集识别</span>
                <button
                  className={isDrawerPinned('left') ? 'drawer-lock-btn active' : 'drawer-lock-btn'}
                  disabled={isDrawerFixed('left')}
                  onClick={() => toggleDrawerLock('left')}
                  title={isDrawerFixed('left') ? '已在设置中固定' : isDrawerPinned('left') ? '取消临时锁定' : '临时锁定左侧抽屉'}
                  type="button"
                >
                  {isDrawerPinned('left') ? '已锁定' : '锁定'}
                </button>
              </div>
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
                  setIsExportPanelOpen(true)
                }}
                onUpdateSheet={handleUpdateSheet}
                predictedFrameCount={sheetGeometry.predictedFrameCount}
                rows={sheetGeometry.rows}
                sheet={sheet}
              />
            </div>
            <div className="drawer-handle drawer-handle-left">
              <span className="handle-text">
                图集识别
                <span className="handle-icon handle-icon-left">»</span>
              </span>
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
                  frame={currentFrame}
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
                      onClick={() => updatePlaybackSettings({ zoom: 'fit' }, false)}
                      type="button"
                    >
                      重置
                    </button>
                    {currentFrame ? (
                      <span className="compact-info" title={`${currentFrame.name} (${currentFrame.width}x${currentFrame.height})`}>
                        {currentFrame.name} | {currentFrame.width}x{currentFrame.height}
                      </span>
                    ) : null}
                  </div>

                  <div className="vt-center">
                    <button className="secondary-button toolbar-nav-btn" disabled={frames.length === 0} onClick={handlePrevious} type="button">
                      |◀
                    </button>
                    <button className="play-action-btn" disabled={frames.length === 0} onClick={handleTogglePlay} type="button">
                      {playback.isPlaying ? '暂停' : '播放'}
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
                        updatePlaybackSettings({ fps: Math.max(1, Math.min(60, playback.fps + step)) })
                      }}
                    >
                      <span>FPS: {playback.fps}</span>
                      <input
                        max={60}
                        min={1}
                        onChange={(event) => updatePlaybackSettings({ fps: Number(event.target.value) })}
                        type="range"
                        value={playback.fps}
                      />
                    </div>
                  </div>

                  <div className="vt-right">
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
              isDrawerFixed('right') ? 'sidebar-drawer-fixed' : ''
            ]
              .filter(Boolean)
              .join(' ')}
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                scheduleDrawerClose('right')
              }
            }}
            onFocusCapture={() => openDrawer('right')}
            onMouseEnter={() => openDrawer('right')}
            onMouseLeave={() => scheduleDrawerClose('right')}
            style={frames.length === 0 && !sheet.source ? { display: 'none' } : undefined}
          >
            <div className="drawer-handle drawer-handle-right">
              <span className="handle-text">
                <span className="handle-icon handle-icon-right">«</span>
                编辑与导出
              </span>
            </div>
            <div className="drawer-content">
              <div className="drawer-topbar">
                <span className="drawer-title">编辑与导出</span>
                <button
                  className={isDrawerPinned('right') ? 'drawer-lock-btn active' : 'drawer-lock-btn'}
                  disabled={isDrawerFixed('right')}
                  onClick={() => toggleDrawerLock('right')}
                  title={isDrawerFixed('right') ? '已在设置中固定' : isDrawerPinned('right') ? '取消临时锁定' : '临时锁定右侧抽屉'}
                  type="button"
                >
                  {isDrawerPinned('right') ? '已锁定' : '锁定'}
                </button>
              </div>
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
                  void handleExportSplitSequence()
                }}
                onExportSheet={() => {
                  void handleExportSheet()
                }}
                onOpenChange={setIsExportPanelOpen}
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
            onMoveFrame={moveFrame}
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

      <SettingsPanel
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onUpdate={updateUiPreferences}
        preferences={uiPreferences}
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
            <span>支持图片、GIF 和文件夹。规则序列图会尽量自动识别，并在置信度足够时直接开始播放。</span>
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
