import { createPortal } from 'react-dom'

export type GuideModalReason = 'welcome' | 'update' | 'manual'
export type GuideSectionId = 'quick-start' | 'context-actions' | 'photoshop' | 'shortcuts'

interface ShortcutRow {
  description: string
  shortcut: string
}

interface GuideModalProps {
  activeSection: GuideSectionId
  autoShowEnabled: boolean
  currentVersion: string
  isOpen: boolean
  onChangeSection: (section: GuideSectionId) => void
  onClose: () => void
  onConfirm: () => void
  onDisableAutoShow: () => void
  onToggleAutoShow: (enabled: boolean) => void
  reason: GuideModalReason
  shortcutRows: ShortcutRow[]
}

const sections: Array<{ id: GuideSectionId; label: string }> = [
  { id: 'quick-start', label: '快速上手' },
  { id: 'context-actions', label: '右键操作' },
  { id: 'photoshop', label: 'Photoshop 编辑' },
  { id: 'shortcuts', label: '快捷键与注意' }
]

const getGuideHeader = (reason: GuideModalReason, currentVersion: string): { eyebrow: string; subtitle: string; title: string } => {
  switch (reason) {
    case 'welcome':
      return {
        eyebrow: '首次上手',
        subtitle: '先用 1 分钟熟悉导入、右键、Photoshop 往返和快捷键。',
        title: '欢迎使用序列图工具'
      }
    case 'update':
      return {
        eyebrow: '本次更新',
        subtitle: '这版补充了首次说明、更新提醒和更清晰的操作提示。',
        title: `v${currentVersion} 更新说明`
      }
    default:
      return {
        eyebrow: '帮助',
        subtitle: '这里集中说明导入、右键、Photoshop 往返和快捷键。',
        title: '快捷键与说明'
      }
  }
}

const renderQuickStart = () => (
  <div className="guide-section-stack">
    <div className="guide-step-grid">
      <div className="hint-card guide-step-card">
        <span className="eyebrow">1. 导入素材</span>
        <strong>支持单张图片、图片序列、GIF 和文件夹。</strong>
      </div>
      <div className="hint-card guide-step-card">
        <span className="eyebrow">2. 确认导入方式</span>
        <strong>单张图如果像规则序列，会先询问按单帧导入还是按序列导入。</strong>
      </div>
      <div className="hint-card guide-step-card">
        <span className="eyebrow">3. 应用到时间轴</span>
        <strong>确认列/行或帧尺寸后，点“应用到时间轴”。</strong>
      </div>
      <div className="hint-card guide-step-card">
        <span className="eyebrow">4. 预览与导出</span>
        <strong>在中间预览播放，在右侧导出图片序列、序列图或 GIF。</strong>
      </div>
    </div>

    <div className="hint-card">
      <span className="eyebrow">补充提示</span>
      <p>已有内容时再次导入，会先询问：追加、替换当前帧，还是清空后重新导入。</p>
      <p>识别不准时，可以直接在导入弹窗里手动输入列/行或帧尺寸。</p>
    </div>
  </div>
)

const renderContextActions = () => (
  <div className="guide-section-stack">
    <div className="guide-dual-grid">
      <div className="hint-card guide-panel-card">
        <span className="eyebrow">预览区右键</span>
        <ul className="guide-bullet-list">
          <li>复制当前画布</li>
          <li>单帧另存为</li>
          <li>导入并替换当前帧...</li>
          <li>用 Photoshop 修改当前帧...</li>
        </ul>
      </div>
      <div className="hint-card guide-panel-card">
        <span className="eyebrow">时间轴右键</span>
        <ul className="guide-bullet-list">
          <li>导入并替换当前帧...</li>
          <li>用 Photoshop 修改这帧...</li>
          <li>删除当前帧</li>
        </ul>
      </div>
    </div>

    <div className="hint-card guide-callout-card">
      <span className="eyebrow">高频流程</span>
      <p>想快速修某一帧，最顺手的流程通常是：时间轴右键 - 用 Photoshop 修改这帧。</p>
      <p>如果只是把外部图片换进当前帧，用“导入并替换当前帧...”更直接。</p>
    </div>
  </div>
)

const renderPhotoshopNotes = () => (
  <div className="guide-section-stack">
    <div className="hint-card guide-callout-card guide-photoshop-card">
      <span className="eyebrow">推荐流程</span>
      <p>右键当前帧 - 用 Photoshop 修改。程序会先准备一张临时 PNG，保存后会尝试自动回灌。</p>
    </div>

    <div className="guide-dual-grid">
      <div className="hint-card guide-panel-card">
        <span className="eyebrow">原位保存的关键</span>
        <p>想让这张帧原位回到工具里，最终保存目标必须还是那张 PNG。</p>
      </div>
      <div className="hint-card guide-panel-card">
        <span className="eyebrow">多图层注意事项</span>
        <p>如果你在 Photoshop 里加了多个图层，直接 Ctrl+S 往往会想保存成 PSD。</p>
        <p>这种情况下，请保留一份 PSD 母稿，再导出或覆盖成单图层 PNG。</p>
      </div>
    </div>

    <div className="hint-card guide-panel-card">
      <span className="eyebrow">剪贴板注意事项</span>
      <p>直接从 Photoshop 复制进工具时，透明有时会丢。更稳的方式仍然是 PNG 文件往返。</p>
      <p>一句话理解：PSD 负责保留图层，PNG 负责回到工具里继续用。</p>
    </div>
  </div>
)

const renderShortcuts = (shortcutRows: ShortcutRow[]) => (
  <div className="guide-section-stack">
    <div className="guide-shortcut-grid">
      {shortcutRows.map(({ description, shortcut }) => (
        <div className="help-row" key={shortcut}>
          <kbd>{shortcut}</kbd>
          <span>{description}</span>
        </div>
      ))}
    </div>

    <div className="hint-card">
      <span className="eyebrow">注意事项</span>
      <p>在输入框里编辑数字时，快捷键不会抢输入。</p>
      <p>导出或拆分过程中如果取消，半成品会自动清理。</p>
      <p>识别只是推荐，不准时优先手动指定。</p>
    </div>
  </div>
)

export function GuideModal({
  activeSection,
  autoShowEnabled,
  currentVersion,
  isOpen,
  onChangeSection,
  onClose,
  onConfirm,
  onDisableAutoShow,
  onToggleAutoShow,
  reason,
  shortcutRows
}: GuideModalProps) {
  if (!isOpen || typeof document === 'undefined') {
    return null
  }

  const header = getGuideHeader(reason, currentVersion)
  const isManualMode = reason === 'manual'
  const showAutoOptions = !isManualMode

  let sectionContent = renderQuickStart()
  if (activeSection === 'context-actions') {
    sectionContent = renderContextActions()
  } else if (activeSection === 'photoshop') {
    sectionContent = renderPhotoshopNotes()
  } else if (activeSection === 'shortcuts') {
    sectionContent = renderShortcuts(shortcutRows)
  }

  return createPortal(
    <div className="modal-overlay">
      <div
        className={`modal-card guide-modal-card${isManualMode ? ' guide-modal-card-manual' : ''}`}
        onClick={(event) => {
          event.stopPropagation()
        }}
      >
        <div className="modal-header guide-modal-header">
          <div className="guide-modal-heading">
            <span className="eyebrow">{header.eyebrow}</span>
            <h2>{header.title}</h2>
            <p className="guide-modal-subtitle">{header.subtitle}</p>
          </div>
          <button className="secondary-button" onClick={onClose} type="button">
            关闭
          </button>
        </div>

        <div className="guide-layout">
          <nav className={`guide-nav${isManualMode ? ' guide-nav-manual' : ''}`} aria-label="操作说明分区">
            {sections.map((section) => (
              <button
                key={section.id}
                className={`guide-nav-button${activeSection === section.id ? ' active' : ''}`}
                onClick={() => onChangeSection(section.id)}
                type="button"
              >
                {section.label}
              </button>
            ))}

            {isManualMode ? <div className="guide-floating-hint">以后按 F1 可以再次打开这份说明。</div> : null}
          </nav>

          <section className="guide-content">{sectionContent}</section>
        </div>

        {showAutoOptions ? (
          <div className="guide-footer">
            <div className="guide-footer-meta">
              <label className="guide-checkbox">
                <input checked={autoShowEnabled} onChange={(event) => onToggleAutoShow(event.target.checked)} type="checkbox" />
                <span>以后更新后仍自动显示</span>
              </label>
              <button className="ghost-button guide-inline-button" onClick={onDisableAutoShow} type="button">
                不再自动弹出
              </button>
            </div>

            <div className="guide-footer-actions">
              <button className="secondary-button" onClick={onClose} type="button">
                以后按 F1 再看
              </button>
              <button className="primary-button" onClick={onConfirm} type="button">
                开始使用
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  )
}
