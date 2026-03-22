import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import pngToIco from 'png-to-ico'
import sharp from 'sharp'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')
const buildDir = path.join(repoRoot, 'build')
const sourceSvgPath = path.join(buildDir, 'icon.svg')

const svgBuffer = await readFile(sourceSvgPath)
const iconSizes = [16, 24, 32, 48, 64, 128, 256]

await mkdir(buildDir, { recursive: true })

const icoInputs = []

for (const size of iconSizes) {
  const outputPath = path.join(buildDir, `icon-${size}.png`)
  const buffer = await sharp(svgBuffer)
    .resize(size, size)
    .png()
    .toBuffer()

  icoInputs.push(buffer)
  await writeFile(outputPath, buffer)
}

const iconPng = await sharp(svgBuffer)
  .resize(512, 512)
  .png()
  .toBuffer()

await writeFile(path.join(buildDir, 'icon.png'), iconPng)

const iconIco = await pngToIco(icoInputs)
await writeFile(path.join(buildDir, 'icon.ico'), iconIco)
await writeFile(path.join(buildDir, 'installerIcon.ico'), iconIco)
await writeFile(path.join(buildDir, 'uninstallerIcon.ico'), iconIco)

console.log('Generated application icons in build/.')
