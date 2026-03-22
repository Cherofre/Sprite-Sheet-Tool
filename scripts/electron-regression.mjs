import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { _electron as electron } from 'playwright'
import sharp from 'sharp'
import gifenc from 'gifenc'

const { GIFEncoder, applyPalette, quantize } = gifenc

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')
const buildEntry = path.join(repoRoot, 'out', 'main', 'index.js')
const fixtureDirectory = path.join(repoRoot, 'tmp', 'regression-input')
const outputDirectory = path.join(repoRoot, 'tmp', 'regression-output')
const autoDetectPath = path.join(fixtureDirectory, 'auto-detect-grid.png')
const gifInputPath = path.join(fixtureDirectory, 'roundtrip-input.gif')
const gifOutputPath = path.join(outputDirectory, 'roundtrip-output.gif')
const UI_PREFERENCES_KEY = 'sprite-sheet-tool.ui-preferences.v1'

const waitFor = async (predicate, timeoutMs = 10000, intervalMs = 150) => {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const result = await predicate()
    if (result) {
      return result
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  throw new Error('Timed out while waiting for the regression condition to pass.')
}

const waitForSmokeBridge = async (window) => {
  await window.waitForFunction(
    () =>
      typeof window.__spriteSheetSmoke?.importPaths === 'function' &&
      typeof window.__spriteSheetSmoke?.getSnapshot === 'function' &&
      typeof window.__spriteSheetSmoke?.exportGif === 'function'
  )
}

const launchApp = async () =>
  electron.launch({
    args: [buildEntry],
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: '',
      SPRITE_SHEET_CHOOSE_DIRECTORY: outputDirectory,
      SPRITE_SHEET_SAVE_FILE: gifOutputPath
    }
  })

const createAutoDetectFixture = async () => {
  const colors = ['#ff8a4d', '#ffd166', '#06d6a0', '#4cc9f0', '#f72585', '#b5179e', '#7209b7', '#4361ee']

  const cells = []
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      const x = column * 64 + 14
      const y = row * 64 + 14
      const fill = colors[(row * 4 + column) % colors.length]
      cells.push(`<rect x="${x}" y="${y}" width="36" height="36" rx="10" fill="${fill}" fill-opacity="0.96" />`)
      cells.push(
        `<path d="M${x + 10} ${y + 8} L${x + 26} ${y + 28}" stroke="rgba(255,255,255,0.55)" stroke-width="4" stroke-linecap="round" />`
      )
    }
  }

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
      <rect width="256" height="256" fill="transparent" />
      ${cells.join('\n')}
    </svg>
  `

  await sharp(Buffer.from(svg)).png().toFile(autoDetectPath)
}

const createTransparentGifFixture = async () => {
  const width = 32
  const height = 32
  const encoder = GIFEncoder()

  const buildFrame = (startX, startY, color) => {
    const pixels = new Uint8Array(width * height * 4)
    for (let y = startY; y < startY + 12; y += 1) {
      for (let x = startX; x < startX + 12; x += 1) {
        const index = (y * width + x) * 4
        pixels[index] = color[0]
        pixels[index + 1] = color[1]
        pixels[index + 2] = color[2]
        pixels[index + 3] = 255
      }
    }

    return pixels
  }

  for (const frame of [buildFrame(4, 4, [255, 138, 77]), buildFrame(16, 16, [94, 209, 177])]) {
    const palette = quantize(frame, 256, {
      format: 'rgba4444',
      oneBitAlpha: true
    })
    const indexed = applyPalette(frame, palette, 'rgba4444')

    encoder.writeFrame(indexed, width, height, {
      delay: 100,
      dispose: 1,
      palette,
      repeat: 0,
      transparent: true,
      transparentIndex: 0
    })
  }

  encoder.finish()
  await fs.writeFile(gifInputPath, Buffer.from(encoder.bytes()))
}

const resetUiPreferences = async () => {
  const app = await launchApp()

  try {
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.evaluate((storageKey) => {
      window.localStorage.removeItem(storageKey)
    }, UI_PREFERENCES_KEY)
  } finally {
    await app.close()
  }
}

const isDrawerOpen = (window, selector) =>
  window.locator(selector).evaluate((node) => node.classList.contains('sidebar-drawer-open') || node.classList.contains('sidebar-drawer-fixed'))

await fs.rm(fixtureDirectory, { force: true, recursive: true })
await fs.rm(outputDirectory, { force: true, recursive: true })
await fs.mkdir(fixtureDirectory, { recursive: true })
await fs.mkdir(outputDirectory, { recursive: true })

await createAutoDetectFixture()
await createTransparentGifFixture()
await resetUiPreferences()

let app = await launchApp()

try {
  let window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await waitForSmokeBridge(window)

  await window.evaluate(async (inputPath) => {
    const bridge = globalThis.__spriteSheetSmoke
    if (!bridge) {
      throw new Error('Smoke bridge is unavailable before auto-detect import.')
    }
    await bridge.importPaths([inputPath])
  }, autoDetectPath)

  const autoDetectSnapshot = await waitFor(async () => {
    const snapshot = await window.evaluate(() => window.__spriteSheetSmoke?.getSnapshot())
    return snapshot?.frameCount === 16 &&
      snapshot.sheet.autoApplied &&
      snapshot.sheet.rows === 4 &&
      snapshot.sheet.columns === 4 &&
      snapshot.playback.isPlaying
      ? snapshot
      : null
  })

  await window.locator('.drawer-handle-left .handle-activate-zone').hover()
  await waitFor(async () => ((await isDrawerOpen(window, '.sidebar-drawer-left')) ? true : null))

  await window.locator('.drawer-handle-left .handle-lock-button').click()
  await window.mouse.move(960, 220)
  await window.waitForTimeout(350)
  await waitFor(async () => ((await isDrawerOpen(window, '.sidebar-drawer-left')) ? true : null))

  await window.locator('.drawer-handle-right .handle-activate-zone').hover()
  await waitFor(async () => ((await isDrawerOpen(window, '.sidebar-drawer-right')) ? true : null))
  await window.locator('.sidebar-drawer-right .drawer-lock-btn').click()
  await waitFor(async () => ((await window.locator('.sidebar-drawer-fixed').count()) === 1 ? true : null))
  await window.locator('.sidebar-drawer-right .drawer-lock-btn').click()
  await waitFor(async () => ((await window.locator('.sidebar-drawer-fixed').count()) === 0 ? true : null))

  await window.locator('button[title="设置"]').click()
  await window.locator('.settings-modal-card').waitFor({ state: 'visible' })

  await window.locator('.settings-modal-card input[type="number"]').fill('420')
  await window.locator('.settings-modal-card select').selectOption('both')
  await window.locator('.settings-modal-card button').getByText('关闭').click()

  await waitFor(async () => ((await window.locator('.sidebar-drawer-fixed').count()) === 2 ? true : null))

  const storedPreferences = await window.evaluate((storageKey) => {
    const rawValue = window.localStorage.getItem(storageKey)
    return rawValue ? JSON.parse(rawValue) : null
  }, UI_PREFERENCES_KEY)

  if (!storedPreferences || storedPreferences.drawerBlurDelayMs !== 420 || storedPreferences.drawerFixedMode !== 'both') {
    throw new Error('UI preferences were not persisted after updating the settings modal.')
  }

  await window.evaluate(async () => {
    const bridge = globalThis.__spriteSheetSmoke
    if (!bridge) {
      throw new Error('Smoke bridge is unavailable before sequence export.')
    }
    await bridge.exportSequence()
  })

  await waitFor(async () => {
    const entries = await fs.readdir(outputDirectory)
    return entries.filter((entry) => entry.endsWith('.png')).length === 16 ? true : null
  })

  const exportToast = window.locator('.export-toast')
  await exportToast.waitFor({ state: 'visible' })
  await waitFor(async () => {
    const text = await exportToast.innerText()
    return text.includes('单帧导出完成') ? true : null
  })
  await exportToast.getByRole('button', { name: '完成' }).click()
  await exportToast.waitFor({ state: 'hidden' })

  await window.evaluate(async (inputPath) => {
    const bridge = globalThis.__spriteSheetSmoke
    if (!bridge) {
      throw new Error('Smoke bridge is unavailable before GIF import.')
    }
    await bridge.importPaths([inputPath])
  }, gifInputPath)

  await waitFor(async () => {
    const snapshot = await window.evaluate(() => window.__spriteSheetSmoke?.getSnapshot())
    return snapshot?.frameCount === 2 && snapshot.playback.fps >= 9 && snapshot.playback.fps <= 11 ? snapshot : null
  })

  await window.evaluate(async () => {
    const bridge = globalThis.__spriteSheetSmoke
    if (!bridge) {
      throw new Error('Smoke bridge is unavailable before GIF export.')
    }
    await bridge.exportGif()
  })

  await waitFor(async () => {
    const stat = await fs.stat(gifOutputPath).catch(() => null)
    return stat && stat.size > 0 ? stat : null
  })

  await window.evaluate(async (inputPath) => {
    const bridge = globalThis.__spriteSheetSmoke
    if (!bridge) {
      throw new Error('Smoke bridge is unavailable before roundtrip GIF import.')
    }
    await bridge.importPaths([inputPath])
  }, gifOutputPath)

  const finalSnapshot = await waitFor(async () => {
    const snapshot = await window.evaluate(() => window.__spriteSheetSmoke?.getSnapshot())
    return snapshot?.frameCount === 2 && snapshot.playback.fps >= 9 && snapshot.playback.fps <= 11 ? snapshot : null
  })

  await app.close()
  app = await launchApp()
  window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await window.locator('button[title="设置"]').click()
  await window.locator('.settings-modal-card').waitFor({ state: 'visible' })

  const persistedDelay = await window.locator('.settings-modal-card input[type="number"]').inputValue()
  const persistedFixedMode = await window.locator('.settings-modal-card select').inputValue()
  if (persistedDelay !== '420' || persistedFixedMode !== 'both') {
    throw new Error('Persisted UI preferences did not survive relaunch.')
  }

  console.log(
    `Electron regression passed: auto-detect ${autoDetectSnapshot.sheet.rows}x${autoDetectSnapshot.sheet.columns}, drawer/settings/export regressions, GIF roundtrip ${finalSnapshot.frameCount} frames @ ${finalSnapshot.playback.fps} FPS.`
  )
} finally {
  await app.close().catch(() => {})
}
