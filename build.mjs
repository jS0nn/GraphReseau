import { build } from 'esbuild'
import { mkdir, cp, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = __dirname
const webDir = path.join(root, 'web')
const outBundleDir = path.join(root, 'app', 'static', 'bundle')
const outVendorDir = path.join(root, 'app', 'static', 'vendor')

// Build mode
const DEV = Boolean(process.env.BUILD_DEV)
const rel = (p) => path.relative(root, p)
const logDev = (...args) => { if(DEV) console.log('[build:dev]', ...args) }
const warnDev = (...args) => { if(DEV) console.warn('[build:dev]', ...args) }

if(DEV){
  logDev('Build de développement activé – logs verbeux et sourcemaps inline')
}

async function exists(p){ try { await stat(p); return true } catch { return false } }

async function copyVendorAssets(){
  await mkdir(outVendorDir, { recursive: true })
  // Copy Inter font files
  const interSrc = path.join(root, 'node_modules', '@fontsource', 'inter')
  if (await exists(interSrc)) {
    const dest = path.join(outVendorDir, 'inter')
    await cp(interSrc, dest, { recursive: true })
    logDev(`Polices Inter copiées → ${rel(dest)}`)
  }
  // Copy Unicons icons
  const uniconsSrc = path.join(root, 'node_modules', '@iconscout', 'unicons')
  if (await exists(uniconsSrc)) {
    const dest = path.join(outVendorDir, 'unicons')
    await cp(uniconsSrc, dest, { recursive: true })
    logDev(`Icônes Unicons copiées → ${rel(dest)}`)
  }
  // Copy Leaflet dist (CSS + images)
  const leafletSrc = path.join(root, 'node_modules', 'leaflet', 'dist')
  if (await exists(leafletSrc)) {
    const dest = path.join(outVendorDir, 'leaflet')
    await cp(leafletSrc, dest, { recursive: true })
    logDev(`Assets Leaflet copiés → ${rel(dest)}`)
  }else{
    warnDev('Leaflet introuvable dans node_modules, aucun asset copié')
  }
}

async function buildJS(){
  await mkdir(outBundleDir, { recursive: true })
  logDev('Compilation JS (esbuild) en cours...')
  await build({
    entryPoints: [
      path.join(webDir, 'src', 'vendor.js'),
      path.join(webDir, 'src', 'polyfills.js'),
      path.join(webDir, 'src', 'main.js'),
      path.join(webDir, 'src', 'editor.js'),
      // Ensure dynamic imports exist as standalone bundles for runtime
      path.join(webDir, 'src', 'editor.boot.js'),
    ],
    bundle: true,
    splitting: false,
    format: 'iife',
    target: 'es2019',
    minify: !DEV,
    sourcemap: DEV ? 'inline' : true,
    outdir: outBundleDir,
    entryNames: '[name]',
    loader: { '.ttf': 'file', '.woff': 'file', '.woff2': 'file' },
    define: { __DEV__: String(DEV) },
    logLevel: 'info',
    logLimit: undefined,
    color: true,
  })
  logDev(`Compilation JS terminée → ${rel(outBundleDir)}`)
}

async function buildCSS(){
  await mkdir(outBundleDir, { recursive: true })
  logDev('Compilation CSS (esbuild) en cours...')
  await build({
    entryPoints: [
      path.join(webDir, 'styles', 'app.css'),
      path.join(webDir, 'styles', 'editor.css'),
    ],
    bundle: true,
    minify: !DEV,
    outdir: outBundleDir,
    entryNames: '[name]',
    loader: { '.css': 'css' },
    logLevel: 'info',
    logLimit: undefined,
    color: true,
  })
  logDev(`Compilation CSS terminée → ${rel(outBundleDir)}`)
}

async function run(){
  logDev('Démarrage du build (Promise.all)')
  await Promise.all([buildJS(), buildCSS(), copyVendorAssets()])
  console.log('[build] done: app/static/bundle + vendor copied')
}

run().catch(err => { console.error(err); process.exit(1) })
