// The tokens over a fighter: a pip per Wound, a mark per Flesh Wound, chips for Ready, Broken, Blaze and Out of Ammo.
import { describe, expect, it } from 'vitest'
import type { Fighter } from '@/engine'
import { chipsFor, outOfAmmo, pips } from '@/client/figures/FighterPips'

const fighter = (over: Partial<Fighter> = {}): Fighter =>
  ({ id: 'a1', wounds: 2, maxWounds: 3, fleshWounds: 1, ready: true, conditions: {}, weapons: [{ weaponId: 'w', ammo: 'ok', lostProfiles: [] }], ...over }) as unknown as Fighter

describe('fighter pips and chips', () => {
  it('counts Wounds left and lost, Flesh Wounds, and honours the director override', () => {
    expect(pips(fighter())).toEqual({ left: 2, lost: 1, flesh: 1 })
    expect(pips(fighter(), 1)).toEqual({ left: 1, lost: 2, flesh: 1 })
    expect(pips(fighter({ maxWounds: 20, wounds: 20 }))).toEqual({ left: 12, lost: 0, flesh: 1 })
  })

  it('shows Ready only in the Action phase and only while the fighter can still activate', () => {
    expect(chipsFor(fighter(), true).map((c) => c.id)).toEqual(['ready'])
    expect(chipsFor(fighter(), false)).toEqual([])
    expect(chipsFor(fighter({ ready: false }), true)).toEqual([])
  })

  it('shows conditions and a dry weapon', () => {
    const f = fighter({
      conditions: { broken: { since: 1 }, blaze: { since: 1 } },
      weapons: [
        { weaponId: 'a', ammo: 'ok', lostProfiles: [] },
        { weaponId: 'b', ammo: 'out', lostProfiles: [] },
      ],
    })
    expect(outOfAmmo(f)).toBe(true)
    expect(chipsFor(f, false).map((c) => c.id)).toEqual(['broken', 'blaze', 'ammo'])
  })
})
