export type LoopMode = 'loop' | 'once' | 'pingpong'
export type BackgroundMode = 'checker' | 'black' | 'white'
export type ExportImageFormat = 'png' | 'jpeg' | 'webp'
export type RotationStep = 0 | 90 | 180 | 270
export type SheetInputMode = 'grid' | 'cell'

export interface ImportedFilePayload {
  dataUrl: string
  extension: string
  mimeType: string
  name: string
  path: string
  size: number
}

export interface FrameItem {
  dataUrl: string
  height: number
  id: string
  name: string
  sourcePath?: string
  sourceType: 'file' | 'gif' | 'sheet'
  width: number
}

export interface PlaybackSettings {
  background: BackgroundMode
  currentFrame: number
  endFrame: number
  fps: number
  isPlaying: boolean
  loopMode: LoopMode
  previewSkip: number
  reverse: boolean
  startFrame: number
  zoom: number | 'fit'
}

export interface ExportSettings {
  exportSkip: number
  fileNamePrefix: string
  imageFormat: ExportImageFormat
  padding: number
  spriteSheetColumns: number
  spriteSheetRows: number
}

export interface GridCandidate {
  columns: number
  confidence: number
  frameHeight: number
  frameWidth: number
  label: string
  rows: number
  score: number
}

export interface SheetState {
  autoApplied: boolean
  candidates: GridCandidate[]
  columns: number
  enabled: boolean
  frameHeight: number
  frameWidth: number
  mode: SheetInputMode
  rows: number
  source?: ImportedFilePayload
  sourceHeight: number
  sourceWidth: number
}

export interface EditorSnapshot {
  exportSettings: ExportSettings
  frames: FrameItem[]
  playback: PlaybackSettings
  selectedFrameIds: string[]
  sheet: SheetState
}

export interface SaveFileInput {
  data: number[]
  defaultPath?: string
  filters?: Array<{ extensions: string[]; name: string }>
  title?: string
}

export interface ChooseDirectoryOptions {
  defaultPath?: string
  title?: string
}

export interface WriteFileInput {
  data: number[]
  filePath: string
}

export interface DesktopApi {
  chooseDirectory(options?: ChooseDirectoryOptions): Promise<string | null>
  deletePaths(paths: string[]): Promise<void>
  getPathForDroppedFile(file: File): string
  loadDirectory(dirPath: string): Promise<ImportedFilePayload[]>
  loadFiles(paths: string[]): Promise<ImportedFilePayload[]>
  loadPaths(paths: string[]): Promise<ImportedFilePayload[]>
  openDirectory(): Promise<string | null>
  openFiles(): Promise<string[] | null>
  revealInFileExplorer(targetPath: string): Promise<void>
  saveBinaryFile(input: SaveFileInput): Promise<string | null>
  writeBinaryFile(input: WriteFileInput): Promise<string>
}

export interface TaskProgress {
  current?: number
  detail?: string
  percent?: number | null
  stage: string
  total?: number
}

export type ProgressCallback = (progress: TaskProgress) => void | Promise<void>
