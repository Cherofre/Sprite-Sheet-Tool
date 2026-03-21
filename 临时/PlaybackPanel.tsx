import type { PlaybackSettings } from '@shared/types'

interface PlaybackPanelProps {
  frameCount: number; onNext: () => void; onPrevious: () => void; onTogglePlay: () => void
  onUpdatePlayback: (patch: Partial<PlaybackSettings>, recordHistory?: boolean) => void; playback: PlaybackSettings; sequenceCount: number
}
const parsePositiveInteger = (value: string): number => Math.max(0, Number.parseInt(value || '0', 10) || 0)

export function PlaybackPanel({ frameCount, onNext, onPrevious, onTogglePlay, onUpdatePlayback, playback, sequenceCount }: PlaybackPanelProps) {
  return (
    <section className="panel stack">
      <div className="section-heading">
        <span className="eyebrow">预览</span>
        <h2>播放控制</h2>
      </div>

      <div className="button-grid" style={{ gridTemplateColumns: '1fr 2fr 1fr' }}>
        <button className="secondary-button" disabled={frameCount === 0} onClick={onPrevious} type="button">|&lt;</button>
        <button className="primary-button" disabled={frameCount === 0} onClick={onTogglePlay} type="button">{playback.isPlaying ? '暂停' : '播放'}</button>
        <button className="secondary-button" disabled={frameCount === 0} onClick={onNext} type="button">&gt;|</button>
      </div>

      <div className="control-block">
        <label htmlFor="fps-range">播放帧率 (FPS)</label>
        <div className="range-row">
          <input id="fps-range" max={60} min={1} onChange={(e) => onUpdatePlayback({ fps: Math.max(1, parsePositiveInteger(e.target.value)) })} type="range" value={playback.fps} />
          <input className="number-input" max={60} min={1} onChange={(e) => onUpdatePlayback({ fps: Math.max(1, parsePositiveInteger(e.target.value)) })} type="number" value={playback.fps} />
        </div>
      </div>

      <div className="form-grid">
        <label>起始帧<input className="number-input" max={Math.max(0, frameCount - 1)} min={0} onChange={(e) => onUpdatePlayback({ startFrame: parsePositiveInteger(e.target.value) })} type="number" value={playback.startFrame} /></label>
        <label>结束帧<input className="number-input" max={Math.max(0, frameCount - 1)} min={0} onChange={(e) => onUpdatePlayback({ endFrame: parsePositiveInteger(e.target.value) })} type="number" value={playback.endFrame} /></label>
        <label>预览跳帧<input className="number-input" max={Math.max(0, frameCount)} min={0} onChange={(e) => onUpdatePlayback({ previewSkip: parsePositiveInteger(e.target.value) })} type="number" value={playback.previewSkip} /></label>
        <label>循环模式
          <select onChange={(e) => onUpdatePlayback({ loopMode: e.target.value as PlaybackSettings['loopMode'] })} value={playback.loopMode}>
            <option value="loop">循环</option>
            <option value="once">单次</option>
            <option value="pingpong">往复</option>
          </select>
        </label>
      </div>

      <div className="toggle-row">
        <button className={playback.reverse ? 'toggle-button active' : 'toggle-button'} onClick={() => onUpdatePlayback({ reverse: !playback.reverse })} type="button" style={{ width: '100%' }}>倒放</button>
      </div>

      <div className="section-heading compact">
        <span className="eyebrow">视图</span>
        <h3>背景与缩放</h3>
      </div>

      <div className="toggle-group">
        <button className={playback.background === 'checker' ? 'toggle-button active' : 'toggle-button'} onClick={() => onUpdatePlayback({ background: 'checker' }, false)} type="button">网格</button>
        <button className={playback.background === 'black' ? 'toggle-button active' : 'toggle-button'} onClick={() => onUpdatePlayback({ background: 'black' }, false)} type="button">纯黑</button>
        <button className={playback.background === 'white' ? 'toggle-button active' : 'toggle-button'} onClick={() => onUpdatePlayback({ background: 'white' }, false)} type="button">纯白</button>
      </div>

      <div className="toggle-group" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)' }}>
        {(['fit', 50, 100, 200, 400] as const).map((zoom) => (
          <button className={playback.zoom === zoom ? 'toggle-button active' : 'toggle-button'} key={String(zoom)} onClick={() => onUpdatePlayback({ zoom }, false)} type="button">
            {zoom === 'fit' ? '适应' : `${zoom}%`}
          </button>
        ))}
      </div>

      <div className="stats-grid">
        <div className="stat-card"><span>当前帧</span><strong>{frameCount === 0 ? '0 / 0' : `${playback.currentFrame + 1} / ${frameCount}`}</strong></div>
        <div className="stat-card"><span>实际播放</span><strong>{sequenceCount}</strong></div>
      </div>
    </section>
  )
}
