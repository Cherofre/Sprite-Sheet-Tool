import type { ExportImageFormat, FrameItem, ImportedFilePayload, RotationStep, TaskProgress } from '@shared/types'

export interface ComposeSheetWorkerResult {
  cellHeight: number
  cellWidth: number
  dataUrl: string
}

export interface DecodeGifWorkerResult {
  averageDelayMs: number
  frames: FrameItem[]
}

export interface EncodedFrameBatchResult {
  encodedFrames: Uint8Array[]
}

export interface ImageInspectionResult {
  columnInk: number[]
  height: number
  inkMap: number[]
  meanInk: number
  rowInk: number[]
  sampleHeight: number
  sampleWidth: number
  width: number
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
  | {
      format: ExportImageFormat
      frames: FrameItem[]
      id: string
      kind: 'encode-frames'
    }
  | {
      id: string
      kind: 'inspect-image'
      maxSampleSize?: number
      payload: ImportedFilePayload
    }
  | {
      id: string
      kind: 'convert-payloads-to-frames'
      payloads: ImportedFilePayload[]
      sourceType: FrameItem['sourceType']
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
      result:
        | ComposeSheetWorkerResult
        | DecodeGifWorkerResult
        | EncodedFrameBatchResult
        | FrameItem[]
        | ImageInspectionResult
        | Uint8Array
      type: 'result'
    }
