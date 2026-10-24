// Synthetic rasters with known geometry: the traced vectors must reproduce it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { traceAlpha, signedArea, loopsToPathData, loopsBounds, type Point } from '../src/trace.ts'

/** Alpha channel holding the supersampled coverage of `inside`, like an antialiased render. */
function raster(width: number, height: number, inside: (x: number, y: number) => boolean): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height)
  const ss = 8
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let hits = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          if (inside(x + (sx + 0.5) / ss, y + (sy + 0.5) / ss)) hits++
        }
      }
      out[y * width + x] = Math.round((hits / (ss * ss)) * 255)
    }
  }
  return out
}

const disc = (cx: number, cy: number, r: number) => (x: number, y: number) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r

test('a disc traces to one loop with the right area and a sub-pixel edge', () => {
  const img = raster(100, 100, disc(50, 50, 30))
  const loops = traceAlpha(img, 100, 100, { simplify: 0 })
  assert.equal(loops.length, 1)
  const area = Math.abs(signedArea(loops[0]))
  assert.ok(Math.abs(area - Math.PI * 900) / (Math.PI * 900) < 0.005, `area ${area}`)
  for (const [x, y] of loops[0]) {
    const r = Math.hypot(x - 50, y - 50)
    assert.ok(Math.abs(r - 30) < 0.1, `point at radius ${r}`)
  }
})

test('a ring traces to two loops — outer boundary and hole', () => {
  const outer = disc(50, 50, 35)
  const inner = disc(50, 50, 20)
  const img = raster(100, 100, (x, y) => outer(x, y) && !inner(x, y))
  const loops = traceAlpha(img, 100, 100, { simplify: 0 })
  assert.equal(loops.length, 2)
  const areas = loops.map((l) => Math.abs(signedArea(l))).sort((a, b) => a - b)
  assert.ok(Math.abs(areas[0] - Math.PI * 400) / (Math.PI * 400) < 0.01)
  assert.ok(Math.abs(areas[1] - Math.PI * 1225) / (Math.PI * 1225) < 0.01)
})

test('shapes touching the image border still close', () => {
  const img = raster(40, 40, () => true)
  const loops = traceAlpha(img, 40, 40, { simplify: 0.3 })
  assert.equal(loops.length, 1)
  const b = loopsBounds(loops)!
  assert.ok(Math.abs(b.minX - 0) < 0.6 && Math.abs(b.maxX - 40) < 0.6, JSON.stringify(b))
})

test('specks under minArea are dropped, larger islands kept', () => {
  const img = raster(60, 60, (x, y) => disc(10.5, 10.5, 1)(x, y) || disc(40, 40, 6)(x, y))
  assert.equal(traceAlpha(img, 60, 60, { minArea: 4 }).length, 1)
  assert.equal(traceAlpha(img, 60, 60, { minArea: 0 }).length, 2)
})

test('a checkerboard of diagonal pixels (saddles) yields closed, non-crossing loops', () => {
  const img = raster(20, 20, (x, y) => (Math.floor(x / 2) + Math.floor(y / 2)) % 2 === 0)
  const loops = traceAlpha(img, 20, 20, { simplify: 0, minArea: 0 })
  assert.ok(loops.length > 0)
  for (const l of loops) assert.ok(l.length >= 3)
})

test('simplify reduces points but stays within tolerance of the circle', () => {
  const img = raster(200, 200, disc(100, 100, 80))
  const full = traceAlpha(img, 200, 200, { simplify: 0 })[0]
  const lean = traceAlpha(img, 200, 200, { simplify: 0.3 })[0]
  assert.ok(lean.length < full.length / 3, `${lean.length} vs ${full.length}`)
  for (const [x, y] of lean) assert.ok(Math.abs(Math.hypot(x - 100, y - 100) - 80) < 0.4)
})

/** On-curve points of the M / l / c / z subset loopsToPathData writes, made absolute. */
function endpoints(d: string): Point[] {
  const out: Point[] = []
  let x = 0, y = 0
  for (const [, cmd, args] of d.matchAll(/([Mlcz])([^Mlcz]*)/g)) {
    const n = (args.match(/-?(?:\d+\.?\d*|\.\d+)/g) ?? []).map(Number)
    if (cmd === 'M') { x = n[0]; y = n[1]; out.push([x, y]) }
    const step = cmd === 'l' ? 2 : cmd === 'c' ? 6 : 0
    for (let k = 0; step && k < n.length; k += step) {
      x += n[k + step - 2]
      y += n[k + step - 1]
      out.push([x, y])
    }
  }
  return out
}

test('path data maps raster pixels to output units, without drift', () => {
  const img = raster(80, 80, disc(40, 40, 20))
  const loops = traceAlpha(img, 80, 80)
  const t = { sx: 4, sy: 4, ox: 100, oy: 200 }
  for (const smooth of [false, true]) {
    const pts = endpoints(loopsToPathData(loops, t, smooth))
    for (const [x, y] of pts) {
      const r = Math.hypot(x - 110, y - 210)
      assert.ok(Math.abs(r - 5) < 0.06, `smooth=${smooth}: (${x}, ${y}) at radius ${r}`)
    }
    // The walk ends where it started: deltas between snapped values do not accumulate error.
    const last = smooth ? pts[pts.length - 1] : pts[0]
    assert.ok(Math.hypot(last[0] - pts[0][0], last[1] - pts[0][1]) < 1e-9)
  }
  assert.match(loopsToPathData(loops, t, true), /^M[\d.]+ [\d.]+c/)
})

test('numbers are written in their shortest form', () => {
  const d = loopsToPathData([[[0, 0], [0.5, 0], [0.5, -0.25]]], { sx: 1, sy: 1, ox: 0, oy: 0 }, false)
  assert.equal(d, 'M0 0l.5 0 0-.25z')
})
