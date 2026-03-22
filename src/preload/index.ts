import { contextBridge, ipcRenderer, webUtils } from 'electron'

import type { DesktopApi } from '@shared/types'

const api: DesktopApi = {
  chooseDirectory: (options) => ipcRenderer.invoke('directory:choose', options),
  deletePaths: (paths) => ipcRenderer.invoke('paths:delete', paths),
  getPathForDroppedFile: (file) => webUtils.getPathForFile(file),
  loadDirectory: (dirPath) => ipcRenderer.invoke('directory:load', dirPath),
  loadFiles: (paths) => ipcRenderer.invoke('files:load', paths),
  loadPaths: (paths) => ipcRenderer.invoke('paths:load', paths),
  openDirectory: () => ipcRenderer.invoke('directory:open'),
  openFiles: () => ipcRenderer.invoke('files:open'),
  revealInFileExplorer: (targetPath) => ipcRenderer.invoke('path:reveal', targetPath),
  saveBinaryFile: (input) => ipcRenderer.invoke('file:save-binary', input),
  writeBinaryFile: (input) => ipcRenderer.invoke('file:write-binary', input)
}

contextBridge.exposeInMainWorld('desktopApi', api)
