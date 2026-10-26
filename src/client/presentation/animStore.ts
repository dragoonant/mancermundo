// Figure animation overrides. While the director plays a move beat the displayed state still holds the old position; the
// figure reads this store each frame and walks the engine's own path (the polyline of `FighterMoved`).
import type { Vec2 } from '@/engine'

export interface MoveAnim {
  /** centre polyline, start first */
  points: Vec2[]
  startedAt: number
  durationMs: number
}

const moves = new Map<string, MoveAnim>()
let repaint: () => void = () => {}

export function setRepaint(fn: () => void): void {
  repaint = fn
}
export function requestRepaint(): void {
  repaint()
}

export function startMoveAnim(id: string, points: Vec2[], durationMs: number): void {
  moves.set(id, { points, startedAt: performance.now(), durationMs })
  repaint()
}
export function endMoveAnim(id: string): void {
  moves.delete(id)
  repaint()
}
export function clearAnims(): void {
  moves.clear()
}
export function anyAnim(): boolean {
  return moves.size > 0
}

/** Position along the path at the current time, or null when this fighter is not animating. `heading` is the engine bearing of the current leg. */
export function animPosition(id: string, now = performance.now()): { x: number; z: number; heading: number } | null {
  const a = moves.get(id)
  if (!a || a.points.length < 2) return null
  const t = a.durationMs <= 0 ? 1 : Math.min(1, Math.max(0, (now - a.startedAt) / a.durationMs))
  const lens: number[] = []
  for (let i = 0; i + 1 < a.points.length; i++) lens.push(Math.max(0.01, Math.hypot(a.points[i + 1]!.x - a.points[i]!.x, a.points[i + 1]!.z - a.points[i]!.z)))
  let want = t * lens.reduce((s, l) => s + l, 0)
  for (let i = 0; i < lens.length; i++) {
    const len = lens[i]!
    const p = a.points[i]!
    const q = a.points[i + 1]!
    if (want <= len || i === lens.length - 1) {
      const f = Math.min(1, want / len)
      return { x: p.x + (q.x - p.x) * f, z: p.z + (q.z - p.z) * f, heading: Math.atan2(q.x - p.x, q.z - p.z) }
    }
    want -= len
  }
  return null
}
