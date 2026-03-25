import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { clipboard, dialog, ipcMain, shell } from 'electron'

import { SUPPORTED_EXTENSIONS } from '@shared/constants'
import type {
  ChooseDirectoryOptions,
  CreateTempBinaryFileInput,
  ImportedFilePayload,
  OpenInPhotoshopInput,
  SaveFileInput,
  WriteFileInput
} from '@shared/types'
import { buildImportedFilePayload, isSupportedImageFile } from './imagePayload'
import {
  checkForUpdates,
  downloadUpdate,
  getUpdateStatus,
  installDownloadedUpdate,
  openUpdateDownloadPage
} from './updater'

const readPathArrayOverride = (name: string): string[] | null => {
  const rawValue = process.env[name]
  if (!rawValue) {
    return null
  }

  try {
    const parsed = JSON.parse(rawValue)
    return Array.isArray(parsed) ? parsed.map((value) => String(value)) : null
  } catch {
    return rawValue
      .split('|')
      .map((value) => value.trim())
      .filter(Boolean)
  }
}

const readFilePayload = async (filePath: string): Promise<ImportedFilePayload> => {
  const stat = await fs.stat(filePath)
  const data = await fs.readFile(filePath)
  return buildImportedFilePayload({ data, filePath, size: stat.size })
}

const flattenPaths = async (paths: string[]): Promise<string[]> => {
  const collected: string[] = []

  for (const targetPath of paths) {
    const stat = await fs.stat(targetPath).catch(() => null)

    if (!stat) {
      continue
    }

    if (stat.isDirectory()) {
      const entries = await fs.readdir(targetPath, { withFileTypes: true })
      collected.push(
        ...entries
          .filter((entry) => entry.isFile())
          .map((entry) => path.join(targetPath, entry.name))
          .filter((filePath) => isSupportedImageFile(filePath))
      )
      continue
    }

    if (stat.isFile() && isSupportedImageFile(targetPath)) {
      collected.push(targetPath)
    }
  }

  return collected
}

const loadSupportedFiles = async (paths: string[]): Promise<ImportedFilePayload[]> => {
  const existing = await Promise.all(
    paths.map(async (filePath) => ({
      exists: await fs
        .access(filePath)
        .then(() => true)
        .catch(() => false),
      filePath
    }))
  )

  const readablePaths = existing.filter((item) => item.exists && isSupportedImageFile(item.filePath))
  return Promise.all(readablePaths.map((item) => readFilePayload(item.filePath)))
}

const readClipboardImagePayload = (): ImportedFilePayload | null => {
  const pngFormat = clipboard.availableFormats().find((format) => {
    const normalized = format.toLowerCase()
    return normalized === 'png' || normalized === 'image/png' || normalized === 'public.png'
  })

  if (pngFormat) {
    const pngBuffer = clipboard.readBuffer(pngFormat)
    if (pngBuffer.byteLength > 0) {
      return {
        dataUrl: `data:image/png;base64,${pngBuffer.toString('base64')}`,
        extension: 'png',
        mimeType: 'image/png',
        name: `clipboard-image-${Date.now()}.png`,
        path: '',
        size: pngBuffer.byteLength
      }
    }
  }

  const image = clipboard.readImage()
  if (image.isEmpty()) {
    return null
  }

  const pngBuffer = image.toPNG()
  return {
    dataUrl: `data:image/png;base64,${pngBuffer.toString('base64')}`,
    extension: 'png',
    mimeType: 'image/png',
    name: `clipboard-image-${Date.now()}.png`,
    path: '',
    size: pngBuffer.byteLength
  }
}

const INVALID_TEMP_FILE_CHARACTERS = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*'])

const sanitizeTempFileName = (fileName: string): string => {
  const trimmed = fileName.trim()
  const withoutUnsafeCharacters = Array.from(trimmed, (character) => {
    const codePoint = character.charCodeAt(0)
    return codePoint <= 31 || INVALID_TEMP_FILE_CHARACTERS.has(character) ? '_' : character
  }).join('')
  return withoutUnsafeCharacters || 'edited-frame.png'
}

const normalizeTempExtension = (extension?: string): string => {
  const normalized = (extension ?? 'png').replace(/^\.+/, '').trim().toLowerCase()
  return normalized || 'png'
}

const createTempBinaryFile = async (input: CreateTempBinaryFileInput): Promise<{ filePath: string; modifiedTimeMs: number }> => {
  const extension = normalizeTempExtension(input.extension)
  const safeFileName = sanitizeTempFileName(input.fileName)
  const fileNameBase = path.parse(safeFileName).name || 'edited-frame'
  const tempDirectory = path.join(os.tmpdir(), 'SpriteSheetTool', 'frame-edits')
  const targetPath = path.join(tempDirectory, `${fileNameBase}-${randomUUID()}.${extension}`)

  await fs.mkdir(tempDirectory, { recursive: true })
  await fs.writeFile(targetPath, Buffer.from(input.data))

  const stat = await fs.stat(targetPath)
  return {
    filePath: targetPath,
    modifiedTimeMs: stat.mtimeMs
  }
}

const openFileInPhotoshop = async (input: OpenInPhotoshopInput): Promise<void> => {
  const photoshopStat = await fs.stat(input.photoshopPath).catch(() => null)
  if (!photoshopStat?.isFile()) {
    throw new Error('未找到 Photoshop 可执行文件，请先在设置里重新选择路径。')
  }

  const fileStat = await fs.stat(input.filePath).catch(() => null)
  if (!fileStat?.isFile()) {
    throw new Error('未找到要编辑的帧文件。')
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(input.photoshopPath, [input.filePath], {
      detached: true,
      stdio: 'ignore'
    })

    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

export const registerIpcHandlers = (): void => {
  ipcMain.handle('files:open', async () => {
    const overriddenPaths = readPathArrayOverride('SPRITE_SHEET_OPEN_FILES')
    if (overriddenPaths) {
      return overriddenPaths
    }

    const result = await dialog.showOpenDialog({
      filters: [{ extensions: [...SUPPORTED_EXTENSIONS], name: '图片文件' }],
      properties: ['openFile', 'multiSelections'],
      title: '导入图片或 GIF'
    })

    return result.canceled ? null : result.filePaths
  })

  ipcMain.handle('directory:open', async () => {
    const overriddenDirectory = process.env.SPRITE_SHEET_OPEN_DIRECTORY
    if (overriddenDirectory) {
      return overriddenDirectory
    }

    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: '导入文件夹'
    })

    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle('files:load', async (_event, paths: string[]) => loadSupportedFiles(paths))

  ipcMain.handle('paths:load', async (_event, paths: string[]) => {
    const flattenedPaths = await flattenPaths(paths)
    return loadSupportedFiles(flattenedPaths)
  })

  ipcMain.handle('paths:delete', async (_event, paths: string[]) => {
    await Promise.all(
      paths.map(async (targetPath) => {
        if (!targetPath) {
          return
        }

        await fs.rm(targetPath, { force: true }).catch(() => undefined)
      })
    )
  })

  ipcMain.handle('clipboard:read-image', async () => readClipboardImagePayload())

  ipcMain.handle('directory:load', async (_event, dirPath: string) => {
    const files = await flattenPaths([dirPath])
    return loadSupportedFiles(files)
  })

  ipcMain.handle('path:reveal', async (_event, targetPath: string) => {
    const stat = await fs.stat(targetPath).catch(() => null)

    if (stat?.isDirectory()) {
      const error = await shell.openPath(targetPath)
      if (error) {
        throw new Error(error)
      }
      return
    }

    if (stat?.isFile()) {
      shell.showItemInFolder(targetPath)
      return
    }

    const parentDirectory = path.dirname(targetPath)
    const parentStat = await fs.stat(parentDirectory).catch(() => null)
    if (parentStat?.isDirectory()) {
      const error = await shell.openPath(parentDirectory)
      if (error) {
        throw new Error(error)
      }
    }
  })

  ipcMain.handle('file:save-binary', async (_event, input: SaveFileInput) => {
    const overriddenSavePath = process.env.SPRITE_SHEET_SAVE_FILE
    if (overriddenSavePath) {
      await fs.mkdir(path.dirname(overriddenSavePath), { recursive: true })
      await fs.writeFile(overriddenSavePath, Buffer.from(input.data))
      return overriddenSavePath
    }

    const result = await dialog.showSaveDialog({
      defaultPath: input.defaultPath,
      filters: input.filters,
      title: input.title ?? '保存文件'
    })

    if (result.canceled || !result.filePath) {
      return null
    }

    await fs.writeFile(result.filePath, Buffer.from(input.data))
    return result.filePath
  })

  ipcMain.handle('directory:choose', async (_event, options?: ChooseDirectoryOptions) => {
    const overriddenDirectory = process.env.SPRITE_SHEET_CHOOSE_DIRECTORY
    if (overriddenDirectory) {
      return overriddenDirectory
    }

    const result = await dialog.showOpenDialog({
      defaultPath: options?.defaultPath,
      properties: ['createDirectory', 'openDirectory'],
      title: options?.title ?? '选择导出文件夹'
    })

    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle('file:write-binary', async (_event, input: WriteFileInput) => {
    await fs.mkdir(path.dirname(input.filePath), { recursive: true })
    await fs.writeFile(input.filePath, Buffer.from(input.data))
    return input.filePath
  })

  ipcMain.handle('file:create-temp-binary', async (_event, input: CreateTempBinaryFileInput) => createTempBinaryFile(input))

  ipcMain.handle('path:get-modified-time', async (_event, filePath: string) => {
    const stat = await fs.stat(filePath).catch(() => null)
    return stat?.isFile() ? stat.mtimeMs : null
  })

  ipcMain.handle('photoshop:choose', async (_event, defaultPath?: string) => {
    const result = await dialog.showOpenDialog({
      defaultPath,
      filters: process.platform === 'win32' ? [{ extensions: ['exe'], name: '应用程序' }] : undefined,
      properties: ['openFile'],
      title: '选择 Photoshop 可执行文件'
    })

    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle('photoshop:open-file', async (_event, input: OpenInPhotoshopInput) => {
    await openFileInPhotoshop(input)
  })

  ipcMain.handle('updates:get-status', async () => getUpdateStatus())
  ipcMain.handle('updates:check', async () => checkForUpdates())
  ipcMain.handle('updates:download', async () => downloadUpdate())
  ipcMain.handle('updates:install', async () => installDownloadedUpdate())
  ipcMain.handle('updates:open-download-page', async () => openUpdateDownloadPage())
}
