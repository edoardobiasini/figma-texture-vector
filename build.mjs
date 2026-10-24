// Two bundles: the sandbox script, and the UI script inlined into ui.html — Figma loads
// the UI from a single HTML string, so it cannot fetch a separate .js file.
import * as esbuild from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const watch = process.argv.includes('--watch')
await mkdir('dist', { recursive: true })

const inlineUi = {
  name: 'inline-ui',
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length) return
      const js = result.outputFiles.find((f) => f.path.endsWith('.js')).text
      const html = await readFile('src/ui.html', 'utf8')
      // A function replacer: the bundle may contain `$&`-style sequences.
      await writeFile('dist/ui.html', html.replace('<script>/*__UI_JS__*/</script>', () => `<script>${js.replace(/<\/script/gi, '<\\/script')}</script>`))
    })
  },
}

const code = { entryPoints: ['src/code.ts'], bundle: true, outfile: 'dist/code.js', target: 'es2017', logLevel: 'info' }
const ui = { entryPoints: ['src/ui.ts'], bundle: true, outfile: 'dist/ui.js', write: false, target: 'es2020', logLevel: 'info', plugins: [inlineUi] }

if (watch) {
  for (const options of [code, ui]) await (await esbuild.context(options)).watch()
} else {
  await Promise.all([esbuild.build(code), esbuild.build(ui)])
}
