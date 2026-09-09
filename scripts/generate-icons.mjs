// One-off dev tool: rasterizes public/app-icon*.svg into the PNG sizes the PWA
// manifest and apple-touch-icon need. Run with: node scripts/generate-icons.mjs
import sharp from 'sharp'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public')

const jobs = [
  { src: 'app-icon.svg', out: 'icon-192.png', size: 192 },
  { src: 'app-icon.svg', out: 'icon-512.png', size: 512 },
  { src: 'app-icon.svg', out: 'apple-touch-icon.png', size: 180 },
  { src: 'app-icon-maskable.svg', out: 'icon-maskable-512.png', size: 512 },
]

for (const job of jobs) {
  await sharp(path.join(publicDir, job.src), { density: 384 })
    .resize(job.size, job.size)
    .png()
    .toFile(path.join(publicDir, job.out))
  console.log(`wrote ${job.out}`)
}
