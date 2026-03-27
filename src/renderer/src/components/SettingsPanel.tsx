import { createPortal } from 'react-dom'

import type { UpdateStatus } from '@shared/types'

export type DrawerFixedMode = 'none' | 'left' | 'right' | 'both'

export interface UiPreferences {
  drawerBlurDelayMs: number
  drawerFixedMode: DrawerFixedMode
  guideAutoShow: boolean
  photoshopPath: string
}

interface SettingsPanelProps {
  isOpen: boolean
  isUpdateActionPending: boolean
  onCheckForUpdates: () => void
  onChoosePhotoshopPath: () => void
  onClearPhotoshopPath: () => void
  onClose: () => void
  onDownloadUpdate: () => void
  onInstallDownloadedUpdate: () => void
  onOpenUpdateDownloadPage: () => void
  onUpdate: (patch: Partial<UiPreferences>) => void
  preferences: UiPreferences
  updateStatus: UpdateStatus
}

const clampDelay = (value: string): number => {
  const parsed = Number.parseInt(value || '0', 10)
  if (Number.isNaN(parsed)) {
    return 0
  }

  return Math.max(0, Math.min(3000, parsed))
}

const getUpdateModeLabel = (status: UpdateStatus): string => {
  switch (status.mode) {
    case 'installed':
      return '安装版'
    case 'portable':
      return '便携版'
    default:
      return '开发环境'
  }
}

const getSecondaryAction = (
  status: UpdateStatus
): { label: string } | null => {
  if (status.mode === 'installed') {
    if (status.canInstall) {
      return {
        label: '安装并重启'
      }
    }

    if (status.phase === 'downloading') {
      return {
        label: '下载中...'
      }
    }

    if (status.canDownload) {
      return {
        label: '下载更新'
      }
    }
  }

  if (status.downloadUrl && (status.phase === 'available' || status.phase === 'error')) {
    return {
      label: status.phase === 'error' ? '打开发布页' : '打开下载页'
    }
  }

  return null
}

export function SettingsPanel({
  isOpen,
  isUpdateActionPending,
  onCheckForUpdates,
  onChoosePhotoshopPath,
  onClearPhotoshopPath,
  onClose,
  onDownloadUpdate,
  onInstallDownloadedUpdate,
  onOpenUpdateDownloadPage,
  onUpdate,
  preferences,
  updateStatus
}: SettingsPanelProps) {
  if (!isOpen || typeof document === 'undefined') {
    return null
  }

  const secondaryAction = getSecondaryAction(updateStatus)
  const secondaryActionHandler =
    updateStatus.mode === 'installed'
      ? updateStatus.canInstall
        ? onInstallDownloadedUpdate
        : updateStatus.canDownload
          ? onDownloadUpdate
          : onOpenUpdateDownloadPage
      : onOpenUpdateDownloadPage

  return createPortal(
    <div className="modal-overlay">
      <div
        className="modal-card settings-modal-card"
        onClick={(event) => {
          event.stopPropagation()
        }}
      >
        <div className="modal-header">
          <div>
            <span className="eyebrow">设置</span>
            <h2>界面、外部编辑与更新</h2>
          </div>
          <button className="secondary-button" onClick={onClose} type="button">
            关闭
          </button>
        </div>

        <div className="form-grid">
          <label>
            抽屉失焦延迟（毫秒）
            <input
              className="number-input"
              max={3000}
              min={0}
              onChange={(event) => onUpdate({ drawerBlurDelayMs: clampDelay(event.target.value) })}
              type="number"
              value={preferences.drawerBlurDelayMs}
            />
          </label>
          <label>
            侧栏固定模式
            <select
              onChange={(event) => onUpdate({ drawerFixedMode: event.target.value as DrawerFixedMode })}
              value={preferences.drawerFixedMode}
            >
              <option value="none">都使用抽屉</option>
              <option value="left">固定左侧</option>
              <option value="right">固定右侧</option>
              <option value="both">左右都固定</option>
            </select>
          </label>
        </div>

        <div className="hint-card settings-editor-card">
          <span className="eyebrow">操作说明</span>
          <p>首次安装或更新到新版本后，可以自动弹出一份简短说明，集中提示右键入口、快捷键和 Photoshop 往返注意事项。</p>

          <label className="guide-checkbox">
            <input checked={preferences.guideAutoShow} onChange={(event) => onUpdate({ guideAutoShow: event.target.checked })} type="checkbox" />
            <span>启动或更新后自动显示操作说明</span>
          </label>
        </div>

        <div className="hint-card settings-editor-card">
          <span className="eyebrow">Photoshop</span>
          <p>时间轴和预览区的右键菜单都可以直接把当前帧交给 Photoshop 修改；程序会先准备一份临时 PNG，保存后自动回灌到这一帧。</p>

          <label className="settings-path-field">
            Photoshop 路径
            <input
              className="settings-path-input"
              readOnly
              type="text"
              value={preferences.photoshopPath || '尚未设置 Photoshop 路径'}
            />
          </label>

          <div className="button-row">
            <button className="primary-button" onClick={onChoosePhotoshopPath} type="button">
              选择 Photoshop
            </button>
            <button className="secondary-button" disabled={!preferences.photoshopPath} onClick={onClearPhotoshopPath} type="button">
              清空路径
            </button>
          </div>
        </div>

        <div className="hint-card settings-update-card">
          <span className="eyebrow">检查更新</span>

          <div className="stats-grid">
            <div className="stat-card">
              <span>当前版本</span>
              <strong>v{updateStatus.currentVersion}</strong>
            </div>
            <div className="stat-card">
              <span>当前渠道</span>
              <strong>{getUpdateModeLabel(updateStatus)}</strong>
            </div>
          </div>

          <p>{updateStatus.message}</p>

          {updateStatus.latestVersion ? (
            <div className="settings-update-meta">
              <span>最新版本</span>
              <strong>v{updateStatus.latestVersion}</strong>
            </div>
          ) : null}

          {updateStatus.phase === 'downloading' && updateStatus.downloadProgressPercent !== null ? (
            <div className="settings-update-meta">
              <span>下载进度</span>
              <strong>{Math.round(updateStatus.downloadProgressPercent)}%</strong>
            </div>
          ) : null}

          <div className="settings-update-actions">
            <button
              className="primary-button"
              disabled={!updateStatus.canCheck || isUpdateActionPending}
              onClick={onCheckForUpdates}
              type="button"
            >
              {isUpdateActionPending && updateStatus.phase === 'checking' ? '检查中...' : '检查更新'}
            </button>

            {secondaryAction ? (
              <button
                className="secondary-button"
                disabled={
                  updateStatus.phase === 'downloading' ||
                  updateStatus.canDownload || updateStatus.canInstall
                    ? isUpdateActionPending && updateStatus.phase !== 'available' && updateStatus.phase !== 'downloaded'
                    : false
                }
                onClick={secondaryActionHandler}
                type="button"
              >
                {updateStatus.phase === 'downloading' ? '下载中...' : secondaryAction.label}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
