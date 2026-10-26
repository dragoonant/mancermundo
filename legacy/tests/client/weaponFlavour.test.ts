// Every weapon in the data has an explicit flavour (audio and vfx read it; the figure stand-in derives its hold from it).
import { ALL_WEAPON_IDS, isPresented } from '../fixtures/presentation'
import { describe, expect, it } from 'vitest'
import { dataBundle } from '@/client/game/adapter'
import { FLAVOURS, WEAPON_FLAVOUR, flavourOf } from '@/client/weaponFlavour'
import { holdClassOf } from '@/client/figures/hold'

interface W {
  id: string
  name: string
  type: 'ranged' | 'melee'
  rules: { rule: string; inches?: number }[]
}
const weapons = Object.values(dataBundle().byId).filter((r) => 'atk' in r && 'dmg' in r && isPresented(r)) as unknown as W[]

describe('weaponFlavour', () => {
  it('data has weapons from both teams and the core list', () => {
    expect(weapons.some((w) => w.id.startsWith('aod.'))).toBe(true)
    expect(weapons.some((w) => w.id.startsWith('kom.'))).toBe(true)
    expect(weapons.some((w) => w.id.startsWith('core.'))).toBe(true)
  })

  it('classifies every weapon id with a known flavour', () => {
    const missing = weapons.filter((w) => !(w.id in WEAPON_FLAVOUR)).map((w) => w.id)
    expect(missing).toEqual([])
    for (const w of weapons) expect(FLAVOURS).toContain(WEAPON_FLAVOUR[w.id])
  })

  it('has no stale entries for weapons that no longer exist', () => {
    const ids = ALL_WEAPON_IDS
    expect(Object.keys(WEAPON_FLAVOUR).filter((id) => !ids.has(id))).toEqual([])
  })

  it('melee profiles map to melee flavours and ranged ones do not', () => {
    const melee = new Set(['chain', 'crush', 'blade', 'bite'])
    for (const w of weapons) {
      if (w.type === 'melee') expect(melee.has(flavourOf(w.id)), `${w.id} is melee`).toBe(true)
    }
    expect(flavourOf('some.unknown-flamer')).toBe('flamer')
  })

  it('gives every weapon a hold class for the stand-in', () => {
    for (const w of weapons) expect(holdClassOf(w.id, w)).toBeTruthy()
    expect(holdClassOf('kom.w.power-klaw', weapons.find((w) => w.id === 'kom.w.power-klaw'))).toBe('melee2h')
  })
})
