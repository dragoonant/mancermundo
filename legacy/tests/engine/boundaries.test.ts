import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const ENGINE = 'src/engine'

describe('module boundaries', () => {
  it('BOUND-001 the engine imports nothing outside itself and uses no DOM, timers, Math.random or Date', () => {
    const files = readdirSync(ENGINE).filter((f) => f.endsWith('.ts'))
    expect(files.length).toBeGreaterThan(20)
    const bad: string[] = []
    for (const f of files) {
      const text = readFileSync(join(ENGINE, f), 'utf8')
      for (const [i, line] of text.split('\n').entries()) {
        const code = line.replace(/\/\/.*$/, '')
        const importFrom = /from\s+'([^']+)'/.exec(code)?.[1]
        // the type-only data records are the one allowed import (00-architecture section 1)
        if (importFrom && !importFrom.startsWith('./') && importFrom !== '../data/types') bad.push(`${f}:${i + 1} imports ${importFrom}`)
        if (/Math\.random\(|Date\.now\(|new Date\(|setTimeout\(|setInterval\(|document\.|window\./.test(code)) {
          bad.push(`${f}:${i + 1} uses a forbidden global: ${code.trim()}`)
        }
      }
    }
    expect(bad).toEqual([])
  })

  it('BOUND-002 ploy rules can be registered at module top level whichever engine module loads first (no import-cycle TDZ)', async () => {
    for (const entry of ['@/engine/ploys', '@/engine/abilities', '@/engine/teams', '@/engine/firefight', '@/engine']) {
      vi.resetModules()
      await expect(import(/* @vite-ignore */ entry)).resolves.toBeDefined()
      const leaf = await import('@/engine/ploy-rules')
      const ploys = await import('@/engine/ploys')
      expect(ploys.registerPloyRule).toBe(leaf.registerPloyRule)
      const before = leaf.ployRules().length
      expect(before).toBeGreaterThan(0) // Angels of Death registers at top level
      ploys.registerPloyRule({})
      expect(leaf.ployRules()).toHaveLength(before + 1)
    }
  })
})
