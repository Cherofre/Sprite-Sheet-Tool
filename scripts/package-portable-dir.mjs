import { execFile } from 'node:child_process'
import { cp, readFile, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')
const releaseDir = path.join(repoRoot, 'release')
const unpackedDir = path.join(releaseDir, 'win-unpacked')
const packageJsonPath = path.join(repoRoot, 'package.json')

const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
const productName = packageJson.build?.productName ?? 'Sprite Sheet Tool'
const version = packageJson.version
const sanitizeArtifactName = (value) =>
  value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

const artifactBaseName = sanitizeArtifactName(productName)
const portableDirName = `${artifactBaseName}-${version}-portable-dir`
const portableDirPath = path.join(releaseDir, portableDirName)
const portableZipPath = path.join(releaseDir, `${portableDirName}.zip`)

await stat(unpackedDir)

await rm(portableDirPath, { force: true, recursive: true }).catch(() => undefined)
await rm(portableZipPath, { force: true }).catch(() => undefined)

await cp(unpackedDir, portableDirPath, {
  recursive: true
})

await execFileAsync(
  'powershell.exe',
  [
    '-NoProfile',
    '-Command',
    "Compress-Archive -LiteralPath $env:SPRITE_PORTABLE_SOURCE -DestinationPath $env:SPRITE_PORTABLE_ZIP -CompressionLevel Optimal -Force"
  ],
  {
    env: {
      ...process.env,
      SPRITE_PORTABLE_SOURCE: portableDirPath,
      SPRITE_PORTABLE_ZIP: portableZipPath
    },
    windowsHide: true
  }
)

console.log(`Packaged portable directory: ${path.relative(repoRoot, portableDirPath)}`)
console.log(`Packaged portable zip: ${path.relative(repoRoot, portableZipPath)}`)
