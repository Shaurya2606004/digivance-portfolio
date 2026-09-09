#!/usr/bin/env node
/*
 * Re-encodes the scrub clips into a two-tier ladder.
 *
 * The original desktop clips were all-intra (every frame a keyframe), which is
 * why a single 8s shot cost 12.7 MB and the whole desktop journey cost 131 MB.
 * On desktop a short GOP seeks just as well for a fraction of the bytes.
 *
 * Phones are the exception. A scrub assigns `currentTime` every frame, and on
 * iOS every seek that lands off a keyframe has to decode forward from the
 * preceding one -- with B-frames, out of order. At GOP 6 that is up to five
 * dependent frames of work on every draw: a fixed cost that shows up as
 * constant micro-stutter from first paint, never worsening, never absent. The
 * mobile targets are therefore all-intra (`-g 1 -bf 0`) so a seek is one
 * decode, and carry a higher CRF to pay for it.
 *
 * Each viewport gets an `hd` tier and a `lite` tier. The lite tier is what a
 * slow connection actually downloads, and it is roughly a tenth of the size.
 *
 *   node scripts/encode-media.mjs            # encode everything
 *   node scripts/encode-media.mjs --only dive-01
 *   node scripts/encode-media.mjs --dry-run
 */
import { execFile } from 'node:child_process'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const root = path.resolve(import.meta.dirname, '..')
const publicDir = path.join(root, 'public', 'assets')
const backupDir = path.join(root, '.asset-originals')

// Shared across every encode. `-g` and `-bf` are set per target.
const BASE = [
  '-an',
  '-c:v', 'libx264',
  '-profile:v', 'high',
  '-pix_fmt', 'yuv420p',
  '-preset', 'slow',
  '-sc_threshold', '0',
  '-movflags', '+faststart',
]

/*
 * A light denoise before scaling. The clips carry render grain that costs a
 * surprising number of bits and is invisible under the stage's own grain
 * overlay, so removing it is free quality.
 */
const targets = [
  {
    id: 'desktop-hd',
    from: 'video',
    to: 'video',
    filter: 'hqdn3d=2:1.5:4:4,scale=1600:-2:flags=lanczos',
    crf: 25,
    gop: 8,
    bf: 2,
  },
  {
    id: 'desktop-lite',
    from: 'video',
    to: 'video-lite',
    filter: 'hqdn3d=3:2:6:6,scale=960:-2:flags=lanczos',
    crf: 28,
    gop: 8,
    bf: 2,
  },
  {
    id: 'mobile-hd',
    from: 'video-mobile',
    to: 'video-mobile',
    filter: 'hqdn3d=2:1.5:4:4,scale=720:-2:flags=lanczos',
    crf: 31,
    gop: 1,
    bf: 0,
  },
  {
    id: 'mobile-lite',
    from: 'video-mobile',
    to: 'video-mobile-lite',
    // 360px is enough for a portrait phone viewport and cuts the full-chain
    // preload by roughly half again without changing the native composition.
    filter: 'hqdn3d=3:2:6:6,scale=360:-2:flags=lanczos',
    crf: 28,
    gop: 1,
    bf: 0,
  },
]

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const onlyIndex = args.indexOf('--only')
const only = onlyIndex === -1 ? null : args[onlyIndex + 1]
const targetsIndex = args.indexOf('--targets')
const selected =
  targetsIndex === -1 ? null : args[targetsIndex + 1].split(',').map((id) => id.trim())

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`
const sizeOf = async (file) => (await stat(file)).size

/*
 * The clips in public/ are the canonical timed cuts, so they are the encode
 * source. They are moved aside on the first run and every later run reads from
 * the backup, which keeps repeat encodes from stacking generation loss.
 */
async function resolveSource(dir) {
  const backup = path.join(backupDir, dir)
  if (existsSync(backup)) return backup

  const live = path.join(publicDir, dir)
  console.log(`  archiving originals -> .asset-originals/${dir}`)
  if (!dryRun) {
    await mkdir(backupDir, { recursive: true })
    await run('node', [
      '-e',
      `require('fs').cpSync(${JSON.stringify(live)}, ${JSON.stringify(backup)}, { recursive: true })`,
    ])
  }
  return dryRun ? live : backup
}

async function encodeTarget(target) {
  const source = await resolveSource(target.from)
  const outDir = path.join(publicDir, target.to)

  const clips = (await readdir(source))
    .filter((name) => name.endsWith('.mp4'))
    .filter((name) => !only || name.includes(only))
    .sort()

  if (!clips.length) return { before: 0, after: 0 }

  console.log(`\n${target.id}: ${clips.length} clip(s) -> assets/${target.to}`)
  if (dryRun) return { before: 0, after: 0 }

  /*
   * Encoded straight into the destination. The source always reads from
   * .asset-originals, so writing in place cannot feed an output back into a
   * later run, and staging directories turned out to be unrenameable on
   * Windows once the encoder had just written into them.
   */
  await mkdir(outDir, { recursive: true })

  let before = 0
  let after = 0

  for (const name of clips) {
    const input = path.join(source, name)
    const output = path.join(outDir, name)
    await run('ffmpeg', [
      '-nostdin', '-v', 'error', '-y',
      '-i', input,
      '-vf', target.filter,
      ...BASE,
      '-crf', String(target.crf),
      '-g', String(target.gop),
      '-keyint_min', String(target.gop),
      '-bf', String(target.bf),
      output,
    ])

    const inSize = await sizeOf(input)
    const outSize = await sizeOf(output)
    before += inSize
    after += outSize
    console.log(
      `  ${name.padEnd(38)} ${mb(inSize).padStart(9)} -> ${mb(outSize).padStart(9)}` +
        `  (${(outSize / inSize * 100).toFixed(0)}%)`,
    )
  }

  // Posters live beside the clips and are copied through untouched.
  const posterSource = path.join(source, 'posters')
  if (existsSync(posterSource)) {
    await run('node', [
      '-e',
      `require('fs').cpSync(${JSON.stringify(posterSource)}, ${JSON.stringify(path.join(outDir, 'posters'))}, { recursive: true })`,
    ])
  }

  return { before, after }
}

let totalBefore = 0
let totalAfter = 0

for (const target of targets) {
  if (selected && !selected.includes(target.id)) continue
  const { before, after } = await encodeTarget(target)
  totalBefore += before
  totalAfter += after
}

if (totalBefore) {
  console.log(
    `\ntotal ${mb(totalBefore)} -> ${mb(totalAfter)} ` +
      `(${(totalAfter / totalBefore * 100).toFixed(0)}%)`,
  )
}
