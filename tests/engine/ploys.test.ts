import { describe, expect, it } from 'vitest'
import { step, validate } from '@/engine'
import { act } from '@/engine/actions'
import { gambitOffers, offersFor } from '@/engine/ploys'
import { ScriptedRng } from '@/engine/rng'
import { activeTactics } from '@/engine/conditions'
import type { GameEvent } from '@/engine/events'
import type { GameState, PendingDecision } from '@/engine/types'
import { defaultAnswer, drive, place } from '../fixtures/helpers'
import { play } from '../fixtures/attack'
import { activateOp, edit, hasOption, newRealGame, openReal, opOf, optionIds, passIt, realGame, roster, take } from '../fixtures/real'

/** Drive a real game to the first gambit decision (A holds initiative; both players have CP 3 in TP1). */
function toGambit(o: Parameters<typeof newRealGame>[0] = {}): GameState {
  const first = newRealGame(o, 'ploys').state
  return drive(first, (st) => st.pending?.kind === 'strategy.gambit', 800, new ScriptedRng([6, 1, 6, 1]))
}

function ployIds(p: PendingDecision): string[] {
  return (p.options ?? []).map((o) => (o.action.payload as { gambitId?: string; ployId?: string }).gambitId ?? (o.action.payload as { ployId?: string }).ployId ?? o.id)
}

describe('PLOY strategy ploys (STRATEGIC GAMBITs)', () => {
  it('SEQ-007 the gambit step offers every usable strategy ploy of the team, with its variants and cost', () => {
    const s = toGambit()
    expect(s.pending).toMatchObject({ kind: 'strategy.gambit', seat: 'A', canPass: true })
    const ids = [...new Set(ployIds(s.pending!))].sort()
    expect(ids).toEqual(['aod.p.adaptive-tactics', 'aod.p.and-they-shall-know-no-fear', 'aod.p.combat-doctrine', 'aod.p.indomitus'])
    const doctrines = s.pending!.options!.filter((o) => (o.action.payload as { gambitId: string }).gambitId === 'aod.p.combat-doctrine')
    expect(doctrines.map((o) => (o.action.payload as { param: string }).param).sort()).toEqual(['assault', 'devastator', 'tactical'])
    for (const o of s.pending!.options!) expect(o.data!.cost).toBe(1)
    // Adaptive Tactics offers every tactic except the two the team already has
    const adapt = s.pending!.options!.filter((o) => (o.action.payload as { gambitId: string }).gambitId === 'aod.p.adaptive-tactics')
    expect(adapt).toHaveLength(6)
    expect(adapt.map((o) => (o.action.payload as { param: string }).param)).not.toContain('aod.a.ct-sharpshooter')
  })

  it('SEQ-008 a gambit is used once per player per turning point and needs the CP', () => {
    let s = toGambit()
    expect(s.players.A.cp).toBe(3)
    s = take(s, 'aod.p.combat-doctrine:tactical').state
    expect(s.players.A.cp).toBe(2)
    expect(s.config.A.doctrine).toBe('tactical')
    expect(s.ledger.A.tp).toContain('aod.p.combat-doctrine')
    expect(s.pending).toMatchObject({ kind: 'strategy.gambit', seat: 'B' })
    const b = s.pending!
    expect(new Set(ployIds(b))).toEqual(new Set(['kom.p.dakka-dakka-dakka', 'kom.p.waaagh', 'kom.p.skulk-about'])) // SSSSHHHH! is not in TP1
    s = passIt(s).state
    // A again: Combat Doctrine is gone, the others remain
    expect(new Set(ployIds(s.pending!))).toEqual(new Set(['aod.p.adaptive-tactics', 'aod.p.and-they-shall-know-no-fear', 'aod.p.indomitus']))
    expect(step(s, act.pass(s.pending!)).rejection).toBeUndefined()
    // a repeat is rejected outright
    const again = step(s, { type: 'strategy.gambit', seat: 'A', decisionId: s.pending!.id, payload: { gambitId: 'aod.p.combat-doctrine', param: 'assault' } })
    expect(again.rejection?.code).toBe('E_NOT_AN_OPTION')
    // PLOY-004 no CP: nothing is offered and the step ends by itself
    const broke = edit(toGambit(), () => undefined)
    expect(gambitOffers(edit(broke, (st) => (st.players.A.cp = 0)), 'A')).toEqual([])
  })

  it('PLOY-003 firefight ploys cannot be used in the Strategy phase', () => {
    const s = toGambit()
    expect(ployIds(s.pending!)).not.toContain('aod.p.adjust-doctrine')
    const r = step(s, { type: 'strategy.gambit', seat: 'A', decisionId: s.pending!.id, payload: { gambitId: 'aod.p.shock-assault' } })
    expect(r.rejection?.code).toBe('E_NOT_AN_OPTION')
    expect(validate(s, { type: 'strategy.gambit', seat: 'A', decisionId: s.pending!.id, payload: { gambitId: 'core.p.command-re-roll' } })?.code).toBe('E_NOT_AN_OPTION')
  })

  it('Combat Doctrine ends with the turning point, Adaptive Tactics replaces the secondary tactic until then', () => {
    let s = toGambit()
    s = take(s, 'aod.p.adaptive-tactics:aod.a.ct-hardy').state
    const marine = Object.values(s.operatives).find((o) => o.seat === 'A')!
    expect(activeTactics(s, marine)).toEqual(['aod.a.ct-sharpshooter', 'aod.a.ct-hardy'])
    expect(s.config.A.adaptive).toBe('aod.a.ct-hardy')
    // play the turning point out: the tactic reverts
    s = drive(s, (st) => st.turningPoint === 2 && st.pending?.kind === 'strategy.initiative', 800, new ScriptedRng([6, 1, 6, 1, 6, 1]))
    expect(s.config.A.adaptive).toBeNull()
    expect(activeTactics(s, Object.values(s.operatives).find((o) => o.seat === 'A')!)).toEqual(['aod.a.ct-sharpshooter', 'aod.a.ct-stealthy'])
    // per-turning-point ledgers reset
    expect(s.ledger.A.tp).toEqual([])
  })

  it('SSSSHHHH! (TP2+): eligible Kommandos take free Dashes one after another, then the gambit step goes on', () => {
    let s = toGambit()
    s = edit(s, (st) => {
      st.turningPoint = 2
      // the Kommandos stay far from every enemy (they start in their own drop zone, more than 6" away) and have Conceal
      st.players.B.cp = 3
    })
    s = passIt(s).state // A passes
    expect(ployIds(s.pending!)).toContain('kom.p.ssssshhhh')
    s = take(s, 'kom.p.ssssshhhh').state
    expect(s.players.B.cp).toBe(2)
    const dashes: string[] = []
    while (s.pending?.kind === 'move.path') {
      expect(s.pending.constraints).toMatchObject({ kind: 'dash', maxInches: 3 })
      dashes.push(s.pending.context.operativeId as string)
      s = passIt(s).state // each free Dash is optional: pass cancels it
    }
    expect(dashes.length).toBeGreaterThanOrEqual(5)
    expect(new Set(dashes).size).toBe(dashes.length)
    expect(s.pending).toMatchObject({ kind: 'strategy.gambit', seat: 'A' }) // the step resumed
    expect(s.firefight.activation).toBeNull()
    expect(s.firefight.stack ?? []).toEqual([])
  })
})

describe('PLOY firefight windows', () => {
  it('a window opens only when the seat can actually use something', () => {
    const s = openReal()
    const sniper = opOf(s, 'A', 'aod.eliminator-sniper')
    // AoD at activation start: Heroic Leader lets the team play Combat Doctrine as an Angel of Death operative activates
    let t = take(take(s, sniper).state, 'engage').state
    expect(t.pending).toMatchObject({ kind: 'ploy.firefight', seat: 'A' })
    expect(optionIds(t).sort()).toEqual(['aod.p.combat-doctrine:assault@heroic', 'aod.p.combat-doctrine:devastator@heroic', 'aod.p.combat-doctrine:tactical@heroic'])
    // no CP: no window
    const broke = edit(s, (st) => {
      st.players.A.cp = 0
    })
    t = take(take(broke, sniper).state, 'engage').state
    expect(t.pending!.kind).toBe('firefight.action')
  })

  it('Heroic Leader (b): Combat Doctrine at an activation, normal cost, and not if already used this turning point', () => {
    const s = openReal()
    const sniper = opOf(s, 'A', 'aod.eliminator-sniper')
    let t = take(take(s, sniper).state, 'engage').state
    t = take(t, 'aod.p.combat-doctrine:devastator@heroic').state
    expect(t.players.A.cp).toBe(2)
    expect(t.config.A.doctrine).toBe('devastator')
    expect(t.ledger.A.tp).toEqual(expect.arrayContaining(['aod.a.heroic-leader', 'aod.p.combat-doctrine']))
    expect(t.pending!.kind).toBe('firefight.action')
    // the Captain must be in the killzone and out of enemy control range
    const engaged = edit(s, (st) => {
      const cap = opOf(st, 'A', 'aod.space-marine-captain')
      st.operatives[cap]!.pos = { x: 0, y: 0, z: 0 }
      st.operatives[opOf(st, 'B', 'kom.boy')]!.pos = { x: 1.6, y: 0, z: 0 }
    })
    const u = take(take(engaged, sniper).state, 'engage').state
    expect(u.pending!.kind).toBe('firefight.action')
  })

  it('PLOY-002 a firefight ploy is once per player per turning point (Shake It Off)', () => {
    let s = openReal()
    const sniper = opOf(s, 'A', 'aod.eliminator-sniper')
    s = take(take(s, sniper).state, 'engage').state
    s = take(s, 'aod.p.combat-doctrine:tactical@heroic').state
    s = take(s, 'end').state
    // B activates a Kommando: Shake It Off is offered
    const boy = opOf(s, 'B', 'kom.boy')
    const burna = opOf(s, 'B', 'kom.burna-boy')
    s = take(take(s, boy).state, 'engage').state
    expect(s.pending).toMatchObject({ kind: 'ploy.firefight', seat: 'B' })
    expect(optionIds(s)).toContain('kom.p.shake-it-off')
    s = take(s, 'kom.p.shake-it-off').state
    expect(s.players.B.cp).toBe(2)
    expect(s.operatives[boy]!.flags.ignoreApl).toBe(true)
    s = take(s, 'end').state
    // A's next activation, then B's second Kommando: the ploy is spent for this turning point
    s = activateOp(s, opOf(s, 'A', 'aod.intercessor-warrior'))
    s = take(s, 'end').state
    s = take(take(s, burna).state, 'engage').state
    expect(s.pending!.kind).toBe('firefight.action')
    // it is gone at the start of the next turning point
    const next = drive(s, (st) => st.pending?.kind === 'strategy.initiative' && st.turningPoint === 2, 800, new ScriptedRng([6, 1, 6, 1, 6, 1]))
    expect(next.operatives[boy]!.flags.ignoreApl).toBeUndefined()
    expect(next.ledger.B.tp).toEqual([])
  })

  it('Shake It Off makes the Kommando ignore APL changes (Stun) for the turning point', () => {
    let s = openReal()
    s = take(take(s, opOf(s, 'A', 'aod.eliminator-sniper')).state, 'engage').state
    s = take(s, 'end' in {} ? 'end' : 'aod.p.combat-doctrine:tactical@heroic').state
    s = take(s, 'end').state
    const boy = opOf(s, 'B', 'kom.boy')
    s = take(take(s, boy).state, 'engage').state
    s = take(s, 'kom.p.shake-it-off').state
    expect(s.operatives[boy]!.apl).toBe(2)
    const stunned = edit(s, (st) => {
      st.operatives[boy]!.aplMods = -1
    })
    // effectiveApl ignores the change
    return import('@/engine/state').then(({ effectiveApl }) => {
      expect(effectiveApl(stunned.operatives[boy]!)).toBe(2)
    })
  })

  it('Wrath of Vengeance: a counteracting Angel of Death takes one extra free action that differs; Chapter Reliquaries make it free', () => {
    let s = openReal({ rosterA: roster(['aod.assault-intercessor-sergeant']), equipmentA: ['aod.e.chapter-reliquaries'], rosterB: roster(['kom.boss-nob', 'kom.boy', 'kom.boy']) })
    const sgt = opOf(s, 'A', 'aod.assault-intercessor-sergeant')
    s = place(s, sgt, -5, 0)
    // A's only operative activates and ends; one Kommando activates; A, with nothing ready, may counteract
    s = activateOp(s, sgt)
    s = take(s, 'end').state
    s = activateOp(s, opOf(s, 'B', 'kom.boss-nob'))
    s = take(s, 'end').state
    expect(s.pending!.kind).toBe('firefight.activate')
    expect(s.pending!.seat).toBe('A')
    expect(hasOption(s, `counteract:${sgt}`)).toBe(true)
    s = take(s, `counteract:${sgt}`).state
    // the Reliquaries make Wrath cost 0 CP for an Engaged operative
    expect(s.pending).toMatchObject({ kind: 'ploy.firefight', seat: 'A' })
    expect(s.pending!.options![0]!.data).toMatchObject({ cost: 0 })
    const cp = s.players.A.cp
    s = take(s, 'aod.p.wrath-of-vengeance').state
    expect(s.players.A.cp).toBe(cp)
    expect(s.firefight.activation).toMatchObject({ bonus: 1, counteract: true })
    s = take(s, 'dash').state
    expect(s.pending!.kind).toBe('move.path')
    s = passIt(s).state // cancel: nothing performed
    expect(s.firefight.activation!.performed).toEqual([])
    s = take(s, 'reposition').state
    const p = s.pending!
    s = step(s, act.path(p, [{ x: -5, z: 1.5 }])).state
    // the second action must differ from the first
    expect(optionIds(s)).not.toContain('reposition')
    expect(s.firefight.activation!.performed).toEqual(['reposition'])
    expect(s.firefight.activation!.bonus).toBe(0)
  })
})

describe('PLOY end of the Firefight phase', () => {
  it("KRUMP 'EM!: at the end of the phase one Kommando in an enemy control range takes a free Fight", () => {
    let s = openReal({ rosterA: roster(['aod.intercessor-warrior']), rosterB: roster(['kom.boss-nob', 'kom.boy']) })
    const boy = opOf(s, 'B', 'kom.boy')
    const marine = opOf(s, 'A', 'aod.intercessor-warrior')
    s = place(place(s, marine, 0, 0), boy, 1.5, 0)
    // everyone has activated; the turning point is about to end
    s = edit(s, (st) => {
      for (const o of Object.values(st.operatives)) o.ready = false
      st.firefight.activation = null
    })
    // run the end of the phase: any step that reaches advance() would do; use a pass-style activation of the marine
    s = edit(s, (st) => {
      st.operatives[marine]!.ready = true
    })
    s = activateOp(s, marine)
    s = take(s, 'end').state
    expect(s.pending).toMatchObject({ kind: 'ploy.firefight', seat: 'B' })
    expect(optionIds(s)).toContain(`kom.p.krump-em@${boy}`)
    s = take(s, `kom.p.krump-em@${boy}`).state
    expect(s.pending).toMatchObject({ kind: 'fight.target' }) // the free Fight runs as a frame
    expect(s.firefight.activation!.frame).toBeDefined()
    expect(s.players.B.cp).toBe(2)
  })

  it('SEQ-010 a firefight ploy is not offered when nothing could use it', () => {
    const s = openReal()
    const offers = offersFor(s, 'B', 'turningPoint.end', { window: 'turningPoint.end' })
    expect(offers).toEqual([]) // no Kommando is in an enemy control range
  })
})

const NEUTRAL = { teamChoices: { A: { 'primary-tactic': 'aod.a.ct-mobile', 'secondary-tactic': 'aod.a.ct-resolute' }, B: {} } } as const
const BOLT = [{ datacardId: 'aod.intercessor-warrior', loadout: { weaponIds: ['aod.w.bolt-rifle'] } }, ...roster(['aod.eliminator-sniper'])]

describe('PLOY ploys inside the attack sequence', () => {
  /** B boy shoots the marine with a forced stream; dice are the 4 attack dice then the 3 defence dice. */
  function boyShoots(dice: number[], marineSetup?: (s: GameState, marine: string) => GameState) {
    let s = openReal(NEUTRAL)
    const marine = opOf(s, 'A', 'aod.intercessor-warrior')
    const boy = opOf(s, 'B', 'kom.boy')
    s = place(place(s, marine, 0, 0), boy, 5, 0)
    if (marineSetup) s = marineSetup(s, marine)
    // A activates somebody far away and ends; then the boy shoots
    s = activateOp(s, opOf(s, 'A', 'aod.eliminator-sniper'))
    s = take(s, 'end').state
    s = activateOp(s, boy)
    s = take(s, 'shoot').state
    return { s, marine, boy, rng: new ScriptedRng(dice) }
  }

  it('Transhuman Physiology (shoot.defenceRolled): one normal defence success is kept as a crit', () => {
    // attack 6,6,4,2 (two crits, a normal, a fail); defence 3,3,2 (two normals): without the ploy 7 damage get through
    const base = boyShoots([6, 6, 4, 2, 3, 3, 2])
    const plain = play(base.s, base.rng, { 'ploy.firefight': (p) => ({ type: 'pass', seat: p.seat, decisionId: p.id, payload: {} }) })
    const lost = plain.state.operatives[base.marine]!.maxWounds - plain.state.operatives[base.marine]!.wounds
    expect(lost).toBe(7)
    const withPloy = boyShoots([6, 6, 4, 2, 3, 3, 2])
    const r = play(withPloy.s, withPloy.rng, {
      'ploy.firefight': (p) => {
        const o = p.options!.find((x) => (x.action.payload as { ployId: string }).ployId === 'aod.p.transhuman-physiology')
        return o ? o.action : { type: 'pass', seat: p.seat, decisionId: p.id, payload: {} }
      },
    })
    const cost = r.events.filter((e): e is Extract<GameEvent, { type: 'CpChanged' }> => e.type === 'CpChanged' && e.reason === 'aod.p.transhuman-physiology')
    expect(cost).toHaveLength(1)
    const lost2 = r.state.operatives[withPloy.marine]!.maxWounds - r.state.operatives[withPloy.marine]!.wounds
    expect(lost2).toBe(4) // the crit now blocks a crit and the normal blocks the normal: one crit gets through
  })

  it('Just a Scratch (shoot.defenceRolled): ignores the damage of one normal die on a friendly Kommando', () => {
    const run = (ploy: boolean) => {
      let s = openReal({ ...NEUTRAL, rosterA: BOLT as never })
      const marine = opOf(s, 'A', 'aod.intercessor-warrior')
      const boy = opOf(s, 'B', 'kom.boy')
      s = place(place(s, marine, 0, 0), boy, 5, 0)
      s = activateOp(s, marine)
      s = take(s, 'shoot').state
      // bolt rifle: 4 attack dice (a normal, a crit, two fails), 3 defence dice all failing against Save 5+
      const r = play(s, new ScriptedRng([3, 6, 1, 1, 1, 1, 1]), {
        'shoot.target': (p) => p.options!.find((o) => o.id === boy)?.action ?? null,
        'ploy.firefight': (p) => {
          const o = ploy ? p.options!.find((x) => (x.action.payload as { ployId: string }).ployId === 'kom.p.just-a-scratch') : undefined
          return o ? o.action : { type: 'pass', seat: p.seat, decisionId: p.id, payload: {} }
        },
      })
      return r.state.operatives[boy]!.wounds
    }
    expect(run(false)).toBe(10 - 7) // 3 + 4
    expect(run(true)).toBe(10 - 4) // the normal die is ignored
  })

  it('a ploy is offered only to the seat whose operative the window is about', () => {
    const base = boyShoots([6, 6, 4, 2, 3, 3, 2])
    const seatsAsked: string[] = []
    play(base.s, base.rng, {
      'ploy.firefight': (p) => {
        seatsAsked.push(`${p.seat}:${p.window}`)
        return { type: 'pass', seat: p.seat, decisionId: p.id, payload: {} }
      },
    })
    // the defender (A) is asked at shoot.defenceRolled, never at shoot.attackRolled
    expect(seatsAsked).toContain('A:shoot.defenceRolled')
    expect(seatsAsked).not.toContain('A:shoot.attackRolled')
  })
})

void defaultAnswer
void realGame
