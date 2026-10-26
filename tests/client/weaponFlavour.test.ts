// weaponFlavour.ts reads the flavour off the data; every weapon of both gangs and the core list has one the client knows.
import { describe, expect, it } from 'vitest'
import type { GameState } from '@/engine'
import { FLAVOURS, flavourOf, guessFlavour, isMeleeFlavour } from '@/client/weaponFlavour'
import { realBundle } from '../fixtures/real'

describe('weapon flavour', () => {
  it('every weapon in the data has a flavour the client knows', () => {
    for (const w of Object.values(realBundle().weapons)) expect(FLAVOURS, w.id).toContain(w.flavour)
  })

  it('reads the data, and guesses from the id only when the table has no such weapon', () => {
    const state = { data: { weapons: { 'esc.w.autogun': { flavour: 'stub' } } } } as unknown as GameState
    expect(flavourOf(state, 'esc.w.autogun')).toBe('stub')
    expect(flavourOf(state, 'esc.w.lasgun')).toBe('las')
    expect(flavourOf(null, 'gol.w.heavy-flamer')).toBe('flamer')
    expect(guessFlavour('gol.w.two-handed-hammer')).toBe('maul')
    expect(guessFlavour('mystery')).toBe('stub')
  })

  it('names the melee flavours', () => {
    expect((['chain', 'blade', 'maul', 'whip', 'crush'] as const).every(isMeleeFlavour)).toBe(true)
    expect((['stub', 'las', 'bolter', 'flamer', 'plasma', 'melta', 'grenade'] as const).some(isMeleeFlavour)).toBe(false)
  })
})
