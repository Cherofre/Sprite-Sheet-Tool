import { create } from 'zustand'

import { HISTORY_LIMIT } from '@shared/constants'
import type { EditorSnapshot, ExportSettings, FrameItem, PlaybackSettings, SheetState } from '@shared/types'

import { createEmptySnapshot } from '@features/history/history'
import type { ImportSession } from '@features/import/importSession'
import { recommendSheetLayout } from '@features/merge/layout'
import { normalizeFrameRange } from '@features/preview/frameSequence'

interface ReplaceFramesOptions {
  keepSelection?: boolean
  playbackPatch?: Partial<PlaybackSettings>
  recordHistory?: boolean
  sheet?: SheetState
}

interface EditorState extends EditorSnapshot {
  errorMessage: string | null
  historyFuture: EditorSnapshot[]
  historyPast: EditorSnapshot[]
  isBusy: boolean
  lastSelectedFrameId: string | null
  statusMessage: string
  applyImportSession: (session: ImportSession) => void
  clearError: () => void
  clearSelection: () => void
  deleteSelectedFrames: () => void
  moveFrame: (activeId: string, overId: string) => void
  redo: () => void
  replaceFrames: (frames: FrameItem[], options?: ReplaceFramesOptions) => void
  resetWorkspace: () => void
  reverseFrames: () => void
  selectFrame: (frameId: string, toggle?: boolean, range?: boolean) => void
  setBusy: (value: boolean) => void
  setCurrentFrame: (index: number) => void
  setErrorMessage: (message: string | null) => void
  setIsPlaying: (value: boolean) => void
  setStatusMessage: (message: string) => void
  undo: () => void
  updateExportSettings: (patch: Partial<ExportSettings>, recordHistory?: boolean) => void
  updatePlaybackSettings: (patch: Partial<PlaybackSettings>, recordHistory?: boolean) => void
  updateSheetSettings: (patch: Partial<SheetState>, recordHistory?: boolean) => void
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

const arrayMove = <T>(items: T[], fromIndex: number, toIndex: number): T[] => {
  const result = [...items]
  const [item] = result.splice(fromIndex, 1)
  result.splice(toIndex, 0, item)
  return result
}

const createSnapshotFromState = (state: EditorState): EditorSnapshot => ({
  exportSettings: state.exportSettings,
  frames: state.frames,
  playback: state.playback,
  selectedFrameIds: state.selectedFrameIds,
  sheet: state.sheet
})

const withHistory = (state: EditorState) => ({
  historyFuture: [],
  historyPast: [...state.historyPast, structuredClone(createSnapshotFromState(state))].slice(-HISTORY_LIMIT)
})

const normalizeSnapshot = (snapshot: EditorSnapshot): EditorSnapshot => {
  const frameCount = snapshot.frames.length
  const recommendedLayout = recommendSheetLayout(frameCount)
  const range = normalizeFrameRange(frameCount, snapshot.playback.startFrame, snapshot.playback.endFrame)
  const currentFrame = frameCount === 0 ? 0 : clamp(snapshot.playback.currentFrame, 0, frameCount - 1)
  const filteredSelection = snapshot.selectedFrameIds.filter((frameId) => snapshot.frames.some((frame) => frame.id === frameId))
  const selectedFrameIds =
    filteredSelection.length > 0 ? filteredSelection : snapshot.frames[currentFrame] ? [snapshot.frames[currentFrame].id] : []

  return {
    exportSettings: {
      ...snapshot.exportSettings,
      spriteSheetColumns:
        snapshot.exportSettings.spriteSheetColumns > 0
          ? snapshot.exportSettings.spriteSheetColumns
          : recommendedLayout.columns,
      spriteSheetRows:
        snapshot.exportSettings.spriteSheetRows > 0 ? snapshot.exportSettings.spriteSheetRows : recommendedLayout.rows
    },
    frames: snapshot.frames,
    playback: {
      ...snapshot.playback,
      currentFrame,
      endFrame: range.endFrame,
      isPlaying: frameCount > 0 ? snapshot.playback.isPlaying : false,
      startFrame: range.startFrame
    },
    selectedFrameIds,
    sheet: snapshot.sheet
  }
}

const snapshotToState = (snapshot: EditorSnapshot) => {
  const normalized = normalizeSnapshot(snapshot)
  return {
    exportSettings: normalized.exportSettings,
    frames: normalized.frames,
    lastSelectedFrameId: normalized.selectedFrameIds.at(-1) ?? null,
    playback: normalized.playback,
    selectedFrameIds: normalized.selectedFrameIds,
    sheet: normalized.sheet
  }
}

const initialSnapshot = createEmptySnapshot()

export const useEditorStore = create<EditorState>((set) => ({
  ...snapshotToState(initialSnapshot),
  errorMessage: null,
  historyFuture: [],
  historyPast: [],
  isBusy: false,
  statusMessage: '导入图片、文件夹或规则序列图后开始工作。',

  applyImportSession: (session) =>
    set((state) => ({
      ...snapshotToState({
        exportSettings: state.exportSettings,
        frames: session.frames,
        playback: session.playback,
        selectedFrameIds: session.frames[0] ? [session.frames[0].id] : [],
        sheet: session.sheet
      }),
      ...(state.frames.length > 0 || state.sheet.enabled ? withHistory(state) : {}),
      errorMessage: null,
      statusMessage:
        session.sheet.autoApplied && session.sheet.rows > 1 && session.sheet.columns > 1
          ? `已自动识别为 ${session.sheet.rows} x ${session.sheet.columns}，并开始播放。`
          : session.playback.isPlaying
            ? `已导入 ${session.frames.length} 帧，并开始播放。`
            : `已导入 ${session.frames.length} 帧。`
    })),

  clearError: () =>
    set(() => ({
      errorMessage: null
    })),

  clearSelection: () =>
    set(() => ({
      lastSelectedFrameId: null,
      selectedFrameIds: []
    })),

  deleteSelectedFrames: () =>
    set((state) => {
      if (state.selectedFrameIds.length === 0) {
        return state
      }

      const frames = state.frames.filter((frame) => !state.selectedFrameIds.includes(frame.id))
      return {
        ...snapshotToState({
          exportSettings: state.exportSettings,
          frames,
          playback: state.playback,
          selectedFrameIds: frames[0] ? [frames[0].id] : [],
          sheet: state.sheet
        }),
        ...withHistory(state),
        statusMessage: `已删除 ${state.selectedFrameIds.length} 个选中帧。`
      }
    }),

  moveFrame: (activeId, overId) =>
    set((state) => {
      const fromIndex = state.frames.findIndex((frame) => frame.id === activeId)
      const toIndex = state.frames.findIndex((frame) => frame.id === overId)
      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
        return state
      }

      const frames = arrayMove(state.frames, fromIndex, toIndex)
      const currentFrameId = state.frames[state.playback.currentFrame]?.id
      const nextCurrentFrame = currentFrameId ? frames.findIndex((frame) => frame.id === currentFrameId) : 0

      return {
        ...snapshotToState({
          exportSettings: state.exportSettings,
          frames,
          playback: {
            ...state.playback,
            currentFrame: Math.max(0, nextCurrentFrame)
          },
          selectedFrameIds: state.selectedFrameIds,
          sheet: state.sheet
        }),
        ...withHistory(state),
        statusMessage: '已重新排序帧序列。'
      }
    }),

  redo: () =>
    set((state) => {
      const next = state.historyFuture[0]
      if (!next) {
        return state
      }

      const currentSnapshot = structuredClone(createSnapshotFromState(state))
      return {
        ...snapshotToState(next),
        historyFuture: state.historyFuture.slice(1),
        historyPast: [...state.historyPast, currentSnapshot].slice(-HISTORY_LIMIT),
        statusMessage: '已重做。'
      }
    }),

  replaceFrames: (frames, options) =>
    set((state) => {
      const nextSnapshot: EditorSnapshot = {
        exportSettings: state.exportSettings,
        frames,
        playback: {
          ...state.playback,
          ...options?.playbackPatch
        },
        selectedFrameIds:
          options?.keepSelection === true
            ? state.selectedFrameIds.filter((frameId) => frames.some((frame) => frame.id === frameId))
            : frames[0]
              ? [frames[0].id]
              : [],
        sheet: options?.sheet ?? state.sheet
      }

      return {
        ...snapshotToState(nextSnapshot),
        ...(options?.recordHistory === false ? {} : withHistory(state))
      }
    }),

  resetWorkspace: () =>
    set((state) => ({
      ...snapshotToState(createEmptySnapshot()),
      ...(state.frames.length > 0 || state.sheet.enabled ? withHistory(state) : {}),
      errorMessage: null,
      statusMessage: '已清空当前工作区。'
    })),

  reverseFrames: () =>
    set((state) => ({
      ...snapshotToState({
        exportSettings: state.exportSettings,
        frames: [...state.frames].reverse(),
        playback: state.playback,
        selectedFrameIds: state.selectedFrameIds,
        sheet: state.sheet
      }),
      ...withHistory(state),
      statusMessage: '已反转帧序列顺序。'
    })),

  selectFrame: (frameId, toggle = false, range = false) =>
    set((state) => {
      const clickedIndex = state.frames.findIndex((frame) => frame.id === frameId)
      if (clickedIndex === -1) {
        return state
      }

      let selectedFrameIds: string[] = [frameId]
      if (range && state.lastSelectedFrameId) {
        const anchorIndex = state.frames.findIndex((frame) => frame.id === state.lastSelectedFrameId)
        const start = Math.min(anchorIndex, clickedIndex)
        const end = Math.max(anchorIndex, clickedIndex)
        selectedFrameIds = state.frames.slice(start, end + 1).map((frame) => frame.id)
      } else if (toggle) {
        selectedFrameIds = state.selectedFrameIds.includes(frameId)
          ? state.selectedFrameIds.filter((selectedId) => selectedId !== frameId)
          : [...state.selectedFrameIds, frameId]
      }

      return {
        lastSelectedFrameId: frameId,
        playback: {
          ...state.playback,
          currentFrame: clickedIndex
        },
        selectedFrameIds
      }
    }),

  setBusy: (value) =>
    set(() => ({
      isBusy: value
    })),

  setCurrentFrame: (index) =>
    set((state) => ({
      playback: {
        ...state.playback,
        currentFrame: clamp(index, 0, Math.max(0, state.frames.length - 1))
      },
      selectedFrameIds: state.frames[index] ? [state.frames[index].id] : state.selectedFrameIds
    })),

  setErrorMessage: (message) =>
    set(() => ({
      errorMessage: message
    })),

  setIsPlaying: (value) =>
    set((state) => ({
      playback: {
        ...state.playback,
        isPlaying: value && state.frames.length > 0
      }
    })),

  setStatusMessage: (message) =>
    set(() => ({
      statusMessage: message
    })),

  undo: () =>
    set((state) => {
      const previous = state.historyPast.at(-1)
      if (!previous) {
        return state
      }

      const remainingPast = state.historyPast.slice(0, -1)
      const currentSnapshot = structuredClone(createSnapshotFromState(state))

      return {
        ...snapshotToState(previous),
        historyFuture: [currentSnapshot, ...state.historyFuture].slice(0, HISTORY_LIMIT),
        historyPast: remainingPast,
        statusMessage: '已撤销。'
      }
    }),

  updateExportSettings: (patch, recordHistory = true) =>
    set((state) => ({
      ...snapshotToState({
        exportSettings: {
          ...state.exportSettings,
          ...patch
        },
        frames: state.frames,
        playback: state.playback,
        selectedFrameIds: state.selectedFrameIds,
        sheet: state.sheet
      }),
      ...(recordHistory ? withHistory(state) : {})
    })),

  updatePlaybackSettings: (patch, recordHistory = true) =>
    set((state) => ({
      ...snapshotToState({
        exportSettings: state.exportSettings,
        frames: state.frames,
        playback: {
          ...state.playback,
          ...patch
        },
        selectedFrameIds: state.selectedFrameIds,
        sheet: state.sheet
      }),
      ...(recordHistory ? withHistory(state) : {})
    })),

  updateSheetSettings: (patch, recordHistory = true) =>
    set((state) => ({
      ...snapshotToState({
        exportSettings: state.exportSettings,
        frames: state.frames,
        playback: state.playback,
        selectedFrameIds: state.selectedFrameIds,
        sheet: {
          ...state.sheet,
          ...patch
        }
      }),
      ...(recordHistory ? withHistory(state) : {})
    }))
}))

export const useCanUndo = (): boolean => useEditorStore((state) => state.historyPast.length > 0)
export const useCanRedo = (): boolean => useEditorStore((state) => state.historyFuture.length > 0)
