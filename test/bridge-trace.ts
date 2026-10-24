// Trace per-colour renders exported over the Desktop Bridge, through the same compose →
// trace → assemble path the plugin UI runs, and write the SVG the plugin would insert.
//
//   node --experimental-strip-types test/bridge-trace.ts job.json out.svg
//
// job.json: { width, height, clip, region, smooth, simplify, minArea, mode?: "alpha" | "ink",
//             layers: [{ png: "/abs/path.png", fill: "#RRGGBB", opacity: 1 }, …] }
// PNG decoding goes through Python's Pillow, which Node lacks — test-only.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { coverage, mergeRasters, traceRasters, type Raster } from '../src/compose.ts'
import { assemble } from '../src/svg.ts'

const [jobPath, outPath] = process.argv.slice(2)
const job = JSON.parse(readFileSync(jobPath, 'utf8'))

const PY = 'import sys;from PIL import Image;i=Image.open(sys.argv[1]).convert("RGBA");sys.stdout.buffer.write(i.size[0].to_bytes(4,"big")+i.size[1].to_bytes(4,"big")+i.tobytes())'
const mode: Raster['mode'] = job.mode ?? 'alpha'

const rasters: Raster[] = job.layers.map((l: { png: string; fill: string; opacity: number }) => {
  const buf = execFileSync('python3', ['-I', '-c', PY, l.png], { maxBuffer: 1 << 28 })
  const width = buf.readUInt32BE(0)
  const height = buf.readUInt32BE(4)
  const alpha = coverage(new Uint8Array(buf.subarray(8)), mode)
  return { alpha, width, height, region: job.region, fill: l.fill, opacity: l.opacity, mode }
})

const t0 = performance.now()
const merged = mergeRasters(rasters)
const traced = traceRasters(merged, { simplify: job.simplify, minArea: job.minArea })
const out = assemble(traced, job, job.smooth)
if (!out) throw new Error('nothing traced')
writeFileSync(outPath, out.svg)
console.log(JSON.stringify({
  renders: rasters.length,
  paths: merged.length,
  fills: merged.map((m) => m.fill),
  loops: traced.map((t) => t.loops.length),
  points: out.points,
  bytes: out.svg.length,
  offset: out.offset,
  ms: Math.round(performance.now() - t0),
}))
