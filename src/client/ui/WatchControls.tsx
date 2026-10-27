// The watch bar of an AI vs AI game: Pause / Play, Step (one decision while paused), the speed, "stop when an attack starts" and
// "follow the action". Shown only when no seat is human. All pacing lives in store/game.ts; this file only presses its buttons.
// Keys: Space pauses or resumes, N or the right arrow steps. Phones get 44 px targets from the shared touch style.
import { useEffect, type CSSProperties } from 'react'
import { focusOf, followTo } from '../presentation/followCamera'
import { useSettings, type AnimSpeed } from '../presentation/settings'
import { useGame } from '../store/game'
import { isWatching } from '../store/pacing'
import { useFormFactor } from './formFactor'
import { colors, panel } from './theme'
import { Tooltip } from './Tooltip'
import { Btn } from './widgets'

export const SPEEDS: { id: AnimSpeed; label: string; body: string }[] = [
  { id: 'slow', label: 'Slow', body: 'Every roll and every log line stays up long enough to read.' },
  { id: 'normal', label: 'Normal', body: 'The pace of a normal game.' },
  { id: 'fast', label: 'Fast', body: 'Short beats: you still see each result go by.' },
  { id: 'instant', label: 'Instant', body: 'No waiting at all. The battle races to its end.' },
]

const isTyping = (t: EventTarget | null): boolean => t instanceof HTMLElement && (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable)

/** Space and N / right arrow, for as long as the bar is on screen (never while typing). */
function useWatchKeys(): void {
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return
      const g = useGame.getState()
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault()
        if (!e.repeat) g.togglePause()
      } else if (e.key === 'n' || e.key === 'N' || e.key === 'ArrowRight') {
        e.preventDefault()
        g.stepOnce()
      }
    }
    // a focused button would also press itself on the key release: the shortcut already did the job
    const onUp = (e: KeyboardEvent) => {
      if (!isTyping(e.target) && (e.key === ' ' || e.code === 'Space')) e.preventDefault()
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
    }
  }, [])
}

/** Moves the camera to the acting fighter while a bot decides (when "Follow the action" is on). */
function useFollow(): void {
  const follow = useGame((s) => s.follow)
  const deciding = useGame((s) => s.deciding)
  const speed = useSettings((s) => s.animSpeed)
  const id = deciding && !deciding.applied ? deciding.id : null
  useEffect(() => {
    const d = useGame.getState().deciding
    if (!follow || !id || !d) return
    const focus = focusOf(d.state, d.pending, d.action)
    if (focus) void followTo(focus, speed)
    // the speed only matters for the flight that starts now
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [follow, id])
}

/** Sits in the dock the battle screen centres at the bottom, under the decision card. */
const bar: CSSProperties = {
  ...panel,
  maxWidth: '100%',
  boxSizing: 'border-box',
  padding: '6px 8px',
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  pointerEvents: 'auto',
}

const group: CSSProperties = { display: 'flex', alignItems: 'center', gap: 4 }

export function WatchControls() {
  const seats = useGame((s) => s.seats)
  const paused = useGame((s) => s.paused)
  const reason = useGame((s) => s.pauseReason)
  const pauseOnAttacks = useGame((s) => s.pauseOnAttacks)
  const follow = useGame((s) => s.follow)
  const over = useGame((s) => s.state?.phase === 'ended')
  const speed = useSettings((s) => s.animSpeed)
  const setSpeed = useSettings((s) => s.setAnimSpeed)
  const ff = useFormFactor()
  const g = useGame.getState
  useWatchKeys()
  useFollow()
  if (!isWatching(seats) || over) return null
  const small: CSSProperties = ff.compact ? { padding: '5px 7px', fontSize: 12 } : {}
  return (
    <div className="ms-touch" data-testid="watch-bar" data-paused={paused ? '1' : '0'} data-speed={speed} role="toolbar" aria-label="Watch controls" style={bar}>
      <div style={group}>
        <Tooltip title={paused ? 'Play' : 'Pause'} body="Hold the game where it is, or let it run. Space does the same.">
          <Btn data-testid="watch-play" variant={paused ? 'primary' : 'base'} aria-pressed={paused} onClick={() => g().togglePause()} style={{ ...small, minWidth: ff.compact ? 56 : 74 }}>
            {paused ? 'Play' : 'Pause'}
          </Btn>
        </Tooltip>
        <Tooltip wrap={!paused} title="Step" body="While paused, let exactly one decision through. N or the right arrow does the same.">
          <Btn data-testid="watch-step" disabled={!paused} onClick={() => g().stepOnce()} style={small}>
            Step
          </Btn>
        </Tooltip>
      </div>
      <div role="radiogroup" aria-label="Speed" data-testid="watch-speed" style={group}>
        {SPEEDS.map((s) => (
          <Tooltip key={s.id} title={s.label} body={s.body}>
            <Btn data-testid={`watch-speed-${s.id}`} role="radio" aria-checked={speed === s.id} variant={speed === s.id ? 'active' : 'base'} onClick={() => setSpeed(s.id)} style={small}>
              {s.label}
            </Btn>
          </Tooltip>
        ))}
      </div>
      <div style={group}>
        <Tooltip title="Pause on attacks" body="Stop by itself when a shot or a fight begins, so you can read the odds first and then step through the dice.">
          <Btn data-testid="watch-attacks" aria-pressed={pauseOnAttacks} variant={pauseOnAttacks ? 'active' : 'base'} onClick={() => g().setPauseOnAttacks(!pauseOnAttacks)} style={small}>
            {ff.compact ? 'Attacks' : 'Pause on attacks'}
          </Btn>
        </Tooltip>
        <Tooltip title="Follow the action" body="The camera moves to the fighter who is acting. Turn it off to look around yourself.">
          <Btn data-testid="watch-follow" aria-pressed={follow} variant={follow ? 'active' : 'base'} onClick={() => g().setFollow(!follow)} style={small}>
            {ff.compact ? 'Follow' : 'Follow the action'}
          </Btn>
        </Tooltip>
      </div>
      {paused && reason === 'attack' && (
        <div data-testid="watch-reason" style={{ flexBasis: '100%', width: 0, minWidth: '100%', textAlign: 'center', fontSize: 12, color: colors.accent }}>
          An attack is about to start. Press Step to go through it one decision at a time, or Play.
        </div>
      )}
    </div>
  )
}
