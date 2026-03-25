import { contextBridge, ipcRenderer, webUtils } from 'electron'

import type { DesktopApi } from '@shared/types'

const api: DesktopApi = {
  checkForAppUpdates: () => ipcRenderer.invoke('updates:check'),
  chooseDirectory: (options) => ipcRenderer.invoke('directory:choose', options),
  choosePhotoshopExecutable: (defaultPath) => ipcRenderer.invoke('photoshop:choose', defaultPath),
  createTempBinaryFile: (input) => ipcRenderer.invoke('file:create-temp-binary', input),
  deletePaths: (paths) => ipcRenderer.invoke('paths:delete', paths),
  downloadAppUpdate: () => ipcRenderer.invoke('updates:download'),
  getFileModifiedTime: (filePath) => ipcRenderer.invoke('path:get-modified-time', filePath),
  getUpdateStatus: () => ipcRenderer.invoke('updates:get-status'),
  getPathForDroppedFile: (file) => webUtils.getPathForFile(file),
  installDownloadedUpdate: () => ipcRenderer.invoke('updates:install'),
  readClipboardImage: () => ipcRenderer.invoke('clipboard:read-image'),
  loadDirectory: (dirPath) => ipcRenderer.invoke('directory:load', dirPath),
  loadFiles: (paths) => ipcRenderer.invoke('files:load', paths),
  loadPaths: (paths) => ipcRenderer.invoke('paths:load', paths),
  openDirectory: () => ipcRenderer.invoke('directory:open'),
  openFiles: () => ipcRenderer.invoke('files:open'),
  openInPhotoshop: (input) => ipcRenderer.invoke('photoshop:open-file', input),
  openUpdateDownloadPage: () => ipcRenderer.invoke('updates:open-download-page'),
  revealInFileExplorer: (targetPath) => ipcRenderer.invoke('path:reveal', targetPath),
  saveBinaryFile: (input) => ipcRenderer.invoke('file:save-binary', input),
  writeBinaryFile: (input) => ipcRenderer.invoke('file:write-binary', input)
}

contextBridge.exposeInMainWorld('desktopApi', api)
