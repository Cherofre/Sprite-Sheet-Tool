# Sprite Sheet Desktop Tool - Requirements

## Product goal
Build a desktop sprite sheet / frame animation tool primarily for game VFX artists. It should make splitting, merging, previewing, and exporting frame animations faster than using general-purpose image tools.

## Target users
- Primary: game VFX artists
- Secondary: pixel artists, 2D animators, UI motion/content artists

## Platform
- Desktop only
- Recommended stack: Electron + React + TypeScript

## Core scenarios
1. Import multiple frame images, reorder them, preview animation, export as sprite sheet/GIF/image sequence.
2. Import one regular sprite sheet, auto-detect rows/columns when possible, preview immediately, split/export.
3. Adjust playback controls such as FPS, start frame, end frame, reverse, preview skip, and export skip.
4. Apply whole-sequence rotation and export stable assets for downstream engine use.

## Functional requirements

### Import
- Drag/drop single image
- Drag/drop multiple images
- Drag/drop folder
- Support PNG/JPG/JPEG/WEBP/GIF
- Natural sort by filename by default
- Manual frame reordering

### Single-sheet import
- Auto-detect regular grids for evenly divided sheets
- Common cases include 6x6 and 8x8
- If confidence is high, prefill and start playback immediately
- Manual override by rows/columns
- Manual override by frame width/height

### Preview
- Play/pause
- Previous/next frame
- FPS slider
- FPS numeric input
- Loop / once / ping-pong
- Start frame / end frame
- Preview skip
- Reverse frame order
- Current frame display
- Total frame count
- Zoom presets / fit to view
- Background switcher: checker / black / white

### Edit
- Drag to reorder frames
- Delete selected frames
- Reverse order
- Rotate all frames by 90/180/270
- Undo / redo

### Split
- Split by rows/columns
- Split by frame width/height
- Preview split results
- Export split image sequence

### Merge
- Merge multiple frames into one sheet
- Custom rows/columns
- Auto-recommend near-square layout
- If sizes differ, scale proportionally, center align, and pad transparent area

### Export
- Export image sequence
- Export sprite sheet
- Export GIF
- GIF speed follows current preview FPS
- Export skip / sampled export
- Padded numbering in filenames

## Non-functional requirements
- UTF-8 text only, no乱码/mojibake
- Stable desktop file handling
- Clear user-facing error messages
- Explicit verification before each delivery
- Maintainable module boundaries
- Reasonable performance for common VFX frame counts and image sizes

## Explicit non-goals for v1
- Project file save/load
- Batch queue processing
- Per-frame arbitrary rotation
- Layered timeline editing
- Color grading/correction
- Smart boundary-based frame extraction

## Recommended initial folder structure
```text
.
├─ .codex/
│  └─ skills/
│     └─ sprite-sheet-desktop/
│        ├─ SKILL.md
│        ├─ agents/
│        │  └─ openai.yaml
│        └─ references/
│           └─ workflow.md
├─ docs/
│  ├─ PROJECT_REQUIREMENTS.md
│  └─ CODEX_HANDOFF_PROMPT.md
├─ src/
│  ├─ main/
│  ├─ preload/
│  ├─ renderer/
│  ├─ shared/
│  ├─ features/
│  │  ├─ import/
│  │  ├─ preview/
│  │  ├─ split/
│  │  ├─ merge/
│  │  ├─ export/
│  │  └─ history/
│  └─ lib/
│     ├─ fs/
│     ├─ grid/
│     ├─ image/
│     └─ sort/
└─ package.json
```

## Suggested development milestones
1. Bootstrap desktop app and quality gates
2. Multi-image import and preview
3. Merge/export sheet
4. Single-sheet split + auto-detect
5. GIF import/export
6. Undo/redo + smoke testing + polish
