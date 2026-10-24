// Plugin sandbox: renders each colour of the selection in isolation — texture applied by
// Figma itself — and hands the PNGs to the UI, which traces them (trace.ts) and sends back
// an SVG to insert. The document work lives in document.ts; this file is the wiring.

import { describe, insertResult, isolate, prepare } from './document.ts'
import type { BakeOptions, ToMain, ToUI } from './protocol.ts'

figma.showUI(__html__, { width: 312, height: 640, themeColors: true })

const post = (msg: ToUI): void => figma.ui.postMessage(msg)

const sendSelection = (): void => post({ type: 'selection', items: figma.currentPage.selection.map(describe) })
figma.on('selectionchange', sendSelection)
sendSelection()

interface Job {
  source: SceneNode
  placement: BakeOptions['placement']
}

const jobs = new Map<number, Job>()
const temporary = new Set<SceneNode>()
const created: SceneNode[] = []
let nextJob = 1
let baking = false

async function bake(source: SceneNode, opts: BakeOptions): Promise<void> {
  try {
    const copy = await prepare(source, opts, (n) => temporary.add(n))
    const jobId = nextJob++
    jobs.set(jobId, { source, placement: opts.placement })
    const { wrap, layers, groups, region, scale, mode } = copy
    post({ type: 'job-start', jobId, name: source.name, width: copy.width, height: copy.height, clip: copy.clip, layers: groups.length, scale })
    try {
      for (let index = 0; index < groups.length; index++) {
        // Ink renders are cumulative: this colour and everything painted above it.
        isolate(layers, new Set(mode === 'ink' ? groups.slice(index).flat() : groups[index]), mode)
        const png = await wrap.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: scale }, useAbsoluteBounds: true })
        post({ type: 'layer', jobId, index, png, region, fill: groups[index][0].fill, opacity: groups[index][0].opacity, mode })
      }
      post({ type: 'job-end', jobId, warnings: [...copy.warnings] })
    } catch (err) {
      jobs.delete(jobId)
      post({ type: 'job-abort', jobId })
      throw err
    }
  } finally {
    for (const node of temporary) if (!node.removed) node.remove()
    temporary.clear()
  }
}

/** Done once the sandbox has rendered everything and the UI has answered for every job. */
function settleIfDone(): void {
  if (baking || jobs.size > 0) return
  if (created.length) figma.currentPage.selection = created.splice(0)
  figma.commitUndo()
  post({ type: 'idle' })
}

const message = (err: unknown): string => String(err instanceof Error ? err.message : err)

figma.ui.onmessage = async (msg: ToMain) => {
  if (msg.type === 'notify') {
    figma.notify(msg.message, { error: msg.error })
  } else if (msg.type === 'create' || msg.type === 'skip') {
    const job = jobs.get(msg.jobId)
    if (!job) return
    jobs.delete(msg.jobId)
    if (msg.type === 'create') {
      try {
        const result = insertResult(msg.svg, msg.names, job.source, job.placement, msg.offset)
        created.push(result)
        post({ type: 'created', jobId: msg.jobId, nodeId: result.id })
      } catch (err) {
        post({ type: 'error', message: message(err) })
      }
    }
    settleIfDone()
  } else if (msg.type === 'bake') {
    if (baking) return
    const selection = [...figma.currentPage.selection]
    if (!selection.length) {
      post({ type: 'error', message: 'Select one or more layers first.' })
      post({ type: 'idle' })
      return
    }
    baking = true
    for (const node of selection) {
      try {
        await bake(node, msg.options)
      } catch (err) {
        post({ type: 'error', message: message(err) })
      }
    }
    baking = false
    settleIfDone()
  }
}

figma.on('close', () => {
  for (const node of temporary) if (!node.removed) node.remove()
})
