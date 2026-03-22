import { promises as fs } from 'node:fs'
import path from 'node:path'

import { dialog, ipcMain, shell } from 'electron'

import { IMAGE_MIME_BY_EXTENSION, SUPPORTED_EXTENSIONS } from '@shared/constants'
import type { ChooseDirectoryOptions, ImportedFilePayload, SaveFileInput, WriteFileInput } from '@shared/types'

const toDataUrl = (extension: string, data: Buffer): string => {
  const mimeType = IMAGE_MIME_BY_EXTENSION[extension] ?? 'application/octet-stream'
  return `data:${mimeType};base64,${data.toString('base64')}`
}

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

const isSupportedImageFile = (filePath: string): boolean => {
  const extension = path.extname(filePath).slice(1).toLowerCase()
  return SUPPORTED_EXTENSIONS.includes(extension as (typeof SUPPORTED_EXTENSIONS)[number])
}

const readFilePayload = async (filePath: string): Promise<ImportedFilePayload> => {
  const stat = await fs.stat(filePath)
  const extension = path.extname(filePath).slice(1).toLowerCase()
  const data = await fs.readFile(filePath)

  return {
    dataUrl: toDataUrl(extension, data),
    extension,
    mimeType: IMAGE_MIME_BY_EXTENSION[extension] ?? 'application/octet-stream',
    name: path.basename(filePath),
    path: filePath,
    size: stat.size
  }
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
}
