import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { chooseMat, getMatPref, matOverride, matThumbUrl, MATS, pickMat } from '@/client/board/mats'

const dir = resolve(process.cwd(), 'public/assets/mats')

describe('killzone mats', () => {
  it('lists the six mats with sane repeat and tint', () => {
    expect(MATS.map((m) => m.id)).toEqual(['plasteel-deck', 'rust-grating', 'cracked-concrete', 'ash-waste', 'gothic-flagstones', 'blood-foundry'])
    for (const m of MATS) {
      expect(m.name.length).toBeGreaterThan(3)
      expect(m.repeat).toBeGreaterThan(1)
      expect(m.repeat).toBeLessThan(6)
      expect(m.tint).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('has a texture, a thumbnail and a tile preview on disk for every mat (textures under 400 KB)', () => {
    for (const m of MATS) {
      const f = resolve(dir, m.file)
      expect(existsSync(f), m.file).toBe(true)
      expect(statSync(f).size).toBeLessThan(400 * 1024)
      expect(existsSync(resolve(dir, `${m.id}-thumb.jpg`)), `${m.id} thumb`).toBe(true)
      expect(existsSync(resolve(dir, `${m.id}-tile-preview.jpg`)), `${m.id} preview`).toBe(true)
    }
  })

  it('pickMat is deterministic from the seed and covers every mat', () => {
    expect(pickMat('e2e-1')).toBe(pickMat('e2e-1'))
    expect(pickMat(7)).toBe(pickMat('7'))
    const seen = new Set<string>()
    for (let s = 1; s <= 60; s++) seen.add(pickMat(s).id)
    expect([...seen].sort()).toEqual(MATS.map((m) => m.id).sort())
  })

  it('?mat=<id> overrides the seed pick and unknown ids are ignored', () => {
    expect(matOverride('?test=1&mat=ash-waste')?.id).toBe('ash-waste')
    expect(matOverride('?mat=nope')).toBeNull()
    expect(chooseMat('1', '?mat=blood-foundry').id).toBe('blood-foundry')
    expect(chooseMat('1', '?mat=nope')).toBe(pickMat('1'))
    expect(chooseMat('1', '')).toBe(pickMat('1'))
  })

  it('the Start screen pick beats the seed, random falls through, the URL beats both', () => {
    expect(chooseMat('1', '', 'ash-waste').id).toBe('ash-waste')
    expect(chooseMat('1', '', 'random')).toBe(pickMat('1'))
    expect(chooseMat('1', '?mat=blood-foundry', 'ash-waste').id).toBe('blood-foundry')
    expect(getMatPref()).toBe('random')
    expect(matThumbUrl('ash-waste', '/x/')).toBe('/x/assets/mats/ash-waste-thumb.jpg')
  })
})
