import { DEFAULT_EXPORT, DEFAULT_PLAYBACK } from '@shared/constants'
import type { EditorSnapshot, SheetState } from '@shared/types'

export const createEmptySheetState = (): SheetState => ({
  autoApplied: false,
  candidates: [],
  columns: 1,
  enabled: false,
  frameHeight: 0,
  frameWidth: 0,
  mode: 'grid',
  rows: 1,
  source: undefined,
  sourceHeight: 0,
  sourceWidth: 0
})

export const createEmptySnapshot = (): EditorSnapshot => ({
  exportSettings: { ...DEFAULT_EXPORT },
  frames: [],
  playback: { ...DEFAULT_PLAYBACK },
  selectedFrameIds: [],
  sheet: createEmptySheetState()
})

export const cloneSnapshot = (snapshot: EditorSnapshot): EditorSnapshot => structuredClone(snapshot)
