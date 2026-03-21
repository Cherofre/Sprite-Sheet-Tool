  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-left">
          <span className="eyebrow-header">桌面工具链</span>
          <h1>序列图工具</h1>
        </div>
        <div className="app-header-right" style={{ flexDirection: 'row', alignItems: 'center' }}>
          <button className="ghost-button" disabled={isBusy} onClick={handleImportFiles} type="button">📁 导入文件</button>
          <button className="ghost-button" disabled={isBusy} onClick={handleImportFolder} type="button">📂 导入文件夹</button>
          <button className="ghost-button" disabled={!canClear || isBusy} onClick={handleClearWorkspace} type="button">🗑️ 清空工作区</button>
          <button className="ghost-button" onClick={() => setIsHelpOpen(true)} type="button">⌨️ 快捷键说明</button>
        </div>
      </header>

      {errorMessage ? (
        <div className="error-banner"><span>{errorMessage}</span><button className="secondary-button" onClick={clearError} type="button">关闭</button></div>
      ) : null}

      <div className="app-grid">
        {/* 左侧：仅保留图集拆分面板 */}
        <aside className="sidebar-column" style={!sheet.source ? { display: 'none' } : {}}>
          <SheetPanel canApply={sheetGeometry.canApply} columns={sheetGeometry.columns} exportSettings={exportSettings} frameHeight={sheetGeometry.frameHeight} frameWidth={sheetGeometry.frameWidth} isBusy={isBusy} onApply={() => { void handleApplySheet() }} onChooseCandidate={handleChooseCandidate} onExportSplitSequence={() => { void handleExportSplitSequence() }} onUpdateSheet={handleUpdateSheet} predictedFrameCount={sheetGeometry.predictedFrameCount} rows={sheetGeometry.rows} sheet={sheet} />
        </aside>

        {/* 中间：巨大空状态引导 or 核心视口与控制条 */}
        <main className="preview-column">
          {frames.length === 0 && !sheet.source ? (
            <div className="empty-workspace-drop" onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const droppedFiles = Array.from(e.dataTransfer.files); if (droppedFiles.length > 0) void importDroppedFiles(droppedFiles); }}>
              <h2>开始创作</h2><p>将图片、GIF 动图 或 文件夹 拖拽至此区域</p>
              <div className="button-grid">
                <button className="primary-button" onClick={handleImportFiles} type="button">选择文件</button>
                <button className="secondary-button" onClick={handleImportFolder} type="button">选择文件夹</button>
              </div>
            </div>
          ) : (
            <>
              <PreviewStage background={playback.background} frame={currentFrame} zoom={playback.zoom} onZoomChange={(zoom) => updatePlaybackSettings({ zoom }, false)} />
              
              {/* 超级大整合：AE级底层工具条 */}
              <div className="viewport-toolbar">
                <div className="vt-left">
                  <select value={playback.background} onChange={(e) => updatePlaybackSettings({ background: e.target.value as any }, false)}>
                    <option value="checker">棋盘</option><option value="black">纯黑</option><option value="white">纯白</option>
                  </select>
                  <select value={playback.zoom} onChange={(e) => updatePlaybackSettings({ zoom: e.target.value === 'fit' ? 'fit' : Number(e.target.value) }, false)}>
                    <option value="fit">适应</option><option value="50">50%</option><option value="100">100%</option><option value="200">200%</option><option value="400">400%</option>
                  </select>
                  {currentFrame && <span className="compact-info" title={`${currentFrame.name} (${currentFrame.width}x${currentFrame.height})`}>{currentFrame.name} | {currentFrame.width}x{currentFrame.height}</span>}
                </div>
                
                <div className="vt-center">
                  <button className="secondary-button" disabled={frames.length === 0} onClick={handlePrevious}>|◀</button>
                  <button className="play-action-btn" disabled={frames.length === 0} onClick={handleTogglePlay}>{playback.isPlaying ? '⏸ 暂停' : '▶ 播放'}</button>
                  <button className="secondary-button" disabled={frames.length === 0} onClick={handleNext}>▶|</button>
                </div>
                
                <div className="vt-right">
                  {/* 支持滚轮调整的 FPS 滑块区 */}
                  <div className="fps-control" onWheel={(e) => {
                    const step = e.deltaY < 0 ? 1 : -1;
                    updatePlaybackSettings({ fps: Math.max(1, Math.min(60, playback.fps + step)) });
                  }}>
                    <span>FPS: {playback.fps}</span>
                    <input type="range" max={60} min={1} value={playback.fps} onChange={(e) => updatePlaybackSettings({ fps: Number(e.target.value) })} />
                  </div>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                    {frames.length === 0 ? '0/0' : `${playback.currentFrame + 1}/${frames.length}`}
                  </span>
                </div>
              </div>

              <FrameTimeline currentFrame={playback.currentFrame} frames={frames} onMoveFrame={moveFrame} onSelectFrame={selectFrame} selectedFrameIds={selectedFrameIds} />
            </>
          )}
        </main>

        {/* 右侧：原先的编辑操作全挪到了这里 */}
        <aside className="sidebar-column" style={frames.length === 0 ? { display: 'none' } : {}}>
          <ImportPanel canRedo={canRedo} canUndo={canUndo} frameCount={frames.length} isBusy={isBusy} onDeleteSelected={deleteSelectedFrames} onRedo={redo} onReverse={reverseFrames} onRotate={(r) => { void handleRotate(r) }} onUndo={undo} selectedCount={selectedFrameIds.length} statusMessage={statusMessage} />
          <PlaybackPanel frameCount={frames.length} onUpdatePlayback={updatePlaybackSettings} playback={playback} />
          <ExportPanel exportFrameCount={exportFrames.length} exportSettings={exportSettings} onExportGif={() => { void handleExportGif() }} onExportSequence={() => { void handleExportSequence() }} onExportSheet={() => { void handleExportSheet() }} onUpdateExport={updateExportSettings} recommendedLayout={recommendedLayout} />
        </aside>
      </div>

      {isBusy && operationProgress ? (
        <div className="busy-overlay">
          {/* ... 保持原有 loading 提示不变 ... */}
        </div>
      ) : null}

      {/* ... 保持原有 Help 弹窗不变 ... */}
    </div>
  )
