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

const parseInteger = (value: string, min = 0): number => Math.max(min, Number.parseInt(value || '0', 10) || min)
const clampFps = (value: string): number => Math.max(1, Math.min(60, Number.parseInt(value || '1', 10) || 1))

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
          FPS
          <input
            className="number-input"
            max={60}
            min={1}
            onChange={(event) => onUpdatePlayback({ fps: clampFps(event.target.value) })}
            type="number"
            value={playback.fps}
          />
        </label>
        <label>
          循环模式
          <select
            onChange={(event) => onUpdatePlayback({ loopMode: event.target.value as PlaybackSettings['loopMode'] })}
            value={playback.loopMode}
          >
            <option value="loop">循环</option>
            <option value="once">单次</option>
            <option value="pingpong">往返</option>
          </select>
        </label>
        <label>
          起始帧
          <input
            className="number-input"
            max={Math.max(0, frameCount - 1)}
            min={0}
            onChange={(event) => onUpdatePlayback({ startFrame: parseInteger(event.target.value) })}
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
            onChange={(event) => onUpdatePlayback({ endFrame: parseInteger(event.target.value) })}
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
            onChange={(event) => onUpdatePlayback({ previewSkip: parseInteger(event.target.value) })}
            type="number"
            value={playback.previewSkip}
          />
        </label>
      </div>

      <button
        className={playback.reverse ? 'toggle-button active full-width-button' : 'toggle-button full-width-button'}
        onClick={() => onUpdatePlayback({ reverse: !playback.reverse })}
        type="button"
      >
        倒放
      </button>
    </section>
  )
}
