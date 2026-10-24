// Builds the Figma Community listing images: cover.png (1920×1080) and icon.png (128×128).
//
//   node docs/community/build.mjs
//
// The cover's drawing is plant.svg, real output of the plugin: a test icon with Figma's
// Texture effect, traced at 4×. Layouts live in this file; it writes cover.html and
// icon.html next to it (not committed), renders them with headless Google Chrome (macOS
// path below), and `sips` downsamples the icon from 512 px.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const C = {
  canvas: '#F5F5F5', // Figma's light canvas
  ink: '#1E1E1E',
  muted: '#6B6B6B',
  sage: '#5E8466',
  blush: '#E8A598',
  select: '#0D99FF', // Figma's selection blue
}

// ─── the drawing ──────────────────────────────────────────────────────────────────────

const plant = readFileSync(join(here, 'plant.svg'), 'utf8')
const paths = [...plant.matchAll(/<path fill="(#[0-9A-F]{6})"[^>]* d="([^"]+)"/g)].map((m) => ({ fill: m[1], d: m[2] }))
const recolor = { '#E5A699': C.blush, '#668C6B': C.sage }

/** Absolute vertices of the M / l / z polylines the plugin writes. */
function loops(d) {
  const out = []
  for (const [, cmd, args] of d.matchAll(/([Mlz])([^Mlz]*)/g)) {
    const n = (args.match(/-?(?:\d+\.?\d*|\.\d+)/g) ?? []).map(Number)
    if (cmd === 'M') out.push([[n[0], n[1]]])
    if (cmd === 'l') {
      const loop = out[out.length - 1]
      let [x, y] = loop[loop.length - 1]
      for (let k = 0; k < n.length; k += 2) loop.push([(x += n[k]), (y += n[k + 1])])
    }
  }
  return out
}

// A sample of the real vertices, roughly every 7 units along each outline, right half only.
const anchors = []
for (const p of paths) {
  for (const loop of loops(p.d)) {
    let run = Infinity
    for (let k = 1; k < loop.length; k++) {
      run += Math.hypot(loop[k][0] - loop[k - 1][0], loop[k][1] - loop[k - 1][1])
      if (run >= 7 && loop[k][0] > 61.5) { anchors.push(loop[k]); run = 0 }
    }
  }
}

const SPLIT = 60 // the stem: where texture ends and outlines begin, in drawing units
const fills = paths.map((p) => `<path fill="${recolor[p.fill] ?? p.fill}" fill-rule="evenodd" d="${p.d}"/>`).join('\n')
const outlines = paths.map((p) => `<path d="${p.d}"/>`).join('\n')
const marks = anchors.map(([x, y]) => `<rect x="${(x - 0.62).toFixed(2)}" y="${(y - 0.62).toFixed(2)}" width="1.24" height="1.24"/>`).join('')

// ─── cover ───────────────────────────────────────────────────────────────────────────

const fonts = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,800&family=IBM+Plex+Mono:wght@400;500&display=block" rel="stylesheet">'

const cover = `<!doctype html>
<html><head><meta charset="utf-8">${fonts}
<style>
  * { margin: 0; box-sizing: border-box; }
  html, body { width: 1920px; height: 1080px; overflow: hidden; background: ${C.canvas}; color: ${C.ink}; }
  body { font-family: 'Bricolage Grotesque', sans-serif; position: relative; }
  .copy { position: absolute; left: 132px; top: 0; bottom: 0; width: 760px; display: flex; flex-direction: column; justify-content: center; }
  .eyebrow { font: 500 24px/1 'IBM Plex Mono', monospace; color: ${C.muted}; letter-spacing: .02em; margin-bottom: 36px; }
  h1 { font-weight: 800; font-size: 150px; line-height: .9; letter-spacing: -.035em; font-variation-settings: 'opsz' 96; }
  h1 .t { color: ${C.sage}; }
  h1 .v { color: ${C.select}; }
  .lede { font-size: 38px; line-height: 1.25; font-weight: 400; margin-top: 44px; max-width: 760px; letter-spacing: -.01em; }
  .fact { font: 400 24px/1.4 'IBM Plex Mono', monospace; color: ${C.muted}; margin-top: 40px; }
  .fact b { font-weight: 500; color: ${C.ink}; }
  .art { position: absolute; left: 912px; top: 0; width: 1008px; height: 1080px; }
  .label { position: absolute; top: 74px; font: 500 24px/1 'IBM Plex Mono', monospace; }
  .label.l { right: calc(1008px - 504px + 22px); color: ${C.sage}; }
  .label.r { left: calc(504px + 22px); color: ${C.select}; }
</style></head>
<body>
  <div class="copy">
    <div class="eyebrow">Figma plugin · free</div>
    <h1><span class="t">Texture</span><br>to <span class="v">Vector</span></h1>
    <p class="lede">Turns Figma’s Texture effect into real vector paths, so it survives SVG export.</p>
    <p class="fact">SVG export: <b>4 &lt;path&gt;</b>, <b>0 filters</b></p>
  </div>
  <div class="art">
    <div class="label l">← Texture effect</div>
    <div class="label r">Vector paths →</div>
    <svg width="1008" height="1080" viewBox="-12 -8 144 154.3">
      <defs>
        <clipPath id="left"><rect x="-20" y="-20" width="${SPLIT + 20}" height="200"/></clipPath>
        <clipPath id="right"><rect x="${SPLIT}" y="-20" width="100" height="200"/></clipPath>
      </defs>
      <g transform="translate(0 3)">
        <g clip-path="url(#left)">${fills}</g>
        <g clip-path="url(#right)" fill="none" stroke="${C.select}" stroke-width="1.6" vector-effect="non-scaling-stroke" style="vector-effect:non-scaling-stroke">
          <g style="--x:0">${outlines.replaceAll('<path ', '<path vector-effect="non-scaling-stroke" ')}</g>
        </g>
        <g fill="#FFFFFF" stroke="${C.select}" stroke-width="1.6">${marks.replaceAll('<rect ', '<rect vector-effect="non-scaling-stroke" ')}</g>
      </g>
      <line x1="${SPLIT}" y1="-8" x2="${SPLIT}" y2="146.3" stroke="${C.ink}" stroke-width="2" vector-effect="non-scaling-stroke"/>
    </svg>
  </div>
</body></html>
`

// ─── icon ────────────────────────────────────────────────────────────────────────────

// Same filter Figma's SVG export writes for Texture: fractal noise displacing the shape.
const icon = `<!doctype html>
<html><head><meta charset="utf-8">
<style>* { margin: 0; } html, body { width: 512px; height: 512px; overflow: hidden; background: ${C.sage}; }</style></head>
<body>
<svg width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <filter id="texture" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="3" seed="4"/>
      <feDisplacementMap in="SourceGraphic" scale="40" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
    <clipPath id="l"><rect x="0" y="0" width="256" height="512"/></clipPath>
    <clipPath id="r"><rect x="256" y="0" width="256" height="512"/></clipPath>
  </defs>
  <g clip-path="url(#l)"><circle cx="256" cy="256" r="150" fill="${C.blush}" filter="url(#texture)"/></g>
  <g clip-path="url(#r)"><circle cx="256" cy="256" r="150" fill="${C.blush}"/>
    <circle cx="256" cy="256" r="150" fill="none" stroke="#FFFFFF" stroke-width="9"/></g>
  <g stroke="#FFFFFF" stroke-width="9" stroke-linecap="round">
    <line x1="406" y1="168" x2="406" y2="344"/>
  </g>
  <g fill="#FFFFFF">
    <circle cx="406" cy="168" r="16"/><circle cx="406" cy="344" r="16"/>
  </g>
  <g fill="${C.sage}" stroke="#FFFFFF" stroke-width="9">
    <rect x="384" y="234" width="44" height="44"/>
    <rect x="234" y="84" width="44" height="44"/>
    <rect x="234" y="384" width="44" height="44"/>
  </g>
</svg>
</body></html>
`

writeFileSync(join(here, 'cover.html'), cover)
writeFileSync(join(here, 'icon.html'), icon)

const shoot = (html, png, w, h) =>
  execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    `--window-size=${w},${h}`, '--virtual-time-budget=10000', `--screenshot=${png}`, `file://${html}`,
  ], { stdio: 'ignore' })

shoot(join(here, 'cover.html'), join(here, 'cover.png'), 1920, 1080)
shoot(join(here, 'icon.html'), join(here, 'icon-512.png'), 512, 512)
execFileSync('sips', ['-z', '128', '128', join(here, 'icon-512.png'), '--out', join(here, 'icon.png')], { stdio: 'ignore' })
rmSync(join(here, 'icon-512.png'))
console.log(`cover.png, icon.png written — ${anchors.length} anchor marks`)
