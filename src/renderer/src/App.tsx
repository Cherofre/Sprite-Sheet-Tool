import { startTransition, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'

import { SUPPORTED_EXTENSIONS } from '@shared/constants'
import type { ImportedFilePayload, TaskProgress, SheetState } from '@shared/types'

import { buildExportFileName, buildExportSequence, buildSampledIndices } from '@features/export/plans'
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
import { SheetPanel } from './components/SheetPanel'
import { useCanRedo, useCanUndo, useEditorStore } from './store/editorStore'

const saveFiltersByFormat = {
  gif: [{ extensions: ['gif'], name: 'GIF' }],
  jpeg: [{ extensions: ['jpg', 'jpeg'], name: 'JPEG' }],
  png: [{ extensions: ['png'], name: 'PNG' }],
  webp: [{ extensions: ['webp'], name: 'WEBP' }]
}

const joinPath = (directory: string, fileName: string): string => `${directory.replace(/[\\/]+$/, '')}/${fileName}`

interface OperationProgressState {
  detail: string
  percent: number | null
  title: string
}

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
      return {
        detail: '正在读取图像尺寸与基础信息...',
        percent: progress.percent ?? 10,
        title: '正在分析图集'
      }
    case 'rank-grid':
      return {
        detail: '正在评估规则网格候选...',
        percent: progress.percent ?? 25,
        title: '正在分析图集'
      }
    case 'split-sheet':
      return {
        detail: `正在切出图集帧${formattedCount}`,
        percent: progress.percent ?? null,
        title: '正在拆分图集'
      }
    case 'decode-gif':
      return {
        detail: `正在解析 GIF 帧${formattedCount}`,
        percent: progress.percent ?? null,
        title: '正在导入 GIF'
      }
    case 'convert-files':
      return {
        detail: `正在生成帧数据${formattedCount}`,
        percent: progress.percent ?? null,
        title: '正在导入资源'
      }
    case 'rotate-frames':
      return {
        detail: `正在旋转帧${formattedCount}`,
        percent: progress.percent ?? null,
        title: '正在旋转序列'
      }
    case 'encode-gif':
      return {
        detail: `正在编码 GIF${formattedCount}`,
        percent: progress.percent ?? null,
        title: '正在导出 GIF'
      }
    case 'export-sequence':
      return {
        detail: `正在导出图片序列${formattedCount}`,
        percent: progress.percent ?? null,
        title: '正在导出图片'
      }
    case 'export-split-sequence':
      return {
        detail: `正在导出拆分序列${formattedCount}`,
        percent: progress.percent ?? null,
        title: '正在导出拆分结果'
      }
    default:
      return {
        detail: progress.detail ?? '正在处理，请稍候...',
        percent: progress.percent ?? null,
        title: '正在处理图像'
      }
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
  const replaceFrames = useEditorStore((state) => state.replaceFrames)
  const reverseFrames = useEditorStore((state) => state.reverseFrames)
  const selectFrame = useEditorStore((state) => state.selectFrame)
  const setBusy = useEditorStore((state) => state.setBusy)
  const setCurrentFrame = useEditorStore((state) => state.setCurrentFrame)
  const setErrorMessage = useEditorStore((state) => state.setErrorMessage)
  const setIsPlaying = useEditorStore((state) => state.setIsPlaying)
  const setStatusMessage = useEditorStore((state) => state.setStatusMessage)
  const undo = useEditorStore((state) => state.undo)
  const redo = useEditorStore((state) => state.redo)
  const updateExportSettings = useEditorStore((state) => state.updateExportSettings)
  const updatePlaybackSettings = useEditorStore((state) => state.updatePlaybackSettings)
  const updateSheetSettings = useEditorStore((state) => state.updateSheetSettings)
  const canUndo = useCanUndo()
  const canRedo = useCanRedo()
  const currentFrame = frames[playback.currentFrame]
  const [pingPongDirection, setPingPongDirection] = useState<1 | -1>(1)
  const [isWindowDragActive, setIsWindowDragActive] = useState(false)
  const [operationProgress, setOperationProgress] = useState<OperationProgressState | null>(null)
  const smokeFnsRef = useRef<{
    exportSequence: () => Promise<void>
    importPaths: (paths: string[]) => Promise<void>
  } | null>(null)
  const windowDragDepthRef = useRef(0)

  const playbackSequence = useMemo(
    () => buildFrameSequence(frames.length, playback.startFrame, playback.endFrame, playback.previewSkip, playback.reverse),
    [frames.length, playback.endFrame, playback.previewSkip, playback.reverse, playback.startFrame]
  )

  const exportSequence = useMemo(
    () => buildExportSequence(frames.length, playback, exportSettings),
    [exportSettings, frames.length, playback]
  )

  const exportFrames = exportSequence.map((index) => frames[index]).filter((frame): frame is NonNullable<typeof frame> => Boolean(frame))
  const recommendedLayout = recommendSheetLayout(exportFrames.length)
  const sheetGeometry = getSheetGeometry(sheet)

  const waitForPaint = async (): Promise<void> => {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve())
    })
  }

  const beginOperationProgress = async (title: string, detail: string, percent: number | null = 0): Promise<void> => {
    setBusy(true)
    setOperationProgress({ detail, percent, title })
    await waitForPaint()
  }

  const updateOperationProgress = async (progress: TaskProgress | OperationProgressState): Promise<void> => {
    const nextState =
      'stage' in progress
        ? buildProgressState(progress)
        : progress

    setOperationProgress(nextState)
    await waitForPaint()
  }

  const endOperationProgress = (): void => {
    setOperationProgress(null)
    setBusy(false)
  }

  useEffect(() => {
    setPingPongDirection(1)

    if (playbackSequence.length > 0 && !playbackSequence.includes(playback.currentFrame)) {
      setCurrentFrame(playbackSequence[0])
    }
  }, [playback.currentFrame, playbackSequence, setCurrentFrame])

  const advancePlayback = useEffectEvent(() => {
    if (playbackSequence.length === 0) {
      return
    }

    const currentPosition = Math.max(0, playbackSequence.indexOf(playback.currentFrame))
    const result = advanceSequencePosition(playbackSequence.length, currentPosition, pingPongDirection, playback.loopMode)

    setPingPongDirection(result.direction)
    setCurrentFrame(playbackSequence[result.position] ?? playbackSequence[0])

    if (result.shouldStop) {
      setIsPlaying(false)
    }
  })

  useEffect(() => {
    if (!playback.isPlaying || playbackSequence.length === 0) {
      return undefined
    }

    const interval = window.setInterval(advancePlayback, Math.max(16, Math.round(1000 / Math.max(1, playback.fps))))
    return () => window.clearInterval(interval)
  }, [advancePlayback, playback.fps, playback.isPlaying, playbackSequence.length])

  const handleWindowDropFiles = useEffectEvent((files: File[]) => {
    void importDroppedFiles(files)
  })

  useEffect(() => {
    const onDragEnter = (event: DragEvent) => {
      if (!hasFileDrag(event.dataTransfer)) {
        return
      }

      event.preventDefault()
      windowDragDepthRef.current += 1
      setIsWindowDragActive(true)
    }

    const onDragOver = (event: DragEvent) => {
      if (!hasFileDrag(event.dataTransfer)) {
        return
      }

      event.preventDefault()
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
      if (!hasFileDrag(event.dataTransfer)) {
        return
      }

      event.preventDefault()
      windowDragDepthRef.current = 0
      setIsWindowDragActive(false)
      const droppedFiles = Array.from(event.dataTransfer?.files ?? [])
      if (droppedFiles.length > 0) {
        handleWindowDropFiles(droppedFiles)
      }
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)

    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [handleWindowDropFiles])

  const importPayloads = async (payloads: ImportedFilePayload[]) => {
    if (payloads.length === 0) {
      setErrorMessage('未发现可导入的 PNG、JPG、WEBP 或 GIF 文件。')
      return
    }

    try {
      clearError()
      const session = await buildImportSession(payloads, async (progress) => {
        await updateOperationProgress(progress)
      })

      startTransition(() => {
        applyImportSession(session)
      })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '导入失败。')
    } finally {
      endOperationProgress()
    }
  }

  const importPaths = async (paths: string[]) => {
    if (paths.length === 0) {
      return
    }

    try {
      clearError()
      await beginOperationProgress('正在读取资源', '正在扫描选择的文件或文件夹...', null)
      const payloads = await window.desktopApi.loadPaths(paths)
      await updateOperationProgress({
        detail: '资源已读取，正在生成帧数据...',
        percent: 8,
        title: '正在导入资源'
      })
      await importPayloads(payloads)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '导入失败。')
      endOperationProgress()
    }
  }

  const importDroppedFiles = async (files: File[]) => {
    if (files.length === 0) {
      return
    }

    const uniquePaths = new Set<string>()
    const fallbackFiles: File[] = []

    files.forEach((file) => {
      try {
        const resolvedPath = window.desktopApi.getPathForDroppedFile(file)
        if (resolvedPath) {
          uniquePaths.add(resolvedPath)
          return
        }
      } catch {
        // Fall through to blob-based import.
      }

      if (isSupportedDroppedFile(file.name)) {
        fallbackFiles.push(file)
      }
    })

    try {
      clearError()
      await beginOperationProgress('正在读取拖入内容', '正在解析拖入文件...', null)

      const [pathPayloads, fallbackPayloads] = await Promise.all([
        uniquePaths.size > 0 ? window.desktopApi.loadPaths([...uniquePaths]) : Promise.resolve<ImportedFilePayload[]>([]),
        Promise.all(
          fallbackFiles.map(async (file, index) => {
            const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
            const dataUrl = await readFileAsDataUrl(file)

            await updateOperationProgress({
              detail: `正在读取拖入文件 (${index + 1}/${fallbackFiles.length})`,
              percent: fallbackFiles.length > 0 ? ((index + 1) / fallbackFiles.length) * 8 : 8,
              title: '正在读取拖入内容'
            })

            return {
              dataUrl,
              extension,
              mimeType: file.type || 'application/octet-stream',
              name: file.name,
              path: file.name,
              size: file.size
            }
          })
        )
      ])

      await updateOperationProgress({
        detail: '拖入内容已读取，正在生成帧数据...',
        percent: 8,
        title: '正在导入资源'
      })
      await importPayloads([...pathPayloads, ...fallbackPayloads])
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '拖拽导入失败。')
      endOperationProgress()
    }
  }

  const handleImportFiles = async () => {
    const paths = await window.desktopApi.openFiles()
    if (paths) {
      await importPaths(paths)
    }
  }

  const handleImportFolder = async () => {
    const directory = await window.desktopApi.openDirectory()
    if (directory) {
      await importPaths([directory])
    }
  }

  const handleApplySheet = async () => {
    if (!sheet.source || !sheetGeometry.canApply) {
      setErrorMessage('当前拆分设置无法整除源图。')
      return
    }

    try {
      await beginOperationProgress('正在拆分图集', '正在切出图集帧...', 0)
      const splitFrames = await splitSheetToFrames(
        sheet.source,
        sheetGeometry.rows,
        sheetGeometry.columns,
        sheetGeometry.frameWidth,
        sheetGeometry.frameHeight,
        async (progress) => {
          await updateOperationProgress(progress)
        }
      )

      replaceFrames(splitFrames, {
        playbackPatch: {
          currentFrame: 0,
          endFrame: Math.max(0, splitFrames.length - 1),
          startFrame: 0
        },
        sheet: {
          ...sheet,
          autoApplied: true,
          columns: sheetGeometry.columns,
          frameHeight: sheetGeometry.frameHeight,
          frameWidth: sheetGeometry.frameWidth,
          rows: sheetGeometry.rows
        }
      })
      setStatusMessage(`已按 ${sheetGeometry.rows} x ${sheetGeometry.columns} 应用拆分。`)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '图集拆分失败。')
    } finally {
      endOperationProgress()
    }
  }

  const handleRotate = async (rotation: 90 | 180 | 270) => {
    if (frames.length === 0) {
      return
    }

    try {
      await beginOperationProgress('正在旋转序列', `准备旋转 ${frames.length} 帧...`, 0)
      const rotatedFrames = await rotateFrames(frames, rotation, async (progress) => {
        await updateOperationProgress(progress)
      })
      replaceFrames(rotatedFrames, { keepSelection: true })
      setStatusMessage(`已将 ${rotatedFrames.length} 帧旋转 ${rotation}°。`)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '旋转失败。')
    } finally {
      endOperationProgress()
    }
  }

  const handlePrevious = () => {
    if (playbackSequence.length === 0) {
      return
    }

    const currentPosition = Math.max(0, playbackSequence.indexOf(playback.currentFrame))
    setCurrentFrame(playbackSequence[Math.max(0, currentPosition - 1)] ?? playbackSequence[0])
  }

  const handleNext = () => {
    if (playbackSequence.length === 0) {
      return
    }

    const currentPosition = Math.max(0, playbackSequence.indexOf(playback.currentFrame))
    setCurrentFrame(
      playbackSequence[Math.min(playbackSequence.length - 1, currentPosition + 1)] ?? playbackSequence[playbackSequence.length - 1]
    )
  }

  const handleExportSequence = async () => {
    if (exportFrames.length === 0) {
      return
    }

    try {
      await beginOperationProgress('正在导出图片', '正在选择导出目录...', null)
      const directory = await window.desktopApi.chooseDirectory('选择图片序列导出文件夹')
      if (!directory) {
        return
      }

      for (let index = 0; index < exportFrames.length; index += 1) {
        const frame = exportFrames[index]
        await updateOperationProgress({
          current: index + 1,
          percent: ((index + 1) / exportFrames.length) * 100,
          stage: 'export-sequence',
          total: exportFrames.length
        })
        const bytes = await frameToBytes(frame, exportSettings.imageFormat)
        const fileName = buildExportFileName(exportSettings.fileNamePrefix, index, exportSettings.padding, exportSettings.imageFormat)

        await window.desktopApi.writeBinaryFile({
          data: Array.from(bytes),
          filePath: joinPath(directory, fileName)
        })
      }

      setStatusMessage(`已导出 ${exportFrames.length} 张图片到 ${directory}。`)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '图片序列导出失败。')
    } finally {
      endOperationProgress()
    }
  }

  const handleExportSplitSequence = async () => {
    if (!sheet.source || !sheetGeometry.canApply || sheetGeometry.predictedFrameCount === 0) {
      setErrorMessage('只有当前拆分设置能整除源图时，才能直接导出拆分序列。')
      return
    }

    try {
      await beginOperationProgress('正在导出拆分结果', '正在选择导出目录...', null)
      const directory = await window.desktopApi.chooseDirectory('选择拆分序列导出文件夹')
      if (!directory) {
        return
      }

      const splitFrames = await splitSheetToFrames(
        sheet.source,
        sheetGeometry.rows,
        sheetGeometry.columns,
        sheetGeometry.frameWidth,
        sheetGeometry.frameHeight,
        async (progress) => {
          await updateOperationProgress({
            detail: `正在切出拆分帧 (${progress.current}/${progress.total})`,
            percent: ((progress.percent ?? 0) * 0.45),
            title: '正在导出拆分结果'
          })
        }
      )
      const exportIndices = buildSampledIndices(splitFrames.length, exportSettings.exportSkip)

      for (let exportPosition = 0; exportPosition < exportIndices.length; exportPosition += 1) {
        await updateOperationProgress({
          current: exportPosition + 1,
          percent: 45 + (((exportPosition + 1) / exportIndices.length) * 55),
          stage: 'export-split-sequence',
          total: exportIndices.length
        })
        const frame = splitFrames[exportIndices[exportPosition]]
        const bytes = await frameToBytes(frame, exportSettings.imageFormat)
        const fileName = buildExportFileName(
          exportSettings.fileNamePrefix,
          exportPosition,
          exportSettings.padding,
          exportSettings.imageFormat
        )

        await window.desktopApi.writeBinaryFile({
          data: Array.from(bytes),
          filePath: joinPath(directory, fileName)
        })
      }

      setStatusMessage(
        `已按 ${sheetGeometry.rows} x ${sheetGeometry.columns} 直接导出 ${exportIndices.length} 张拆分图片，且未替换当前时间轴。`
      )
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '拆分序列导出失败。')
    } finally {
      endOperationProgress()
    }
  }

  const handleExportSheet = async () => {
    if (exportFrames.length === 0) {
      return
    }

    try {
      await beginOperationProgress('正在导出图集', '正在合成图集...', 35)
      const layout = normalizeSheetLayout(exportFrames.length, exportSettings.spriteSheetRows, exportSettings.spriteSheetColumns)
      const { canvas } = await composeSpriteSheet(exportFrames, layout.rows, layout.columns)
      await updateOperationProgress({
        detail: '正在编码图集文件...',
        percent: 80,
        title: '正在导出图集'
      })
      const bytes = await canvasToBytes(canvas, exportSettings.imageFormat)
      const savedPath = await window.desktopApi.saveBinaryFile({
        data: Array.from(bytes),
        defaultPath: `sprite-sheet.${exportSettings.imageFormat}`,
        filters: saveFiltersByFormat[exportSettings.imageFormat],
        title: '保存图集'
      })

      if (savedPath) {
        setStatusMessage(`图集已保存到 ${savedPath}。`)
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '图集导出失败。')
    } finally {
      endOperationProgress()
    }
  }

  const handleExportGif = async () => {
    if (exportFrames.length === 0) {
      return
    }

    try {
      await beginOperationProgress('正在导出 GIF', '正在准备 GIF 编码...', 0)
      const bytes = await encodeGif(exportFrames, playback.fps, async (progress) => {
        await updateOperationProgress(progress)
      })
      const savedPath = await window.desktopApi.saveBinaryFile({
        data: Array.from(bytes),
        defaultPath: 'animation.gif',
        filters: saveFiltersByFormat.gif,
        title: '保存 GIF'
      })

      if (savedPath) {
        setStatusMessage(`GIF 已保存到 ${savedPath}。`)
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'GIF 导出失败。')
    } finally {
      endOperationProgress()
    }
  }

  smokeFnsRef.current = {
    exportSequence: handleExportSequence,
    importPaths
  }

  useEffect(() => {
    if (!navigator.webdriver) {
      return undefined
    }

    const smokeWindow = window as Window & {
      __spriteSheetSmoke?: {
        exportSequence: () => Promise<void>
        importPaths: (paths: string[]) => Promise<void>
      }
    }

    smokeWindow.__spriteSheetSmoke = {
      exportSequence: () => smokeFnsRef.current?.exportSequence() ?? Promise.resolve(),
      importPaths: (paths) => smokeFnsRef.current?.importPaths(paths) ?? Promise.resolve()
    }

    return () => {
      delete smokeWindow.__spriteSheetSmoke
    }
  }, [])

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-left">
          <span className="eyebrow-header">桌面工具链</span>
          <h1>序列图工具</h1>
        </div>
        <p>面向游戏特效师的桌面序列图工具，专注快速导入、清晰预览、可靠拆分与稳定导出。</p>
      </header>

      {errorMessage ? (
        <div className="error-banner">
          <span>{errorMessage}</span>
          <button className="secondary-button" onClick={clearError} type="button">
            关闭
          </button>
        </div>
      ) : null}

      <main className="app-grid">
        <div className="sidebar-column">
          <ImportPanel
            canRedo={canRedo}
            canUndo={canUndo}
            frameCount={frames.length}
            isBusy={isBusy}
            onDeleteSelected={deleteSelectedFrames}
            onDropFiles={importDroppedFiles}
            onImportFiles={handleImportFiles}
            onImportFolder={handleImportFolder}
            onRedo={redo}
            onReverse={reverseFrames}
            onRotate={handleRotate}
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
            onApply={handleApplySheet}
            onChooseCandidate={(candidate) =>
              updateSheetSettings(
                {
                  columns: candidate.columns,
                  frameHeight: candidate.frameHeight,
                  frameWidth: candidate.frameWidth,
                  mode: 'grid',
                  rows: candidate.rows
                },
                false
              )
            }
            onExportSplitSequence={handleExportSplitSequence}
            onUpdateSheet={updateSheetSettings}
            predictedFrameCount={sheetGeometry.predictedFrameCount}
            rows={sheetGeometry.rows}
            sheet={sheet}
          />
        </div>

        <div className="preview-column">
          <PreviewStage background={playback.background} frame={currentFrame} zoom={playback.zoom} />
          <FrameTimeline
            currentFrame={playback.currentFrame}
            frames={frames}
            onMoveFrame={moveFrame}
            onSelectFrame={selectFrame}
            selectedFrameIds={selectedFrameIds}
          />
        </div>

        <div className="sidebar-column">
          <PlaybackPanel
            frameCount={frames.length}
            onNext={handleNext}
            onPrevious={handlePrevious}
            onTogglePlay={() => setIsPlaying(!playback.isPlaying)}
            onUpdatePlayback={updatePlaybackSettings}
            playback={playback}
            sequenceCount={playbackSequence.length}
          />
          <ExportPanel
            exportFrameCount={exportFrames.length}
            exportSettings={exportSettings}
            onExportGif={handleExportGif}
            onExportSequence={handleExportSequence}
            onExportSheet={handleExportSheet}
            onUpdateExport={updateExportSettings}
            recommendedLayout={recommendedLayout}
          />
        </div>
      </main>

      {isBusy ? (
        <div className="busy-overlay">
          <div className="busy-card">
            <strong>{operationProgress?.title ?? '正在处理图像'}</strong>
            <span>{operationProgress?.detail ?? '请稍候，任务仍在继续。'}</span>
            <div className="busy-progress-track">
              <div
                className={
                  operationProgress?.percent == null
                    ? 'busy-progress-bar indeterminate'
                    : 'busy-progress-bar'
                }
                style={operationProgress?.percent == null ? undefined : { width: `${Math.max(4, Math.min(100, operationProgress.percent))}%` }}
              />
            </div>
            <small>
              {operationProgress?.percent == null ? '处理中...' : `${Math.round(operationProgress.percent)}%`}
            </small>
          </div>
        </div>
      ) : null}
      {isWindowDragActive ? (
        <div className="drop-overlay">
          <div className="drop-overlay-card">
            <strong>松手即可导入</strong>
            <span>支持将图片、GIF 或整个文件夹拖进窗口任意位置。</span>
          </div>
        </div>
      ) : null}
    </div>
  )
}
