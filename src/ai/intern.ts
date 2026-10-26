// Board definitions are static, but a state that crosses a worker boundary is structured-cloned on every request, and the
// engine's navigation graphs and this package's grid fields are cached per `BoardDef` object. Interning the definition (one
// object per distinct board, found by a signature of its geometry) keeps those caches warm across requests.
import type { BoardDef, GameState, PlayerView } from '@/engine'

const interned = new Map<string, BoardDef>()

function signature(def: BoardDef): string {
  let h = 2166136261
  const mix = (n: number) => {
    h ^= Math.round(n * 1000) | 0
    h = Math.imul(h, 16777619)
  }
  for (const w of def.walls) for (const p of w.poly) (mix(p.x), mix(p.z))
  for (const d of def.doors) for (const p of d.poly) (mix(p.x), mix(p.z))
  for (const o of def.obstacles) for (const p of o.poly) (mix(p.x), mix(p.z))
  return `${def.id}|${def.walls.length}|${def.doors.length}|${def.obstacles.length}|${h >>> 0}`
}

/** The view with its board definition replaced by the interned copy (a new view object; the input is not touched). */
export function internBoard<T extends GameState | PlayerView>(state: T): T {
  const sig = signature(state.board.def)
  let def = interned.get(sig)
  if (!def) {
    if (interned.size >= 12) interned.clear()
    interned.set(sig, state.board.def)
    def = state.board.def
  }
  return def === state.board.def ? state : { ...state, board: { ...state.board, def } }
}
