// Team rule providers (M9 engine prep, additive). The questions firefight.ts, setup.ts, missions.ts,
// markers, fight.ts, shoot.ts and equipment.ts ask about team rules (how often an action repeats, who may
// counteract, which orders are allowed, whether a Conceal operative may Charge, extra actions, who counts
// for the kill op, control APL, Move changes, chained activations, reactions...) used to be answered by
// branches naming Angels of Death and Kommandos rules. A team file (src/engine/teams/<team>.ts) registers
// a provider here and the shared files consult every provider, so a new team needs no edit outside its own
// files. Every member is optional; `null` / `undefined` means "no opinion".
//
// Members taking `state` must be pure functions of it (they run inside queries, validation and the AI).
// Members taking `ctx` run inside a step only and may roll dice and change state through `ctx`, but never
// raise decisions. Providers run in registration order (src/engine/teams/index.ts import order).
import type { Ctx } from './registry'
import type { Body } from './los'
import type { AttackState, DiceSide, GameState, Marker, Operative, Order, Seat, Vec2, Vec3 } from './types'

/** The move costs so far a moveSurcharge sees (batch C shared: `obstructing` and `climbs` added). */
export interface MoveSurchargeBreakdown {
  horizontal: number
  accessible: number
  climb: number
  drop: number
  /** Obstructing crossings (Razor Wire) included in `accessible` */
  obstructing?: number
  /** cost charged for each climb in order */
  climbs?: number[]
}

/** One answer a team gives to "may this player react to that action?" (Quicksilver Strike). */
export interface ReactionOffer {
  /** code hook (code-hooks.ts) whose `choice(ctx, op, option, context)` performs the reaction */
  hook: string
  /** the reacting operative */
  operativeId: string
  /** passed back to the hook's choice as `option` */
  option: string
  labelKey: string
  data?: Record<string, unknown>
  /**
   * batch C shared: once another reaction to the same action is over, offer this again (each operative still reacts
   * once per action): two Hounds answering one Charge
   */
  repeat?: boolean
  /**
   * batch C shared: also offer after free actions that are not otherwise reaction points: a free action an operative
   * takes inside its own seat's activation (info.freeAction) and a non-move free action in the Strategy phase
   * (info.strategy with info.freeAction). Offers without it are dropped there, so older providers are unaffected.
   */
  freeActions?: boolean
}

/** What happened, for `reactions`. */
export interface ReactionInfo {
  /** the operative that performed the action */
  actorId: string
  action: string
  /** seat whose activation (or counteraction) the action belonged to */
  activeSeat: Seat
  /** the action moved the actor or set it up (move actions, Grappling Hook, emerging) */
  moved: boolean
  /** M9 shared: a free move made in the Strategy phase (a gambit's Dash), outside any activation */
  strategy?: boolean
  /** M9 shared: a Guard interrupt (actorId = the guarding operative) has just finished; activeSeat is the guard's seat */
  interrupt?: boolean
  /**
   * M9 batch B: actorId's activation (or counteraction, with `counteract`) has just ended, after its end-of-activation
   * window and hooks, before the next activation is chosen (the Butcher's free Charge); action is 'activationEnded'
   */
  activationEnded?: boolean
  counteract?: boolean
  /** batch C shared: the action was a free action (see ReactionOffer.freeActions) */
  freeAction?: boolean
}

export interface TeamRuleProvider {
  /** unique id, usually the team id; re-registering the same id replaces the provider */
  id: string

  // ---- actions and orders --------------------------------------------------------------------
  /** times `actionId` may be performed in one activation (R-3.7); the highest answer wins */
  maxRepeats?(state: GameState, op: Operative, actionId: string, performed: string[]): number | null
  /** 'any' lets the operative counteract whatever its order; 'never' forbids counteracting */
  counteract?(state: GameState, op: Operative): 'any' | 'never' | null
  /** orders the operative may take; answers are intersected (an empty result falls back to the core answer) */
  orders?(state: GameState, op: Operative): Order[] | null
  /** the operative may Charge while it has a Conceal order */
  chargeUnderConceal?(state: GameState, op: Operative): boolean
  /** the operative may Charge from inside an enemy control range */
  chargeFromControlRange?(state: GameState, op: Operative): boolean
  /** the operative may Shoot while in an enemy control range */
  shootInControlRange?(state: GameState, op: Operative): boolean
  /**
   * batch C shared: free Shoots (startFreeAction) and Guard interrupt Shoots of this operative in an enemy's control
   * range are ordinary Shoots, not point-blank ones (Quick on the Trigger); without it they stay point-blank
   */
  freeShootInControlRange?(state: GameState, op: Operative): boolean
  /** the operative may Shoot with non-Silent weapons while it has a Conceal order (Magnify through a proxy) */
  shootUnderConceal?(state: GameState, op: Operative): boolean
  /** the operative may perform Guard while it has a Conceal order (Dimensional Ambush) */
  guardUnderConceal?(state: GameState, op: Operative): boolean
  /** a reason the operative can never take `actionId` (universal id or `ability:<id>`), or null */
  actionForbidden?(state: GameState, op: Operative, actionId: string): string | null
  /** AP change for an action (universal id, `ability:<id>`, `marker:pickUp`); summed with data costDelta (never below 0) */
  actionCostDelta?(state: GameState, op: Operative, actionId: string): number
  /** extra unique-action ability ids the operative may take (beyond its card, mission and equipment) */
  extraActions?(state: GameState, op: Operative): string[]
  /** the only unique actions an operative out of the killzone (`offboard`) may take, e.g. emerging from HIDING */
  offboardActions?(state: GameState, op: Operative): string[]

  // ---- stats ---------------------------------------------------------------------------------
  /** flags derived from team rules and effects, recomputed by refreshFlags (ORed with the core flags) */
  flags?(state: GameState, op: Operative): { ignoreApl?: boolean; ignoreInjured?: boolean; ignoreAplDecreases?: boolean } | null
  /** inches added to (or taken from) the operative's Move; summed; Move never drops below 4" (R-9.6) */
  moveDelta?(state: GameState, op: Operative): number
  /**
   * the operative suffers the injured stat changes (Move -2", Hit worse by 1) as if injured, without
   * stacking with real injury and even when it ignores injury (Contagion)
   */
  injuredEquivalent?(state: GameState, op: Operative): boolean

  // ---- kill op, equipment, roster ------------------------------------------------------------
  /** true: the operative is ignored for the kill op (starting count and incapacitations), like Expendable */
  killOpIgnored?(state: GameState, op: Operative): boolean
  /** may the operative receive the weapons a piece of equipment grants (null: use the equipment's grants.to) */
  equipmentEligible?(state: GameState, op: Operative, equipmentId: string): boolean | null
  /** may this operative be set aside instead of deployed at set-up (Wyrmblade HIDING) */
  setAsideAtSetup?(state: GameState, op: Operative): boolean
  /** how many operatives of `seat` may be set aside at set-up (smallest answer wins) */
  setAsideCap?(state: GameState, seat: Seat): number | null

  // ---- marker control (R-8.6) ----------------------------------------------------------------
  /** the APL this operative counts for when control of `marker` is worked out (Icon Bearer +1, Drone -1, Steadfast 3) */
  controlApl?(state: GameState, op: Operative, marker: Marker, apl: number): number | null
  /** the seat's contesting total after per-operative values (Despair -1, a Reanimation marker counting as APL 1) */
  controlTotal?(state: GameState, seat: Seat, marker: Marker, total: number, contesting: string[]): number | null

  // ---- activation flow -----------------------------------------------------------------------
  /**
   * After `expended` ends its activation: ready friendly operatives the same seat must activate next
   * (Group Activation). `wasChained` is true when `expended` itself was activated through a chain.
   */
  chainActivation?(state: GameState, expended: Operative, wasChained: boolean): string[] | null
  /** the seat picked `op` to activate: true stops it this time (Vision of Madness); only asked when another ready operative exists */
  gateActivation?(ctx: Ctx, op: Operative): boolean
  /**
   * M9 batch B: false keeps the ready operative out of its seat's activate options while that seat has another ready
   * operative no provider blocks (System Jam); never empties the options
   */
  canActivate?(state: GameState, op: Operative): boolean
  /**
   * M9 batch B: once both initiative dice are rolled, may `seat` re-roll its own die (Writ of Claim)? Asked once per
   * seat per TP; `onInitiativeReroll` runs when the seat does (spend the once-per-battle use)
   */
  initiativeReroll?(state: GameState, seat: Seat): boolean
  onInitiativeReroll?(ctx: Ctx, seat: Seat): void
  /** reactions the non-active `seat` may take after an action (Quicksilver Strike), offered as one ability.choice */
  reactions?(state: GameState, seat: Seat, info: ReactionInfo): ReactionOffer[]
  /**
   * batch C shared: reactions the ACTIVE `seat` may take after its own operative's action (Savage Brutality's free
   * Fight), offered before the other seat's `reactions`; same ReactionOffer contract
   */
  ownReactions?(state: GameState, seat: Seat, info: ReactionInfo): ReactionOffer[]

  // ---- attacks -------------------------------------------------------------------------------
  /** no die of `side` may be re-rolled (Nightmare Shroud, Suppressing Fire) */
  rerollsBanned?(state: GameState, side: DiceSide, attack: AttackState): boolean
  /**
   * batch C shared: the CP a Command Re-roll of `side` costs (core 1). The lowest answer wins (never below 0);
   * `onCommandReroll` runs when the re-roll is made at that cost (spend a once-per-battle use: Tactical Advantage).
   */
  commandRerollCost?(state: GameState, side: DiceSide, attack: AttackState | null): number | null
  onCommandReroll?(ctx: Ctx, side: DiceSide, cost: number): void
  /** extra weapons the operative may fight or retaliate with, e.g. a ranged profile used as melee (Point-Blank Fusillade) */
  extraFightWeapons?(state: GameState, op: Operative, retaliating: boolean): string[]
  /** once per fight sequence, before the first strike or block: who resolves first, owed resolutions, seats that cannot block */
  fightResolveStart?(state: GameState, attack: AttackState): { first?: Seat; queue?: { seat: Seat; blockOnly?: boolean; strikeOnly?: boolean }[]; noBlock?: Seat[] } | null
  /** M9 batch B: how many unresolved enemy successes one block with die `die` of `seat` cancels (Tangle: 2); highest answer wins, default 1 */
  blockCapacity?(state: GameState, attack: AttackState, seat: Seat, die: number): number | null
  /** after `seat` struck or blocked: resolutions owed before the alternation continues (Assassinate's second strike) */
  afterFightResolution?(state: GameState, attack: AttackState, seat: Seat, op: 'strike' | 'block'): { seat: Seat; blockOnly?: boolean; strikeOnly?: boolean }[] | null
  /** friendly operatives the shooter may use as its viewpoint for this weapon (Magnify proxies); offered as weapon options */
  shootViewpoints?(state: GameState, shooter: Operative, weaponId: string): string[]
  /** extra Stealthy-style cover sources when the operative is shot (Cult Agent): retain one more cover save or one as a crit */
  stealthyCover?(state: GameState, op: Operative): number

  // ---- movement and markers ------------------------------------------------------------------
  /**
   * inches added to a move's cost (Grav-inhibitor: +2" once when the path comes visible to and within 6");
   * `points` are the increment end points in order, `breakdown` the costs so far (return a negative
   * amount to cancel Accessible or Obstructing extras). Summed; the move fails if it then exceeds its limit.
   * batch C shared: `breakdown.obstructing` is the Obstructing share of `accessible`; `breakdown.climbs` the cost of
   * each climb in order (absent for a direct cost query that has no path).
   */
  moveSurcharge?(state: GameState, op: Operative, kind: string, points: Vec3[], breakdown: MoveSurchargeBreakdown): number
  /**
   * M9 batch B: grenades this operative carries on its own, apart from the team's picks and totals (Hearthkyn
   * Grenadier): weapon ids (frag, krak) and grenade action ability ids (smoke, stun) to uses per battle. The weapons
   * are added at set-up; the actions still have to be offered (card, extraActions); grenadeSource then pays them.
   * M9 batch C: `tpActions` are allowances per turning point shared by the whole seat, not counted against the team's
   * picks (Kasrkin Adaptive Equipment: one Smoke and one Stun Grenade per TP for any TROOPER); source 'ownTp'
   */
  ownGrenades?(state: GameState, op: Operative): { weapons?: Record<string, number>; actions?: Record<string, number>; tpActions?: Record<string, number> } | null
  /** M9 batch B: the operative may FLY in this move action (Jump Pack): set up within its move horizontally, ignoring terrain between */
  canFly?(state: GameState, op: Operative, kind: string): boolean
  /** the operative never triggers this mine (Explosive Traps: friendly Wyrmblade operatives) */
  ignoresMine?(state: GameState, op: Operative, mine: Marker): boolean

  // ---- M9 batch C ----------------------------------------------------------------------------
  /**
   * M9 batch C: a reason the operative cannot use this weapon now (Concealed Position after its first Shoot, Detonate
   * with no Explosives marker, a weapon lent away by Psychic Cabal), or null. Read by attack-common.weaponUnusable, so
   * Shoot and Fight options, availability and the AI all agree
   */
  weaponForbidden?(state: GameState, op: Operative, weaponId: string, kind: 'shoot' | 'fight'): string | null
  /**
   * M9 batch C: the operative's PSYCHIC actions, PSYCHIC ranged weapons and PSYCHIC additional rules do not work now
   * (Novitiate Condemnor Null Rod within 6"). psychic.ts applies it to unique actions and ranged weapons; team files ask
   * `psychicAllowed` before their own PSYCHIC rules
   */
  psychicBlocked?(state: GameState, op: Operative): boolean
  /** M9 batch C: PSYCHIC actions cannot select the operative and never count it as within their distances (Null Rod) */
  psychicImmune?(state: GameState, op: Operative): boolean
  /**
   * M9 batch C: the weapon chooses its own targets instead of a valid target (Detonate: every operative within 2" of
   * the Explosives marker; the Gheistskull as the primary target). `targets[0]` is the primary; Blast secondaries are
   * still added around it. The shooter needs no visibility; the listed flags force the statuses. Empty `targets`: the
   * weapon cannot be selected
   */
  fixedTargets?(state: GameState, shooter: Operative, weaponId: string): FixedTargets | null
  /**
   * M9 batch C: after the primary target, up to `max` more primary targets the shooter may add, chosen from
   * `candidates` (Salvo: a second valid target not within control range of the shooter's friends); each is shot as
   * its own sequence, like Torrent targets
   */
  extraTargets?(state: GameState, shooter: Operative, weaponId: string, primaryId: string): { candidates: string[]; max: number } | null
  /** M9 batch C: inches added to the move limit of one move kind only (Strike Fast: Reposition +1"; Boost: Charge +2" more); summed */
  moveLimitDelta?(state: GameState, op: Operative, kind: string): number
  /** M9 batch C: the FLY distance for this move kind instead of the move limit (Blink Pack: 7"); smallest answer wins */
  flyLimit?(state: GameState, op: Operative, kind: string): number | null
  /** M9 batch C: movement the operative can never make (C.A.T. Unit: no climbing, no jumping) */
  moveRestrictions?(state: GameState, op: Operative): { noClimb?: boolean; noJump?: boolean } | null
  /**
   * M9 batch C: the ready operative cannot be activated now and does not stop the turning point from ending (C.A.T.
   * Unit in an enemy control range or without its Surveyor); unlike `canActivate`, this may leave a seat nothing to
   * activate
   */
  activationBarred?(state: GameState, op: Operative): boolean
  /**
   * M9 batch C: things the seat may do instead of counteracting when it is its turn to counteract (Farstalker: change
   * one operative's order). Offered on the firefight.activate decision as `alt:<n>`; the hook's `choice` runs and the
   * turn passes as after a counteraction (no operative is marked as having counteracted)
   */
  counteractAlternatives?(state: GameState, seat: Seat): ReactionOffer[]
  /**
   * M9 batch C: relief for Pick Up Marker (`marker:pickUp`) and MISSION actions (`ability:<id>`): performable with an
   * enemy in control range (Light Fingers, Mutant Appendage), or needing only to contest the marker (Poach)
   */
  markerActionRelief?(state: GameState, op: Operative, actionId: string): { ignoreEnemyControlRange?: boolean; contestSuffices?: boolean } | null
  /** M9 batch C: the enemies `attacker` may fight, filtered (Bad-tempered: the Hound when it forces itself); never empties */
  fightTargets?(state: GameState, attacker: Operative, foes: string[]): string[] | null

  // ---- batch C shared ------------------------------------------------------------------------
  /**
   * Extra eye points the operative sees from, besides its head (C.A.T. Unit wide view): bodies whose head point is an
   * eye, built around `body` (the operative where it stands, or a ghost of it on a planned path). Core `visible`, and so
   * control range, tries them when the head cannot see. Pure; never calls `visible` for the same operative.
   * (Magnify's shootViewpoints are other operatives standing in for the shooter, so they stay separate.)
   */
  viewpoints?(state: GameState, op: Operative, body: Body): Body[] | null
  /** Place Marker (the shared action) cannot put `marker` at `pos`: the reason, or null (Melta Mine: no enemy control range) */
  placeMarkerProblem?(state: GameState, op: Operative, marker: Marker, pos: Vec2): string | null
  /**
   * After every accepted step with no action in progress (as core Mines): `moved` lists each operative's increment end
   * points from this step, forced moves outside actions included, then every active operative's position. Team mines
   * check here. Runs in a step only; may roll and change state through `ctx`, never raises decisions.
   */
  checkMines?(ctx: Ctx, moved: { operativeId: string; pos: Vec3 }[]): void
  /**
   * Choices the seat makes in the Ready step, after operatives are readied and before the Gambit step (Farstalker and
   * Hierotek order picks). Offered as one ability.choice (context.readyStep); the offer's code hook `choice` runs and
   * must call strategy.readyChoiceDone(ctx) once finished. The seat is asked again until it has no offer or passes.
   */
  readyStepChoices?(state: GameState, seat: Seat): ReactionOffer[]
  /**
   * A move (not a forced one) cannot end like this: the reason shown to the player, or null. `points` are the increment
   * end points in order (a FLY set-up: just its end). Use instead of pricing a move out of reach with moveSurcharge.
   */
  moveProblem?(state: GameState, op: Operative, kind: string, points: Vec3[]): string | null

  // ---- batch D prep (M10) ----------------------------------------------------------------------
  /**
   * Die results that cannot be re-rolled for this roll by anything (re-roll grants and the Command Re-roll): Sinister
   * Trophies, Strobing Phosphor-lumen. `info.rollerId` rolls the dice against `info.opponentId`. Pure; the answers of
   * every provider are united. Applied to the grants attackStats / defenceStats return, so the odds respect it.
   */
  rerollBannedValues?(state: GameState, info: RerollBanInfo): number[] | null
  /**
   * Choices the seat makes once every operative is set up and before turning point 1 (Forward Scouting). Offered as
   * one ability.choice (context.preBattle); seats alternate one choice at a time, the setup initiative holder first,
   * while both have offers; a pass drops that seat. The offer's code hook `choice` runs and must call
   * setup.preBattleChoiceDone(ctx) once finished (a free action it starts calls it from its frame resume).
   */
  preBattleChoices?(state: GameState, seat: Seat): ReactionOffer[]
  /**
   * When `op` is shot and retains any cover save, it retains this many more (spare fails become cover saves), without
   * the crit option of Stealthy (Camo Cloak, extra-only versions). Summed. The provider decides any non-stacking.
   */
  extraCoverSaves?(state: GameState, op: Operative): number
  /**
   * Set-aside at set-up works by whole batches for this seat (Drop Insertion): `skipFirst` keeps the seat's first batch
   * on the table; any later batch is either all deployed or all set aside, decided by its first answer.
   */
  setAsideBatches?(state: GameState, seat: Seat): { skipFirst?: boolean } | null
  /**
   * M10 batch D shared: `op` has just been incapacitated outside an attack (mines, direct damage: effects.removeNow)
   * and one of its before-removal rules may need a decision (Explosive Demise, Destructive Demise, a Medic! decline).
   * True defers the removal to a queue at the end of the step that can pause (attack-common.runDeferredRemovals):
   * the `operative.incapacitated` hooks there may raise a decision and the code hook calls continueRemovals.
   */
  pausableRemoval?(state: GameState, op: Operative): boolean
}

/** batch D prep: who rolls the dice a rerollBannedValues answer is about. */
export interface RerollBanInfo {
  kind: 'shoot' | 'fight'
  /** the operative rolling the dice */
  rollerId: string
  /** the operative it attacks, or (defence dice) the shooter */
  opponentId: string
  /** defence dice of a Shoot */
  defence: boolean
}

/** M9 batch C: what `fixedTargets` answers. */
export interface FixedTargets {
  /** primary first; every id is shot in its own sequence */
  targets: string[]
  /** the targets are never in cover / never obscured (Detonate) */
  noCover?: boolean
  noObscured?: boolean
  /** add Blast secondaries around the primary as usual (default true) */
  blast?: boolean
}

const providers = new Map<string, TeamRuleProvider>()

// batch C shared: the providers answering `viewpoints`, cached because core `visible` asks on every line of sight
let viewpointProviders: TeamRuleProvider[] = []
function cacheProviders(): void {
  viewpointProviders = [...providers.values()].filter((p) => typeof p.viewpoints === 'function')
}

export function registerTeamRules(p: TeamRuleProvider): void {
  providers.set(p.id, p)
  cacheProviders()
}

export function unregisterTeamRules(id: string): void {
  providers.delete(id)
  cacheProviders()
}

/** batch C shared: extra eye bodies of `op` standing as `body` (wide view); empty for nearly everyone. */
export function providerViewpointBodies(state: GameState, op: Operative, body: Body): Body[] {
  if (viewpointProviders.length === 0) return []
  const out: Body[] = []
  for (const p of viewpointProviders) out.push(...(p.viewpoints?.(state, op, body) ?? []))
  return out
}

export function providerPlaceMarkerProblem(state: GameState, op: Operative, marker: Marker, pos: Vec2): string | null {
  for (const p of providers.values()) {
    const r = p.placeMarkerProblem?.(state, op, marker, pos)
    if (r) return r
  }
  return null
}

/** True when some provider filters Place Marker spots (the decision then lists candidate spots). */
export function placeMarkerFiltered(): boolean {
  for (const p of providers.values()) if (p.placeMarkerProblem) return true
  return false
}

export function providerReadyStepChoices(state: GameState, seat: Seat): ReactionOffer[] {
  const out: ReactionOffer[] = []
  for (const p of providers.values()) out.push(...(p.readyStepChoices?.(state, seat) ?? []))
  return out
}

export function providerMoveProblem(state: GameState, op: Operative, kind: string, points: Vec3[]): string | null {
  for (const p of providers.values()) {
    const r = p.moveProblem?.(state, op, kind, points)
    if (r) return r
  }
  return null
}

export function providerCheckMines(ctx: Ctx, moved: { operativeId: string; pos: Vec3 }[]): void {
  for (const p of providers.values()) p.checkMines?.(ctx, moved)
}

export function teamRuleProviders(): TeamRuleProvider[] {
  return [...providers.values()]
}

/** Highest provider answer for an action's repeat limit, or null when no provider has one. */
export function providerMaxRepeats(state: GameState, op: Operative, actionId: string, performed: string[]): number | null {
  let best: number | null = null
  for (const p of providers.values()) {
    const n = p.maxRepeats?.(state, op, actionId, performed)
    if (n !== null && n !== undefined && (best === null || n > best)) best = n
  }
  return best
}

export function providerCounteract(state: GameState, op: Operative): 'any' | 'never' | null {
  let out: 'any' | 'never' | null = null
  for (const p of providers.values()) {
    const a = p.counteract?.(state, op) ?? null
    if (a === 'never') return 'never'
    if (a === 'any') out = 'any'
  }
  return out
}

export function providerOrders(state: GameState, op: Operative): Order[] | null {
  let out: Order[] | null = null
  for (const p of providers.values()) {
    const o = p.orders?.(state, op)
    if (!o) continue
    out = out === null ? [...o] : out.filter((x) => o.includes(x))
  }
  return out
}

type BoolKey = 'chargeUnderConceal' | 'chargeFromControlRange' | 'shootInControlRange' | 'freeShootInControlRange' | 'shootUnderConceal' | 'guardUnderConceal' | 'killOpIgnored' | 'setAsideAtSetup' | 'injuredEquivalent'

export function providerAny(state: GameState, op: Operative, key: BoolKey): boolean {
  for (const p of providers.values()) if (p[key]?.(state, op)) return true
  return false
}

export function providerActionForbidden(state: GameState, op: Operative, actionId: string): string | null {
  for (const p of providers.values()) {
    const why = p.actionForbidden?.(state, op, actionId)
    if (why) return why
  }
  return null
}

export function providerCostDelta(state: GameState, op: Operative, actionId: string): number {
  let d = 0
  for (const p of providers.values()) d += p.actionCostDelta?.(state, op, actionId) ?? 0
  return d
}

function collectIds(fn: (p: TeamRuleProvider) => string[] | undefined): string[] {
  const out: string[] = []
  for (const p of providers.values()) for (const id of fn(p) ?? []) if (!out.includes(id)) out.push(id)
  return out
}

export function providerExtraActions(state: GameState, op: Operative): string[] {
  return collectIds((p) => p.extraActions?.(state, op))
}

export function providerOffboardActions(state: GameState, op: Operative): string[] {
  return collectIds((p) => p.offboardActions?.(state, op))
}

export function providerFlags(state: GameState, op: Operative): { ignoreApl: boolean; ignoreInjured: boolean; ignoreAplDecreases: boolean } {
  const out = { ignoreApl: false, ignoreInjured: false, ignoreAplDecreases: false }
  for (const p of providers.values()) {
    const f = p.flags?.(state, op)
    if (f?.ignoreApl) out.ignoreApl = true
    if (f?.ignoreInjured) out.ignoreInjured = true
    if (f?.ignoreAplDecreases) out.ignoreAplDecreases = true
  }
  return out
}

export function providerMoveDelta(state: GameState, op: Operative): number {
  let d = 0
  for (const p of providers.values()) d += p.moveDelta?.(state, op) ?? 0
  return d
}

export function providerEquipmentEligible(state: GameState, op: Operative, equipmentId: string): boolean | null {
  let out: boolean | null = null
  for (const p of providers.values()) {
    const a = p.equipmentEligible?.(state, op, equipmentId)
    if (a === false) return false
    if (a === true) out = true
  }
  return out
}

export function providerSetAsideCap(state: GameState, seat: Seat): number {
  let cap: number | null = null
  for (const p of providers.values()) {
    const c = p.setAsideCap?.(state, seat)
    if (c !== null && c !== undefined) cap = cap === null ? c : Math.min(cap, c)
  }
  return cap ?? 0
}

export function providerControlApl(state: GameState, op: Operative, marker: Marker, apl: number): number {
  let v = apl
  for (const p of providers.values()) {
    const n = p.controlApl?.(state, op, marker, v)
    if (n !== null && n !== undefined) v = n
  }
  return v
}

export function providerControlTotal(state: GameState, seat: Seat, marker: Marker, total: number, contesting: string[]): number {
  let v = total
  for (const p of providers.values()) {
    const n = p.controlTotal?.(state, seat, marker, v, contesting)
    if (n !== null && n !== undefined) v = n
  }
  return v
}

export function providerChain(state: GameState, expended: Operative, wasChained: boolean): string[] {
  return collectIds((p) => p.chainActivation?.(state, expended, wasChained) ?? undefined)
}

export function providerGate(ctx: Ctx, op: Operative): string | null {
  for (const p of providers.values()) if (p.gateActivation?.(ctx, op)) return p.id
  return null
}

/** M9 batch B: providers that let `seat` re-roll its initiative die now (Writ of Claim). */
export function providerInitiativeReroll(state: GameState, seat: Seat): TeamRuleProvider[] {
  return [...providers.values()].filter((p) => p.initiativeReroll?.(state, seat) === true)
}

/** M9 batch B: every provider lets the operative activate now (System Jam). */
export function providerCanActivate(state: GameState, op: Operative): boolean {
  for (const p of providers.values()) if (p.canActivate?.(state, op) === false) return false
  return true
}

export function providerReactions(state: GameState, seat: Seat, info: ReactionInfo): ReactionOffer[] {
  const out: ReactionOffer[] = []
  for (const p of providers.values()) out.push(...(p.reactions?.(state, seat, info) ?? []))
  return out
}

export function providerOwnReactions(state: GameState, seat: Seat, info: ReactionInfo): ReactionOffer[] {
  const out: ReactionOffer[] = []
  for (const p of providers.values()) out.push(...(p.ownReactions?.(state, seat, info) ?? []))
  return out
}

export function providerRerollsBanned(state: GameState, side: DiceSide, attack: AttackState): boolean {
  for (const p of providers.values()) if (p.rerollsBanned?.(state, side, attack)) return true
  return false
}

/** batch C shared: the CP the Command Re-roll of `side` costs now (1 unless a provider lowers or raises it). */
export function providerCommandRerollCost(state: GameState, side: DiceSide, attack: AttackState | null): number {
  let cost: number | null = null
  for (const p of providers.values()) {
    const c = p.commandRerollCost?.(state, side, attack)
    if (c !== null && c !== undefined) cost = cost === null ? c : Math.min(cost, c)
  }
  return Math.max(0, cost ?? 1)
}

export function providerOnCommandReroll(ctx: Ctx, side: DiceSide, cost: number): void {
  for (const p of providers.values()) p.onCommandReroll?.(ctx, side, cost)
}

export function providerFightWeapons(state: GameState, op: Operative, retaliating: boolean): string[] {
  return collectIds((p) => p.extraFightWeapons?.(state, op, retaliating))
}

export function providerFightStart(state: GameState, attack: AttackState): { first?: Seat; queue: { seat: Seat; blockOnly?: boolean; strikeOnly?: boolean }[]; noBlock: Seat[] } {
  const out: { first?: Seat; queue: { seat: Seat; blockOnly?: boolean; strikeOnly?: boolean }[]; noBlock: Seat[] } = { queue: [], noBlock: [] }
  for (const p of providers.values()) {
    const r = p.fightResolveStart?.(state, attack)
    if (!r) continue
    if (r.first) out.first = r.first
    out.queue.push(...(r.queue ?? []))
    for (const s of r.noBlock ?? []) if (!out.noBlock.includes(s)) out.noBlock.push(s)
  }
  return out
}

export function providerBlockCapacity(state: GameState, attack: AttackState, seat: Seat, die: number): number {
  let n = 1
  for (const p of providers.values()) {
    const c = p.blockCapacity?.(state, attack, seat, die)
    if (c !== null && c !== undefined && c > n) n = c
  }
  return n
}

export function providerAfterResolution(state: GameState, attack: AttackState, seat: Seat, op: 'strike' | 'block'): { seat: Seat; blockOnly?: boolean; strikeOnly?: boolean }[] {
  const out: { seat: Seat; blockOnly?: boolean; strikeOnly?: boolean }[] = []
  for (const p of providers.values()) out.push(...(p.afterFightResolution?.(state, attack, seat, op) ?? []))
  return out
}

export function providerViewpoints(state: GameState, shooter: Operative, weaponId: string): string[] {
  return collectIds((p) => p.shootViewpoints?.(state, shooter, weaponId))
}

export function providerStealthy(state: GameState, op: Operative): number {
  let n = 0
  for (const p of providers.values()) n += p.stealthyCover?.(state, op) ?? 0
  return n
}

export function providerMoveSurcharge(state: GameState, op: Operative, kind: string, points: Vec3[], breakdown: MoveSurchargeBreakdown): number {
  let n = 0
  for (const p of providers.values()) n += p.moveSurcharge?.(state, op, kind, points, breakdown) ?? 0
  return n
}

/** M9 batch B: every provider's own-grenade allowances for the operative, merged (largest allowance wins). */
export function providerOwnGrenades(state: GameState, op: Operative): { weapons: Record<string, number>; actions: Record<string, number>; tpActions: Record<string, number> } {
  const out = { weapons: {} as Record<string, number>, actions: {} as Record<string, number>, tpActions: {} as Record<string, number> }
  for (const p of providers.values()) {
    const g = p.ownGrenades?.(state, op)
    if (!g) continue
    for (const [k, n] of Object.entries(g.weapons ?? {})) out.weapons[k] = Math.max(out.weapons[k] ?? 0, n)
    for (const [k, n] of Object.entries(g.actions ?? {})) out.actions[k] = Math.max(out.actions[k] ?? 0, n)
    for (const [k, n] of Object.entries(g.tpActions ?? {})) out.tpActions[k] = Math.max(out.tpActions[k] ?? 0, n)
  }
  return out
}

// ---- M9 batch C aggregators ------------------------------------------------------------------

export function providerWeaponForbidden(state: GameState, op: Operative, weaponId: string, kind: 'shoot' | 'fight'): string | null {
  for (const p of providers.values()) {
    const why = p.weaponForbidden?.(state, op, weaponId, kind)
    if (why) return why
  }
  return null
}

export function providerPsychicBlocked(state: GameState, op: Operative): boolean {
  for (const p of providers.values()) if (p.psychicBlocked?.(state, op)) return true
  return false
}

export function providerPsychicImmune(state: GameState, op: Operative): boolean {
  for (const p of providers.values()) if (p.psychicImmune?.(state, op)) return true
  return false
}

/** The first provider answer for a weapon's own targets, or null (the weapon targets as usual). */
export function providerFixedTargets(state: GameState, shooter: Operative, weaponId: string): FixedTargets | null {
  for (const p of providers.values()) {
    const t = p.fixedTargets?.(state, shooter, weaponId)
    if (t) return t
  }
  return null
}

/** Extra primary targets (Salvo): candidates merged, the largest `max`. */
export function providerExtraTargets(state: GameState, shooter: Operative, weaponId: string, primaryId: string): { candidates: string[]; max: number } | null {
  let out: { candidates: string[]; max: number } | null = null
  for (const p of providers.values()) {
    const t = p.extraTargets?.(state, shooter, weaponId, primaryId)
    if (!t || t.max <= 0) continue
    if (!out) out = { candidates: [], max: 0 }
    for (const id of t.candidates) if (id !== primaryId && !out.candidates.includes(id)) out.candidates.push(id)
    out.max = Math.max(out.max, t.max)
  }
  return out && out.candidates.length > 0 ? out : null
}

export function providerMoveLimitDelta(state: GameState, op: Operative, kind: string): number {
  let d = 0
  for (const p of providers.values()) d += p.moveLimitDelta?.(state, op, kind) ?? 0
  return d
}

export function providerFlyLimit(state: GameState, op: Operative, kind: string): number | null {
  let out: number | null = null
  for (const p of providers.values()) {
    const n = p.flyLimit?.(state, op, kind)
    if (n !== null && n !== undefined) out = out === null ? n : Math.min(out, n)
  }
  return out
}

export function providerMoveRestrictions(state: GameState, op: Operative): { noClimb: boolean; noJump: boolean } {
  const out = { noClimb: false, noJump: false }
  for (const p of providers.values()) {
    const r = p.moveRestrictions?.(state, op)
    if (r?.noClimb) out.noClimb = true
    if (r?.noJump) out.noJump = true
  }
  return out
}

export function providerActivationBarred(state: GameState, op: Operative): boolean {
  for (const p of providers.values()) if (p.activationBarred?.(state, op)) return true
  return false
}

export function providerCounteractAlternatives(state: GameState, seat: Seat): ReactionOffer[] {
  const out: ReactionOffer[] = []
  for (const p of providers.values()) out.push(...(p.counteractAlternatives?.(state, seat) ?? []))
  return out
}

export function providerMarkerActionRelief(state: GameState, op: Operative, actionId: string): { ignoreEnemyControlRange: boolean; contestSuffices: boolean } {
  const out = { ignoreEnemyControlRange: false, contestSuffices: false }
  for (const p of providers.values()) {
    const r = p.markerActionRelief?.(state, op, actionId)
    if (r?.ignoreEnemyControlRange) out.ignoreEnemyControlRange = true
    if (r?.contestSuffices) out.contestSuffices = true
  }
  return out
}

/** Fight targets after every provider's filter; an answer that would empty the list is ignored. */
export function providerFightTargets(state: GameState, attacker: Operative, foes: string[]): string[] {
  let out = [...foes]
  for (const p of providers.values()) {
    const f = p.fightTargets?.(state, attacker, out)
    if (!f) continue
    const kept = out.filter((id) => f.includes(id))
    if (kept.length > 0) out = kept
  }
  return out
}

export function providerCanFly(state: GameState, op: Operative, kind: string): boolean {
  for (const p of providers.values()) if (p.canFly?.(state, op, kind)) return true
  return false
}

export function providerIgnoresMine(state: GameState, op: Operative, mine: Marker): boolean {
  for (const p of providers.values()) if (p.ignoresMine?.(state, op, mine)) return true
  return false
}

// ---- batch D prep (M10) ------------------------------------------------------------------------

/** batch D prep: the die results nothing may re-roll for this roll (every provider's answer united, sorted). */
export function providerRerollBannedValues(state: GameState, info: RerollBanInfo): number[] {
  const out = new Set<number>()
  for (const p of providers.values()) for (const v of p.rerollBannedValues?.(state, info) ?? []) out.add(v)
  return [...out].sort((a, b) => a - b)
}

export function providerPreBattleChoices(state: GameState, seat: Seat): ReactionOffer[] {
  const out: ReactionOffer[] = []
  for (const p of providers.values()) out.push(...(p.preBattleChoices?.(state, seat) ?? []))
  return out
}

export function providerExtraCoverSaves(state: GameState, op: Operative): number {
  let n = 0
  for (const p of providers.values()) n += p.extraCoverSaves?.(state, op) ?? 0
  return Math.max(0, n)
}

export function providerSetAsideBatches(state: GameState, seat: Seat): { skipFirst: boolean } | null {
  let any = false
  let skipFirst = false
  for (const p of providers.values()) {
    const b = p.setAsideBatches?.(state, seat)
    if (!b) continue
    any = true
    if (b.skipFirst === true) skipFirst = true
  }
  return any ? { skipFirst } : null
}

/** M10 batch D shared: some provider wants `op`'s removal outside an attack to be able to pause for a decision. */
export function providerPausableRemoval(state: GameState, op: Operative): boolean {
  for (const p of providers.values()) if (p.pausableRemoval?.(state, op)) return true
  return false
}
