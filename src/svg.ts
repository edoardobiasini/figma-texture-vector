// Traced layers → one SVG document. Pure, so the tests and the Bridge harness build exactly
// the SVG the plugin would.

import { loopsBounds, loopsToPathData, type Loop } from './trace.ts'
import type { Region } from './protocol.ts'

export interface TracedLayer {
  loops: Loop[]
  /** Raster pixels per output unit. */
  sx: number
  sy: number
  /** Where the raster sits, relative to the source's bounding box origin. */
  region: Region
  fill: string
  opacity: number
}

export interface Assembled {
  svg: string
  /** Where the SVG's origin sits relative to the source's bounding box origin. */
  offset: { x: number; y: number }
  /** A layer name per <path>, in document order. */
  names: string[]
  points: number
}

const round = (v: number): number => Math.round(v * 100) / 100

/**
 * A clipping frame keeps its own box; anything else grows to whatever the texture pushed
 * out past the bounding box, rounded out to whole pixels.
 */
export function assemble(
  traced: (TracedLayer | undefined)[],
  box: { width: number; height: number; clip: boolean },
  smooth: boolean,
): Assembled | null {
  const layers = traced.filter((l): l is TracedLayer => !!l && l.loops.length > 0)
  if (!layers.length) return null

  let minX = 0, minY = 0, maxX = box.width, maxY = box.height
  if (!box.clip) {
    for (const l of layers) {
      const b = loopsBounds(l.loops)!
      minX = Math.min(minX, l.region.x + b.minX / l.sx)
      minY = Math.min(minY, l.region.y + b.minY / l.sy)
      maxX = Math.max(maxX, l.region.x + b.maxX / l.sx)
      maxY = Math.max(maxY, l.region.y + b.maxY / l.sy)
    }
    minX = Math.floor(minX)
    minY = Math.floor(minY)
    maxX = Math.ceil(maxX)
    maxY = Math.ceil(maxY)
  }
  const width = round(maxX - minX)
  const height = round(maxY - minY)

  let points = 0
  const names: string[] = []
  const paths = layers.map((l) => {
    points += l.loops.reduce((n, loop) => n + loop.length, 0)
    const d = loopsToPathData(l.loops, { sx: l.sx, sy: l.sy, ox: l.region.x - minX, oy: l.region.y - minY }, smooth)
    const opacity = l.opacity < 1 ? ` fill-opacity="${l.opacity}"` : ''
    names.push(l.opacity < 1 ? `${l.fill} ${Math.round(l.opacity * 100)}%` : l.fill)
    return `<path fill="${l.fill}"${opacity} fill-rule="evenodd" d="${d}"/>`
  })
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none">\n` +
    paths.join('\n') +
    '\n</svg>\n'
  return { svg, offset: { x: minX, y: minY }, names, points }
}
