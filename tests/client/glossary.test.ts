// Glossary (client/game/glossary.ts): every status, action, characteristic, weapon trait, skill, fighter rule and wargear item the
// starter gangs use resolves to a plain-language entry in our own wording; free text links the right words and not the everyday
// ones; parameterised traits resolve through their bare name.
import { describe, expect, it } from 'vitest'
import { dataBundle } from '../../src/client/game/adapter'
import { allEntries, linkTerms, lookupTerm, traitLabel, traitParts } from '../../src/client/game/glossary'

const b = () => dataBundle()

function used() {
  const traits = new Set<string>()
  const skills = new Set<string>()
  const gear = new Set<string>()
  const rules = new Set<string>()
  for (const g of Object.values(b().starterGangs)) {
    for (const f of g.fighters) {
      f.skills.forEach((s) => skills.add(s))
      f.wargear.forEach((w) => gear.add(w))
      b().fighterTypes[f.type]!.rules.forEach((r) => rules.add(r.rule))
      for (const w of f.weapons) for (const p of b().weapons[w]!.profiles) p.traits.forEach((t) => traits.add(t.trait))
    }
  }
  return { traits, skills, gear, rules }
}

describe('glossary', () => {
  it('has an entry for every weapon trait the starter gangs use, written for players', () => {
    const { traits } = used()
    expect(traits.size).toBeGreaterThan(15)
    for (const id of traits) {
      const name = b().traits[id]!.name
      const e = lookupTerm(name, 'trait')
      expect(e, `trait ${name}`).not.toBeNull()
      expect(e!.kind).toBe('trait')
      expect(e!.body.length, name).toBeGreaterThan(20)
      // no rules-engineering notes in what a player reads
      expect(e!.body, name).not.toMatch(/\bv1\b|\bR-\d|not implemented|specified before use/i)
    }
  })

  it('has an entry for every action, skill, fighter rule and wargear item the starter gangs use', () => {
    for (const a of Object.values(b().actions)) {
      const e = lookupTerm(a.name, 'action')
      expect(e, `action ${a.name}`).not.toBeNull()
      expect(e!.kind).toBe('action')
    }
    const { skills, gear, rules } = used()
    for (const id of skills) expect(lookupTerm(b().skills[id]!.name), `skill ${id}`).not.toBeNull()
    for (const id of rules) expect(lookupTerm(b().rules[id]!.name), `rule ${id}`).not.toBeNull()
    for (const id of gear) expect(lookupTerm(b().wargear[id]!.name, 'wargear'), `wargear ${id}`).not.toBeNull()
  })

  it('explains the twelve characteristics and every status and condition', () => {
    for (const k of ['M', 'WS', 'BS', 'S', 'T', 'W', 'I', 'A', 'Ld', 'Cl', 'Wil', 'Int']) expect(lookupTerm(k, 'stat'), k).not.toBeNull()
    for (const t of ['Standing and Active', 'Standing and Engaged', 'Pinned', 'Prone', 'Seriously Injured', 'Out of Action', 'Broken', 'Ready', 'Flesh Wound', 'Blaze', 'Blind', 'Concussion', 'Out of Ammo']) {
      expect(lookupTerm(t), t).not.toBeNull()
    }
    for (const t of ['Priority', 'Bottle test', 'Nerve test', 'Hit roll', 'Wound roll', 'Armour save', 'Injury dice', 'Firepower dice', 'Group Activation', 'Cover', 'Vision arc', 'Target priority']) {
      expect(lookupTerm(t), t).not.toBeNull()
    }
  })

  it('looks terms up through aliases and parameters', () => {
    expect(lookupTerm('Rapid Fire (2)')!.term).toBe('Rapid Fire')
    expect(lookupTerm('Rapid Fire 2')!.term).toBe('Rapid Fire')
    expect(lookupTerm('Blast (3")')!.term).toBe('Blast')
    expect(lookupTerm('Cool')!.term).toBe('Cl')
    expect(lookupTerm('pinned')!.term).toBe('Pinned')
    expect(lookupTerm('Group Activation (2)')).not.toBeNull()
    expect(lookupTerm('no such term')).toBeNull()
    expect(lookupTerm('Power', 'trait')!.kind).toBe('trait')
  })

  it('formats a trait with its parameter', () => {
    const name = (id: string) => b().traits[id]?.name ?? id
    expect(traitLabel({ trait: 'core.t.rapid-fire', x: 2 }, name)).toBe('Rapid Fire (2)')
    expect(traitLabel({ trait: 'core.t.blast', inches: 3 }, name)).toBe('Blast (3")')
    expect(traitParts({ trait: 'core.t.unstable' }, name)).toEqual({ term: 'Unstable', label: 'Unstable' })
  })

  it('links glossary terms in running text, case-sensitively, and leaves everyday words alone', () => {
    const linked = (t: string) => linkTerms(t).filter((s) => typeof s !== 'string').map((s) => (s as { text: string }).text)
    expect(linked('A fighter that is Pinned or Seriously Injured cannot charge.')).toEqual(['Pinned', 'Seriously Injured'])
    expect(linked('You can move and shoot, but a Bottle test follows.')).toEqual(['Bottle test'])
    expect(linked('Rapid Fire (2) weapons roll Firepower dice.')).toEqual(['Rapid Fire (2)', 'Firepower dice'])
    expect(linked('nothing to see here')).toEqual([])
    // plain text comes back whole
    expect(linkTerms('hello').join('')).toBe('hello')
    expect(linkTerms('The gang rests. Pinned!').map((s) => (typeof s === 'string' ? s : s.text)).join('')).toBe('The gang rests. Pinned!')
  })

  it('keeps entries unique by name and kind, with no engine-room wording', () => {
    const seen = new Set<string>()
    for (const e of allEntries()) {
      const k = `${e.kind}:${e.term.toLowerCase()}`
      expect(seen.has(k), k).toBe(false)
      seen.add(k)
      expect(e.body.trim().length, e.term).toBeGreaterThan(8)
    }
  })
})
