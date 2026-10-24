# Texture to Vector

A Figma plugin that turns layers using Figma's **Texture** effect into plain vector
paths, so the hand-drawn look survives SVG export and opens as editable shapes in
Illustrator, Inkscape, a browser or a codebase.

## Install

Texture to Vector has been submitted to the Figma Community and is in review. Once it's
approved, it will be one click away on its
[Community page](https://www.figma.com/community/plugin/1695932217794835681).

Until then, install it as a development plugin, which takes about a minute. You need
the **Figma desktop app**: the browser version of Figma can't load plugins from your
disk.

### From the ready-made download (no tools needed)

1. Open the [latest release](https://github.com/edoardobiasini/figma-texture-vector/releases/latest)
   and download `texture-to-vector-v….zip`.
2. Unzip it somewhere it can stay, for example `Documents/Figma plugins/`. Figma loads
   the plugin from that folder every time it runs, so don't delete it or leave it in
   Downloads.
3. In the Figma desktop app, open any design file.
4. In the menu bar, go to **Plugins → Development → Import plugin from manifest…** and
   choose `manifest.json` inside the unzipped `texture-to-vector` folder.
5. Figma confirms with "Texture to Vector has been imported". The plugin is now
   available in every file on this computer.

To run it, select some layers and go to **Plugins → Development → Texture to Vector**.
You can also press <kbd>⌘</kbd> <kbd>/</kbd> (<kbd>Ctrl</kbd> <kbd>/</kbd> on Windows)
and type "Texture".

To update, download the new release and unzip it over the same folder. Figma picks up
the new files the next time you run the plugin, so there's nothing to re-import. To
remove the plugin, go to **Plugins → Development → Manage plugins in development** and
choose **Remove** from the plugin's menu.

### From source

Needs Node 22+ and [pnpm](https://pnpm.io).

```bash
git clone https://github.com/edoardobiasini/figma-texture-vector.git
cd figma-texture-vector
pnpm install
pnpm build
```

Then import `manifest.json` from the repository folder, as in step 4 above.
`pnpm watch` rebuilds on save, and the next run of the plugin in Figma uses the new
build.

## Use

Select one or more layers (an icon frame, a group, a single vector) and press
**Vectorize texture**.

| Option | What it does |
| --- | --- |
| Resolution | Raster pixels per design pixel: 4×, 8× or 16×. Capped at 4096 px on the longest side. |
| Simplify | How far a path may stray from the traced edge, in px. Higher means fewer points. |
| Min. speck | Drops islands of texture smaller than this, in px. |
| Smooth curves | Writes cubic curves instead of straight segments. Looks the same at normal sizes and makes the file about 3× larger. |
| Keep the selected frame's background | Includes the frame's own fill as a shape. Off by default, so icons stay transparent. |
| Next to original / Replace | Places the result beside the source, or in its slot with the source hidden. |

For the 120 px test icon traced at 4×, with the other options at their defaults: 4
paths, ~3,300 points, 25 KB. With Smooth curves the same icon is 76 KB. 8× (the
default) keeps more of the fine grain, so expect more points.

**Download SVG** gives the compact file the plugin wrote. Exporting the result layer
from Figma's own Export panel works too, but Figma rewrites the paths in absolute
coordinates. At 8× that made the test icon 49 KB.

## Why the effect doesn't export

Figma's SVG export does not drop the texture: it writes it as a filter.

```xml
<feTurbulence type="fractalNoise" baseFrequency="0.25 0.25" numOctaves="3" seed="0"/>
<feDisplacementMap in="shape" scale="8" xChannelSelector="R" yChannelSelector="G"/>
```

`baseFrequency` is `1 / noiseSize` and `scale` is `2 × radius`. A filter like that is a
raster operation, so the rough outline never exists as geometry: Illustrator can't
expand it, browsers draw their own version of the noise, and flatten or union in Figma
work on the original shape underneath.

## How the plugin works

It traces Figma's own render of the texture, so it doesn't try to reproduce the noise.

1. It clones the selection into a temporary frame at the same position.
2. It renders one colour at a time to PNG, at 4–16× resolution, with the texture applied
   by Figma itself. Paints of other colours are set to transparent rather than removed,
   so the geometry and the noise stay identical between renders.
3. The UI traces each render with marching squares, interpolated to sub-pixel precision,
   simplifies the outline, and writes one `<path fill-rule="evenodd">` per colour.
4. The SVG goes back onto the canvas next to the original (or replaces it), and can also
   be copied or downloaded.

Renders of the same colour are merged whenever the pixels allow it, without changing what
paints over what. In the two-colour test icon, 6 renders became 4 paths. It can't go
down to 2 because the stem runs into the flower: green is under pink there and over pink
elsewhere.

**Clip to shape** works differently. With that option Figma keeps the outer edge smooth
and roughens only the borders between colours inside the shape, so a colour rendered on
its own shows no texture at all. For those layers the plugin uses ink renders instead:

- Every paint stays in place. The colour being traced turns black and the rest turns
  opaque white.
- Coverage is read from the colour instead of the alpha.
- Each render covers that colour plus everything painted above it, so the paths stack
  without seams.

Measured on Figma 126 before relying on it:

- **The noise is anchored to the node.** Moving the layer by whole or half pixels, or
  growing its render bounds with a shadow, leaves the pattern pixel-identical.
- **The noise doesn't depend on scale.** A 4× render downsampled to 1× matches the 1×
  render (mean alpha error 0.001). Tracing at 16× is the same texture with more detail.
- **Isolating colours is faithful.** The stroke-only render composited over the
  fill-only render reproduces the full render, with a mean alpha error of 0.002.
- **The output is accurate.** Traced at 4×, a two-colour test icon matched Figma's
  render with an alpha IoU of 0.995 and the same colour on 99.6% of shared pixels. A
  1 px shift of the original only scores 0.90.
- **Clip to shape is handled.** A fill + stroke ellipse with that option scored 0.999
  on the outline and 0.992 on the inner green border. Rendering each colour alone would
  have scored 0.89 there, with no texture left.
- **The installed plugin matches.** Run from Figma at the default 8×, the plugin scored
  0.995 on the icon with the texture on its frame, 0.995 on the same icon with the
  texture on each child, and 0.999 on the clipped ellipse.

## Limits

- Only flat colours are kept. Gradients become their first stop and image fills become
  grey shapes. The UI shows a warning when that happens.
- Shadows, blurs and the Noise effect are not traced.
- Opacity is carried over per shape. Overlapping parts inside a semi-transparent group
  can therefore look slightly denser than in Figma.
- Blend modes are ignored.
- A texture set on a parent of the selection is not part of the render. The UI points
  out the layer to select instead.
- Text is traced as shapes. Its font must be available in the file.

## Development

```bash
pnpm typecheck   # tsc over src/ and test/
pnpm test        # tracer tests on synthetic rasters with known geometry
pnpm package     # build, then zip manifest + dist into release/ for a GitHub release
```

To publish to the Figma Community, follow [docs/PUBLISHING.md](docs/PUBLISHING.md).

| File | Role |
| --- | --- |
| `src/code.ts` | Plugin sandbox: messaging and job bookkeeping. |
| `src/document.ts` | Everything that touches the document: working copy, colour isolation, placing the result. |
| `src/compose.ts` | Merges per-colour renders by actual pixel overlap, then traces them. |
| `src/trace.ts` | Marching squares, simplification, compact SVG path output. Pure. |
| `src/svg.ts` | Traced layers to one SVG document. Pure. |
| `src/ui.ts`, `src/ui.html` | The panel. The build inlines the script into `dist/ui.html`. |

`test/harness.ts` and `test/bridge-trace.ts` run the same `document.ts` and
`compose`/`trace`/`svg` code through the
[figma-console](https://github.com/southleft/figma-console-mcp) Desktop Bridge, which
is how the measurements above were taken:

1. `harness.ts` is bundled to an IIFE and executed with `figma_execute`.
2. The per-colour renders are captured to PNG.
3. `bridge-trace.ts` traces them into the SVG the plugin would insert.

`bridge-trace.ts` decodes PNGs through Python's Pillow, so it needs
`python3 -m pip install pillow`.

## License

[MIT](LICENSE). Free to use, copy and modify. Keep the copyright notice.
