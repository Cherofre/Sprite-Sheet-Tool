# Windows Release Compatibility

## Summary
- `portable` single-file builds created by `electron-builder --win portable` unpack to `%TEMP%` and then launch the real app from there.
- On some Windows environments, especially with stricter security software or temp-directory execution rules, the unpacked Electron app can crash before any window appears.
- This repo has already reproduced that behavior locally: the same unpacked app runs normally from a regular folder, but fails when launched from the portable temp folder.

## Recommended release artifacts
- `npm run package:portable`
  Builds a `zip` portable package. Users unzip it and run `Sprite Sheet Tool.exe` directly from a normal folder. This is the most compatible no-install option.
- `npm run package:nsis`
  Builds the installer. This is the best default for most end users.
- `npm run package:win`
  Builds both the recommended `zip` portable package and the installer.
- `npm run package:portable:single`
  Builds the legacy single-file portable exe. Keep this only as an advanced option for users who specifically need a single file.
- `npm run package:win:all`
  Builds all Windows variants, including the legacy single-file portable exe.

## Practical guidance
- Prefer `zip` portable when you want "no install" distribution.
- Prefer `nsis` when you want the fewest support issues.
- Treat the single-file portable exe as opt-in, not the default artifact.
- If you still ship the single-file portable exe, code signing becomes much more important.

## Why `unpackDirName` is still set
- The single-file portable target always unpacks before launch.
- A stable unpack directory name makes environment-specific whitelisting easier and avoids a moving temp path per build.
- It does not remove the temp-directory launch risk, so it is only a small mitigation, not the primary fix.
