// The client side of the seven batch D teams (Blooded, Fellgor Ravagers, Chaos Cult, Goremongers, Scout Squad, Tempestus
// Aquilons, Exaction Squad): token looks and wording, the per-team set-aside wording, the prompt headlines and option labels
// of the new team hooks, the Chaos Cult card chips and the weapon sounds the rules verifiers asked to change.
import { describe, expect, it } from 'vitest'
import { abilityChoiceHeadline, abilityChoiceOption, ployCard } from '@/client/game/promptLabels'
import { describeEvent } from '@/client/game/labels'
import { lookupTerm } from '@/client/game/glossary'
import { cardChipsFor, setAsideWording, TEAM_PRESENTATION } from '@/client/teams'
import { tokenDef } from '@/client/ui/tokenDefs'
import { tokenTip } from '@/client/ui/tokenInfo'
import type { DecisionOption, GameEvent, PendingDecision } from '@/engine'
import { openReal } from '../fixtures/real'

/** Every token kind a batch D team puts on an operative (engine/teams/*.ts addToken kinds). */
const TOKEN_KINDS = [
  'ss.optics', 'ss.auspexScan', 'ss.trackEnemy', 'ss.target', 'ss.covertPosition', 'ss.rawPhysiology',
  'bl.blooded', 'bl.gaze', 'bl.name-whispered', 'bl.glory-kill', 'bl.stimm-enraged', 'bl.stimm-fortified', 'bl.shielding',
  'fg.frenzy', 'fg.gongKnell', 'fg.mantle',
  'gm.gore', 'gm.bleeding', 'gm.apotheosis', 'gm.gore-fuel', 'gm.claim-skull',
  'cc.ruinousIcon',
  'ta.detected',
  'ex.marked-for-justice', 'ex.medic', 'ex.apprehend', 'ex.veriscant', 'ex.revelatum-spot', 'ex.marksman-optics', 'ex.aggressive', 'ex.swift', 'ex.defensive',
]

const body = (term: string, kind?: Parameters<typeof lookupTerm>[1]): string => lookupTerm(term, kind)!.body

describe('batch D: tokens', () => {
  it('BD-C-001 every batch D token kind has a name, glyph and glossary tooltip of its own', () => {
    const terms = new Set<string>()
    for (const k of TOKEN_KINDS) {
      const d = tokenDef(k)
      expect(d.label, k).not.toMatch(/\./)
      expect(d.body, k).not.toBe('A token a team rule put on this operative.')
      expect(lookupTerm(d.term), `${k} -> ${d.term}`).not.toBeNull()
      expect(lookupTerm(d.term)!.kind, d.term).toBe('status')
      expect(terms.has(d.term), `${k} term unique`).toBe(false)
      terms.add(d.term)
      expect(tokenTip({ kind: k, owner: 'A', count: 2 }).title, k).toContain('x2')
    }
  })

  it('BD-C-002 Frenzy is drawn as a badge and its token entry describes the whole state', () => {
    expect(tokenDef('fg.frenzy').glyph.badge).toBe(true)
    const t = body('Frenzy token')
    for (const part of [/1 wound/, /activation or counteraction ends/, /critical strike/, /second normal strike/, /Conceal/, /injured/, /APL 1/, /Sweeping Blow/]) expect(t).toMatch(part)
  })

  it('BD-C-003 the verifiers\' wording fixes: Auspex, Blooded, Goremongers, Aquilons, Exaction, Chaos Cult', () => {
    expect(body('Scout Auspex Scan token')).toMatch(/against that enemy/)
    expect(body('Blooded token')).toMatch(/first friend to fall within 6 inches of an enemy/)
    expect(body('THUG', 'keyword')).toMatch(/3 or more Normal Dmg/)
    expect(body('BRIMSTONE GRENADIER', 'keyword')).toMatch(/4\+/)
    expect(body('STALKER', 'keyword')).toMatch(/2 inches of height/)
    expect(body('STALKER', 'keyword')).toMatch(/standing on Vantage/)
    expect(body('Bleeding token')).toMatch(/dual autopistols/)
    expect(body('DEVOTEE', 'keyword')).toMatch(/incapacitates an enemy within its control range/)
    expect(body('DEVOTEE', 'keyword')).not.toMatch(/kills in melee/)
    expect(body('Drop and Secure token')).toMatch(/contesting total there counts 1 higher/)
    expect(body('Detected token')).toMatch(/fights or retaliates/)
    expect(body('Drop marker')).toMatch(/horizontally/)
    expect(body('REVELATUM', 'keyword')).toMatch(/Seek Light/)
    expect(body('REVELATUM', 'keyword')).not.toMatch(/cover denial/)
  })
})

describe('batch D: weapons', () => {
  it('BD-C-004 the Fellgor bludgeon and crackthorn whip no longer borrow the power fist and the throwing knives', () => {
    const p = TEAM_PRESENTATION['fellgor-ravagers']!
    expect(p.sound!['fg.w.bludgeon']!.id).not.toBe('wpn-power-fist')
    expect(p.sound!['fg.w.crackthorn-whip-ranged']!.id).not.toBe('wpn-throwing-knives')
    expect(p.vfx!['fg.w.crackthorn-whip-ranged']!.family).not.toBe('knives')
  })
})

describe('batch D: set-aside wording', () => {
  it('BD-C-005 the Aquilons say above and Land, the Wyrmblade (and any team without its own) keep hiding and Emerge', () => {
    const ta = setAsideWording('tempestus-aquilons')
    expect(ta.term).toBe('Set up above')
    expect(ta.action).toBe('Land')
    expect(ta.mine(true)).toMatch(/Waiting above/)
    expect(ta.mine(true)).not.toMatch(/hid/i)
    expect(lookupTerm(ta.term)).not.toBeNull()
    const wb = setAsideWording('wyrmblade')
    expect(wb.term).toBe('HIDING')
    expect(wb.action).toBe('Emerge')
    expect(setAsideWording('kasrkin')).toEqual(wb)
    expect(setAsideWording(undefined)).toEqual(wb)
  })

  it('BD-C-006 the feed says an Aquilon lands from above and a Wyrmblade emerges from hiding', () => {
    const s = openReal({ teams: ['tempestus-aquilons', 'angels-of-death'] })
    const op = Object.values(s.operatives).find((o) => o.seat === 'A')!
    const ev = (kind: string): GameEvent => ({ type: 'OperativeReturned', seq: 1, seat: 'A', operativeId: op.id, pos: op.pos, wounds: op.wounds, ready: true, kind }) as unknown as GameEvent
    expect(describeEvent(ev('land'), s)).toMatch(/lands from above/)
    const w = openReal({ teams: ['wyrmblade', 'angels-of-death'] })
    const wop = Object.values(w.operatives).find((o) => o.seat === 'A')!
    expect(describeEvent({ ...(ev('emerge') as object), operativeId: wop.id } as unknown as GameEvent, w)).toMatch(/emerges from hiding/)
  })
})

describe('batch D: prompts', () => {
  const pendingFor = (context: Record<string, unknown>): PendingDecision => ({ id: 'd', seat: 'A', kind: 'ability.choice', window: 'setup.*', context, options: [], canPass: true }) as unknown as PendingDecision
  const opt = (id: string, labelKey: string, data: Record<string, unknown>): DecisionOption => ({ id, labelKey, type: 'ability.choice', action: { type: 'ability.choice', seat: 'A', decisionId: 'd', payload: { option: id } }, data }) as unknown as DecisionOption

  it('BD-C-007 the Scout Squad and pre-battle hooks name what they decide', () => {
    const s = openReal({ teams: ['scout-squad', 'angels-of-death'] })
    const op = Object.values(s.operatives).find((o) => o.seat === 'A')!
    for (const [ctx, re] of [
      [{ hook: 'preBattle', preBattle: true, offers: [{ hook: 'ssForwardScouting' }] }, /Forward Scouting/],
      [{ hook: 'preBattle', preBattle: true, offers: [{ hook: 'blRegularDosage' }] }, /Regular Dosage/],
      [{ hook: 'ssForwardScouting', operativeId: op.id, step: 'redeploy.op', left: 2 }, /Redeploy.*2 left/],
      [{ hook: 'ssForwardScouting', operativeId: op.id, step: 'marker', kind: 'tripAlarm' }, /Trip Alarm/],
      [{ hook: 'ssForwardScouting', operativeId: op.id, step: 'designate' }, /Designate Target/],
      [{ hook: 'ssAdaptableTraining', operativeId: op.id, left: 1 }, /Adaptable Training.*1 switch left/],
      [{ hook: 'ssStealthRelocation', operativeId: op.id, left: 2 }, /Stealth Relocation.*2 left/],
      [{ hook: 'exDeployNuncio', operativeId: op.id }, /Nuncio-aquila/],
      [{ hook: 'exMarkedForJustice', operativeId: op.id }, /Marked for Justice/],
    ] as [Record<string, unknown>, RegExp][]) {
      expect(abilityChoiceHeadline(pendingFor(ctx), s), JSON.stringify(ctx)).toMatch(re)
    }
  })

  it('BD-C-008 the Scout Squad follow-up options read as sentences, not label keys', () => {
    const labels = [
      abilityChoiceOption(opt('done', 'ss.fs.done', {})),
      abilityChoiceOption(opt('A1', 'ss.fs.redeployOp', { name: 'Scout Sniper' })),
      abilityChoiceOption(opt('4,5', 'ss.fs.tripSpot', { x: 4, z: 5 })),
      abilityChoiceOption(opt('B2', 'ss.fs.designate', { name: 'Intercessor', wounds: 3 })),
      abilityChoiceOption(opt('A2', 'ss.adaptable.flip', { name: 'Scout Warrior', order: 'engage' })),
      abilityChoiceOption(opt('done', 'ss.adaptable.done', {})),
      abilityChoiceOption(opt('A3', 'ss.stealth.dash', { name: 'Scout Gunner' })),
      abilityChoiceOption(opt('done', 'ss.stealth.done', {})),
    ].map((c) => c.label)
    expect(labels).toEqual([
      'Finish Forward Scouting',
      'Redeploy Scout Sniper',
      'Trip Alarm marker at 4.0, 5.0',
      'Designate Intercessor (3 wounds left)',
      'Scout Warrior: switch to Conceal',
      'Finish Adaptable Training',
      'Scout Gunner takes a free Dash',
      'No more Dashes',
    ])
  })

  it('BD-C-009 the Drop and Secure ploy names the marker it picks', () => {
    const s = openReal({ teams: ['tempestus-aquilons', 'angels-of-death'] })
    const m = s.markers.find((k) => k.kind === 'objective')
    if (!m) return
    const o = { id: 'p', labelKey: 'ploy', type: 'ploy.firefight', action: { type: 'ploy.firefight', seat: 'A', decisionId: 'd', payload: { ployId: 'ta.p.drop-and-secure', param: m.id } }, data: { cost: 1 } } as unknown as DecisionOption
    expect(ployCard(o, s, 'A').param).toMatch(/^Objective marker at -?\d/)
  })
})

describe('batch D: Chaos Cult', () => {
  it('BD-C-010 a Devotee has no card chips; a Mutant shows its form and its gifts from the engine', () => {
    const s = openReal({ teams: ['chaos-cult', 'angels-of-death'] })
    const dev = Object.values(s.operatives).find((o) => o.seat === 'A' && o.datacardId === 'cc.devotee')!
    expect(cardChipsFor(s, dev)).toEqual([])
    const mutant = { ...dev, datacardId: 'cc.mutant' }
    const chips = cardChipsFor({ ...s, operatives: { ...s.operatives, [dev.id]: mutant } }, mutant)
    expect(chips[0]!.label).toBe('Mutant')
    expect(chips[0]!.body).toMatch(/mutated once/)
    // another team never gets chips
    const foe = Object.values(s.operatives).find((o) => o.seat === 'B')!
    expect(cardChipsFor(s, foe)).toEqual([])
  })

  it('BD-C-011 the Mutation event reads as a change of body and Covert Guises shows its D3 to both players', () => {
    const s = openReal({ teams: ['chaos-cult', 'angels-of-death'] })
    const dev = Object.values(s.operatives).find((o) => o.seat === 'A' && o.datacardId === 'cc.devotee')!
    const t = describeEvent({ type: 'OperativeTransformed', seq: 1, seat: 'A', operativeId: dev.id, from: 'cc.devotee', to: 'cc.mutant' } as unknown as GameEvent, s)
    expect(t).toMatch(/becomes/)
    const g = describeEvent({ type: 'AbilityUsed', seq: 2, seat: null, operativeId: null, abilityId: 'cc.e.covert-guises', detail: 'D3: 2' } as unknown as GameEvent, s)
    expect(g).toMatch(/rolled a D3 and got 2/)
    const m = describeEvent({ type: 'AbilityUsed', seq: 3, seat: 'A', operativeId: dev.id, abilityId: 'cc.a.mutation', detail: 'mutant:chitinous' } as unknown as GameEvent, s)
    expect(m).not.toMatch(/mutant:chitinous/)
  })
})
