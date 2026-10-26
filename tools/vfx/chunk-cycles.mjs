// Dev tool: report static-import cycles between the built chunks of a dist directory (a cycle between the react chunk
// and the runtime helper once broke every page).   node tools/vfx/chunk-cycles.mjs [dist dir]
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = join(process.argv[2] ?? 'dist', 'assets')
const files = readdirSync(dir).filter((f) => f.endsWith('.js'))
const edges = new Map()
for (const f of files) {
  const src = readFileSync(join(dir, f), 'utf8')
  const deps = new Set()
  for (const m of src.matchAll(/(?:^|[;}\n])import\s*(?:[^'"`;]*?from\s*)?["'`]\.\/([^"'`]+\.js)["'`]/g)) deps.add(m[1])
  edges.set(f, [...deps])
}
const cycles = []
const state = new Map()
const stack = []
const visit = (n) => {
  state.set(n, 1)
  stack.push(n)
  for (const d of edges.get(n) ?? []) {
    if (state.get(d) === 1) cycles.push([...stack.slice(stack.indexOf(d)), d])
    else if (!state.has(d)) visit(d)
  }
  stack.pop()
  state.set(n, 2)
}
for (const f of files) if (!state.has(f)) visit(f)
if (cycles.length === 0) console.log(`no static import cycles among ${files.length} chunks`)
else for (const c of cycles) console.log('CYCLE', c.join(' -> '))
process.exit(cycles.length ? 1 : 0)
