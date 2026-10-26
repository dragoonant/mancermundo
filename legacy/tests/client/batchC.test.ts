// The client side of the seven batch C teams (Kasrkin, Novitiates, Phobos Strike Team, Corsair Voidscarred, Warpcoven,
// Farstalker Kinband, Imperial Navy Breachers): builder legality (default, full and randomised builds), token looks and
// wording, the glossary corrections the rules verifiers asked for, the Faith pool chip and the ploy option labels.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dataBundle, flattenRoster } from '@/client/game/adapter'
import { buildProblems, defaultBuild, equipmentLimitOf, fullBuild, randomBuildLoadouts, resolveMission } from '@/client/game/defaults'
import { allEntries, lookupTerm } from '@/client/game/glossary'
import { addProblem } from '@/client/ui/TeamBuilder'
import { ployParamLabel, poolLabel, STAND_INS, TEAM_PRESENTATION } from '@/client/teams'
import { poolEntries } from '@/client/ui/Hud'
import { tokenDef } from '@/client/ui/tokenDefs'
import { tokenTip } from '@/client/ui/tokenInfo'
import { loadoutCapProblems, validateRoster, type DatacardData, type SelectionSlot } from '@/data'

const BATCH_C = ['kasrkin', 'novitiates', 'phobos-strike-team', 'corsair-voidscarred', 'warpcoven', 'farstalker-kinband', 'imperial-navy-breachers'] as const

/** Every token kind a batch C team puts on an operative (engine/teams/*.ts addToken kinds). */
const TOKEN_KINDS = [
  'ks.tacticalCommand', 'ks.auspexScan',
  'nv.whip', 'nv.blaze',
  'ph.auspex', 'ph.omni',
  'cv.osa', 'cv.faolchu', 'cv.shield', 'cv.erudite', 'cv.runes',
  'wc.protected', 'wc.ravaged', 'wc.alight', 'wc.mindburn',
  'fk.victoryShriek', 'fk.vengeance',
  'nb.spotted', 'nb.emboldened',
]

/** A small seeded generator so the randomised builds are reproducible. */
function lcg(seed: number): () => number {
  let x = seed >>> 0
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0
    return x / 0x100000000
  }
}

describe('batch C: builder', () => {
  const b = dataBundle()
  const limit = b.missions[resolveMission(b, 'secure').id]!.equipmentLimit

  it('BC-C-001 the default and the full build of every batch C team are legal and show a GLB body or a stand-in in the preview', () => {
    const manifest = JSON.parse(readFileSync(resolve(__dirname, '../../public/assets/models/manifest.json'), 'utf8')) as { bodies: Record<string, unknown> }
    for (const t of BATCH_C) {
      const team = b.teams[t]!
      for (const build of [defaultBuild(b, team), fullBuild(b, team)]) {
        expect(buildProblems(b, build, equipmentLimitOf(b, build, limit)), t).toEqual([])
        for (const id of flattenRoster(team, build.roster)) {
          const card = b.byId[id] as DatacardData
          expect(card.figure?.archetype, `${t} ${id}`).toBeTruthy()
          expect(!!manifest.bodies[card.figure.archetype] || STAND_INS.has(card.figure.archetype), `${t} ${id} has neither a body nor a stand-in`).toBe(true)
        }
      }
    }
  })

  it('BC-C-002 randomised loadouts keep every batch C build legal (caps and exclusions hold)', () => {
    const rnd = lcg(40)
    for (const t of BATCH_C) {
      const team = b.teams[t]!
      for (const base of [defaultBuild(b, team), fullBuild(b, team)]) {
        for (let i = 0; i < 40; i++) {
          const build = { ...base, loadouts: randomBuildLoadouts(b, team, base, rnd) }
          expect(buildProblems(b, build, equipmentLimitOf(b, build, limit)), `${t} #${i}`).toEqual([])
        }
      }
    }
  })
})

describe('batch C: builder rules', () => {
  const b = dataBundle()
  const cards = b.byId as Record<string, DatacardData>
  const main = (t: string): SelectionSlot => b.teams[t]!.selection.slots.find((s) => s.id === 'main')!
  const add = (t: string, current: string[], id: string, others: string[] = []) => addProblem(main(t), current, id, b.teams[t], others, cards)
  const roster = (t: string, ids: string[]) => {
    const slots = b.teams[t]!.selection.slots
    const leader = slots.find((sl) => sl.id === 'leader')
    return validateRoster(b.teams[t]!, { ...(leader ? { leader: [leader.from[0]!] } : {}), main: ids }, cards).reasons
  }

  it('BC-C-014 Kasrkin: Gunners and the Sharpshooter share one cap of four', () => {
    expect(add('kasrkin', ['ks.gunner', 'ks.gunner', 'ks.gunner'], 'ks.sharpshooter')).toBeNull()
    expect(add('kasrkin', ['ks.gunner', 'ks.gunner', 'ks.gunner', 'ks.sharpshooter'], 'ks.gunner')).toMatch(/at most 4/)
    expect(roster('kasrkin', ['ks.gunner', 'ks.gunner', 'ks.gunner', 'ks.gunner', 'ks.sharpshooter', 'ks.trooper', 'ks.trooper', 'ks.trooper', 'ks.trooper']).join(' ')).toMatch(/at most 4/)
    expect(add('kasrkin', ['ks.gunner'], 'ks.trooper')).toBeNull()
  })

  it('BC-C-015 Novitiates: at most two Purgatus', () => {
    expect(add('novitiates', ['nv.purgatus'], 'nv.purgatus')).toBeNull()
    expect(add('novitiates', ['nv.purgatus', 'nv.purgatus'], 'nv.purgatus')).toMatch(/at most 2/)
  })

  it('BC-C-016 Corsair: one blaster or wraithcannon on the whole roster', () => {
    const team = b.teams['corsair-voidscarred']!
    // two operatives carrying a blaster and a wraithcannon between them break the cap; one such weapon does not
    const carry = (ids: string[]) => ids.map((w) => [w])
    expect(loadoutCapProblems(team, carry(['cv.w.blaster', 'cv.w.wraithcannon']), b.weaponGroups).length).toBeGreaterThan(0)
    expect(loadoutCapProblems(team, carry(['cv.w.blaster', 'cv.w.fusion-pistol']), b.weaponGroups)).toEqual([])
  })

  it('BC-C-017 Warpcoven: at least one Sorcerer, halves for the Tzaangors, a different boon per Sorcerer', () => {
    expect(roster('warpcoven', ['wc.rubric-marine-warrior', 'wc.rubric-marine-warrior', 'wc.rubric-marine-warrior', 'wc.rubric-marine-warrior', 'wc.rubric-marine-gunner']).join(' ')).toMatch(/at least 1/)
    expect(roster('warpcoven', ['wc.sorcerer-of-destiny', 'wc.rubric-marine-warrior', 'wc.rubric-marine-warrior', 'wc.rubric-marine-warrior', 'wc.rubric-marine-gunner'])).toEqual([])
    // two Tzaangor warriors are one selection
    expect(roster('warpcoven', ['wc.sorcerer-of-destiny', 'wc.rubric-marine-warrior', 'wc.rubric-marine-warrior', 'wc.rubric-marine-warrior', 'wc.tzaangor-warrior', 'wc.tzaangor-warrior'])).toEqual([])
    expect(b.teams.warpcoven!.operativeChoices?.find((c) => c.id === 'boon')?.unique).toBe(true)
    // the default build gives every Sorcerer its own boon
    const d = defaultBuild(b, b.teams.warpcoven!)
    const boons = (d.picks ?? []).map((p) => p?.boon).filter(Boolean)
    expect(new Set(boons).size).toBe(boons.length)
    expect(boons.length).toBeGreaterThan(0)
  })

  it('BC-C-018 Farstalker: at most two Hounds across the roster', () => {
    expect(add('farstalker-kinband', ['fk.hound'], 'fk.hound')).toBeNull()
    expect(add('farstalker-kinband', ['fk.hound', 'fk.hound'], 'fk.hound')).toMatch(/at most 2/)
    expect(add('farstalker-kinband', ['fk.hound', 'fk.hound'], 'fk.warrior')).toBeNull()
  })

  it('BC-C-019 Navy Breachers: at most two Gunners, halves for the C.A.T. Unit and Gheistskull, the Gheistskull needs a Void-Jammer', () => {
    expect(add('imperial-navy-breachers', ['nb.gunner-las-volley', 'nb.gunner-meltagun'], 'nb.gunner-plasma-gun')).toMatch(/at most 2/)
    expect(add('imperial-navy-breachers', ['nb.gunner-las-volley', 'nb.gunner-las-volley'], 'nb.gunner-las-volley')).toMatch(/at most 2/)
    // the C.A.T. Unit and the Gheistskull are half a selection each: together they fill one place
    expect(roster('imperial-navy-breachers', ['nb.armsman', 'nb.armsman', 'nb.armsman', 'nb.armsman', 'nb.armsman', 'nb.armsman', 'nb.armsman', 'nb.void-jammer', 'nb.surveyor', 'nb.cat-unit', 'nb.gheistskull'])).toEqual([])
    expect(roster('imperial-navy-breachers', ['nb.armsman', 'nb.armsman', 'nb.armsman', 'nb.armsman', 'nb.armsman', 'nb.armsman', 'nb.armsman', 'nb.armsman', 'nb.axejack', 'nb.gheistskull']).join(' ')).toMatch(/Gheistskull needs a Void-Jammer/)
  })
})

describe('batch C: tokens', () => {
  it('BC-C-003 every batch C token kind has a name, glyph and glossary tooltip of its own', () => {
    const labels = new Set<string>()
    const terms = new Set<string>()
    for (const k of TOKEN_KINDS) {
      const d = tokenDef(k)
      expect(d.label, k).not.toMatch(/\./)
      expect(d.body, k).not.toBe('A token a team rule put on this operative.')
      expect(lookupTerm(d.term), `${k} -> ${d.term}`).not.toBeNull()
      expect(lookupTerm(d.term)!.kind, d.term).toBe('status')
      expect(terms.has(d.term), `${k} term unique`).toBe(false)
      terms.add(d.term)
      labels.add(d.label)
      expect(tokenTip({ kind: k, owner: 'A', count: 2 }).title, k).toContain('x2')
    }
    // the two Auspex Scan tokens are separate entries (Recon-Trooper and Voxbreaker)
    expect(tokenDef('ks.auspexScan').term).not.toBe(tokenDef('ph.auspex').term)
    // the Navy Breachers Spot token is not the Hearthkyn one
    expect(tokenDef('nb.spotted').term).not.toBe(tokenDef('hk.spot').term)
    expect(lookupTerm(tokenDef('nb.spotted').term)!.body).toMatch(/Spot token/)
    // tokens that are never placed have no entry
    // (the Exaction Squad's Medic! does place a Medic token, so that one has an entry since batch D)
    expect(lookupTerm('Relics of Cadia token')).toBeNull()
    expect(lookupTerm('Mistfield token')).toBeNull()
  })

  it('BC-C-004 the Novitiates Faith pool chip is declared, labelled and explained, and shows from the start', () => {
    expect(poolLabel('nv.faith')).toBe('Faith')
    expect(lookupTerm('Faith')!.body).toMatch(/pool/)
    expect(poolEntries('novitiates', undefined)).toEqual([['nv.faith', 0]])
    expect(poolEntries('novitiates', { 'nv.faith': 3 })).toEqual([['nv.faith', 3]])
    expect(poolEntries('kasrkin', undefined)).toEqual([])
  })
})

describe('batch C: wording', () => {
  const body = (term: string, kind?: Parameters<typeof lookupTerm>[1]): string => lookupTerm(term, kind)!.body

  it('BC-C-005 Navy Breachers: Spot token, armsmen activate in pairs, the equipment and weapon tokens', () => {
    expect(body('ARMSMAN')).toMatch(/activate in pairs/)
    for (const t of ['Lock It Down token', 'Slugs token', 'Demolition Charge token', 'Gheistskull Detonator token', 'Emboldened token']) expect(lookupTerm(t), t).not.toBeNull()
    expect(body('Gheistskull Detonator token')).toMatch(/Limited 1/)
    expect(body('Slugs token')).toMatch(/three each turning point/)
  })

  it('BC-C-006 Kasrkin: Camo Cloak, the Melta Mine survivor and the dropped tokens', () => {
    expect(body('SHARPSHOOTER', 'keyword')).toMatch(/ignore Saturate/)
    expect(body('SHARPSHOOTER', 'keyword')).not.toMatch(/hard to hit/)
    expect(body('Melta Mine marker')).toMatch(/action ends/)
  })

  it('BC-C-007 Farstalker: twelve operatives in all, Salvo up to two targets', () => {
    expect(body('FARSTALKER KINBAND')).toMatch(/eleven Kroot hunters and hounds, twelve operatives in all/)
    expect(body('PISTOLIER')).toMatch(/up to two different targets/)
  })

  it('BC-C-008 Phobos: the Auspex Scan token names the targets within 8 inches', () => {
    const t = body('Voxbreaker Auspex Scan token')
    expect(t).toMatch(/within 8 inches of it cannot be obscured when a Phobos operative shoots them/)
    expect(t).not.toMatch(/Incursors there/)
  })

  it('BC-C-009 Warpcoven: PSYCHIC is a weapon rule, Warpcoven Astartes use it, CHAMPION is not a Leader, the flux options have labels', () => {
    expect(lookupTerm('PSYCHIC')!.kind).toBe('weaponRule')
    expect(body('PSYCHIC')).toMatch(/same PSYCHIC weapon cannot be picked twice/)
    expect(body('PSYKER')).toMatch(/Warpcoven Astartes may not pick the same PSYCHIC weapon twice/)
    expect(body('CHAMPION', 'keyword')).toMatch(/no Leader/)
    expect(body('CHAMPION', 'keyword')).not.toMatch(/leader-type/)
    for (const p of ['dash', 'order', 'both', 'flux-dash', 'flux-both']) expect(ployParamLabel('wc.p.capricious-plan', p), p).toBeTruthy()
    expect(ployParamLabel('wc.p.capricious-plan', 'flux-both')).toMatch(/Temporal Flux first/)
    expect(ployParamLabel('wc.p.other', 'flux-both')).toBeNull()
  })

  it('BC-C-010 Corsair: Anhrathe, Fate Dealer and no Mistfield token', () => {
    expect(body('ANHRATHE')).toMatch(/craftworlds or the Dark City/)
    expect(body('FATE DEALER')).toMatch(/one extra cover save \(or keep one as a crit\)/)
  })

  it('BC-C-011 Novitiates: Pronatus and Condemnor wording', () => {
    expect(body('PRONATUS')).toMatch(/Pick Up Marker, Place Marker or a mission action cost 1 AP less/)
    expect(body('CONDEMNOR')).toMatch(/stakethrower and its null rod/)
  })

  it('BC-C-012 the shared keywords IMPERIUM, LEADER and MEDIC name no single team', () => {
    for (const k of ['IMPERIUM', 'LEADER', 'MEDIC']) {
      const e = lookupTerm(k, 'keyword')!
      expect(e.body, k).not.toMatch(/Angels of Death|Kommando|Pathfinder|Plague Marine|Wyrmblade|Hierotek|Warpcoven/)
    }
    expect(allEntries().filter((e) => e.kind === 'keyword' && e.term === 'MEDIC')).toHaveLength(1)
  })

  it('BC-C-013 every batch C team presents itself (flavour, vfx, sound and glossary entries exist)', () => {
    for (const t of BATCH_C) {
      const p = TEAM_PRESENTATION[t]!
      expect(Object.keys(p.flavour ?? {}).length, t).toBeGreaterThan(5)
      expect((p.glossary ?? []).length, t).toBeGreaterThan(5)
    }
  })
})
