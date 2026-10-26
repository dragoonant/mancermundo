// End screen: winner, VP by source (from VpScored events when the engine emits them), kill grades.
import { useMemo, useState } from 'react'
import type { GameEvent, GameState, Seat } from '@/engine'
import { dataBundle } from '../game/adapter'
import { killStatus } from '../game/kill'
import { humanize, SEAT_NAME } from '../game/labels'
import { useGame } from '../store/game'
import { randomSeed, useSession } from '../store/session'
import { colors, fontStack, panel } from './theme'
import { Tooltip } from './Tooltip'
import { Keyword, KeywordText } from './Keyword'
import { Btn, Dot, Muted } from './widgets'

export interface VpLine {
  source: string
  vp: number
}

/** VP per seat grouped by source, from `VpScored`-style events (shape-tolerant: the scoring module owns the event). */
export function vpBySource(events: GameEvent[]): Record<Seat, VpLine[]> {
  const out: Record<Seat, Map<string, number>> = { A: new Map(), B: new Map() }
  for (const ev of events) {
    const e = ev as unknown as Record<string, unknown>
    if (e.type !== 'VpScored') continue
    const seat = (e.seat ?? e.player) as Seat | null | undefined
    const amount = [e.amount, e.delta, e.vp].find((v): v is number => typeof v === 'number')
    if ((seat !== 'A' && seat !== 'B') || amount === undefined) continue
    const source = [e.source, e.reason, e.op, e.ruleId].find((v): v is string => typeof v === 'string') ?? 'mission'
    out[seat].set(source, (out[seat].get(source) ?? 0) + amount)
  }
  const lines = (m: Map<string, number>) => [...m.entries()].map(([source, vp]) => ({ source, vp }))
  return { A: lines(out.A), B: lines(out.B) }
}

export interface SourceLine {
  id: string
  op: string
  vp: number
  text: string
}

/** VP per scoring rule from the engine's own mission ledger (`state.mission.scored`), falling back to the event log. */
export function vpLines(state: GameState, ruleList: { id: string; op: string; text: string }[], events: GameEvent[], seat: Seat): SourceLine[] {
  const scored = state.mission?.scored
  if (scored) {
    return ruleList.map((r) => ({ id: r.id, op: r.op, vp: scored[r.id]?.[seat] ?? 0, text: r.text })).filter((l) => l.vp !== 0)
  }
  return vpBySource(events)[seat].map((l) => ({ id: l.source, op: 'mission', vp: l.vp, text: '' }))
}

export function EndScreen() {
  const state = useGame((g) => g.state)
  const meta = useGame((g) => g.meta)
  const events = useGame((g) => g.events)
  const [hidden, setHidden] = useState(false)
  const vp = useMemo(() => {
    const rules = meta?.mission.scoring ?? []
    return state ? { A: vpLines(state, rules, events, 'A'), B: vpLines(state, rules, events, 'B') } : { A: [], B: [] }
  }, [events, meta, state])
  if (!state || !meta || !state.result || hidden) {
    return hidden ? (
      <div style={{ position: 'fixed', top: 8, right: 8, zIndex: 90 }}>
        <Btn data-testid="end-show" variant="primary" onClick={() => setHidden(false)}>
          Show results
        </Btn>
      </div>
    ) : null
  }
  const r = state.result
  const playAgain = () => {
    useSession.getState().setSeed(randomSeed())
    useSession.getState().launch()
  }
  const save = () => {
    const file = useGame.getState().exportSave()
    if (!file) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `mancermundo-${meta.seed}.json`
    a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <div
      data-testid="end-screen"
      style={{ position: 'absolute', inset: 0, background: 'rgba(5,5,10,0.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 90, fontFamily: fontStack, color: colors.text }}
    >
      <div style={{ ...panel, width: 'min(680px, 94vw)', maxHeight: '90vh', overflowY: 'auto', padding: 20, boxSizing: 'border-box' }}>
        <h1 data-testid="end-title" style={{ margin: 0, fontSize: 26 }}>
          {r.winner === 'draw' ? 'Draw' : `${SEAT_NAME[r.winner]} wins`}
        </h1>
        <Muted style={{ marginBottom: 10 }}>
          {r.reason === 'resign' ? 'By resignation.' : 'After the final turning point.'} {r.placeholder ? 'Mission scoring is still a placeholder in this engine build.' : ''}
        </Muted>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {(['A', 'B'] as const).map((seat) => {
            const k = killStatus(state, seat)
            const team = dataBundle().teams[state.players[seat].teamId]
            return (
              <div key={seat} data-testid={`end-seat-${seat}`} style={{ borderTop: `4px solid ${seat === 'A' ? colors.playerA : colors.playerB}`, paddingTop: 6 }}>
                <div style={{ fontWeight: 800 }}>
                  <Dot seat={seat} />
                  {SEAT_NAME[seat]} &middot; {team?.name}
                </div>
                <div style={{ fontSize: 28, fontWeight: 800 }} data-testid={`end-vp-${seat}`}>
                  {r.vp[seat]} <Keyword term="VP" />
                </div>
                <div style={{ fontSize: 12, marginBottom: 4, color: colors.muted }}>By source</div>
                {vp[seat].length === 0 && <Muted>No VP scored from the mission.</Muted>}
                {vp[seat].map((l) => (
                  <div key={l.id} data-testid={`end-source-${seat}-${l.id}`} style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span>
                      <span style={{ color: colors.muted }}>
                        {l.op === 'kill' ? <Keyword term="Kill op" /> : l.op === 'crit' ? <Keyword term="Crit op" /> : 'Mission'} ·{' '}
                      </span>
                      <KeywordText text={humanize(l.id)} />
                    </span>
                    <b>{l.vp}</b>
                  </div>
                ))}
                <div style={{ fontSize: 12, marginTop: 8, color: colors.muted }}>
                  <Keyword term="Kill grade" />
                </div>
                <div data-testid={`end-kill-${seat}`} style={{ fontSize: 13 }}>
                  Grade <b>{k.grade}</b>/5 with {k.kills} enemy operatives down
                  <div style={{ color: colors.muted, fontSize: 11 }}>Grades at {k.thresholds.join(', ') || 'n/a'}</div>
                </div>
              </div>
            )
          })}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          <Btn data-testid="end-again" variant="primary" onClick={playAgain}>
            Play again (same settings)
          </Btn>
          <Tooltip title="Swap seats" body="Exchange the two sides: you take the other team and the bot takes yours. Same mission and layout, new seed.">
            <Btn data-testid="end-swap" onClick={() => useSession.getState().swapSeats()}>
              Swap seats
            </Btn>
          </Tooltip>
          <Btn data-testid="end-view" onClick={() => setHidden(true)}>
            View board
          </Btn>
          <Btn data-testid="end-save" onClick={save}>
            Save replay
          </Btn>
          <Btn data-testid="end-menu" onClick={() => useSession.getState().backToMenu()}>
            Menu
          </Btn>
        </div>
      </div>
    </div>
  )
}
