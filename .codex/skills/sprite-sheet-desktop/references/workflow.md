# Recommended Codex workflow for this repository

## 1. Bootstrap
- Initialize an Electron + React + TypeScript desktop app if the repo is empty.
- Add basic scripts for dev, build, lint, typecheck, and test.
- Keep all source files UTF-8.

## 2. Build in this order
1. Multi-image import + frame list + natural sort
2. Preview player + FPS/start/end/reverse/skip
3. Sheet merge export
4. Single-sheet split and grid auto-detect
5. GIF import/export
6. Undo/redo and hardening
7. UI polish and release checks

## 3. Self-check before each handoff
- Install any missing dependencies required by the code you wrote.
- Run the project's available quality gates.
- Fix TypeScript errors, import issues, build errors, and obvious runtime issues that can be caught locally.
- Scan touched files for encoding problems.
- Do a short smoke-test path and state it explicitly in the handoff.

## 4. Suggested smoke tests
- Import 8 png files, reorder one, preview at changed FPS, export sheet.
- Import one 8x8 sheet, auto-detect, preview, split to frames.
- Export GIF from a selected frame range with export skip.
