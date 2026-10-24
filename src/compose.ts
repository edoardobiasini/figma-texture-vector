// Per-colour renders → traced layers. Pure, shared by the UI and the Bridge test.
//
// The sandbox already merges paints of one colour into one render when their bounding boxes
// allow it, but boxes are blunt: a leaf's outline and the opposite leaf's fill share a box
// around the stem without sharing a single pixel. Here the actual pixels decide, so an icon
// drawn in two colours usually comes out as two paths.

import { traceAlpha } from './trace.ts'
import type { TracedLayer } from './svg.ts'
import type { Region } from './protocol.ts'

export interface Raster {
  /** Coverage, one byte per pixel. Every raster of a job has the same size and region. */
  alpha: Uint8Array | Uint8ClampedArray
  width: number
  height: number
  region: Region
  fill: string
  opacity: number
  /** See `Mode` in document.ts: `ink` renders are cumulative, each one contains those above it. */
  mode: 'alpha' | 'ink'
}

/** Coverage from a decoded RGBA render: its alpha, or for ink renders how black it is. */
export function coverage(rgba: Uint8Array | Uint8ClampedArray, mode: Raster['mode']): Uint8Array {
  const out = new Uint8Array(rgba.length / 4)
  if (mode === 'alpha') {
    for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4 + 3]
  } else {
    // Black ink on opaque white paper, unpremultiplied: red alone tells them apart.
    for (let i = 0; i < out.length; i++) out[i] = Math.round((rgba[i * 4 + 3] * (255 - rgba[i * 4])) / 255)
  }
  return out
}

/** Below this coverage two renders count as not touching: a faint antialiased fringe. */
const TOUCH = 32

interface Box { x0: number; y0: number; x1: number; y1: number }

function contentBox(r: Raster): Box | null {
  let x0 = r.width, y0 = r.height, x1 = -1, y1 = -1
  for (let y = 0; y < r.height; y++) {
    const row = y * r.width
    for (let x = 0; x < r.width; x++) {
      if (r.alpha[row + x] > TOUCH) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        y1 = y
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 }
}

/** Only the overlap of the two content boxes is scanned: most pairs never get that far. */
function touches(a: Raster, boxA: Box | null, b: Raster, boxB: Box | null): boolean {
  if (!boxA || !boxB) return false
  const x0 = Math.max(boxA.x0, boxB.x0), x1 = Math.min(boxA.x1, boxB.x1)
  const y0 = Math.max(boxA.y0, boxB.y0), y1 = Math.min(boxA.y1, boxB.y1)
  for (let y = y0; y <= y1; y++) {
    for (let i = y * a.width + x0, end = y * a.width + x1; i <= end; i++) {
      if (a.alpha[i] > TOUCH && b.alpha[i] > TOUCH) return true
    }
  }
  return false
}

const union = (a: Box | null, b: Box | null): Box | null =>
  !a ? b : !b ? a : { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }

/**
 * Bottom-to-top renders in, fewer renders out, same picture.
 *
 * Alpha renders: one may join an earlier render of the same colour and opacity only by
 * sliding under renders it does not touch. Joined renders are combined pixel-wise (max),
 * not as paths: two overlapping paths of one colour under evenodd would punch a hole
 * where they overlap.
 *
 * Ink renders are cumulative, so a render directly above one of the same colour adds
 * nothing to the picture and is dropped; anything else stays.
 */
export function mergeRasters(rasters: Raster[]): Raster[] {
  const out: Raster[] = []
  const boxes: (Box | null)[] = []
  for (const r of rasters) {
    const same = (k: number): boolean => out[k].fill === r.fill && out[k].opacity === r.opacity
    if (r.mode === 'ink') {
      if (!out.length || !same(out.length - 1)) out.push(r)
      continue
    }
    const box = contentBox(r)
    let target = -1
    for (let k = out.length - 1; k >= 0; k--) {
      if (same(k)) { target = k; break }
      if (touches(out[k], boxes[k], r, box)) break
    }
    if (target < 0) {
      out.push({ ...r, alpha: Uint8Array.from(r.alpha) })
      boxes.push(box)
    } else {
      const a = out[target].alpha
      for (let i = 0; i < a.length; i++) if (r.alpha[i] > a[i]) a[i] = r.alpha[i]
      boxes[target] = union(boxes[target], box)
    }
  }
  return out
}

export interface TraceSettings {
  /** Design pixels. */
  simplify: number
  /** Square design pixels. */
  minArea: number
}

export function traceRasters(rasters: Raster[], settings: TraceSettings): TracedLayer[] {
  return rasters.map((r) => {
    const sx = r.width / r.region.width
    const sy = r.height / r.region.height
    const loops = traceAlpha(r.alpha, r.width, r.height, {
      simplify: settings.simplify * sx,
      minArea: settings.minArea * sx * sy,
    })
    return { loops, sx, sy, region: r.region, fill: r.fill, opacity: r.opacity }
  })
}
