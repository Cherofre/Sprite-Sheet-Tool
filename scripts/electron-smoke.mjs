import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { _electron as electron } from 'playwright'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')
const buildEntry = path.join(repoRoot, 'out', 'main', 'index.js')
const fixtureDirectory = path.join(repoRoot, 'tmp', 'smoke-input')
const exportDirectory = path.join(repoRoot, 'tmp', 'smoke-output')
const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg=='

const waitFor = async (predicate, timeoutMs = 8000, intervalMs = 150) => {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) {
      return
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  throw new Error('Timed out while waiting for the smoke condition to pass.')
}

await fs.rm(fixtureDirectory, { force: true, recursive: true })
await fs.rm(exportDirectory, { force: true, recursive: true })
await fs.mkdir(fixtureDirectory, { recursive: true })
await fs.mkdir(exportDirectory, { recursive: true })

for (let index = 1; index <= 3; index += 1) {
  const filePath = path.join(fixtureDirectory, `frame_${index}.png`)
  await fs.writeFile(filePath, Buffer.from(pngBase64, 'base64'))
}

const app = await electron.launch({
  args: [buildEntry],
  env: {
    ...process.env,
    ELECTRON_RENDERER_URL: '',
    SPRITE_SHEET_CHOOSE_DIRECTORY: exportDirectory
  }
})

try {
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  await window.waitForFunction(() => Boolean(window.__spriteSheetSmoke))
  await window.evaluate(async ({ base64, names }) => {
    const toBytes = (input) => Uint8Array.from(atob(input), (char) => char.charCodeAt(0))
    const files = names.map((name) => new File([toBytes(base64)], name, { type: 'image/png' }))
    const dataTransfer = new window.DataTransfer()
    files.forEach((file) => dataTransfer.items.add(file))

    window.dispatchEvent(new window.DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer }))
    const dropTarget = window.document.querySelector('.empty-workspace-drop')
    if (!(dropTarget instanceof window.HTMLElement)) {
      throw new Error('Smoke could not find the empty workspace drop zone.')
    }

    dropTarget.dispatchEvent(new window.DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }))
    dropTarget.dispatchEvent(new window.DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }))
  }, { base64: pngBase64, names: ['frame_1.png', 'frame_2.png', 'frame_3.png'] })

  try {
    await waitFor(async () => (await window.locator('.timeline-card').count()) === 3)
  } catch (error) {
    const bodyText = await window.locator('body').innerText()
    console.error('Smoke import body snapshot:\n', bodyText)
    throw error
  }

  await waitFor(async () => (await window.locator('.drop-overlay').count()) === 0)

  await waitFor(async () => {
    const bodyText = await window.locator('body').innerText()
    return bodyText.includes('2/3') || bodyText.includes('3/3')
  })

  await window.keyboard.press('Space')
  await window.locator('.play-action-btn').getByText('播放').waitFor({ timeout: 8000 })
  await window.keyboard.press('Space')
  await window.locator('.play-action-btn').getByText('暂停').waitFor({ timeout: 8000 })

  await window.evaluate(async () => {
    await window.__spriteSheetSmoke.exportSequence()
  })
  await waitFor(async () => {
    const entries = await fs.readdir(exportDirectory)
    return entries.filter((entry) => entry.endsWith('.png')).length === 3
  })

  console.log('Electron smoke passed: drag-drop import, playback, and sequence export succeeded.')
} finally {
  await app.close()
}
