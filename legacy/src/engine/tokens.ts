// Operative tokens (M9 engine prep, generic capability "operativeTokens"). Tokens are per-owner counters a
// rule puts on an operative, friendly or enemy: Pathfinders Markerlight (up to 4), Plague Marines Poison
// (one per owner), Hierotek Chronometron / Deathmarked / Madness, Wyrmblade Soulsight. They are public
// information (view.ts does not redact them), every change emits TokenChanged, and they go away with the
// operative: removal clears the tokens it holds and the tokens whose source it was when they expire on
// 'sourceIncapacitated'. Reading helpers are pure; changing helpers take the step Ctx.
import type { Ctx } from './registry'
import type { GameState, Operative, OperativeToken, Seat } from './types'

/** Expiry triggers understood by the engine (a token may list several; the first to happen removes it). */
export type TokenExpiry =
  | 'battle'
  | 'turningPointEnd'
  /** the source operative starts its next activation (OPTICS-style "until its next activation") */
  | 'sourceNextActivation'
  /** the source operative is incapacitated */
  | 'sourceIncapacitated'
  /** the holder's current or next activation ends */
  | 'holderActivationEnd'

export interface AddTokenOpts {
  kind: string
  owner: Seat
  /** default 1 */
  count?: number
  /** the stack never exceeds this (Markerlight 4, Poison 1) */
  cap?: number
  sourceId?: string
  expires?: TokenExpiry[]
  data?: Record<string, unknown>
}

export function tokensOn(state: GameState, opId: string): OperativeToken[] {
  return state.operatives[opId]?.tokens ?? []
}

/** Count of `kind` tokens on the operative, from one owner or from both when `owner` is omitted. */
export function tokenCount(state: GameState, opId: string, kind: string, owner?: Seat): number {
  let n = 0
  for (const t of tokensOn(state, opId)) if (t.kind === kind && (owner === undefined || t.owner === owner)) n += t.count
  return n
}

export function hasToken(state: GameState, opId: string, kind: string, owner?: Seat): boolean {
  return tokenCount(state, opId, kind, owner) > 0
}

/** Did the operative already hold `kind` tokens of `owner` when the current action was declared (Toxic)? */
export function heldSinceActionStart(state: GameState, opId: string, kind: string, owner: Seat): boolean {
  const t = tokensOn(state, opId).find((x) => x.kind === kind && x.owner === owner && x.count > 0)
  if (!t) return false
  const declared = state.firefight.activation?.declaredSeq
  return declared === undefined || (t.since ?? -1) < declared
}

/** Operatives carrying `kind` tokens of `owner`, in id order. */
export function holdersOf(state: GameState, kind: string, owner?: Seat): Operative[] {
  return Object.values(state.operatives)
    .filter((o) => o.status === 'active' && hasToken(state, o.id, kind, owner))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
}

function emit(ctx: Ctx, op: Operative, kind: string, owner: Seat, delta: number, reason: string): void {
  ctx.emit({ type: 'TokenChanged', operativeId: op.id, kind, owner, count: tokenCount(ctx.state, op.id, kind, owner), delta, reason }, owner)
}

/** Add tokens (stacking with the owner's existing stack of that kind, up to `cap`). Returns how many were added. */
export function addToken(ctx: Ctx, opId: string, o: AddTokenOpts, reason: string): number {
  const op = ctx.state.operatives[opId]
  if (!op || op.status !== 'active') return 0
  const list = (op.tokens ??= [])
  let t = list.find((x) => x.kind === o.kind && x.owner === o.owner)
  const want = o.count ?? 1
  const have = t?.count ?? 0
  const room = o.cap === undefined ? want : Math.max(0, Math.min(want, o.cap - have))
  if (room <= 0) return 0
  if (!t) {
    t = { kind: o.kind, owner: o.owner, count: 0, since: ctx.state.seq }
    if (o.sourceId) t.sourceId = o.sourceId
    if (o.expires) t.expires = [...o.expires]
    if (o.data) t.data = { ...o.data }
    list.push(t)
  } else {
    if (o.sourceId) t.sourceId = o.sourceId
    if (o.expires) t.expires = [...o.expires]
    if (o.data) t.data = { ...(t.data ?? {}), ...o.data }
  }
  t.count += room
  emit(ctx, op, o.kind, o.owner, room, reason)
  return room
}

/** Remove up to `count` tokens of `kind` (all when omitted) from one owner or both. Returns how many went. */
export function removeToken(ctx: Ctx, opId: string, kind: string, reason: string, owner?: Seat, count?: number): number {
  const op = ctx.state.operatives[opId]
  if (!op?.tokens) return 0
  let removed = 0
  for (const t of op.tokens) {
    if (t.kind !== kind || (owner !== undefined && t.owner !== owner)) continue
    const n = count === undefined ? t.count : Math.min(t.count, count - removed)
    if (n <= 0) continue
    t.count -= n
    removed += n
    emit(ctx, op, t.kind, t.owner, -n, reason)
  }
  op.tokens = op.tokens.filter((t) => t.count > 0)
  return removed
}

/** Remove every token matching `pred` on every operative (one TokenChanged per stack). */
export function removeTokensWhere(ctx: Ctx, pred: (t: OperativeToken, holder: Operative) => boolean, reason: string): number {
  let n = 0
  for (const op of Object.values(ctx.state.operatives).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!op.tokens || op.tokens.length === 0) continue
    const keep: OperativeToken[] = []
    for (const t of op.tokens) {
      if (pred(t, op)) {
        n += t.count
        const count = t.count
        t.count = 0
        ctx.emit({ type: 'TokenChanged', operativeId: op.id, kind: t.kind, owner: t.owner, count: 0, delta: -count, reason }, t.owner)
      } else keep.push(t)
    }
    op.tokens = keep
  }
  return n
}

/** Move every `kind` token of `owner` onto one operative (Soulsight: performing the action again moves the token). */
export function moveTokenTo(ctx: Ctx, kind: string, owner: Seat, opId: string, o: Omit<AddTokenOpts, 'kind' | 'owner'>, reason: string): void {
  removeTokensWhere(ctx, (t) => t.kind === kind && t.owner === owner, reason)
  addToken(ctx, opId, { ...o, kind, owner }, reason)
}

// ---------------------------------------------------------------------------
// Engine-driven expiry (called by firefight.ts, markers.ts and strategy.ts)
// ---------------------------------------------------------------------------

/** The operative left the killzone (removed or set aside): its own tokens go, and so do 'sourceIncapacitated' ones it placed. */
export function tokensOnRemoval(ctx: Ctx, opId: string): void {
  removeTokensWhere(ctx, (t, holder) => holder.id === opId || (t.sourceId === opId && (t.expires ?? []).includes('sourceIncapacitated')), 'removed')
}

export function tokensOnActivationStart(ctx: Ctx, opId: string): void {
  removeTokensWhere(ctx, (t) => t.sourceId === opId && (t.expires ?? []).includes('sourceNextActivation'), 'sourceActivated')
}

export function tokensOnActivationEnd(ctx: Ctx, opId: string): void {
  removeTokensWhere(ctx, (t, holder) => holder.id === opId && (t.expires ?? []).includes('holderActivationEnd'), 'activationEnded')
}

export function tokensOnTurningPointEnd(ctx: Ctx): void {
  removeTokensWhere(ctx, (t) => (t.expires ?? []).includes('turningPointEnd'), 'turningPointEnd')
}
