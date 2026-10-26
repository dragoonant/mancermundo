// pathfinders code-hook firing scenarios, merged into tests/engine/code-hooks.test.ts (which proves every hook the
// data names fires in a real game). One entry per hook name this team's data uses. Owned by the team implementer.
// The helpers are exported for tests/engine/teams/pathfinders.test.ts.
import { expect } from 'vitest'
import { step } from '@/engine'
import { effectiveMove } from '@/engine/state'
import { actionAvailability } from '@/engine/firefight'
import { attackStats, defenceStats, effectiveRules, inflict, parseRules, runDeferredRemovals, validTargets } from '@/engine/attack-common'
import { queueRemoval } from '@/engine/effects'
import { runHook } from '@/engine/hooks'
import { offersFor, usePloy } from '@/engine/ploys'
import { ScriptedRng } from '@/engine/rng'
import { tokenCount } from '@/engine/tokens'
import type { GameState } from '@/engine/types'
import { drive, place } from '../../fixtures/helpers'
import { activateOp, edit, newRealGame, openReal, opOf, passIt, realBundle, roster, take, withCtx, type RealOpts } from '../../fixtures/real'
import { feature, part, rect } from '../../fixtures/maps'

export const ALL_PF = [
  'pf.shasui',
  'pf.assault-grenadier',
  'pf.blooded',
  'pf.comms-specialist',
  'pf.drone-controller',
  'pf.marksman',
  'pf.medical-technician',
  'pf.shasla',
  'pf.shasla',
  'pf.transpectral-interference',
  'pf.weapons-expert',
  'pf.mb3-recon-drone',
  'pf.mv1-gun-drone',
  'pf.mv4-shield-drone',
  'pf.mv7-marker-drone',
  'pf.mv31-pulse-accelerator-drone',
  'pf.mv33-grav-inhibitor-drone',
]

export const ML = 'pf.markerlight'

/**
 * Rule damage that incapacitates `id` outside an attack (mines, direct damage): the removal waits for the end-of-step
 * queue (attack-common.runDeferredRemovals), where a before-removal decision such as Medic! is asked.
 */
export function ruleKill(s: GameState, id: string, by: string, amount = 99): GameState {
  return withCtx(s, (ctx) => {
    inflict(ctx, { targetId: id, attackerId: by, weaponId: null, amount, source: 'direct' })
    queueRemoval(ctx, id)
    runDeferredRemovals(ctx)
  }).state
}

export function pfOpts(o: RealOpts = {}): RealOpts {
  return { teams: ['pathfinders', 'kommandos'], rosterA: roster(ALL_PF), ...o }
}

/** Every operative parked in a tidy grid at its own end of an open killzone, all on Engage; tests then place who they need. */
function park(s: GameState): GameState {
  return edit(s, (st) => {
    let a = 0
    let b = 0
    for (const op of Object.values(st.operatives)) {
      const i = op.seat === 'A' ? a++ : b++
      const col = i % 3
      const row = Math.floor(i / 3)
      op.pos = { x: op.seat === 'A' ? -13.5 + col * 1.8 : 13.5 - col * 1.8, y: 0, z: -10 + row * 1.7 }
      op.order = 'engage'
    }
  })
}

/** Pathfinders (A, all sixteen datacards) against the default Kommandos (B), open ground, A to activate. */
export function pfOpen(o: RealOpts = {}): GameState {
  return park(openReal(pfOpts(o), 'pf-open'))
}

/** All operatives of a seat with this datacard. */
export function opsOf(s: GameState, seat: 'A' | 'B', datacardId: string): string[] {
  return Object.values(s.operatives)
    .filter((o) => o.seat === seat && o.datacardId === datacardId)
    .map((o) => o.id)
}

export const A = (s: GameState, id: string): string => opOf(s, 'A', id)
export const B = (s: GameState, id: string): string => opOf(s, 'B', id)

/** Activate (Engage, ploy windows passed) and take one option. */
export function go(s: GameState, who: string, optionId: string, rng?: ScriptedRng): GameState {
  return take(activateOp(s, who), optionId, rng).state
}

export function toGambit(o: RealOpts = {}): GameState {
  return drive(newRealGame(pfOpts(o), 'pf-hooks').state, (st) => st.pending?.kind === 'strategy.gambit', 1200, new ScriptedRng([6, 1, 6, 1]))
}

/**
 * A Shas'la 2" from an objective in the second turning point (Secure is a mission action from then on), both gambit
 * steps passed: the game stops at the firefight.start ploy window of the Pathfinder player.
 */
export function worthyStart(): { s: GameState; sla: string } {
  let s = edit(toGambit({ missionId: 'mission.prelim-secure' }), (st) => {
    st.turningPoint = 2
    st.players.A.cp = 2
  })
  const sla = A(s, 'pf.shasla')
  const m = s.markers.find((k) => k.kind === 'objective')!
  s = place(s, sla, m.pos.x + 2, m.pos.z)
  for (let i = 0; i < 12 && !(s.pending?.kind === 'ploy.firefight' && s.pending.window === 'firefight.start'); i++) s = passIt(s).state
  expect(s.pending).toMatchObject({ kind: 'ploy.firefight', seat: 'A', window: 'firefight.start' })
  return { s, sla }
}

/** A low light wall between x1 and x2 across the lane (cover for whoever stands just behind it). */
export function lightWall(x0: number, x1: number): ReturnType<typeof feature> {
  return feature('pf-wall', part('pf-wall.a', rect(x0, x1, -2, 2), 1, ['light']))
}

export function withTerrain(s: GameState, ...features: ReturnType<typeof feature>[]): GameState {
  return edit(s, (st) => {
    st.map = { ...st.map, features }
  })
}

/** An effect the way a ploy would leave it (for rules that read ploy flags). */
export function withEffect(s: GameState, source: string, seat: 'A' | 'B', extra: { operativeId?: string; expires?: string; data?: Record<string, unknown>; kind?: string } = {}): GameState {
  return edit(s, (st) => {
    st.effects.push({ id: `e${st.nextEffect++}`, source, seat, kind: extra.kind ?? 'ployFlag', expires: extra.expires ?? 'turningPoint', ...(extra.operativeId ? { operativeId: extra.operativeId } : {}), ...(extra.data ? { data: extra.data } : {}) })
  })
}

export const scenarios: Record<string, () => void> = {
  pfTeamRules() {
    // runs when the game is created
    pfOpen()
  },
  markerlightRules() {
    const s = pfOpen()
    const sh = A(s, 'pf.shasui')
    const boy = B(s, 'kom.boy')
    const t = go(place(place(s, sh, 0, 0), boy, 6, 0), sh, `ability:pf.a.markerlight:${boy}`)
    expect(tokenCount(t, boy, ML, 'A')).toBe(1)
  },
  markerlight() {
    scenarios.markerlightRules!()
  },
  artOfWar() {
    const t = take(toGambit(), 'pf.p.art-of-war:montka').state
    expect(t.effects.some((e) => e.kind === 'pf.aow')).toBe(true)
  },
  veteran() {
    let t = take(toGambit(), 'pf.p.art-of-war:kauyon').state
    t = drive(t, (st) => st.pending?.kind === 'firefight.activate', 200, new ScriptedRng([6, 1]))
    t = take(take(t, A(t, 'pf.blooded')).state, 'engage').state
    expect(t.pending?.kind).toBe('ploy.firefight')
    t = take(t, 'pf.p.veteran').state
    expect(t.effects.some((e) => e.kind === 'pf.veteran')).toBe(true)
  },
  pfGrenadier() {
    // set-up gives the Assault Grenadier its own frag and krak grenades
    const s = pfOpen()
    expect(s.operatives[A(s, 'pf.assault-grenadier')]!.weapons).toContain('core.w.frag-grenade')
    // and the first one thrown is used up
    const ag = A(s, 'pf.assault-grenadier')
    withCtx(place(place(s, ag, 0, 0), B(s, 'kom.boy'), 4, 0), (ctx) => {
      runHook('afterShootResolved', { seat: 'A', state: ctx.state, engine: ctx, operativeId: ag, weaponId: 'core.w.frag-grenade', data: { weaponId: 'core.w.frag-grenade', targets: [B(s, 'kom.boy')], incapacitated: [] } })
      expect(ctx.state.operatives[ag]!.weapons).not.toContain('core.w.frag-grenade')
    })
  },
  pfSignal() {
    const s = pfOpen()
    const c = A(s, 'pf.comms-specialist')
    const sh = A(s, 'pf.shasui')
    const t = go(place(place(s, c, 0, 0), sh, 3, 0), c, `ability:pf.a.signal:${sh}`)
    expect(t.operatives[sh]!.aplMods).toBe(1)
  },
  droneController() {
    const s = pfOpen()
    expect(effectiveMove(s.operatives[A(s, 'pf.mv1-gun-drone')]!, s)).toBe(8)
  },
  remotePilot() {
    const s = pfOpen()
    const c = A(s, 'pf.drone-controller')
    const d = A(s, 'pf.mv1-gun-drone')
    const t = go(place(place(s, c, 0, 0), d, 2, 0), c, `ability:pf.a.remote-pilot:${d}`)
    expect(t.pending?.kind).toBe('firefight.action')
    expect(t.firefight.activation?.operativeId).toBe(d)
  },
  inertialDampener() {
    const s = edit(pfOpen(), (st) => {
      const m = Object.values(st.operatives).find((o) => o.datacardId === 'pf.marksman')!
      m.wounds = 2
    })
    const m = A(s, 'pf.marksman')
    expect(attackStats(s, m, 'pf.w.marksman-rail-rifle-standard', B(s, 'kom.boy'), { kind: 'shoot' }).need).toBe(3)
  },
  medic() {
    const s = pfOpen()
    const v = A(s, 'pf.shasla')
    const m = A(s, 'pf.medical-technician')
    const boy = B(s, 'kom.boy')
    // the removal waits for the before-removal queue, where the owner takes Medic!
    const asked = ruleKill(place(place(place(s, v, 0, 0), m, 2, 0), boy, 6, 0), v, boy)
    expect(asked.pending).toMatchObject({ kind: 'ability.choice', context: { hook: 'medic', operativeId: v } })
    expect(take(asked, 'save').state.operatives[v]).toMatchObject({ status: 'active', wounds: 1 })
  },
  medikit() {
    const s = edit(pfOpen(), (st) => {
      Object.values(st.operatives).find((o) => o.seat === 'A' && o.datacardId === 'pf.shasla')!.wounds = 3
    })
    const m = A(s, 'pf.medical-technician')
    const w = A(s, 'pf.shasla')
    const t = go(place(place(s, m, 0, 0), w, 1.5, 0), m, `ability:pf.a.medikit:${w}`, new ScriptedRng([4, 6]))
    expect(t.operatives[w]!.wounds).toBe(7)
  },
  groupActivation() {
    const s = pfOpen()
    const [a, b] = opsOf(s, 'A', 'pf.shasla') as [string, string]
    const t = take(activateOp(s, a), 'end').state
    expect(t.pending).toMatchObject({ kind: 'firefight.activate', seat: 'A' })
    expect(t.pending!.options!.map((o) => o.id)).toEqual([b])
  },
  systemJam() {
    const s = pfOpen()
    const ti = A(s, 'pf.transpectral-interference')
    const boy = B(s, 'kom.boy')
    const t = go(place(place(s, ti, 0, 0), boy, 7, 0), ti, `ability:pf.a.system-jam:${boy}`)
    expect(t.operatives[boy]!.aplMods).toBe(-1)
  },
  multiDimensionalVision() {
    const s = pfOpen()
    const data = { obscured: true, inCover: false }
    runHook('target.status', { seat: 'A', state: s, operativeId: A(s, 'pf.transpectral-interference'), targetId: B(s, 'kom.boy'), data })
    expect(data.obscured).toBe(false)
  },
  pfDrone() {
    const s = pfOpen()
    const d = s.operatives[A(s, 'pf.mv4-shield-drone')]!
    expect(actionAvailability(s, d, 'guard', null)?.code).toBe('E_ACTION_RESTRICTED')
  },
  analyse() {
    const s = pfOpen()
    const d = A(s, 'pf.mb3-recon-drone')
    const e1 = B(s, 'kom.boy')
    const e2 = B(s, 'kom.dakka-boy')
    const t = go(place(place(place(s, d, 0, 0), e1, 6, 0), e2, 6.5, 2.5), d, `ability:pf.a.markerlight:${e1}`)
    expect(tokenCount(t, e2, ML, 'A')).toBe(1)
  },
  shieldGenerator() {
    const s = pfOpen()
    const mv4 = A(s, 'pf.mv4-shield-drone')
    const r = withCtx(s, (ctx) => {
      inflict(ctx, { targetId: mv4, attackerId: B(s, 'kom.boy'), weaponId: null, amount: 3, source: 'normal' })
    })
    expect(r.state.operatives[mv4]!.wounds).toBe(s.operatives[mv4]!.wounds)
  },
  mv7Markerlight() {
    const s = pfOpen()
    const d = A(s, 'pf.mv7-marker-drone')
    const boy = B(s, 'kom.boy')
    const t = go(place(place(s, d, 0, 0), boy, 6, 0), d, `ability:pf.a.markerlight:${boy}`)
    expect(tokenCount(t, boy, ML, 'A')).toBe(2)
  },
  pulseAccelerator() {
    const s = pfOpen()
    const d = A(s, 'pf.mv31-pulse-accelerator-drone')
    const t = go(s, d, 'ability:pf.a.pulse-accelerator')
    expect(tokenCount(t, d, 'pf.pulse', 'A')).toBe(1)
  },
  gravInhibitor() {
    const s = pfOpen()
    const g = A(s, 'pf.mv33-grav-inhibitor-drone')
    const boy = B(s, 'kom.boy')
    const t = place(place(s, g, 0, 0), boy, 3, 0)
    const worse = attackStats(t, boy, 'kom.w.choppa', A(t, 'pf.shasui'), { kind: 'fight' }).need
    expect(worse).toBe(4)
  },
  photonGrenade() {
    const s = pfOpen({ equipmentA: ['pf.e.photon-grenade'] })
    const sh = A(s, 'pf.shasla')
    const boy = B(s, 'kom.boy')
    const t = go(place(place(s, sh, 0, 0), boy, 6, 0), sh, `ability:pf.a.photon-grenade:${boy}`, new ScriptedRng([4]))
    expect(tokenCount(t, boy, 'pf.photon', 'A')).toBe(1)
  },
  reconSweep() {
    const s = edit(toGambit(), (st) => {
      st.turningPoint = 2
    })
    const offers = offersFor(s, 'A', 'strategy.gambit', { window: 'strategy.gambit' }).filter((o) => o.ployId === 'pf.p.recon-sweep')
    expect(offers.length).toBeGreaterThan(0)
    const r = withCtx(s, (ctx) => usePloy(ctx, 'A', offers[0]!, { window: 'strategy.gambit' }))
    expect(r.state.pending?.kind).toBe('ability.choice')
  },
  suppressingFire() {
    // an enemy that shoots a target which is not the closest valid one cannot re-roll its attack dice
    let s = withEffect(pfOpen(), 'pf.p.suppressing-fire', 'A')
    const near = A(s, 'pf.shasla')
    const far = A(s, 'pf.shasui')
    const boy = B(s, 'kom.dakka-boy')
    s = place(place(place(s, near, 2, 0), far, 0, 1), boy, 5.5, 0)
    let t = take(activateOp(s, A(s, 'pf.mv1-gun-drone')), 'end').state
    t = take(activateOp(t, boy), 'shoot').state
    t = take(t, 'kom.w.dakka-shoota-short').state
    t = take(t, far, new ScriptedRng(Array<number>(40).fill(1))).state
    // no attack-dice re-roll is offered (a defender's re-roll is a different window)
    expect(t.pending?.context.side).not.toBe('attack')
  },
  bonded() {
    const s = withEffect(pfOpen(), 'pf.p.bonded', 'A')
    const sh = A(s, 'pf.shasui')
    const t = place(place(s, sh, 0, 0), A(s, 'pf.shasla'), 2, 0)
    const rules = effectiveRules(t, t.operatives[sh]!, t.data.weapons['pf.w.pulse-carbine-shasui']!, 'shoot', B(t, 'kom.boy'))
    expect(rules.some((r) => r.rule === 'accurate')).toBe(true)
  },
  takeCover() {
    let s = withEffect(pfOpen(), 'pf.p.take-cover', 'A')
    const target = A(s, 'pf.shasla')
    const boy = B(s, 'kom.boy')
    s = withTerrain(place(place(s, target, 0, 0), boy, 6, 0), lightWall(1.2, 1.6))
    const rules = parseRules(effectiveRules(s, s.operatives[boy]!, s.data.weapons['kom.w.slugga']!, 'shoot', target))
    expect(defenceStats(s, target, boy, 'kom.w.slugga', rules, false).need).toBe(4)
  },
  worthyCause() {
    const { s, sla } = worthyStart()
    const opt = s.pending!.options!.find((o) => o.id.startsWith('pf.p.a-worthy-cause') && (o.action.payload as { operativeId?: string }).operativeId === sla)!
    expect(take(s, opt.id).state.pending?.kind).toBe('firefight.action')
  },
  supportingFire() {
    let s = pfOpen()
    const sh = A(s, 'pf.shasui')
    const friend = A(s, 'pf.shasla')
    const boy = B(s, 'kom.boy')
    s = place(place(place(s, sh, 2, 0), friend, 4.5, 0), boy, 6, 0)
    const info = { window: 'firefight.actionDeclared', subjectId: sh, action: 'shoot' }
    const offer = offersFor(s, 'A', 'firefight.actionDeclared', info).find((o) => o.ployId === 'pf.p.supporting-fire')!
    expect(offer).toBeDefined()
    const t = withCtx(s, (ctx) => usePloy(ctx, 'A', offer, info)).state
    expect(validTargets(t, t.operatives[sh]!, 'pf.w.pulse-carbine-shasui').map((x) => x.id)).toContain(boy)
  },
  saviourProtocols() {
    let s = pfOpen()
    const target = A(s, 'pf.shasla')
    const drone = A(s, 'pf.mv1-gun-drone')
    const boy = B(s, 'kom.boy')
    s = place(place(place(s, target, 0, 0), drone, 0, 2), boy, 5, 0)
    let t = take(activateOp(s, A(s, 'pf.mv4-shield-drone')), 'end').state
    t = take(activateOp(t, boy), 'shoot').state
    t = take(t, 'kom.w.slugga').state
    t = take(t, target).state
    expect(t.pending?.kind).toBe('ploy.firefight')
    t = take(t, `pf.p.saviour-protocols:${drone}`).state
    expect(t.attack?.targets[0]).toBe(drone)
  },
  pointBlankFusillade() {
    let s = pfOpen()
    const target = A(s, 'pf.shasla')
    const boy = B(s, 'kom.boy')
    s = place(place(s, target, 0, 0), boy, 6, 0)
    let t = take(activateOp(s, A(s, 'pf.mv4-shield-drone')), 'end').state
    t = take(activateOp(t, boy), 'charge').state
    const p = t.pending!
    t = expectStep(t, { type: 'move.path', seat: p.seat, decisionId: p.id, payload: { waypoints: [{ x: 1.3, z: 0 }] } })
    t = take(t, 'fight').state
    t = take(t, target).state
    expect(t.pending?.kind).toBe('ploy.firefight')
    t = take(t, `pf.p.point-blank-fusillade:pf.w.pulse-carbine`).state
    expect(t.attack?.fight?.weaponD).toBe('pf.w.pulse-carbine')
  },
  targetAnalysisOptic() {
    const s = pfOpen({ equipmentA: ['pf.e.target-analysis-optic'] })
    const sh = A(s, 'pf.shasui')
    const t = take(take(take(place(place(s, sh, 0, 0), B(s, 'kom.boy'), 6, 0), sh).state, 'engage').state, 'shoot').state
    expect(t.pending?.kind).toBe('ploy.firefight')
    const u = take(t, 'pf.e.target-analysis-optic').state
    expect(u.effects.some((e) => e.source === 'pf.e.target-analysis-optic')).toBe(true)
  },
  highIntensityMarkerlight() {
    const s = pfOpen({ equipmentA: ['pf.e.high-intensity-markerlight'] })
    const sh = A(s, 'pf.shasui')
    const boy = B(s, 'kom.boy')
    const t = go(place(place(s, sh, 0, 0), boy, 6, 0), sh, `ability:pf.a.markerlight:${boy}:himl`)
    expect(tokenCount(t, boy, ML, 'A')).toBe(2)
  },
  orbitalSurveyUplink() {
    let s = pfOpen({ equipmentA: ['pf.e.orbital-survey-uplink'] })
    const sh = A(s, 'pf.shasui')
    const boy = B(s, 'kom.boy')
    s = withTerrain(place(place(s, sh, 0, 0), boy, 6, 0), feature('pf-block', part('pf-block.a', rect(2, 2.5, -3, 3), 3, ['blocking'])))
    const t = go(s, sh, `ability:pf.a.markerlight:osu:${boy}`)
    expect(tokenCount(t, boy, ML, 'A')).toBe(1)
  },
}

/** Apply an action built from the pending decision, requiring acceptance. */
function expectStep(s: GameState, action: Parameters<typeof step>[1]): GameState {
  const r = step(s, action)
  if (r.rejection) throw new Error(`rejected ${r.rejection.code}: ${r.rejection.reason}`)
  return r.state
}

void passIt
void realBundle
