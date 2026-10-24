// Plugin UI. Receives one PNG per colour from the sandbox, traces it, and assembles the SVG
// that goes back to be inserted — and that the Copy/Download buttons hand out.

import { coverage, mergeRasters, traceRasters, type Raster } from './compose.ts'
import { assemble } from './svg.ts'
import type { BakeOptions, SelectionItem, ToMain, ToUI } from './protocol.ts'

const MAX_SIDE = 4096

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const send = (msg: ToMain): void => parent.postMessage({ pluginMessage: msg }, '*')

interface Job {
  name: string
  width: number
  height: number
  clip: boolean
  layers: number
  options: BakeOptions
  rasters: Raster[]
}

interface Result {
  name: string
  svg: string
}

const jobs = new Map<number, Job>()
let results: Result[] = []
let selection: SelectionItem[] = []
let busy = false
let runOptions: BakeOptions | null = null

// ─── options ──────────────────────────────────────────────────────────────────────────

function options(): BakeOptions {
  const radio = (name: string): string => (document.querySelector(`input[name=${name}]:checked`) as HTMLInputElement).value
  const speck = Number($<HTMLInputElement>('speck').value)
  return {
    pixelsPerUnit: Number(radio('q')),
    maxSide: MAX_SIDE,
    simplify: Number($<HTMLInputElement>('simplify').value),
    minArea: speck * speck,
    smooth: $<HTMLInputElement>('smooth').checked,
    includeBackground: $<HTMLInputElement>('background').checked,
    placement: radio('p') as BakeOptions['placement'],
  }
}

function renderOptions(): void {
  const o = options()
  $('simplify-out').textContent = `${o.simplify.toFixed(2)}px`
  $('speck-out').textContent = `${Math.sqrt(o.minArea).toFixed(1)}px`
  const largest = Math.max(0, ...selection.map((s) => Math.max(s.width, s.height)))
  const side = Math.min(MAX_SIDE, Math.round(largest * o.pixelsPerUnit))
  $('q-out').textContent = largest ? `${side}px` : ''
}

for (const el of document.querySelectorAll('input')) el.addEventListener('input', renderOptions)

// ─── selection ────────────────────────────────────────────────────────────────────────

const escape = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function renderSelection(): void {
  const box = $('selection')
  if (!selection.length) {
    box.className = 'card muted'
    box.textContent = 'Select layers that use the Texture effect.'
  } else {
    box.className = 'card'
    box.innerHTML = selection
      .map((s) => {
        const size = `${Math.round(s.width)}×${Math.round(s.height)}`
        const textures = s.textures === 1 ? '1 texture' : `${s.textures} textures`
        let note = ''
        if (s.isResult) note = '<div class="muted">Vectorized by this plugin — ready to export.</div>'
        else if (s.ancestorTexture) note = `<div class="note">The texture on “${escape(s.ancestorTexture)}” is outside this selection — select that layer to include it.</div>`
        else if (!s.textures) note = '<div class="note">No Texture effect here — it will be traced as it is.</div>'
        return `<div class="sel-item"><b>${escape(s.name)}</b><span class="muted">${size} · ${textures}</span></div>` + note
      })
      .join('')
  }
  $<HTMLButtonElement>('run').disabled = busy || !selection.length
  renderOptions()
}

// ─── progress ─────────────────────────────────────────────────────────────────────────

function status(text: string, error = false): void {
  const el = $('status')
  el.textContent = text
  el.className = error ? 'error' : 'muted'
}

function progress(done: number, total: number): void {
  $('bar').style.width = total ? `${(done / total) * 100}%` : '0'
}

function setBusy(value: boolean): void {
  busy = value
  $<HTMLButtonElement>('run').disabled = busy || !selection.length
}

$('run').addEventListener('click', () => {
  results = []
  $('result').hidden = true
  setBusy(true)
  status('Rendering…')
  progress(0, 1)
  runOptions = options()
  send({ type: 'bake', options: runOptions })
})

// ─── tracing ──────────────────────────────────────────────────────────────────────────

async function decode(png: Uint8Array): Promise<ImageData> {
  const blob = new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' })
  const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

/** Keep one coverage byte per pixel: the colour is known, and a quarter of the memory. */
async function keepLayer(job: Job, msg: Extract<ToUI, { type: 'layer' }>): Promise<void> {
  const image = await decode(msg.png)
  job.rasters[msg.index] = {
    alpha: coverage(image.data, msg.mode),
    width: image.width,
    height: image.height,
    region: msg.region,
    fill: msg.fill,
    opacity: msg.opacity,
    mode: msg.mode,
  }
}

function showResults(warnings: string[], points: number): void {
  const last = results[results.length - 1]
  $('result').hidden = false
  $('result-title').textContent = results.length > 1 ? `Results (${results.length})` : 'Result'
  $('preview').innerHTML = last.svg
  const kb = new Blob([last.svg]).size / 1024
  $('stats').textContent = `${escape(last.name)} — ${points.toLocaleString()} points, ${kb.toFixed(1)} KB`
  const list = $('warnings')
  list.hidden = !warnings.length
  list.innerHTML = warnings.map((w) => `<li>${escape(w)}</li>`).join('')
}

async function handle(msg: ToUI): Promise<void> {
  switch (msg.type) {
    case 'selection':
      selection = msg.items
      renderSelection()
      break
    case 'job-start':
      jobs.set(msg.jobId, { ...msg, options: runOptions ?? options(), rasters: [] })
      status(`Tracing “${msg.name}”…`)
      progress(0, msg.layers)
      break
    case 'layer': {
      const job = jobs.get(msg.jobId)
      if (!job) break
      status(`Rendering “${job.name}” — colour ${msg.index + 1} of ${job.layers}`)
      await keepLayer(job, msg)
      progress(msg.index + 1, job.layers)
      break
    }
    case 'job-end': {
      const job = jobs.get(msg.jobId)
      if (!job) break
      jobs.delete(msg.jobId)
      status(`Tracing “${job.name}”…`)
      const merged = mergeRasters(job.rasters.filter(Boolean))
      const traced = traceRasters(merged, job.options)
      const out = assemble(traced, job, job.options.smooth)
      if (!out) {
        send({ type: 'skip', jobId: msg.jobId })
        status(`Nothing left to trace in “${job.name}” — lower Min. speck?`, true)
        break
      }
      results.push({ name: job.name, svg: out.svg })
      showResults(msg.warnings, out.points)
      send({ type: 'create', jobId: msg.jobId, svg: out.svg, offset: out.offset, names: out.names })
      break
    }
    case 'job-abort':
      jobs.delete(msg.jobId)
      break
    case 'created':
      status('Done — vector layers added.')
      break
    case 'error':
      status(msg.message, true)
      send({ type: 'notify', message: msg.message, error: true })
      break
    case 'idle':
      setBusy(false)
      break
  }
}

// Decoding is async: chain the messages so a job's end never overtakes its last layer.
let queue = Promise.resolve()
window.onmessage = (event: MessageEvent) => {
  const msg = event.data?.pluginMessage as ToUI | undefined
  if (!msg) return
  queue = queue.then(() => handle(msg)).catch((err) => status(String(err), true))
}

// ─── export ───────────────────────────────────────────────────────────────────────────

const fileName = (name: string): string => `${name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'texture'}.svg`

$('copy').addEventListener('click', () => {
  // navigator.clipboard is blocked inside plugin iframes; the textarea route still works.
  const area = document.createElement('textarea')
  area.value = results.map((r) => r.svg).join('\n')
  document.body.appendChild(area)
  area.select()
  document.execCommand('copy')
  area.remove()
  send({ type: 'notify', message: results.length > 1 ? `${results.length} SVGs copied` : 'SVG copied' })
})

$('download').addEventListener('click', () => {
  for (const r of results) {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([r.svg], { type: 'image/svg+xml' }))
    a.download = fileName(r.name)
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
})

renderSelection()
