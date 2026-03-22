import path from 'node:path'

import { app, BrowserWindow, Menu } from 'electron'

import { APP_NAME } from '@shared/constants'

import { registerIpcHandlers } from './ipc'

const createMainWindow = async (): Promise<void> => {
  let rendererRecoveryAttempts = 0
  const mainWindow = new BrowserWindow({
    autoHideMenuBar: true,
    backgroundColor: '#0e1418',
    height: 960,
    minHeight: 760,
    minWidth: 1280,
    show: false,
    title: APP_NAME,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, '../preload/index.mjs'),
      sandbox: false
    },
    width: 1560
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.setMenuBarVisibility(false)
    mainWindow.show()
  })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[main] renderer process gone:', details)

    if (rendererRecoveryAttempts >= 1 || mainWindow.isDestroyed()) {
      return
    }

    rendererRecoveryAttempts += 1
    setTimeout(() => {
      if (!mainWindow.isDestroyed()) {
        void mainWindow.webContents.reloadIgnoringCache()
      }
    }, 400)
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  app.setName(APP_NAME)
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.codex.spritesheettool')
  }

  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
  }

  registerIpcHandlers()
  await createMainWindow()

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
