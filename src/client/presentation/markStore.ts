// Short-lived board marks the director lays down for an area effect: the Blast circle where a shell landed and the Template shape
// of a flamer or chem-thrower. The Zones layer draws them; each clears itself after its linger time. Only the director writes.
import { create } from 'zustand'
import type { Vec2 } from '@/engine'
import { requestRepaint } from './animStore'

export type BoardMark = { id: number; kind: 'blast'; centre: Vec2; radius: number } | { id: number; kind: 'template'; polygon: Vec2[] }

/** How long a mark stays on the board (ms). */
export const MARK_LINGER_MS = 4000

export const useMarks = create<{ list: BoardMark[] }>(() => ({ list: [] }))

let nextId = 1

export function addMark(mark: { kind: 'blast'; centre: Vec2; radius: number } | { kind: 'template'; polygon: Vec2[] }): void {
  const id = nextId++
  useMarks.setState((s) => ({ list: [...s.list.slice(-5), { ...mark, id }] }))
  requestRepaint()
  setTimeout(() => {
    useMarks.setState((s) => ({ list: s.list.filter((m) => m.id !== id) }))
    requestRepaint()
  }, MARK_LINGER_MS)
}

export function clearMarks(): void {
  useMarks.setState({ list: [] })
}
