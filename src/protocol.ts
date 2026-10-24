// Messages between the plugin sandbox (code.ts) and the UI iframe (ui.ts).

export interface SelectionItem {
  id: string
  name: string
  width: number
  height: number
  /** Visible TEXTURE effects on the node and its descendants. */
  textures: number
  /** Name of the nearest ancestor carrying a texture, which a bake of this node cannot include. */
  ancestorTexture: string | null
  /** Made by this plugin: after a run the results are what is selected. */
  isResult: boolean
}

export interface BakeOptions {
  /** Raster pixels per design pixel. */
  pixelsPerUnit: number
  /** Longest raster side allowed — the UI has to hold the whole bitmap in a canvas. */
  maxSide: number
  /** Simplify tolerance, in design pixels. */
  simplify: number
  /** Islands smaller than this many square design pixels are dropped. */
  minArea: number
  smooth: boolean
  /** Keep the fill of the selected frame itself, or leave the result transparent. */
  includeBackground: boolean
  placement: 'beside' | 'replace'
}

/** Rectangle in output units, relative to the original node's bounding box origin. */
export interface Region {
  x: number
  y: number
  width: number
  height: number
}

export type ToUI =
  | { type: 'selection'; items: SelectionItem[] }
  | { type: 'job-start'; jobId: number; name: string; width: number; height: number; clip: boolean; layers: number; scale: number }
  | { type: 'layer'; jobId: number; index: number; png: Uint8Array; region: Region; fill: string; opacity: number; mode: 'alpha' | 'ink' }
  | { type: 'job-end'; jobId: number; warnings: string[] }
  | { type: 'job-abort'; jobId: number }
  | { type: 'created'; jobId: number; nodeId: string }
  | { type: 'error'; message: string }
  | { type: 'idle' }

export type ToMain =
  | { type: 'bake'; options: BakeOptions }
  | { type: 'create'; jobId: number; svg: string; offset: { x: number; y: number }; names: string[] }
  | { type: 'skip'; jobId: number }
  | { type: 'notify'; message: string; error?: boolean }
