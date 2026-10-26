// Figure animation overrides. While the director plays a move beat the displayed state still holds the
// old position; the figure reads this store each frame and walks the engine's own move segments.
import type { MoveSegmentEvent } from '@/engine/events'

export interface MoveAnim {
  segments: MoveSegmentEvent[]
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

export function startMoveAnim(id: string, segments: MoveSegmentEvent[], durationMs: number): void {
  moves.set(id, { segments, startedAt: performance.now(), durationMs })
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

/** Position along the path at the current time, or null when this operative is not animating. */
export function animPosition(id: string, now = performance.now()): { x: number; y: number; z: number; heading: number } | null {
  const a = moves.get(id)
  if (!a || a.segments.length === 0) return null
  const t = a.durationMs <= 0 ? 1 : Math.min(1, (now - a.startedAt) / a.durationMs)
  const total = a.segments.reduce((s, g) => s + Math.max(0.01, g.length), 0)
  let want = t * total
  for (const seg of a.segments) {
    const len = Math.max(0.01, seg.length)
    if (want <= len) {
      const f = want / len
      // jumps arc over the gap
      const arc = seg.kind === 'jump' ? Math.sin(f * Math.PI) * 1.2 : 0
      return {
        x: seg.from.x + (seg.to.x - seg.from.x) * f,
        y: seg.from.y + (seg.to.y - seg.from.y) * f + arc,
        z: seg.from.z + (seg.to.z - seg.from.z) * f,
        heading: Math.atan2(seg.to.x - seg.from.x, seg.to.z - seg.from.z),
      }
    }
    want -= len
  }
  const last = a.segments[a.segments.length - 1]!
  return { ...last.to, heading: Math.atan2(last.to.x - last.from.x, last.to.z - last.from.z) }
}
