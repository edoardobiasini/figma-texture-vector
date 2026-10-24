// Raster → vector. Pure functions, no DOM and no figma global, so the same file runs in
// the plugin UI and under `node --experimental-strip-types` for the tests.
//
// The input is the alpha channel of a PNG Figma rendered itself — texture included — so
// what comes out is Figma's own look, not an imitation of its noise.

export type Point = [number, number]
export type Loop = Point[]

export interface TraceOptions {
  /** Iso level as a fraction of full alpha. 0.5 puts the edge where coverage is half. */
  threshold: number
  /** Ramer–Douglas–Peucker tolerance, in raster pixels. 0 keeps every point. */
  simplify: number
  /** Loops enclosing less than this many square raster pixels are dropped (specks). */
  minArea: number
}

export const defaultTraceOptions: TraceOptions = { threshold: 0.5, simplify: 0.3, minArea: 4 }

/**
 * Marching squares over a coverage channel (one byte per pixel), linearly interpolated so the
 * edges land between pixel centres instead of on the pixel grid — no staircase. Returns
 * closed loops in raster coordinates (pixel (x, y) spans [x, x+1] × [y, y+1]).
 *
 * Loops are unoriented: outer boundaries and holes come out in whatever direction the walk
 * found them, so render them with fill-rule evenodd.
 */
export function traceAlpha(
  alpha: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  options: Partial<TraceOptions> = {},
): Loop[] {
  const opts = { ...defaultTraceOptions, ...options }
  // A one-sample transparent border closes every contour that touches the image edge.
  const gw = width + 2
  const gh = height + 2
  const field = new Float32Array(gw * gh)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      field[(y + 1) * gw + (x + 1)] = alpha[y * width + x]
    }
  }
  const iso = opts.threshold * 255

  // Edge ids: horizontal edge from grid point (i, j) to (i+1, j) is 2·(j·gw+i); the
  // vertical one from (i, j) to (i, j+1) is that plus one.
  const points = new Map<number, Point>()
  const segA: number[] = []
  const segB: number[] = []

  const edgePoint = (id: number): void => {
    if (points.has(id)) return
    const base = id >> 1
    const i = base % gw
    const j = (base - i) / gw
    const va = field[base]
    const vb = (id & 1) === 0 ? field[base + 1] : field[base + gw]
    const t = (iso - va) / (vb - va)
    // Grid point (i, j) is the centre of pixel (i-1, j-1), i.e. raster (i-0.5, j-0.5).
    points.set(id, (id & 1) === 0 ? [i - 0.5 + t, j - 0.5] : [i - 0.5, j - 0.5 + t])
  }
  const segment = (a: number, b: number): void => {
    edgePoint(a)
    edgePoint(b)
    segA.push(a)
    segB.push(b)
  }

  for (let j = 0; j < gh - 1; j++) {
    for (let i = 0; i < gw - 1; i++) {
      const p = j * gw + i
      const tl = field[p] >= iso ? 8 : 0
      const tr = field[p + 1] >= iso ? 4 : 0
      const br = field[p + gw + 1] >= iso ? 2 : 0
      const bl = field[p + gw] >= iso ? 1 : 0
      const kind = tl | tr | br | bl
      if (kind === 0 || kind === 15) continue

      const top = 2 * p
      const bottom = 2 * (p + gw)
      const left = 2 * p + 1
      const right = 2 * (p + 1) + 1

      switch (kind) {
        case 1: case 14: segment(left, bottom); break
        case 2: case 13: segment(bottom, right); break
        case 3: case 12: segment(left, right); break
        case 4: case 11: segment(top, right); break
        case 6: case 9: segment(top, bottom); break
        case 7: case 8: segment(left, top); break
        case 5: case 10: {
          // Saddle: the cell centre decides whether the two inside corners connect.
          const centreInside = (field[p] + field[p + 1] + field[p + gw] + field[p + gw + 1]) / 4 >= iso
          // 5 = tr+bl inside, 10 = tl+br inside. Connected diagonal → cut the other two corners.
          const cutTlBr = (kind === 5) === centreInside
          if (cutTlBr) {
            segment(left, top)
            segment(bottom, right)
          } else {
            segment(top, right)
            segment(left, bottom)
          }
          break
        }
      }
    }
  }

  // Every edge on a closed iso-line is shared by exactly two segments: walk them into loops.
  const byEdge = new Map<number, number[]>()
  for (let s = 0; s < segA.length; s++) {
    for (const e of [segA[s], segB[s]]) {
      const list = byEdge.get(e)
      if (list) list.push(s)
      else byEdge.set(e, [s])
    }
  }

  const used = new Uint8Array(segA.length)
  const loops: Loop[] = []
  for (let start = 0; start < segA.length; start++) {
    if (used[start]) continue
    used[start] = 1
    const first = segA[start]
    const loop: Loop = [points.get(first)!]
    let edge = segB[start]
    let seg = start
    while (edge !== first) {
      loop.push(points.get(edge)!)
      const pair = byEdge.get(edge)!
      const next = pair[0] === seg ? pair[1] : pair[0]
      if (next === undefined || used[next]) break
      used[next] = 1
      edge = segA[next] === edge ? segB[next] : segA[next]
      seg = next
    }
    if (loop.length >= 3 && Math.abs(signedArea(loop)) >= opts.minArea) {
      loops.push(opts.simplify > 0 ? simplifyClosed(loop, opts.simplify) : loop)
    }
  }
  return loops.filter((l) => l.length >= 3)
}

export function signedArea(loop: Loop): number {
  let a = 0
  for (let k = 0, n = loop.length; k < n; k++) {
    const [x1, y1] = loop[k]
    const [x2, y2] = loop[(k + 1) % n]
    a += x1 * y2 - x2 * y1
  }
  return a / 2
}

/** Ramer–Douglas–Peucker on a closed loop, split at the two mutually farthest-ish points. */
export function simplifyClosed(loop: Loop, tolerance: number): Loop {
  const n = loop.length
  if (n < 4) return loop
  let far = 0
  let best = -1
  for (let k = 1; k < n; k++) {
    const d = (loop[k][0] - loop[0][0]) ** 2 + (loop[k][1] - loop[0][1]) ** 2
    if (d > best) { best = d; far = k }
  }
  const keep = new Uint8Array(n)
  keep[0] = 1
  keep[far] = 1
  rdp(loop, 0, far, tolerance * tolerance, keep)
  rdp(loop, far, n, tolerance * tolerance, keep)
  const out: Loop = []
  for (let k = 0; k < n; k++) if (keep[k]) out.push(loop[k])
  return out
}

// Iterative so a long, wiggly loop cannot blow the stack. `to` may equal loop.length,
// standing for index 0 again (the loop closes on itself).
function rdp(loop: Loop, from: number, to: number, tol2: number, keep: Uint8Array): void {
  const n = loop.length
  const stack: [number, number][] = [[from, to]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    if (b - a < 2) continue
    const [ax, ay] = loop[a]
    const [bx, by] = loop[b % n]
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    let worst = -1
    let index = -1
    for (let k = a + 1; k < b; k++) {
      const [px, py] = loop[k]
      let d: number
      if (len2 === 0) {
        d = (px - ax) ** 2 + (py - ay) ** 2
      } else {
        const cross = (px - ax) * dy - (py - ay) * dx
        d = (cross * cross) / len2
      }
      if (d > worst) { worst = d; index = k }
    }
    if (worst > tol2) {
      keep[index] = 1
      stack.push([a, index], [index, b])
    }
  }
}

export interface PathTransform {
  /** Raster pixels per output unit, per axis. */
  sx: number
  sy: number
  /** Output coordinates of raster (0, 0). */
  ox: number
  oy: number
}

/** Shortest SVG spelling of q / 10^decimals: no leading zero, nothing trailing. */
function compact(q: number, f: number): string {
  const s = String(q / f)
  if (s.startsWith('0.')) return s.slice(1)
  if (s.startsWith('-0.')) return '-' + s.slice(2)
  return s
}

/**
 * SVG path data for a set of loops, mapped from raster to output units. With `smooth`,
 * each loop becomes a closed Catmull-Rom spline written as cubic Béziers — it passes
 * through every kept point, so it cannot drift from the trace by more than a fraction of
 * the simplify tolerance. Without it, straight segments: a third of the size, and at the
 * default tolerance the facets are a few hundredths of a pixel off the curve.
 *
 * Written relative and minified, since a textured outline is thousands of tiny steps:
 * coordinates are first snapped to a 10^-decimals grid and the deltas taken between
 * snapped values, so rounding cannot accumulate along a loop.
 */
export function loopsToPathData(loops: Loop[], t: PathTransform, smooth: boolean, decimals = 2): string {
  const f = 10 ** decimals
  const qx = (x: number): number => Math.round((x / t.sx + t.ox) * f)
  const qy = (y: number): number => Math.round((y / t.sy + t.oy) * f)
  const parts: string[] = []
  for (const loop of loops) {
    const n = loop.length
    const xs = loop.map((p) => qx(p[0]))
    const ys = loop.map((p) => qy(p[1]))
    let d = 'M'
    let fresh = true
    // A minus sign separates numbers on its own; after a command letter nothing is needed.
    const put = (q: number): void => {
      const s = compact(q, f)
      d += fresh || s[0] === '-' ? s : ' ' + s
      fresh = false
    }
    put(xs[0])
    put(ys[0])
    if (!smooth || n < 4) {
      d += 'l'
      fresh = true
      for (let k = 1; k < n; k++) {
        put(xs[k] - xs[k - 1])
        put(ys[k] - ys[k - 1])
      }
    } else {
      d += 'c'
      fresh = true
      for (let k = 0; k < n; k++) {
        const p0 = loop[(k - 1 + n) % n]
        const p1 = loop[k]
        const p2 = loop[(k + 1) % n]
        const p3 = loop[(k + 2) % n]
        const x = xs[k], y = ys[k]
        put(qx(p1[0] + (p2[0] - p0[0]) / 6) - x)
        put(qy(p1[1] + (p2[1] - p0[1]) / 6) - y)
        put(qx(p2[0] - (p3[0] - p1[0]) / 6) - x)
        put(qy(p2[1] - (p3[1] - p1[1]) / 6) - y)
        put(xs[(k + 1) % n] - x)
        put(ys[(k + 1) % n] - y)
      }
    }
    parts.push(d + 'z')
  }
  return parts.join('')
}

/** Bounding box of loops in raster coordinates, or null when there are none. */
export function loopsBounds(loops: Loop[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const loop of loops) {
    for (const [x, y] of loop) {
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY }
}
