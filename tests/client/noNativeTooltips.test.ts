// Owner rule: no native browser tooltips. A `title=` attribute on a lowercase (DOM) element shows the unstyled
// browser popup; use <Tooltip> from src/client/ui/Tooltip.tsx instead. Component props named `title` (capitalised
// tags) are fine, and SVG accessibility should use aria-label rather than title.
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const CLIENT = join(ROOT, 'src', 'client')

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? tsxFiles(p) : p.endsWith('.tsx') ? [p] : []
  })
}

/** Find `title=` attributes on lowercase JSX opening tags. Returns 1-based line numbers. */
export function findNativeTitles(src: string): { line: number; tag: string }[] {
  const out: { line: number; tag: string }[] = []
  const open = /<([a-z][a-zA-Z0-9]*)(?=[\s/>])/g
  let m: RegExpExecArray | null
  while ((m = open.exec(src))) {
    let i = m.index + m[0].length
    let depth = 0
    let quote: string | null = null
    while (i < src.length) {
      const c = src[i]!
      if (quote) { if (c === quote) quote = null }
      else if (depth === 0 && (c === '"' || c === "'")) quote = c
      else if (c === '{') depth++
      else if (c === '}') depth--
      else if (depth === 0 && c === '>') break
      else if (depth === 0 && c === 't' && /^title\s*=/.test(src.slice(i, i + 12)) && /[\s]/.test(src[i - 1] ?? '')) {
        out.push({ line: src.slice(0, i).split('\n').length, tag: m[1]! })
      }
      i++
    }
  }
  return out
}

describe('no native tooltips', () => {
  it('flags title= on intrinsic elements (scanner self-check)', () => {
    expect(findNativeTitles('const a = <button title="x" onClick={() => 1}>hi</button>')).toHaveLength(1)
    expect(findNativeTitles('const a = <svg><title>x</title></svg>')).toHaveLength(0)
    expect(findNativeTitles('const a = <Tooltip title="x"><span style={{ title: 1 }}>a</span></Tooltip>')).toHaveLength(0)
    expect(findNativeTitles('const a = <div\n  data-x={1}\n  title={`t`}\n/>')).toEqual([{ line: 3, tag: 'div' }])
  })

  it('src/client has no title= attribute on DOM elements (use <Tooltip>)', () => {
    const hits: string[] = []
    for (const file of tsxFiles(CLIENT)) {
      for (const h of findNativeTitles(readFileSync(file, 'utf8').replace(/\r\n/g, '\n'))) {
        hits.push(`${relative(ROOT, file).split(sep).join('/')}:${h.line} <${h.tag} title=...> - use <Tooltip> from src/client/ui/Tooltip.tsx`)
      }
    }
    expect(hits).toEqual([])
  })
})
