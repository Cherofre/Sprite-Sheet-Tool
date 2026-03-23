import { rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')

const targets = [
  path.join(repoRoot, 'out'),
  path.join(repoRoot, 'release', 'win-unpacked')
]

for (const target of targets) {
  await rm(target, {
    force: true,
    recursive: true
  }).catch(() => undefined)
}

console.log(`Cleaned build artifacts: ${targets.map((target) => path.relative(repoRoot, target)).join(', ')}`)
