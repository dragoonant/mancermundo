import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ALL_MODULES, moduleFor } from '@/engine/modules'
import { skillsModule } from '@/engine/skills'

const ENGINE = 'src/engine'

/** Every .ts/.tsx file under a directory (empty when it does not exist). */
function sources(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...sources(p))
    else if (/\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

function code(raw: string): string {
  return raw.replace(/\/\/.*$/, '').replace(/^\s*(\/\*|\*).*$/, '')
}

/** Import specifiers of a file with comments blanked, with their 1-based line numbers. */
function imports(file: string): { spec: string; line: number }[] {
  const out: { spec: string; line: number }[] = []
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((raw, i) => {
      for (const m of code(raw).matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)) out.push({ spec: m[1]!, line: i + 1 })
    })
  return out
}

describe('module boundaries', () => {
  it('BOUND-001 the engine imports nothing outside itself and uses no DOM, timers, Math.random or Date', () => {
    const files = sources(ENGINE)
    expect(files.length).toBeGreaterThan(15)
    const bad: string[] = []
    for (const f of files) {
      for (const { spec, line } of imports(f)) {
        // the type-only data records are the one allowed import (00-architecture section 1); a file in an engine sub-folder
        // (skills/, gangs/) may reach back into the engine through `../`
        const subFolder = dirname(f) !== ENGINE.replace(/\//g, sep)
        const insideEngine = subFolder && spec.startsWith('../') && resolve(dirname(f), spec).startsWith(resolve(ENGINE))
        if (!spec.startsWith('./') && spec !== '../data/types' && !insideEngine) bad.push(`${f}:${line} imports ${spec}`)
      }
      for (const [i, raw] of readFileSync(f, 'utf8').split('\n').entries()) {
        const c = code(raw)
        if (/Math\.random\(|Date\.now\(|new Date\(|setTimeout\(|setInterval\(|document\.|window\./.test(c)) {
          bad.push(`${f}:${i + 1} uses a forbidden global: ${c.trim()}`)
        }
      }
    }
    expect(bad).toEqual([])
  })

  it('BOUND-002 nothing imports from legacy/', () => {
    const bad: string[] = []
    for (const f of [...sources('src'), ...sources('tests'), ...sources('tools')]) {
      if (f.endsWith('boundaries.test.ts')) continue
      for (const { spec, line } of imports(f)) {
        if (/(^|\/)legacy(\/|$)/.test(spec)) bad.push(`${f}:${line} imports ${spec}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('BOUND-003 dependencies point data <- engine <- ai <- client', () => {
    const forbidden: Record<string, RegExp> = {
      'src/data': /(^|\/)(engine|ai|client)(\/|$)/,
      'src/ai': /(^|\/)client(\/|$)/,
    }
    const bad: string[] = []
    for (const [dir, re] of Object.entries(forbidden)) {
      for (const f of sources(dir)) {
        for (const { spec, line } of imports(f)) {
          if ((spec.startsWith('.') || spec.startsWith('@/')) && re.test(spec)) bad.push(`${f}:${line} imports ${spec}`)
        }
      }
    }
    expect(bad).toEqual([])
  })

  it('BOUND-004 every decision-kind namespace has exactly one owner and dice.reroll is routed to skills', () => {
    const seen = new Map<string, string>()
    for (const mod of ALL_MODULES) {
      for (const ns of mod.namespaces) {
        expect(seen.has(ns), `namespace ${ns} owned by ${seen.get(ns)} and ${mod.id}`).toBe(false)
        seen.set(ns, mod.id)
      }
    }
    for (const kind of ['setup.role', 'action.activate', 'move.path', 'shoot.target', 'fight.after', 'end.bottle', 'skill.choice', 'confirm']) {
      expect(() => moduleFor(kind), kind).not.toThrow()
    }
    expect(moduleFor('dice.reroll')).toBe(skillsModule)
  })
})
