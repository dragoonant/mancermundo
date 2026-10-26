// Glossary: every game term the UI shows resolves to a plain-language entry in our own wording, and free text links the
// right words (and not the everyday ones).
import { describe, expect, it } from 'vitest'
import { dataBundle } from '@/client/game/adapter'
import { ACTION_LABEL } from '@/client/game/labels'
import { allEntries, linkTerms, lookupTerm } from '@/client/game/glossary'
import type { AbilityData, DatacardData, EquipmentData, PloyData, WeaponData } from '@/data'

const records = () => Object.values(dataBundle().byId)
const weapons = () => records().filter((r): r is WeaponData => 'atk' in r && 'hit' in r && 'dmg' in r)
const datacards = () => records().filter((r): r is DatacardData => 'stats' in r && 'keywords' in r)

function ruleName(r: { rule: string; x?: number; inches?: number; target?: string | number; crits?: boolean }): string {
  const rec = dataBundle().byId[r.rule] as { name: string }
  const val = r.inches !== undefined ? ` ${r.inches}″` : r.x !== undefined ? ` ${r.x}` : r.target !== undefined ? ` ${String(r.target).replace(/\+?$/, '+')}` : ''
  return `${rec.name}${r.crits ? ' Crits' : ''}${val}`
}

const linkedTexts = (t: string) => linkTerms(t).filter((s) => typeof s !== 'string').map((s) => (s as { text: string }).text)

describe('glossary', () => {
  it('resolves every weapon rule on every weapon, parameterised forms included, with the parameter filled in', () => {
    let seen = 0
    for (const w of weapons()) {
      for (const r of w.rules) {
        const name = ruleName(r as never)
        const e = lookupTerm(name)
        expect(e, `${w.id}: ${name}`).not.toBeNull()
        expect(e!.kind, name).toBe('weaponRule')
        seen++
      }
    }
    expect(seen).toBeGreaterThan(40)
    expect(lookupTerm('Piercing 1')!.body).toMatch(/\b1 fewer/)
    expect(lookupTerm('Lethal 5+')!.body).toContain('5+')
    expect(lookupTerm('Blast 2"')!.body).toContain('2″')
    expect(lookupTerm('Devastating 3')!.body).toContain('3 damage')
    expect(lookupTerm('Range 6″')!.body).toContain('6″')
    expect(lookupTerm('Piercing Crits 1')!.body).toMatch(/crit/i)
    expect(lookupTerm('piercing')!.kind).toBe('weaponRule')
  })

  it('resolves every operative keyword of every team, and says which team a faction keyword belongs to', () => {
    const cards = datacards()
    expect(cards.length).toBeGreaterThan(15)
    for (const c of cards) for (const k of c.keywords) expect(lookupTerm(k, 'keyword'), `${c.id}: ${k}`).not.toBeNull()
    for (const t of Object.values(dataBundle().teams)) {
      const e = lookupTerm(t.factionKeyword, 'keyword')!
      expect(e.kind).toBe('keyword')
      expect(e.body).toContain(t.name)
    }
    expect(lookupTerm('LEADER')!.body).toMatch(/Leader|commander/)
  })

  it('resolves every ability, unique action, ploy and piece of equipment by name', () => {
    let n = 0
    for (const r of records()) {
      const a = r as Partial<AbilityData & PloyData & EquipmentData>
      const isAbility = typeof a.kind === 'string' && ['ability', 'uniqueAction', 'factionRule', 'weaponRule'].includes(a.kind) && !('stats' in r)
      const isPloy = a.type === 'strategy' || a.type === 'firefight'
      const isEquipment = a.scope === 'universal' || a.scope === 'faction'
      if (!(isAbility || isPloy || isEquipment) || !a.name) continue
      expect(lookupTerm(a.name), a.id).not.toBeNull()
      n++
    }
    expect(n).toBeGreaterThan(60)
    expect(lookupTerm('Command Re-roll')!.kind).toBe('ploy')
    expect(lookupTerm('GET IT DUN!')!.body).toMatch(/6 inches/)
    expect(lookupTerm('Get It Dun')).not.toBeNull()
  })

  it('covers the core terms and every universal action', () => {
    const core = [
      'APL', 'Move', 'Save', 'Wounds', 'Atk', 'Hit', 'Dmg', 'Engage', 'Conceal', 'Ready', 'Expended', 'Injured', 'Incapacitated', 'Visible', 'Obscured', 'In cover', 'Cover',
      'Light terrain', 'Heavy terrain', 'Vantage', 'Control range', 'Valid target', 'Activation', 'Counteract', 'Turning point', 'Initiative', 'Command points', 'CP', 'Victory points', 'VP',
      'Crit op', 'Tac op', 'Kill op', 'Normal success', 'Critical success', 'Crit', 'Fail', 'Block', 'Retain', 'Re-roll', 'Command Re-roll', 'Guard', 'Objective marker', 'Wholly within',
      'Strategy ploy', 'Firefight ploy', 'Equipment', 'Gambit', 'Pick Up Marker', 'Place Marker',
    ]
    for (const t of core) expect(lookupTerm(t), t).not.toBeNull()
    for (const label of Object.values(ACTION_LABEL)) expect(lookupTerm(label), label).not.toBeNull()
    expect(lookupTerm('Fall Back')!.kind).toBe('action')
    expect(lookupTerm('Hit 3+')!.term).toBe('Hit')
  })

  it('links "Piercing 1" and "Engage" in a sentence and keeps the matched text', () => {
    const text = 'A Bolt rifle with Piercing 1 can shoot while Engage is set.'
    const segs = linkTerms(text)
    const hits = segs.filter((s): s is Exclude<typeof s, string> => typeof s !== 'string')
    expect(hits.map((h) => h.text)).toEqual(expect.arrayContaining(['Piercing 1', 'Engage']))
    expect(hits.find((h) => h.text === 'Piercing 1')!.entry.kind).toBe('weaponRule')
    expect(segs.map((s) => (typeof s === 'string' ? s : s.text)).join('')).toBe(text)
  })

  it('does not link everyday lower-case words', () => {
    expect(linkedTexts('you can move and then hit the place where they block and fail to save')).toEqual([])
    expect(linkedTexts('a heavy hot silent range with limited seek')).toEqual([])
    expect(linkedTexts('Move then Hit')).toEqual(['Move', 'Hit'])
    expect(linkedTexts('It is in cover and obscured, so it is injured.')).toEqual(['in cover', 'obscured', 'injured'])
  })

  it('links operative keywords only in caps or Title Case, longest match first', () => {
    expect(linkedTexts('Only the BOSS NOB or a Grot may do it.')).toEqual(['BOSS NOB', 'Grot'])
    expect(linkedTexts('the grot boss nob')).toEqual([])
    expect(linkedTexts('Light terrain and Seek Light')).toEqual(['Light terrain', 'Seek Light'])
    expect(linkedTexts('Friendly Kommandos gain Rending.')).toEqual(['Kommandos', 'Rending'])
  })

  it('has a non-empty body for every entry and a lookup for each term', () => {
    const all = allEntries()
    expect(all.length).toBeGreaterThan(150)
    for (const e of all) {
      expect(e.body.trim().length, e.term).toBeGreaterThan(15)
      expect(lookupTerm(e.term), e.term).not.toBeNull()
    }
  })

  it('keeps 2021-edition and 40k-10th words out of every body', () => {
    for (const e of allEntries()) {
      expect(e.body, e.term).not.toMatch(/wound roll|overwatch|armou?r penetration|battle-?shock|coherency|parry/i)
    }
  })

  it('links an event-feed style line quickly and caches the result', () => {
    const line = 'A1 Boss Nob attack (need 3+): crit, normal, fail. Seat B plays Skulk About; Piercing 1, Blast 2″, Lethal 5+ apply.'
    const t0 = performance.now()
    for (let i = 0; i < 2000; i++) linkTerms(`${line} ${i % 50}`)
    expect(performance.now() - t0).toBeLessThan(1500)
    expect(linkTerms(line)).toBe(linkTerms(line))
  })
})
