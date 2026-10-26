// plague-marines code-hook firing scenarios, merged into tests/engine/code-hooks.test.ts (which proves every hook the
// data names fires in a real game). One entry per hook name this team's data uses. Owned by the team implementer.
import { createGame } from '@/engine'
import { act } from '@/engine/actions'
import { maxRepeats } from '@/engine/abilities'
import { inflict, runDeferredRemovals, weaponDamage } from '@/engine/attack-common'
import { removeNow } from '@/engine/effects'
import { territoryOf } from '@/engine/equipment'
import { runHook } from '@/engine/hooks'
import { offersFor, usePloy, type PloyOffer } from '@/engine/ploys'
import { markerControl } from '@/engine/query'
import { ScriptedRng } from '@/engine/rng'
import { POISON } from '@/engine/teams/plague-marines'
import type { GameState } from '@/engine/types'
import { play } from '../../fixtures/attack'
import { drive, place } from '../../fixtures/helpers'
import { activateOp, edit, openReal, opOf, realBundle, realSetupWith, roster, take, withCtx } from '../../fixtures/real'

const MATCH = { teams: ['plague-marines', 'kommandos'] as [string, string] }
const open = (o: Parameters<typeof openReal>[0] = {}): GameState => openReal({ ...MATCH, ...o })
const A = (s: GameState, card: string): string => opOf(s, 'A', `pm.${card}`)
const B = (s: GameState, card: string): string => opOf(s, 'B', `kom.${card}`)

function poisoned(s: GameState, id: string): GameState {
  return edit(s, (st) => {
    st.operatives[id]!.tokens = [{ kind: POISON, owner: 'A', count: 1, since: 0 }]
  })
}

function toGambit(o: Parameters<typeof openReal>[0] = {}): GameState {
  return drive(createGame(realSetupWith({ ...MATCH, ...o }), 'pm-hooks', realBundle).state, (st) => st.pending?.kind === 'strategy.gambit', 800, new ScriptedRng([6, 1, 6, 1]))
}

/** Use a ploy through the engine with a hand-made offer (the window itself is not what the scenario is about). */
function usePlayed(s: GameState, ployId: string, info: Record<string, unknown>, param?: string): GameState {
  const ploy = s.data.ploys![ployId]!
  const offer: PloyOffer = { id: ployId, ployId, name: ploy.name, cost: ploy.cost, seed: param ? { param } : {}, ...(param ? { param } : {}) }
  return withCtx(s, (ctx) => usePloy(ctx, 'A', offer, { window: 'x', ...info })).state
}

export const scenarios: Record<string, () => void> = {
  pmAstartes() {
    const s = open()
    maxRepeats(s, s.operatives[A(s, 'bombardier')]!, 'shoot', ['shoot'])
  },
  disgustinglyResilient() {
    const s = open()
    withCtx(s, (ctx) => {
      inflict(ctx, { targetId: A(s, 'warrior'), attackerId: B(s, 'boy'), weaponId: 'kom.w.slugga', amount: 3, source: 'normal' })
    }, new ScriptedRng([4]))
  },
  poisonRule() {
    const s = open()
    withCtx(s, (ctx) => {
      inflict(ctx, { targetId: B(s, 'boy'), attackerId: A(s, 'heavy-gunner'), weaponId: 'pm.w.plague-spewer', amount: 3, source: 'normal' })
    })
  },
  toxicRule() {
    const s = open()
    const champ = A(s, 'champion')
    const boy = B(s, 'boy')
    weaponDamage(poisoned(s, boy), champ, 'pm.w.plague-sword', boy, 'fight')
  },
  grandfathersBlessing() {
    const s = open()
    const champ = A(s, 'champion')
    const boy = B(s, 'boy')
    const t = edit(poisoned(place(place(s, champ, 0, 0), boy, 5, 0), boy), (st) => (st.operatives[champ]!.wounds = 5))
    withCtx(t, (ctx) => {
      inflict(ctx, { targetId: boy, attackerId: champ, weaponId: null, amount: 2, source: 'direct' })
    })
  },
  flail() {
    const s = open()
    const fighter = A(s, 'fighter')
    take(activateOp(place(place(s, fighter, 0, 0), B(s, 'boy'), 1.4, 0), fighter), 'ability:pm.a.flail', new ScriptedRng([2, 2, 2, 2]))
  },
  iconBearer() {
    const s = open({ rosterA: roster(['pm.champion', 'pm.icon-bearer', 'pm.warrior', 'pm.fighter', 'pm.bombardier', 'pm.heavy-gunner']) })
    const m = s.markers.find((k) => k.kind === 'objective')!
    markerControl(edit(s, (st) => (st.operatives[A(s, 'icon-bearer')]!.pos = { x: m.pos.x + 0.9, y: 0, z: m.pos.z })), m)
  },
  iconOfContagion() {
    const g = toGambit({ rosterA: roster(['pm.champion', 'pm.icon-bearer', 'pm.warrior', 'pm.fighter', 'pm.bombardier', 'pm.heavy-gunner']) })
    const icon = A(g, 'icon-bearer')
    const away = edit(g, (st) => {
      const foe = territoryOf(st, 'B')!
      st.operatives[icon]!.pos = { x: foe.reduce((a, p) => a + p.x, 0) / foe.length, y: 0, z: foe.reduce((a, p) => a + p.z, 0) / foe.length }
    })
    const offer = offersFor(away, 'A', 'strategy.gambit', { window: 'strategy.gambit' }).find((o) => o.ployId === 'pm.p.contagion')!
    if (offer.cost !== 0) throw new Error('Contagion should cost 0 CP with the Icon Bearer in the opponent territory')
    withCtx(away, (ctx) => usePloy(ctx, 'A', offer, { window: 'strategy.gambit' }))
  },
  poisonousMiasma() {
    const s = open()
    const caster = A(s, 'plaguecaster')
    const boy = B(s, 'boy')
    take(activateOp(place(place(s, caster, 0, 0), boy, 5, 0), caster), `ability:pm.a.poisonous-miasma:${boy}`)
  },
  putrescentVitality() {
    const s = open()
    const caster = A(s, 'plaguecaster')
    const t = edit(place(s, caster, 0, 0), (st) => (st.operatives[caster]!.wounds = 4))
    take(activateOp(t, caster), `ability:pm.a.putrescent-vitality:${caster}`, new ScriptedRng([3, 2]))
  },
  repulsiveFortitude() {
    const s = open()
    const dice = [{ value: 5, kind: 'normal' as const, rerolled: false }]
    withCtx(s, (ctx) => {
      runHook('afterDefenceRoll', { seat: 'A', state: ctx.state, engine: ctx, operativeId: A(s, 'warrior'), targetId: B(s, 'boy'), data: { kind: 'shoot', side: 'defence', targetId: B(s, 'boy'), dice, requests: [], choices: {} } })
    })
  },
  contagion() {
    take(toGambit(), 'pm.p.contagion')
  },
  lumberingDeath() {
    take(toGambit(), 'pm.p.lumbering-death')
  },
  cloudOfFlies() {
    const g = toGambit()
    take(g, g.pending!.options!.find((o) => o.id.startsWith('pm.p.cloud-of-flies:'))!.id)
  },
  nurglings() {
    const s = open()
    const warrior = A(s, 'warrior')
    const boy = B(s, 'boy')
    usePlayed(place(place(s, warrior, 0, 0), boy, 2.5, 0), 'pm.p.nurglings', { window: 'strategy.gambit' }, boy)
  },
  virulentPoison() {
    const s = open()
    const warrior = A(s, 'warrior')
    const boy = B(s, 'boy')
    usePlayed(place(place(s, warrior, 0, 0), boy, 2.5, 0), 'pm.p.virulent-poison', { window: 'firefight.activationStart', subjectId: warrior }, boy)
  },
  sickeningResilience() {
    const s = open()
    usePlayed(s, 'pm.p.sickening-resilience', { window: 'shoot.defenceRolled', subjectId: A(s, 'warrior'), targetId: A(s, 'warrior'), attackerId: B(s, 'boy') })
  },
  poisonousDemise() {
    const s = open()
    const warrior = A(s, 'warrior')
    const t = edit(place(place(s, warrior, 0, 0), B(s, 'boy'), 2, 0), (st) => (st.operatives[warrior]!.wounds = 0))
    // M10 batch D shared: the removal waits for the end-of-step queue, whose operative.incapacitated window offers it
    const asked = withCtx(t, (ctx) => {
      removeNow(ctx, warrior)
      runDeferredRemovals(ctx)
    }).state
    take(asked, 'pm.p.poisonous-demise')
  },
  curseOfRot() {
    // a real Shoot: the defence roll shows two 3s, and the ploy is taken in the window before the defender's re-rolls
    const s = open()
    const hg = A(s, 'heavy-gunner')
    const boy = B(s, 'boy')
    const t = take(take(activateOp(place(place(s, hg, 0, 0), boy, 3, 0), hg), 'shoot').state, 'pm.w.bolt-pistol').state
    play(t, new ScriptedRng([6, 1, 1, 1, 3, 3, 6, ...Array<number>(20).fill(1)]), {
      'ploy.firefight': (q) => (q.seat === 'A' && q.options?.find((o) => o.id === 'pm.p.curse-of-rot')?.action) || act.pass(q),
    })
  },
  plagueBells() {
    open({ equipmentA: ['pm.e.plague-bells'] })
  },
  poisonVents() {
    const s = open({ equipmentA: ['pm.e.poison-vents'] })
    const boy = B(s, 'boy')
    const t = poisoned(place(place(s, boy, 12.5, 0), A(s, 'bombardier'), 11, 0), boy)
    withCtx(t, (ctx) => {
      runHook('activation.start', { seat: 'B', state: ctx.state, engine: ctx, operativeId: boy, data: { previousOrder: 'conceal', order: 'engage' } })
    }, new ScriptedRng([4]))
  },
}
