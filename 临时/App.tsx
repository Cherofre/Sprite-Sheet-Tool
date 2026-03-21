  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-left">
          <span className="eyebrow-header">桌面工具链</span>
          <h1>序列图工具</h1>
        </div>
        <div className="app-header-right">
          {/* 新增的顶部操作栏 */}
          <div className="top-toolbar">
            <button className="secondary-button" disabled={isBusy} onClick={handleImportFiles} type="button">📁 导入文件</button>
            <button className="secondary-button" disabled={isBusy} onClick={handleImportFolder} type="button">📂 导入文件夹</button>
            <button className="secondary-button" disabled={!canClear || isBusy} onClick={handleClearWorkspace} type="button">🗑️ 清空工作区</button>
          </div>
          <button className="header-button" onClick={() => setIsHelpOpen(true)} type="button">快捷键 / 说明</button>
        </div>
      </header>

      {errorMessage ? (
        <div className="error-banner">
          <span>{errorMessage}</span>
          <button className="secondary-button" onClick={clearError} type="button">关闭</button>
        </div>
      ) : null}

      <div className="app-grid">
        {/* 左侧区域：只有在导入文件后才会撑开 */}
        <aside className="sidebar-column">
          <ImportPanel canRedo={canRedo} canUndo={canUndo} frameCount={frames.length} isBusy={isBusy} onDeleteSelected={deleteSelectedFrames} onRedo={redo} onReverse={reverseFrames} onRotate={(r) => { void handleRotate(r) }} onUndo={undo} selectedCount={selectedFrameIds.length} statusMessage={statusMessage} />
          
          <SheetPanel canApply={sheetGeometry.canApply} columns={sheetGeometry.columns} exportSettings={exportSettings} frameHeight={sheetGeometry.frameHeight} frameWidth={sheetGeometry.frameWidth} isBusy={isBusy} onApply={() => { void handleApplySheet() }} onChooseCandidate={handleChooseCandidate} onExportSplitSequence={() => { void handleExportSplitSequence() }} onUpdateSheet={handleUpdateSheet} predictedFrameCount={sheetGeometry.predictedFrameCount} rows={sheetGeometry.rows} sheet={sheet} />
        </aside>

        {/* 中间核心工作区：空状态引导 vs 监视器视口 */}
        <main className="preview-column">
          {frames.length === 0 && !sheet.source ? (
            <div 
              className="empty-workspace-drop" 
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }} 
              onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const droppedFiles = Array.from(e.dataTransfer.files); if (droppedFiles.length > 0) void importDroppedFiles(droppedFiles); }}
            >
              <h2>开始创作</h2>
              <p>将图片、GIF 动图 或 文件夹 拖拽至此区域</p>
              <div className="button-grid">
                <button className="primary-button" onClick={handleImportFiles} type="button">选择文件</button>
                <button className="secondary-button" onClick={handleImportFolder} type="button">选择文件夹</button>
              </div>
            </div>
          ) : (
            <>
              <PreviewStage background={playback.background} frame={currentFrame} zoom={playback.zoom} />
              
              {/* AE 风格监视器控制条 */}
              <div className="viewport-toolbar">
                <div className="vt-group">
                  <select className="toolbar-select" value={playback.background} onChange={(e) => updatePlaybackSettings({ background: e.target.value as any }, false)}>
                    <option value="checker">背景: 棋盘</option>
                    <option value="black">背景: 纯黑</option>
                    <option value="white">背景: 纯白</option>
                  </select>
                  <select className="toolbar-select" value={playback.zoom} onChange={(e) => updatePlaybackSettings({ zoom: e.target.value === 'fit' ? 'fit' : Number(e.target.value) }, false)}>
                    <option value="fit">缩放: 适应</option>
                    <option value="50">50%</option>
                    <option value="100">100%</option>
                    <option value="200">200%</option>
                    <option value="400">400%</option>
                  </select>
                </div>
                <div className="vt-group vt-center">
                  <button className="toolbar-btn" disabled={frames.length === 0} onClick={handlePrevious}>|◀</button>
                  <button className="toolbar-btn play-btn" disabled={frames.length === 0} onClick={handleTogglePlay}>{playback.isPlaying ? '⏸ 暂停' : '▶ 播放'}</button>
                  <button className="toolbar-btn" disabled={frames.length === 0} onClick={handleNext}>▶|</button>
                </div>
                <div className="vt-group vt-right">
                  <span>{frames.length === 0 ? '0 / 0' : `${playback.currentFrame + 1} / ${frames.length}`} 帧</span>
                </div>
              </div>

              <FrameTimeline currentFrame={playback.currentFrame} frames={frames} onMoveFrame={moveFrame} onSelectFrame={selectFrame} selectedFrameIds={selectedFrameIds} />
            </>
          )}
        </main>

        <aside className="sidebar-column">
          <PlaybackPanel frameCount={frames.length} onUpdatePlayback={updatePlaybackSettings} playback={playback} />
          <ExportPanel exportFrameCount={exportFrames.length} exportSettings={exportSettings} onExportGif={() => { void handleExportGif() }} onExportSequence={() => { void handleExportSequence() }} onExportSheet={() => { void handleExportSheet() }} onUpdateExport={updateExportSettings} recommendedLayout={recommendedLayout} />
        </aside>
      </div>

      {/* 以下保留了你的 busy-overlay, help modal 和 drop-overlay 逻辑，请确保它们原本就在这里 */}
      {isBusy && operationProgress ? (
        <div className="busy-overlay">
          {/* ... 原有逻辑 ... */}
        </div>
      ) : null}

      {/* ... 其他弹窗原封不动 ... */}
    </div>
  )
