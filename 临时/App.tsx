import { startTransition, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import type { SheetState } from '@shared/types'
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

const getSheetGeometry = (sheet: SheetState) => {
  if (!sheet.source || sheet.sourceWidth <= 0 || sheet.sourceHeight <= 0) {
    return { canApply: false, columns: 0, frameHeight: 0, frameWidth: 0, predictedFrameCount: 0, rows: 0 }
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
  const smokeFnsRef = useRef<{
    exportSequence: () => Promise<void>
    importPaths: (paths: string[]) => Promise<void>
  } | null>(null)

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

  useEffect(() => {
    setPingPongDirection(1)
    if (playbackSequence.length > 0 && !playbackSequence.includes(playback.currentFrame)) {
      setCurrentFrame(playbackSequence[0])
    }
  }, [playback.currentFrame, playbackSequence, setCurrentFrame])

  const advancePlayback = useEffectEvent(() => {
    if (playbackSequence.length === 0) return
    const currentPosition = Math.max(0, playbackSequence.indexOf(playback.currentFrame))
    const result = advanceSequencePosition(playbackSequence.length, currentPosition, pingPongDirection, playback.loopMode)
    setPingPongDirection(result.direction)
    setCurrentFrame(playbackSequence[result.position] ?? playbackSequence[0])
    if (result.shouldStop) setIsPlaying(false)
  })

  useEffect(() => {
    if (!playback.isPlaying || playbackSequence.length === 0) return undefined
    const interval = window.setInterval(advancePlayback, Math.max(16, Math.round(1000 / Math.max(1, playback.fps))))
    return () => window.clearInterval(interval)
  }, [advancePlayback, playback.fps, playback.isPlaying, playbackSequence.length])

  const importPaths = async (paths: string[]) => {
    if (paths.length === 0) return
    try {
      clearError()
      setBusy(true)
      setStatusMessage('正在加载源文件...')
      const payloads = await window.desktopApi.loadPaths(paths)
      const session = await buildImportSession(payloads)
      startTransition(() => { applyImportSession(session) })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '导入失败。')
    } finally {
      setBusy(false)
    }
  }

  const handleImportFiles = async () => {
    const paths = await window.desktopApi.openFiles()
    if (paths) await importPaths(paths)
  }

  const handleImportFolder = async () => {
    const directory = await window.desktopApi.openDirectory()
    if (directory) await importPaths([directory])
  }

  const handleApplySheet = async () => {
    if (!sheet.source || !sheetGeometry.canApply) {
      setErrorMessage('当前的拆分设置无法完美等分源图像。')
      return
    }
    try {
      setBusy(true)
      const splitFrames = await splitSheetToFrames(sheet.source, sheetGeometry.rows, sheetGeometry.columns, sheetGeometry.frameWidth, sheetGeometry.frameHeight)
      replaceFrames(splitFrames, {
        playbackPatch: { currentFrame: 0, endFrame: Math.max(0, splitFrames.length - 1), startFrame: 0 },
        sheet: { ...sheet, autoApplied: true, columns: sheetGeometry.columns, frameHeight: sheetGeometry.frameHeight, frameWidth: sheetGeometry.frameWidth, rows: sheetGeometry.rows }
      })
      setStatusMessage(`已应用拆分，共 ${sheetGeometry.rows} 行 ${sheetGeometry.columns} 列。`)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '图集拆分失败。')
    } finally {
      setBusy(false)
    }
  }

  const handleRotate = async (rotation: 90 | 180 | 270) => {
    if (frames.length === 0) return
    try {
      setBusy(true)
      const rotatedFrames = await rotateFrames(frames, rotation)
      replaceFrames(rotatedFrames, { keepSelection: true })
      setStatusMessage(`已将 ${rotatedFrames.length} 帧旋转 ${rotation}°。`)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '旋转失败。')
    } finally {
      setBusy(false)
    }
  }

  const handlePrevious = () => {
    if (playbackSequence.length === 0) return
    const currentPosition = Math.max(0, playbackSequence.indexOf(playback.currentFrame))
    setCurrentFrame(playbackSequence[Math.max(0, currentPosition - 1)] ?? playbackSequence[0])
  }

  const handleNext = () => {
    if (playbackSequence.length === 0) return
    const currentPosition = Math.max(0, playbackSequence.indexOf(playback.currentFrame))
    setCurrentFrame(playbackSequence[Math.min(playbackSequence.length - 1, currentPosition + 1)] ?? playbackSequence[playbackSequence.length - 1])
  }

  const handleExportSequence = async () => {
    if (exportFrames.length === 0) return
    try {
      setBusy(true)
      const directory = await window.desktopApi.chooseDirectory('选择序列导出文件夹')
      if (!directory) return

      for (let index = 0; index < exportFrames.length; index += 1) {
        const frame = exportFrames[index]
        const bytes = await frameToBytes(frame, exportSettings.imageFormat)
        const fileName = buildExportFileName(exportSettings.fileNamePrefix, index, exportSettings.padding, exportSettings.imageFormat)
        await window.desktopApi.writeBinaryFile({ data: Array.from(bytes), filePath: joinPath(directory, fileName) })
      }
      setStatusMessage(`已成功导出 ${exportFrames.length} 张图像至 ${directory}。`)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '序列帧导出失败。')
    } finally {
      setBusy(false)
    }
  }

  const handleExportSplitSequence = async () => {
    if (!sheet.source || !sheetGeometry.canApply || sheetGeometry.predictedFrameCount === 0) {
      setErrorMessage('图集未等分前无法直接导出拆分序列。')
      return
    }
    try {
      setBusy(true)
      const directory = await window.desktopApi.chooseDirectory('选择拆分序列导出文件夹')
      if (!directory) return

      const splitFrames = await splitSheetToFrames(sheet.source, sheetGeometry.rows, sheetGeometry.columns, sheetGeometry.frameWidth, sheetGeometry.frameHeight)
      const exportIndices = buildSampledIndices(splitFrames.length, exportSettings.exportSkip)

      for (let exportPosition = 0; exportPosition < exportIndices.length; exportPosition += 1) {
        const frame = splitFrames[exportIndices[exportPosition]]
        const bytes = await frameToBytes(frame, exportSettings.imageFormat)
        const fileName = buildExportFileName(exportSettings.fileNamePrefix, exportPosition, exportSettings.padding, exportSettings.imageFormat)
        await window.desktopApi.writeBinaryFile({ data: Array.from(bytes), filePath: joinPath(directory, fileName) })
      }
      setStatusMessage(`已直接导出 ${exportIndices.length} 张拆分图像，未覆盖当前时间轴。`)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '拆分序列导出失败。')
    } finally {
      setBusy(false)
    }
  }

  const handleExportSheet = async () => {
    if (exportFrames.length === 0) return
    try {
      setBusy(true)
      const layout = normalizeSheetLayout(exportFrames.length, exportSettings.spriteSheetRows, exportSettings.spriteSheetColumns)
      const { canvas } = await composeSpriteSheet(exportFrames, layout.rows, layout.columns)
      const bytes = await canvasToBytes(canvas, exportSettings.imageFormat)
      const savedPath = await window.desktopApi.saveBinaryFile({
        data: Array.from(bytes),
        defaultPath: `sprite-sheet.${exportSettings.imageFormat}`,
        filters: saveFiltersByFormat[exportSettings.imageFormat],
        title: '保存图集'
      })
      if (savedPath) setStatusMessage(`图集已保存至 ${savedPath}。`)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '图集导出失败。')
    } finally {
      setBusy(false)
    }
  }

  const handleExportGif = async () => {
    if (exportFrames.length === 0) return
    try {
      setBusy(true)
      const bytes = await encodeGif(exportFrames, playback.fps)
      const savedPath = await window.desktopApi.saveBinaryFile({
        data: Array.from(bytes),
        defaultPath: 'animation.gif',
        filters: saveFiltersByFormat.gif,
        title: '保存 GIF'
      })
      if (savedPath) setStatusMessage(`GIF 已保存至 ${savedPath}。`)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'GIF 导出失败。')
    } finally {
      setBusy(false)
    }
  }

  smokeFnsRef.current = { exportSequence: handleExportSequence, importPaths }

  useEffect(() => {
    if (!navigator.webdriver) return undefined
    const smokeWindow = window as Window & { __spriteSheetSmoke?: { exportSequence: () => Promise<void>; importPaths: (paths: string[]) => Promise<void> } }
    smokeWindow.__spriteSheetSmoke = {
      exportSequence: () => smokeFnsRef.current?.exportSequence() ?? Promise.resolve(),
      importPaths: (paths) => smokeFnsRef.current?.importPaths(paths) ?? Promise.resolve()
    }
    return () => { delete smokeWindow.__spriteSheetSmoke }
  }, [])

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-left">
          <span className="eyebrow-header">桌面级工具链</span>
          <h1>序列帧编辑工具</h1>
        </div>
        <p>专为游戏特效美术打造，提供极速导入、清晰预览、精准拆分及可靠的导出流。</p>
      </header>

      {errorMessage ? (
        <div className="error-banner">
          <span>{errorMessage}</span>
          <button className="secondary-button" onClick={clearError} type="button">关闭</button>
        </div>
      ) : null}

      <main className="app-grid">
        <div className="sidebar-column">
          <ImportPanel
            canRedo={canRedo} canUndo={canUndo} frameCount={frames.length} isBusy={isBusy} onDeleteSelected={deleteSelectedFrames} onDropPaths={importPaths}
            onImportFiles={handleImportFiles} onImportFolder={handleImportFolder} onRedo={redo} onReverse={reverseFrames} onRotate={handleRotate} onUndo={undo}
            selectedCount={selectedFrameIds.length} statusMessage={statusMessage}
          />
          <SheetPanel
            canApply={sheetGeometry.canApply} columns={sheetGeometry.columns} exportSettings={exportSettings} frameHeight={sheetGeometry.frameHeight} frameWidth={sheetGeometry.frameWidth}
            isBusy={isBusy} onApply={handleApplySheet} onChooseCandidate={(candidate) => updateSheetSettings({ columns: candidate.columns, frameHeight: candidate.frameHeight, frameWidth: candidate.frameWidth, mode: 'grid', rows: candidate.rows }, false)}
            onExportSplitSequence={handleExportSplitSequence} onUpdateSheet={updateSheetSettings} predictedFrameCount={sheetGeometry.predictedFrameCount} rows={sheetGeometry.rows} sheet={sheet}
          />
        </div>

        <div className="preview-column">
          <PreviewStage background={playback.background} frame={currentFrame} zoom={playback.zoom} />
          <FrameTimeline currentFrame={playback.currentFrame} frames={frames} onMoveFrame={moveFrame} onSelectFrame={selectFrame} selectedFrameIds={selectedFrameIds} />
        </div>

        <div className="sidebar-column">
          <PlaybackPanel frameCount={frames.length} onNext={handleNext} onPrevious={handlePrevious} onTogglePlay={() => setIsPlaying(!playback.isPlaying)} onUpdatePlayback={updatePlaybackSettings} playback={playback} sequenceCount={playbackSequence.length} />
          <ExportPanel exportFrameCount={exportFrames.length} exportSettings={exportSettings} onExportGif={handleExportGif} onExportSequence={handleExportSequence} onExportSheet={handleExportSheet} onUpdateExport={updateExportSettings} recommendedLayout={recommendedLayout} />
        </div>
      </main>

      {isBusy ? <div className="busy-overlay">正在处理图像...</div> : null}
    </div>
  )
}
