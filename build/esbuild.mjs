import { build } from 'esbuild'
import { mkdir, cp, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const srcDir = path.join(root, 'frontend', 'src')
const publicDir = path.join(root, 'frontend', 'public')
const distDir = path.join(root, 'frontend', 'dist')

async function pathExists(p) {
  try { await stat(p); return true } catch { return false }
}

async function bundle() {
  const entryCandidates = [
    path.join(srcDir, 'index.ts'),
    path.join(srcDir, 'index.js'),
  ]
  const entry = (await Promise.all(entryCandidates.map(pathExists)))
    .map((e, i) => (e ? entryCandidates[i] : null))
    .find(Boolean)

  await mkdir(distDir, { recursive: true })
  await cp(publicDir, distDir, { recursive: true })

  if (!entry) {
    console.log('[esbuild] no entry file, copied public → dist')
    return
  }

  await build({
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    target: 'es2019',
    sourcemap: true,
    minify: true,
    outdir: path.join(distDir, 'assets'),
    loader: { '.ttf': 'file', '.woff': 'file', '.woff2': 'file' },
  })
  console.log('[esbuild] build complete')
}

bundle().catch((err) => { console.error(err); process.exit(1) })

