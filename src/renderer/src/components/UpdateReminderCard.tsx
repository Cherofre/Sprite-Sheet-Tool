import type { UpdateStatus } from '@shared/types'

interface UpdateReminderCardProps {
  onDismiss: () => void
  onIgnoreVersion: () => void
  onPrimaryAction: () => void
  status: UpdateStatus
  visible: boolean
}

const getReminderPresentation = (status: UpdateStatus): {
  description: string
  primaryLabel: string | null
  secondaryLabel: string
  showIgnore: boolean
  title: string
} => {
  const latestVersion = status.latestVersion ? `v${status.latestVersion}` : '新版本'
  const currentVersion = status.currentVersion ? `v${status.currentVersion}` : '当前版本'

  if (status.phase === 'downloaded') {
    return {
      description: `${latestVersion} 已下载完成，重启后安装。`,
      primaryLabel: '重启并安装',
      secondaryLabel: '稍后',
      showIgnore: false,
      title: '新版本已准备就绪'
    }
  }

  if (status.phase === 'downloading') {
    return {
      description: `${currentVersion} 正在下载 ${latestVersion}。你可以先继续处理当前工作。`,
      primaryLabel: null,
      secondaryLabel: '后台继续',
      showIgnore: false,
      title: `正在下载 ${latestVersion}`
    }
  }

  if (status.mode === 'portable') {
    return {
      description: `${currentVersion}，便携版需要重新下载覆盖。`,
      primaryLabel: '打开下载页',
      secondaryLabel: '稍后',
      showIgnore: true,
      title: `发现新版本 ${latestVersion}`
    }
  }

  return {
    description: `${currentVersion}，可直接下载并安装。`,
    primaryLabel: '立即更新',
    secondaryLabel: '稍后',
    showIgnore: true,
    title: `发现新版本 ${latestVersion}`
  }
}

export function UpdateReminderCard({ onDismiss, onIgnoreVersion, onPrimaryAction, status, visible }: UpdateReminderCardProps) {
  if (!visible) {
    return null
  }

  const presentation = getReminderPresentation(status)
  const progressPercent = Math.max(0, Math.min(100, Math.round(status.downloadProgressPercent ?? 0)))

  return (
    <aside className="update-reminder-card" aria-live="polite">
      <div className="update-reminder-header">
        <div className="update-reminder-heading">
          <span className="eyebrow">更新提醒</span>
          <strong>{presentation.title}</strong>
        </div>
        <button className="ghost-button update-reminder-close" onClick={onDismiss} type="button">
          关闭
        </button>
      </div>

      <p className="update-reminder-copy">{presentation.description}</p>

      {status.phase === 'downloading' ? (
        <div className="update-reminder-progress">
          <div className="update-reminder-progress-track">
            <div className="update-reminder-progress-bar" style={{ width: `${progressPercent}%` }} />
          </div>
          <span>{progressPercent}%</span>
        </div>
      ) : null}

      <div className="update-reminder-footer">
        {presentation.showIgnore ? (
          <button className="ghost-button update-reminder-ignore" onClick={onIgnoreVersion} type="button">
            这个版本不再提醒
          </button>
        ) : (
          <span className="muted-copy">下载完成后，这里会变成“重启并安装”。</span>
        )}

        <div className="update-reminder-actions">
          <button className="secondary-button" onClick={onDismiss} type="button">
            {presentation.secondaryLabel}
          </button>
          {presentation.primaryLabel ? (
            <button className="primary-button" onClick={onPrimaryAction} type="button">
              {presentation.primaryLabel}
            </button>
          ) : null}
        </div>
      </div>
    </aside>
  )
}
