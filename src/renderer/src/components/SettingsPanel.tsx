import { createPortal } from 'react-dom'

export type DrawerFixedMode = 'none' | 'left' | 'right' | 'both'

export interface UiPreferences {
  drawerBlurDelayMs: number
  drawerFixedMode: DrawerFixedMode
}

interface SettingsPanelProps {
  isOpen: boolean
  onClose: () => void
  onUpdate: (patch: Partial<UiPreferences>) => void
  preferences: UiPreferences
}

const clampDelay = (value: string): number => {
  const parsed = Number.parseInt(value || '0', 10)
  if (Number.isNaN(parsed)) {
    return 0
  }

  return Math.max(0, Math.min(3000, parsed))
}

export function SettingsPanel({ isOpen, onClose, onUpdate, preferences }: SettingsPanelProps) {
  if (!isOpen || typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-card settings-modal-card"
        onClick={(event) => {
          event.stopPropagation()
        }}
      >
        <div className="modal-header">
          <div>
            <span className="eyebrow">设置</span>
            <h2>界面与抽屉</h2>
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

        <div className="hint-card">
          <span className="eyebrow">说明</span>
          <p>
            1. 固定模式会让侧栏常驻并为预览区让出空间。
            <br />
            2. 抽屉上的锁定按钮是临时锁定，不会覆盖这里的固定模式。
            <br />
            3. 这些设置会自动保存在当前机器上。
          </p>
        </div>
      </div>
    </div>,
    document.body
  )
}
