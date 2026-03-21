import type { PlaybackSettings } from '@shared/types'

interface PlaybackPanelProps {
  frameCount: number
  onNext?: () => void
  onPrevious?: () => void
  onTogglePlay?: () => void
  onUpdatePlayback: (patch: Partial<PlaybackSettings>, recordHistory?: boolean) => void
  playback: PlaybackSettings
  sequenceCount?: number
}

const parsePositiveInteger = (value: string): number => Math.max(0, Number.parseInt(value || '0', 10) || 0)

export function PlaybackPanel({ frameCount, onUpdatePlayback, playback }: PlaybackPanelProps) {
  if (frameCount === 0) {
    return null
  }

  return (
    <section className="panel stack">
      <div className="section-heading">
        <span className="eyebrow">参数</span>
        <h2>播放参数</h2>
      </div>

      <div className="form-grid">
        <label>
          起始帧
          <input
            className="number-input"
            max={Math.max(0, frameCount - 1)}
            min={0}
            onChange={(event) => onUpdatePlayback({ startFrame: parsePositiveInteger(event.target.value) })}
            type="number"
            value={playback.startFrame}
          />
        </label>
        <label>
          结束帧
          <input
            className="number-input"
            max={Math.max(0, frameCount - 1)}
            min={0}
            onChange={(event) => onUpdatePlayback({ endFrame: parsePositiveInteger(event.target.value) })}
            type="number"
            value={playback.endFrame}
          />
        </label>
        <label>
          预览跳帧
          <input
            className="number-input"
            max={Math.max(0, frameCount)}
            min={0}
            onChange={(event) => onUpdatePlayback({ previewSkip: parsePositiveInteger(event.target.value) })}
            type="number"
            value={playback.previewSkip}
          />
        </label>
        <label>
          循环模式
          <select onChange={(event) => onUpdatePlayback({ loopMode: event.target.value as PlaybackSettings['loopMode'] })} value={playback.loopMode}>
            <option value="loop">循环</option>
            <option value="once">单次</option>
            <option value="pingpong">往返</option>
          </select>
        </label>
      </div>

      <button
        className={playback.reverse ? 'toggle-button active full-width-button' : 'toggle-button full-width-button'}
        onClick={() => onUpdatePlayback({ reverse: !playback.reverse })}
        type="button"
      >
        启用倒放
      </button>
    </section>
  )
}
