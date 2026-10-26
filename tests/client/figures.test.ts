// Figure manifest: every datacard archetype has a measured body entry whose GLB exists, sockets are sane,
// every hold class has a HOLDS mount, and the rigid cues behave.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dataBundle } from '@/client/game/adapter'
import { HOLDS } from '@/client/figures/hold'
import { cuePose, triggerCue, clearCues } from '@/client/figures/cues'
import type { HoldClass, ModelManifest } from '@/client/figures/manifest'

const modelsDir = resolve(__dirname, '../../public/assets/models')
const manifest = JSON.parse(readFileSync(resolve(modelsDir, 'manifest.json'), 'utf8')) as ModelManifest
const cards = Object.values(dataBundle().byId).filter((r) => 'figure' in r) as unknown as { id: string; figure: { archetype: string } }[]

describe('figure manifest', () => {
  it('has datacards to check', () => {
    expect(cards.length).toBeGreaterThanOrEqual(20)
  })

  it('every datacard archetype has a manifest entry', () => {
    const missing = cards.filter((c) => !manifest.bodies[c.figure.archetype]).map((c) => `${c.id} -> ${c.figure.archetype}`)
    expect(missing).toEqual([])
  })

  it('every manifest body and attachment file exists on disk', () => {
    for (const [slug, b] of Object.entries(manifest.bodies)) {
      const bare = b.file.replace(/\.glb$/i, '')
      const rel = bare.includes('/') ? bare : `bodies/${bare}`
      expect(existsSync(resolve(modelsDir, `${rel}.glb`)), `${slug}: ${b.file}`).toBe(true)
    }
    for (const [id, a] of Object.entries(manifest.attachments)) {
      const bare = a.file.replace(/\.glb$/i, '')
      const rel = bare.includes('/') ? bare : `attachments/${bare}`
      expect(existsSync(resolve(modelsDir, `${rel}.glb`)), `${id}: ${a.file}`).toBe(true)
    }
  })

  it('bodies are measured, sized and carry sockets inside their footprint', () => {
    for (const [slug, b] of Object.entries(manifest.bodies)) {
      expect(b.measured, slug).toBe(true)
      expect(b.archetype).toBe(slug)
      expect(b.heightIn, slug).toBeGreaterThan(0.5)
      expect(b.baseMm, slug).toBeGreaterThan(20)
      const s = b.sockets!
      for (const k of ['back', 'beltR', 'beltL', 'shoulderR', 'shoulderL', 'head'] as const) expect(s[k], `${slug}.${k}`).toBeTruthy()
      if (slug === 'kom-bomb-squig') {
        expect(s.handR).toBeUndefined()
        expect(s.handL).toBeUndefined()
      } else {
        expect(s.handR![0], `${slug} handR is on the figure's right (-x)`).toBeLessThan(0)
        expect(s.handL![0], `${slug} handL is on the figure's left (+x)`).toBeGreaterThan(0)
        expect(s.handR![1]).toBeLessThan(b.heightIn!)
      }
      expect(s.back![2], `${slug} back is on the -z side`).toBeLessThan(0)
    }
  })
})

describe('HOLDS and cues', () => {
  it('every hold class has a mount with a grip fraction and a box', () => {
    const classes: HoldClass[] = ['pistol', 'rifle', 'long', 'heavy', 'melee1h', 'melee2h', 'shield', 'pack', 'grenade', 'tool']
    for (const c of classes) {
      expect(HOLDS[c], c).toBeTruthy()
      expect(HOLDS[c].gripAt).toBeGreaterThanOrEqual(0)
      expect(HOLDS[c].gripAt).toBeLessThanOrEqual(1)
      expect(HOLDS[c].box.every((n) => n > 0)).toBe(true)
    }
    // guns point forward (+Z): ry = -PI/2 maps barrel-right to forward
    expect(HOLDS.rifle.socket).toBe('handR')
    expect(HOLDS.rifle.rot[1]).toBeCloseTo(-Math.PI / 2)
  })

  it('cues recoil, lunge, flinch and topple, then settle', () => {
    clearCues()
    const t0 = 1000
    triggerCue('a', 'shoot', t0)
    expect(cuePose('a', t0 + 120, false).dz).toBeLessThan(0)
    triggerCue('b', 'melee', t0)
    expect(cuePose('b', t0 + 190, false).dz).toBeGreaterThan(0)
    triggerCue('c', 'hit', t0)
    expect(Math.abs(cuePose('c', t0 + 100, false).dz)).toBeGreaterThan(0)
    expect(cuePose('a', t0 + 5000, false).dz).toBe(0)
    triggerCue('d', 'death', t0)
    expect(cuePose('d', t0 + 700, false).rx).toBeCloseTo(-Math.PI / 2)
    expect(cuePose('d', t0 + 1000, false).vis).toBe(0)
    expect(cuePose('e', t0, true).dy).toBeGreaterThanOrEqual(0)
    clearCues()
  })
})
