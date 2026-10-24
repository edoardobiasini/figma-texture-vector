// Everything that reads or changes the Figma document. No UI here, so the same functions
// run inside the plugin (code.ts) and from a test harness over the Desktop Bridge.
//
// Why a render and not the geometry: Figma's Texture is an SVG-style displacement filter
// (feTurbulence + feDisplacementMap — that is literally what its SVG export writes), so the
// textured outline exists only as pixels. Tracing Figma's own render is the one way to get
// vectors that match what the designer sees. Measured on Figma 126: the noise is anchored to
// the node (moving it, or growing its render bounds with a shadow, leaves the pattern
// unchanged) and it is scale-independent (a 4× render downsampled matches the 1× one), so a
// high-scale render is the same texture with more detail.

import type { BakeOptions, Region, SelectionItem } from './protocol.ts'

export const visibleTextures = (node: BaseNode): TextureEffect[] =>
  'effects' in node
    ? (node.effects as readonly Effect[]).filter((e): e is TextureEffect => e.type === 'TEXTURE' && e.visible)
    : []

// FigJam-only node types have no render bounds; everything this plugin traces does.
export const renderBounds = (node: BaseNode): Rect | null =>
  'absoluteRenderBounds' in node ? node.absoluteRenderBounds : null

export function walk(node: SceneNode, visit: (n: SceneNode) => void): void {
  visit(node)
  if ('children' in node) for (const child of node.children) walk(child, visit)
}

/** Plugin data marking a node this plugin created. */
const RESULT_KEY = 'result'

export function describe(node: SceneNode): SelectionItem {
  let textures = 0
  walk(node, (n) => { textures += visibleTextures(n).length })
  let ancestorTexture: string | null = null
  for (let p = node.parent; p && p.type !== 'PAGE' && p.type !== 'DOCUMENT'; p = p.parent) {
    if (visibleTextures(p).length) { ancestorTexture = p.name; break }
  }
  const box = renderBounds(node) ?? node.absoluteBoundingBox
  const isResult = node.getPluginData(RESULT_KEY) === '1'
  return { id: node.id, name: node.name, width: box?.width ?? 0, height: box?.height ?? 0, textures, ancestorTexture, isResult }
}

// ─── preparing the working copy ───────────────────────────────────────────────────────

/** One paint of one node, in painter's order. */
export interface Layer {
  node: SceneNode & MinimalFillsMixin & MinimalStrokesMixin
  kind: 'fills' | 'strokes'
  index: number
  fill: string
  opacity: number
  key: string
  bounds: Rect
}

const SOLID_INK: SolidPaint = { type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 1 }
// Transparent instead of removed: nothing about the node's geometry or bounds may change
// between the per-colour renders, or the layers would stop lining up.
const SOLID_NONE: SolidPaint = { type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 0 }
const SOLID_PAPER: SolidPaint = { type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 1 }

/**
 * How a colour is isolated for its render.
 *
 * - `alpha`: every other paint goes transparent and the render's alpha is the shape. Exact
 *   when the texture displaces the whole layer — the default Texture.
 * - `ink`: every paint stays, the colours being traced turn black and the rest opaque
 *   white, and coverage is read from the colour. Needed for Texture with "Clip to shape":
 *   Figma then keeps the outline smooth and roughens only the edges *between* colours
 *   inside it, so a colour rendered alone shows no texture at all. Renders are cumulative
 *   (this colour and everything above it), so the paths stack without seams.
 */
export type Mode = 'alpha' | 'ink'

const hex = (c: RGB): string =>
  '#' + [c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase()

/** Flat colour + opacity standing in for a paint in the vector output. */
function flatten(paint: Paint, warnings: Set<string>): { color: RGB; opacity: number } {
  const opacity = paint.opacity ?? 1
  if (paint.type === 'SOLID') return { color: paint.color, opacity }
  if (paint.type.startsWith('GRADIENT_') && 'gradientStops' in paint && paint.gradientStops.length) {
    warnings.add('Gradients are flattened to their first colour stop.')
    const stop = paint.gradientStops[0]
    return { color: { r: stop.color.r, g: stop.color.g, b: stop.color.b }, opacity: opacity * stop.color.a }
  }
  warnings.add('Image and video fills are traced as flat grey shapes.')
  return { color: { r: 0.5, g: 0.5, b: 0.5 }, opacity }
}

/**
 * Prepare the clone for isolated renders and list its visible paints bottom to top.
 * Node opacity goes to 1 (it would halve the alpha the tracer thresholds) and moves into
 * the layer's own opacity; effects other than Texture are switched off.
 */
function collect(node: SceneNode, inherited: number, isRoot: boolean, opts: BakeOptions, out: Layer[], warnings: Set<string>): void {
  if (!node.visible) return
  // A mask's paint decides what its siblings show; it is never drawn itself. Leave it alone.
  if ('isMask' in node && node.isMask) return

  let opacity = inherited
  if ('opacity' in node) {
    opacity *= node.opacity
    node.opacity = 1
  }
  if ('effects' in node && node.effects.length) {
    const effects = node.effects as readonly Effect[]
    if (effects.some((e) => e.visible && e.type !== 'TEXTURE')) {
      warnings.add('Shadows, blurs and Noise are not part of the vector output.')
      node.effects = effects.map((e) => (e.type === 'TEXTURE' ? e : { ...e, visible: false }))
    }
  }

  const paintable = 'fills' in node && 'strokes' in node
  const add = (kind: 'fills' | 'strokes'): void => {
    if (!paintable) return
    const target = node as Layer['node']
    let paints: readonly Paint[]
    if (kind === 'fills') {
      if (target.fills === figma.mixed) {
        warnings.add('Text with several fill colours takes the colour of its first character.')
        paints = (target as TextNode).getRangeFills(0, 1) as Paint[]
      } else {
        paints = target.fills
      }
      const frameLike = node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE'
      if (isRoot && frameLike && !opts.includeBackground) {
        target.fills = paints.map(() => SOLID_NONE)
        return
      }
    } else {
      paints = target.strokes
    }
    const bounds = renderBounds(node)
    paints.forEach((paint, index) => {
      if (!paint.visible || (paint.opacity ?? 1) === 0 || !bounds) return
      const flat = flatten(paint, warnings)
      const layerOpacity = Math.round(flat.opacity * opacity * 1000) / 1000
      const fill = hex(flat.color)
      out.push({ node: target, kind, index, fill, opacity: layerOpacity, key: `${fill}/${layerOpacity}`, bounds })
    })
  }

  // Booleans render as one shape: their children's paints are never drawn.
  const container = 'children' in node && node.type !== 'BOOLEAN_OPERATION'
  add('fills')
  if (container) {
    for (const child of (node as ChildrenMixin).children) collect(child, opacity, false, opts, out, warnings)
  }
  // Frame strokes paint above the frame's content; for a leaf the order is the same anyway.
  add('strokes')
}

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/**
 * Layers of one colour become one render, and so one path. A layer may join an earlier
 * group of its colour only by sliding under groups it does not touch, so the stacking of
 * everything that overlaps stays exactly as designed.
 */
function group(layers: Layer[]): Layer[][] {
  const groups: Layer[][] = []
  for (const layer of layers) {
    let target: Layer[] | null = null
    for (let g = groups.length - 1; g >= 0; g--) {
      if (groups[g][0].key === layer.key) { target = groups[g]; break }
      if (groups[g].some((l) => overlaps(l.bounds, layer.bounds))) break
    }
    if (target) target.push(layer)
    else groups.push([layer])
  }
  return groups
}

/** Paints in `active` become opaque black; every other one transparent or white, per `mode`. */
export function isolate(layers: Layer[], active: Set<Layer>, mode: Mode): void {
  const rest = mode === 'ink' ? SOLID_PAPER : SOLID_NONE
  const byNode = new Map<Layer['node'], Layer[]>()
  for (const l of layers) {
    const list = byNode.get(l.node)
    if (list) list.push(l)
    else byNode.set(l.node, [l])
  }
  for (const [node, own] of byNode) {
    for (const kind of ['fills', 'strokes'] as const) {
      const mine = own.filter((l) => l.kind === kind)
      if (!mine.length) continue
      const count = kind === 'fills' && node.fills === figma.mixed ? 1 : (node[kind] as readonly Paint[]).length
      const next: Paint[] = []
      for (let i = 0; i < count; i++) {
        next.push(mine.some((l) => l.index === i && active.has(l)) ? SOLID_INK : rest)
      }
      node[kind] = next
    }
  }
}

export interface WorkingCopy {
  /** Transparent, clipping frame of known bounds; export it, then remove it. */
  wrap: FrameNode
  layers: Layer[]
  /** Paint layers merged into one render each, bottom to top. */
  groups: Layer[][]
  mode: Mode
  scale: number
  /** The wrap's rectangle relative to the source's bounding box origin. */
  region: Region
  width: number
  height: number
  clip: boolean
  warnings: Set<string>
}

/**
 * A clone of `source` sitting exactly where the original is, inside a transparent frame
 * of known bounds, so every per-colour render covers the same rectangle whatever is
 * visible. The caller owns `wrap` and must remove it, also on failure — `track` hands it
 * over before anything that can throw.
 */
export async function prepare(source: SceneNode, opts: BakeOptions, track: (n: SceneNode) => void): Promise<WorkingCopy> {
  const render = renderBounds(source)
  const box = source.absoluteBoundingBox
  if (!render || !box) throw new Error(`"${source.name}" is hidden — nothing to trace.`)

  const warnings = new Set<string>()
  const pad = 2
  const scale = Math.min(opts.pixelsPerUnit, opts.maxSide / (Math.max(render.width, render.height) + 2 * pad))
  if (scale < opts.pixelsPerUnit) warnings.add(`Large selection: traced at ${scale.toFixed(1)}× instead of ${opts.pixelsPerUnit}×.`)

  const wrap = figma.createFrame()
  track(wrap)
  wrap.name = 'Texture to Vector — working copy'
  wrap.fills = []
  wrap.clipsContent = true
  wrap.resizeWithoutConstraints(render.width + 2 * pad, render.height + 2 * pad)
  wrap.x = render.x - pad
  wrap.y = render.y - pad

  let clone: SceneNode = source.clone()
  wrap.appendChild(clone)
  if (clone.type === 'INSTANCE') clone = clone.detachInstance()
  const t = source.absoluteTransform
  clone.relativeTransform = [
    [t[0][0], t[0][1], t[0][2] - wrap.x],
    [t[1][0], t[1][1], t[1][2] - wrap.y],
  ]

  // Repainting text needs its fonts loaded.
  const fonts = new Map<string, FontName>()
  walk(clone, (n) => {
    if (n.type !== 'TEXT' || !n.characters.length) return
    for (const font of n.getRangeAllFontNames(0, n.characters.length)) fonts.set(`${font.family}/${font.style}`, font)
  })
  try {
    await Promise.all([...fonts.values()].map((font) => figma.loadFontAsync(font)))
  } catch {
    throw new Error(`"${source.name}" uses a font that is not available here — outline the text first.`)
  }

  const layers: Layer[] = []
  collect(clone, 1, true, opts, layers, warnings)
  if (!layers.length) throw new Error(`"${source.name}" has no visible fills or strokes.`)
  let mode: Mode = 'alpha'
  walk(clone, (n) => { if (visibleTextures(n).some((t) => t.clipToShape)) mode = 'ink' })

  return {
    wrap,
    layers,
    groups: group(layers),
    mode,
    scale,
    region: { x: wrap.x - box.x, y: wrap.y - box.y, width: wrap.width, height: wrap.height },
    width: box.width,
    height: box.height,
    clip: 'clipsContent' in source && source.clipsContent,
    warnings,
  }
}

// ─── placing the result ──────────────────────────────────────────────────────────────

type Matrix = [[number, number, number], [number, number, number]]

/** Coordinate space a child of `parent` is positioned in: groups and booleans have none of their own. */
function spaceOf(parent: BaseNode & ChildrenMixin): Matrix {
  if (parent.type === 'GROUP' || parent.type === 'BOOLEAN_OPERATION') return spaceOf(parent.parent as BaseNode & ChildrenMixin)
  if (parent.type === 'PAGE' || parent.type === 'DOCUMENT') return [[1, 0, 0], [0, 1, 0]]
  return (parent as SceneNode & LayoutMixin).absoluteTransform as Matrix
}

/** Translation to absolute (x, y), expressed in the coordinate space `m`. */
function placeAt(m: Matrix, x: number, y: number): Transform {
  const [[a, c, e], [b, d, f]] = m
  const det = a * d - b * c
  const ia = d / det, ic = -c / det, ib = -b / det, id = a / det
  const dx = x - e, dy = y - f
  return [
    [ia, ic, ia * dx + ic * dy],
    [ib, id, ib * dx + id * dy],
  ]
}

/**
 * Insert an SVG built by the UI next to (or in place of) `source`. `offset` is where the
 * SVG's origin sits relative to the source's bounding box.
 */
export function insertResult(
  svg: string,
  names: string[],
  source: SceneNode,
  placement: BakeOptions['placement'],
  offset: { x: number; y: number },
): FrameNode {
  const result = figma.createNodeFromSvg(svg)
  result.name = `${source.name} · vector`
  result.setPluginData(RESULT_KEY, '1')
  result.fills = []
  result.clipsContent = false
  result.children.forEach((child, i) => { if (names[i]) child.name = names[i] })

  const box = source.absoluteBoundingBox!
  const parent = source.parent
  const x = box.x + offset.x + (placement === 'beside' ? box.width + 24 : 0)
  const y = box.y + offset.y

  if (parent && 'insertChild' in parent && parent.type !== 'INSTANCE') {
    try {
      parent.insertChild(parent.children.indexOf(source) + 1, result)
      const inFlow = 'layoutMode' in parent && parent.layoutMode !== 'NONE'
      if (!inFlow) result.relativeTransform = placeAt(spaceOf(parent), x, y)
      if (placement === 'replace') source.visible = false
      return result
    } catch {
      // Fall through to the page: some parents (instances, locked structures) refuse children.
    }
  }
  figma.currentPage.appendChild(result)
  result.x = x
  result.y = y
  return result
}
