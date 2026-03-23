# Sprite Sheet Tool

Desktop sprite sheet and frame animation tool for game VFX artists.

## What it does
- Import image sequences, folders, and sprite sheets
- Preview frame animation with playback controls
- Split sprite sheets into frames
- Merge frames into a new sheet
- Export image sequences, sprite sheets, and GIFs

## Local development
```powershell
npm install
npm run dev
```

## Windows packaging
Recommended commands:

```powershell
npm run package:portable
npm run package:nsis
```

Or build both recommended Windows artifacts at once:

```powershell
npm run package:win
```

### Artifact policy
- `package:portable` builds a `zip` portable package
- `package:nsis` builds the Windows installer
- `package:win` builds both of the above
- `package:portable:single` builds the legacy single-file portable exe
- `package:win:all` builds every Windows artifact, including the legacy single-file portable exe

## Why zip portable is the default
Single-file Electron portable builds unpack to `%TEMP%` before launching the real app. On some Windows environments, that temp-directory launch can be blocked or crash before any window appears.

This repo now treats:
- `zip` portable as the recommended no-install option
- `nsis` as the recommended default for general users
- single-file portable as an advanced fallback only

See [docs/WINDOWS_RELEASE_COMPAT.md](docs/WINDOWS_RELEASE_COMPAT.md) for details.

## GitHub Actions release flow
The repository includes a Windows release workflow at `.github/workflows/windows-release.yml`.

- Tag push like `v1.0.1` builds the recommended Windows artifacts and publishes them to the GitHub Release
- Manual dispatch builds the same artifacts and can optionally include the legacy single-file portable exe

## Signing
If Windows signing secrets are present, `electron-builder` will use them during packaging.

Supported environment variables:
- `CSC_LINK`
- `CSC_KEY_PASSWORD`
- `WIN_CSC_LINK`
- `WIN_CSC_KEY_PASSWORD`
- `CSC_NAME`
