---
name: sprite-sheet-desktop
description: guide chatgpt/codex to build and maintain a desktop sprite sheet and frame animation tool for game vfx artists. use when working on this repository's product requirements, implementation plan, ui flow, electron/react/typescript architecture, import/export pipeline, sprite sheet split/merge, gif import/export, frame preview, playback controls, undo/redo, release readiness, or pre-delivery self-checks.
---

# Goal
Build a desktop sprite sheet tool for game VFX artists first, with other users as secondary. Prioritize speed, stable import/export, clean preview, and production-friendly defaults over general image-editing complexity.

# Hard product constraints
- Target platform: desktop only.
- Recommended stack unless repo already differs: Electron + React + TypeScript.
- Core user: game VFX artist.
- Rotation applies to all frames, not individual free-angle transforms.
- GIF export speed follows the current preview FPS.
- Frame skipping must exist in both preview and export.
- Undo/redo is required.
- Project file save/load is not required for v1.
- Batch processing is not required for v1.
- If a normal evenly divided sheet is imported, such as 6x6 or 8x8, auto-detect the grid and immediately allow playback.

# Delivery rules
Before every meaningful handoff:
1. Run typecheck, lint, tests, and build if configured.
2. Manually verify there is no mojibake/garbled text in UI labels, dialogs, README, comments added in this task, or generated config.
3. Confirm drag/drop, playback, and one import/export path still work.
4. Report exactly what was checked and any known gaps.

Do not claim something is finished unless it was actually verified.

# MVP scope
## Import
- Drag/drop a single sprite sheet image.
- Drag/drop multiple images.
- Drag/drop a folder.
- Support PNG, JPG/JPEG, WEBP, GIF.
- Natural-sort multi-image imports by filename by default.
- Allow manual drag reordering of frames.

## Single-sheet workflow
When a single sheet is imported:
- Offer auto-detection for regular grids.
- If grid detection is confident, prefill rows/columns and start preview immediately.
- Still allow manual override by rows/columns or frame width/height.
- Show total detected frame count before applying destructive operations.

## Preview
- Play/pause.
- Previous/next frame.
- FPS slider plus numeric input.
- Loop, once, ping-pong.
- Start frame and end frame.
- Preview frame skipping.
- Current frame index and total frames.
- Zoom controls and fit-to-view.
- Preview background choices: checker, black, white.

## Editing
- Reorder frames by drag.
- Delete selected frame(s).
- Reverse frame order.
- Rotate all frames by 90/180/270.
- Undo/redo for frame/order/settings edits that affect user workflow.

## Merge/export
- Merge frames into a sprite sheet with configurable rows/columns.
- Recommend a near-square layout automatically.
- If input sizes differ, scale proportionally to the target frame size, keep aspect ratio, center align, and pad transparent space.
- Export image sequence with padded numbering.
- Export sprite sheet.
- Export GIF using current FPS.
- Export frame skipping / sampled export.

## Split
- Split a sheet by rows/columns.
- Split a sheet by frame width/height.
- Preview split result before export.

# Product rules
- Prefer practical VFX workflow defaults over advanced editor features.
- Avoid heavy features in v1: per-frame arbitrary transform, layer system, color grading, smart boundary detection, project files, batch queues.
- Use precise, deterministic naming for settings. Distinguish preview skipping from export skipping.
- Keep file operations and UI messaging robust and explicit.

# Suggested architecture
- Electron for shell and file access.
- React + TypeScript renderer.
- A small centralized state store such as Zustand.
- Clear separation between:
  - import/parsing
  - frame model/state
  - preview playback
  - image processing/export
  - history/undo
- Prefer utility modules with pure functions for frame ordering, range filtering, grid math, and export planning.
- Wrap native/file APIs behind repository-local services for testability.

# Data model guidance
Use explicit models close to:
- SourceAsset
- FrameItem
- PlaybackSettings
- ExportSettings
- ImportSession
- HistoryEntry

Keep derived state out of persisted source records when possible.

# Auto-detect guidance for a regular sheet
For a single sheet, try these in order:
1. If metadata or user-provided dimensions already imply rows/columns, use them.
2. Check for common even grids where width and height divide cleanly into candidate counts such as 1..16.
3. Prefer candidates that produce square-ish or consistent cell sizes.
4. If multiple candidates are plausible, surface the best few instead of silently locking one.
5. If confidence is high, start preview with the top candidate immediately.

Do not pretend auto-detection is perfect. Surface fallback manual controls.

# Coding rules
- Keep encoding UTF-8 everywhere.
- Avoid hidden magic numbers; centralize defaults.
- Use natural sort for filenames.
- Treat image processing as cancellable/isolated work where practical.
- Write comments only where they add non-obvious value.
- Keep components small and name them by job, not by visual position alone.

# Suggested file organization
Use or adapt this structure:
- src/main
- src/preload
- src/renderer
- src/shared
- src/features/import
- src/features/preview
- src/features/split
- src/features/merge
- src/features/export
- src/features/history
- src/lib/image
- src/lib/sort
- src/lib/grid
- src/lib/fs

# Working style
For each milestone:
1. Restate the exact sub-goal.
2. Change the minimal necessary files.
3. Run checks.
4. Summarize what changed, how it was verified, and what remains.

# Do not do
- Do not add unrelated frameworks.
- Do not silently downgrade desktop requirements into a web-only solution.
- Do not skip verification.
- Do not introduce project-save features into v1 unless explicitly requested later.
