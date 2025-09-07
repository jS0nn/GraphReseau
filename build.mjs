import { build } from 'esbuild'
import { mkdir, cp, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = __dirname
const webDir = path.join(root, 'web')
const outBundleDir = path.join(root, 'app', 'static', 'bundle')
const outVendorDir = path.join(root, 'app', 'static', 'vendor')

async function exists(p){ try { await stat(p); return true } catch { return false } }

async function copyVendorAssets(){
  await mkdir(outVendorDir, { recursive: true })
  // Copy Inter font files
  const interSrc = path.join(root, 'node_modules', '@fontsource', 'inter')
  if (await exists(interSrc)) {
    await cp(interSrc, path.join(outVendorDir, 'inter'), { recursive: true })
  }
  // Copy Unicons icons
  const uniconsSrc = path.join(root, 'node_modules', '@iconscout', 'unicons')
  if (await exists(uniconsSrc)) {
    await cp(uniconsSrc, path.join(outVendorDir, 'unicons'), { recursive: true })
  }
}

async function buildJS(){
  await mkdir(outBundleDir, { recursive: true })
  await build({
    entryPoints: [
      path.join(webDir, 'src', 'vendor.js'),
      path.join(webDir, 'src', 'main.js'),
      path.join(webDir, 'src', 'legacy-editor.js'),
    ],
    bundle: true,
    splitting: false,
    format: 'iife',
    target: 'es2019',
    minify: true,
    sourcemap: true,
    outdir: outBundleDir,
    entryNames: '[name]',
    loader: { '.ttf': 'file', '.woff': 'file', '.woff2': 'file' },
  })
}

async function buildCSS(){
  await mkdir(outBundleDir, { recursive: true })
  await build({
    entryPoints: [
      path.join(webDir, 'styles', 'app.css'),
      path.join(webDir, 'styles', 'legacy.css'),
    ],
    bundle: true,
    minify: true,
    outdir: outBundleDir,
    entryNames: '[name]',
    loader: { '.css': 'css' },
  })
}

async function run(){
  await Promise.all([buildJS(), buildCSS(), copyVendorAssets()])
  console.log('[build] done: app/static/bundle + vendor copied')
}

run().catch(err => { console.error(err); process.exit(1) })
