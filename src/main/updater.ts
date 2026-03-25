import { promises as fs } from 'node:fs'
import path from 'node:path'

import { app, shell } from 'electron'
import electronUpdater from 'electron-updater'

import {
  GITHUB_LATEST_RELEASE_API_URL,
  GITHUB_RELEASES_PAGE_URL,
  PRODUCT_NAME
} from '@shared/constants'
import type { UpdateMode, UpdateStatus } from '@shared/types'

const { autoUpdater } = electronUpdater

interface GitHubReleaseAsset {
  browser_download_url?: string
  name?: string
}

interface GitHubLatestReleaseResponse {
  assets?: GitHubReleaseAsset[]
  html_url?: string
  tag_name?: string
}

const normalizeVersion = (value: string | null | undefined): string => value?.trim().replace(/^v/i, '') ?? ''

const parseVersionParts = (value: string): number[] =>
  normalizeVersion(value)
    .split('.')
    .map((segment) => Number.parseInt(segment, 10))
    .map((segment) => (Number.isFinite(segment) ? segment : 0))

const compareVersions = (left: string, right: string): number => {
  const leftParts = parseVersionParts(left)
  const rightParts = parseVersionParts(right)
  const limit = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < limit; index += 1) {
    const leftPart = leftParts[index] ?? 0
    const rightPart = rightParts[index] ?? 0

    if (leftPart > rightPart) {
      return 1
    }

    if (leftPart < rightPart) {
      return -1
    }
  }

  return 0
}

const buildStatus = (overrides?: Partial<UpdateStatus>): UpdateStatus => ({
  canCheck: false,
  canDownload: false,
  canInstall: false,
  currentVersion: app.getVersion(),
  downloadProgressPercent: null,
  downloadUrl: null,
  latestVersion: null,
  message: '当前环境不支持检查更新。',
  mode: 'disabled',
  phase: 'idle',
  ...overrides
})

let isInitialized = false
let isUpdaterConfigured = false
let currentStatus = buildStatus()

const setStatus = (patch: Partial<UpdateStatus>): UpdateStatus => {
  currentStatus = {
    ...currentStatus,
    ...patch
  }
  return currentStatus
}

const detectUpdateMode = async (): Promise<UpdateMode> => {
  if (process.platform !== 'win32' || !app.isPackaged) {
    return 'disabled'
  }

  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return 'portable'
  }

  const executableDirectory = path.dirname(app.getPath('exe'))
  const uninstallerPath = path.join(executableDirectory, `Uninstall ${PRODUCT_NAME}.exe`)
  const hasUninstaller = await fs
    .access(uninstallerPath)
    .then(() => true)
    .catch(() => false)

  return hasUninstaller ? 'installed' : 'portable'
}

const pickPortableDownloadUrl = (release: GitHubLatestReleaseResponse): string => {
  const preferredAsset =
    release.assets?.find((asset) => asset.name?.toLowerCase().endsWith('-portable-dir.zip')) ??
    release.assets?.find((asset) => asset.name?.toLowerCase().endsWith('.zip'))

  return preferredAsset?.browser_download_url ?? release.html_url ?? GITHUB_RELEASES_PAGE_URL
}

const fetchLatestGitHubRelease = async (): Promise<GitHubLatestReleaseResponse> => {
  const response = await fetch(GITHUB_LATEST_RELEASE_API_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': `${PRODUCT_NAME}/${app.getVersion()}`
    }
  })

  if (!response.ok) {
    throw new Error(`GitHub 返回 ${response.status}，暂时无法检查更新。`)
  }

  return (await response.json()) as GitHubLatestReleaseResponse
}

const configureAutoUpdater = (): void => {
  if (isUpdaterConfigured) {
    return
  }

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('checking-for-update', () => {
    setStatus({
      canCheck: false,
      canDownload: false,
      canInstall: false,
      downloadProgressPercent: null,
      message: '正在检查更新...',
      phase: 'checking'
    })
  })

  autoUpdater.on('update-available', (info) => {
    setStatus({
      canCheck: true,
      canDownload: true,
      canInstall: false,
      downloadProgressPercent: null,
      latestVersion: normalizeVersion(info.version),
      message: `发现新版本 v${normalizeVersion(info.version)}，可以开始下载。`,
      phase: 'available'
    })
  })

  autoUpdater.on('update-not-available', (info) => {
    setStatus({
      canCheck: true,
      canDownload: false,
      canInstall: false,
      downloadProgressPercent: null,
      latestVersion: normalizeVersion(info.version) || app.getVersion(),
      message: '当前已经是最新版本。',
      phase: 'not-available'
    })
  })

  autoUpdater.on('download-progress', (progress) => {
    setStatus({
      canCheck: false,
      canDownload: false,
      canInstall: false,
      downloadProgressPercent: progress.percent ?? null,
      message: `正在下载更新... ${Math.round(progress.percent ?? 0)}%`,
      phase: 'downloading'
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    setStatus({
      canCheck: true,
      canDownload: false,
      canInstall: true,
      downloadProgressPercent: 100,
      latestVersion: normalizeVersion(info.version),
      message: `新版本 v${normalizeVersion(info.version)} 已下载完成，准备安装。`,
      phase: 'downloaded'
    })
  })

  autoUpdater.on('error', (error) => {
    setStatus({
      canCheck: true,
      canDownload: false,
      canInstall: false,
      downloadProgressPercent: null,
      message: error.message || '检查更新失败，请稍后重试。',
      phase: 'error'
    })
  })

  isUpdaterConfigured = true
}

export const initializeUpdater = async (): Promise<UpdateStatus> => {
  if (isInitialized) {
    return currentStatus
  }

  const mode = await detectUpdateMode()

  if (mode === 'installed') {
    configureAutoUpdater()
    currentStatus = buildStatus({
      canCheck: true,
      currentVersion: app.getVersion(),
      message: '当前是安装版，可以检查、下载并安装更新。',
      mode
    })
  } else if (mode === 'portable') {
    currentStatus = buildStatus({
      canCheck: true,
      currentVersion: app.getVersion(),
      message: '当前是便携版，可以检查新版本并打开下载页。',
      mode
    })
  } else {
    currentStatus = buildStatus({
      currentVersion: app.getVersion(),
      message: '开发环境下不检查更新。',
      mode
    })
  }

  isInitialized = true
  return currentStatus
}

export const getUpdateStatus = async (): Promise<UpdateStatus> => initializeUpdater()

export const checkForUpdates = async (): Promise<UpdateStatus> => {
  const initialStatus = await initializeUpdater()

  if (!initialStatus.canCheck) {
    return initialStatus
  }

  if (initialStatus.mode === 'portable') {
    setStatus({
      canCheck: false,
      canDownload: false,
      canInstall: false,
      downloadProgressPercent: null,
      message: '正在检查更新...',
      phase: 'checking'
    })

    try {
      const release = await fetchLatestGitHubRelease()
      const latestVersion = normalizeVersion(release.tag_name)
      const hasUpdate = latestVersion && compareVersions(latestVersion, app.getVersion()) > 0

      if (hasUpdate) {
        return setStatus({
          canCheck: true,
          canDownload: false,
          canInstall: false,
          downloadProgressPercent: null,
          downloadUrl: pickPortableDownloadUrl(release),
          latestVersion,
          message: `发现新版本 v${latestVersion}，便携版需要重新下载覆盖。`,
          phase: 'available'
        })
      }

      return setStatus({
        canCheck: true,
        canDownload: false,
        canInstall: false,
        downloadProgressPercent: null,
        downloadUrl: release.html_url ?? GITHUB_RELEASES_PAGE_URL,
        latestVersion: latestVersion || app.getVersion(),
        message: '当前已经是最新版本。',
        phase: 'not-available'
      })
    } catch (error) {
      return setStatus({
        canCheck: true,
        canDownload: false,
        canInstall: false,
        downloadProgressPercent: null,
        message: error instanceof Error ? error.message : '检查更新失败，请稍后重试。',
        phase: 'error'
      })
    }
  }

  try {
    const result = await autoUpdater.checkForUpdates()
    if (result?.isUpdateAvailable === false) {
      return setStatus({
        canCheck: true,
        canDownload: false,
        canInstall: false,
        downloadProgressPercent: null,
        latestVersion: normalizeVersion(result.updateInfo.version) || app.getVersion(),
        message: '当前已经是最新版本。',
        phase: 'not-available'
      })
    }

    return currentStatus
  } catch (error) {
    return setStatus({
      canCheck: true,
      canDownload: false,
      canInstall: false,
      downloadProgressPercent: null,
      message: error instanceof Error ? error.message : '检查更新失败，请稍后重试。',
      phase: 'error'
    })
  }
}

export const downloadUpdate = async (): Promise<UpdateStatus> => {
  const status = await initializeUpdater()
  if (status.mode !== 'installed') {
    return status
  }

  try {
    setStatus({
      canCheck: false,
      canDownload: false,
      canInstall: false,
      downloadProgressPercent: 0,
      message: '正在下载更新...',
      phase: 'downloading'
    })
    await autoUpdater.downloadUpdate()
    return currentStatus
  } catch (error) {
    return setStatus({
      canCheck: true,
      canDownload: status.phase === 'available',
      canInstall: false,
      downloadProgressPercent: null,
      message: error instanceof Error ? error.message : '下载更新失败，请稍后重试。',
      phase: 'error'
    })
  }
}

export const installDownloadedUpdate = async (): Promise<void> => {
  const status = await initializeUpdater()
  if (status.mode !== 'installed' || !status.canInstall) {
    throw new Error('当前还没有可安装的更新。')
  }

  autoUpdater.quitAndInstall()
}

export const openUpdateDownloadPage = async (): Promise<void> => {
  const status = await initializeUpdater()
  const targetUrl = status.downloadUrl || GITHUB_RELEASES_PAGE_URL
  await shell.openExternal(targetUrl)
}
