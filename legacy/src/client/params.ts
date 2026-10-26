// URL parameters (docs/spec/50-client.md section 4). Pure parsing: no DOM access, so it is unit-testable.
export type AnimSpeed = 'normal' | 'fast' | 'instant'
export type SeatMode = 'human' | 'bot'

export interface UrlParams {
  /** ?test=1: skip the menus and start a battle with default rosters */
  test: boolean
  gallery: boolean
  fps: boolean
  /** ?ff=compact|desktop forces the phone layout on or off */
  ff: 'compact' | 'desktop' | null
  seats: [SeatMode, SeatMode]
  seed: string | null
  mission: string | null
  /** a layout id or number (1-6), or 'auto' to roll one of the cards from the seed; the layout names its own map */
  layout: string | null
  teams: [string, string] | null
  speed: AnimSpeed | null
  scenario: string | null
  /** ?place=manual: the human places objective and equipment markers on the board (default: the engine's suggestions) */
  place: 'auto' | 'manual'
}

function mode(v: string | undefined, fallback: SeatMode): SeatMode {
  return v === 'human' || v === 'bot' ? v : fallback
}

export function parseParams(search: string): UrlParams {
  const q = new URLSearchParams(search)
  const seats = (q.get('seats') ?? '').split(',').map((s) => s.trim())
  const teams = (q.get('teams') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const speed = q.get('speed')
  const ff = q.get('ff')
  return {
    test: q.get('test') === '1',
    gallery: q.has('gallery'),
    fps: q.has('fps'),
    ff: ff === 'compact' || ff === 'desktop' ? ff : null,
    seats: [mode(seats[0], 'human'), mode(seats[1], 'bot')],
    seed: q.get('seed'),
    mission: q.get('mission'),
    layout: q.get('layout'),
    teams: teams.length >= 2 ? [teams[0]!, teams[1]!] : null,
    speed: speed === 'normal' || speed === 'fast' || speed === 'instant' ? speed : null,
    scenario: q.get('scenario'),
    place: q.get('place') === 'manual' ? 'manual' : 'auto',
  }
}

export function currentParams(): UrlParams {
  return parseParams(typeof location === 'undefined' ? '' : location.search)
}
