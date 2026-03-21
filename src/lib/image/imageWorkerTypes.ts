import type { FrameItem, ImportedFilePayload, RotationStep, TaskProgress } from '@shared/types'

export interface ComposeSheetWorkerResult {
  cellHeight: number
  cellWidth: number
  dataUrl: string
}

export interface DecodeGifWorkerResult {
  averageDelayMs: number
  frames: FrameItem[]
}

export type ImageWorkerRequest =
  | {
      columns: number
      frameHeight: number
      frameWidth: number
      id: string
      kind: 'split-sheet'
      payload: ImportedFilePayload
      rows: number
    }
  | {
      frames: FrameItem[]
      id: string
      kind: 'rotate-frames'
      rotation: RotationStep
    }
  | {
      columns: number
      frames: FrameItem[]
      id: string
      kind: 'compose-sheet'
      rows: number
    }
  | {
      id: string
      kind: 'decode-gif'
      payload: ImportedFilePayload
    }
  | {
      fps: number
      frames: FrameItem[]
      id: string
      kind: 'encode-gif'
    }

export type ImageWorkerResponse =
  | {
      id: string
      progress: TaskProgress
      type: 'progress'
    }
  | {
      error: string
      id: string
      type: 'error'
    }
  | {
      id: string
      result: ComposeSheetWorkerResult | DecodeGifWorkerResult | FrameItem[] | Uint8Array
      type: 'result'
    }
