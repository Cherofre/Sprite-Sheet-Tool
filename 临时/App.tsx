      <div className="app-grid">
        {/* 1. 上半部分：核心工作区（全宽画布 + 两侧抽屉） */}
        <div className="app-workspace">
          
          {/* 左侧抽屉：图集识别 */}
          <aside className="sidebar-drawer sidebar-drawer-left" style={!sheet.source ? { display: 'none' } : undefined}>
            <div className="drawer-content">
              <SheetPanel
                canApply={sheetGeometry.canApply}
                columns={sheetGeometry.columns}
                exportSettings={exportSettings}
                frameHeight={sheetGeometry.frameHeight}
                frameWidth={sheetGeometry.frameWidth}
                isBusy={isBusy}
                onApply={() => { void handleApplySheet() }}
                onChooseCandidate={handleChooseCandidate}
                onExportSplitSequence={() => { setIsExportPanelOpen(true) }}
                onUpdateSheet={handleUpdateSheet}
                predictedFrameCount={sheetGeometry.predictedFrameCount}
                rows={sheetGeometry.rows}
                sheet={sheet}
              />
            </div>
            <div className="drawer-handle drawer-handle-left">
              <div className="handle-pill" />
            </div>
          </aside>

          {/* 中心画布区（占满剩余空间） */}
          <main className="preview-column">
            {frames.length === 0 && !sheet.source ? (
              <div
                className="empty-workspace-drop"
                onDragOver={(event) => { event.preventDefault(); event.stopPropagation() }}
                onDrop={(event) => {
                  event.preventDefault(); event.stopPropagation()
                  clearWindowDragState()
                  const droppedFiles = Array.from(event.dataTransfer.files)
                  if (droppedFiles.length > 0) void importDroppedFiles(droppedFiles)
                }}
              >
                <h2>开始创作</h2>
                <p>将图片、GIF 动图或文件夹拖拽至此</p>
                <div className="button-grid">
                  <button className="primary-button" onClick={() => { void handleImportFiles() }} type="button">选择文件</button>
                  <button className="secondary-button" onClick={() => { void handleImportFolder() }} type="button">选择文件夹</button>
                </div>
              </div>
            ) : (
              <>
                <PreviewStage background={playback.background} frame={currentFrame} onZoomChange={(zoom) => updatePlaybackSettings({ zoom }, false)} zoom={playback.zoom} />
                <div className="viewport-toolbar">
                  {/* ...保留原有的 viewport-toolbar 内部所有代码不变... */}
                  <div className="vt-left">
                    <select onChange={(event) => updatePlaybackSettings({ background: event.target.value as typeof playback.background }, false)} value={playback.background}>
                      <option value="checker">棋盘</option>
                      <option value="black">纯黑</option>
                      <option value="white">纯白</option>
                    </select>
                    <select onChange={(event) => updatePlaybackSettings({ zoom: event.target.value === 'fit' ? 'fit' : Number(event.target.value) }, false)} value={String(playback.zoom)}>
                      {typeof playback.zoom === 'number' && ![50, 100, 200, 400].includes(playback.zoom) ? <option value={String(playback.zoom)}>{playback.zoom}%</option> : null}
                      <option value="fit">适应</option>
                      <option value="50">50%</option>
                      <option value="100">100%</option>
                      <option value="200">200%</option>
                      <option value="400">400%</option>
                    </select>
                    {currentFrame ? <span className="compact-info" title={`${currentFrame.name} (${currentFrame.width}x${currentFrame.height})`}>{currentFrame.name} | {currentFrame.width}x{currentFrame.height}</span> : null}
                  </div>
                  <div className="vt-center">
                    <button className="secondary-button toolbar-nav-btn" disabled={frames.length === 0} onClick={handlePrevious} type="button">|◀</button>
                    <button className="play-action-btn" disabled={frames.length === 0} onClick={handleTogglePlay} type="button">{playback.isPlaying ? '暂停' : '播放'}</button>
                    <button className="secondary-button toolbar-nav-btn" disabled={frames.length === 0} onClick={handleNext} type="button">▶|</button>
                    <div className="fps-control" title="鼠标在此处滚动可调节帧率" onWheel={(event) => { event.preventDefault(); const step = event.deltaY < 0 ? 1 : -1; updatePlaybackSettings({ fps: Math.max(1, Math.min(60, playback.fps + step)) }) }}>
                      <span>FPS: {playback.fps}</span>
                      <input max={60} min={1} onChange={(event) => updatePlaybackSettings({ fps: Number(event.target.value) })} type="range" value={playback.fps} />
                    </div>
                  </div>
                  <div className="vt-right">
                    <span className="compact-counter">{frames.length === 0 ? '0/0' : `${playback.currentFrame + 1}/${frames.length}`}</span>
                  </div>
                </div>
              </>
            )}
          </main>

          {/* 右侧抽屉：编辑、播放、导出 */}
          <aside className="sidebar-drawer sidebar-drawer-right" style={frames.length === 0 && !sheet.source ? { display: 'none' } : undefined}>
            <div className="drawer-handle drawer-handle-right">
              <div className="handle-pill" />
            </div>
            <div className="drawer-content">
              <ImportPanel
                canRedo={canRedo} canUndo={canUndo} frameCount={frames.length} isBusy={isBusy}
                onDeleteSelected={deleteSelectedFrames} onRedo={redo} onReverse={reverseFrames}
                onRotate={(rotation) => { void handleRotate(rotation) }} onUndo={undo}
                selectedCount={selectedFrameIds.length} statusMessage={statusMessage}
              />
              <PlaybackPanel frameCount={frames.length} onUpdatePlayback={updatePlaybackSettings} playback={playback} />
              <ExportPanel
                canExportSplitSequence={sheetGeometry.canApply} exportFrameCount={exportFrames.length}
                exportSettings={exportSettings} isOpen={isExportPanelOpen}
                onExportGif={() => { void handleExportGif() }} onExportSequence={() => { void handleExportSequence() }}
                onExportSplitSequence={() => { void handleExportSplitSequence() }} onExportSheet={() => { void handleExportSheet() }}
                onOpenChange={setIsExportPanelOpen} onUpdateExport={updateExportSettings} recommendedLayout={recommendedLayout}
              />
            </div>
          </aside>

        </div>

        {/* 2. 下半部分：全宽沉底时间轴 */}
        {!(frames.length === 0 && !sheet.source) && (
          <FrameTimeline
            currentFrame={playback.currentFrame}
            frames={frames}
            onMoveFrame={moveFrame}
            onSelectFrame={selectFrame}
            selectedFrameIds={selectedFrameIds}
          />
        )}
      </div>
