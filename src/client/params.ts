// URL parameters (docs/spec/50-client.md section 4). Pure parsing: no DOM access, so it is unit-testable.
//   ?lab                          the S2L lab viewer (main.tsx routes it; it has its own parameters)
//   ?test=1&seats=human,bot&seed=<s>&gangs=gol,esc&scenario=<id|slug>&board=<id|slug>&starters=<id>,<id>&speed=instant
//        skips the menus and opens a battle (A = first gang, B = second); `scenario`/`board` accept the full id or the slug.
//   &fixture=shoot|charge|fight|card|end   (with ?test=1) plays the engine up to a screen worth looking at (client/dev/scenarios.ts)
export type AnimSpeed = 'normal' | 'fast' | 'instant'
export type SeatMode = 'human' | 'bot'

export interface UrlParams {
  /** ?test=1: skip the menus and start a battle with the default gangs */
  test: boolean
  /** ?lab: the lab viewer */
  lab: boolean
  fps: boolean
  /** ?ff=compact|desktop forces the phone layout on or off */
  ff: 'compact' | 'desktop' | null
  seats: [SeatMode, SeatMode]
  seed: string | null
  /** house prefixes or ids of the two gangs (`gol,esc`); each picks that house's first starter gang */
  gangs: [string, string] | null
  /** explicit starter gang ids (`gol.sg.starter-1,esc.sg.starter-2`); wins over `gangs` */
  starters: [string, string] | null
  scenario: string | null
  board: string | null
  speed: AnimSpeed | null
  /** ?fixture=<name>: dev fixture that fast-forwards a test battle to a given decision or screen */
  fixture: string | null
}

function mode(v: string | undefined, fallback: SeatMode): SeatMode {
  return v === 'human' || v === 'bot' ? v : fallback
}

function pair(raw: string | null): [string, string] | null {
  const parts = (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  return parts.length >= 2 ? [parts[0]!, parts[1]!] : null
}

export function parseParams(search: string): UrlParams {
  const q = new URLSearchParams(search)
  const seats = (q.get('seats') ?? '').split(',').map((s) => s.trim())
  const speed = q.get('speed')
  const ff = q.get('ff')
  return {
    test: q.get('test') === '1',
    lab: q.has('lab'),
    fps: q.has('fps'),
    ff: ff === 'compact' || ff === 'desktop' ? ff : null,
    seats: [mode(seats[0], 'human'), mode(seats[1], 'bot')],
    seed: q.get('seed'),
    gangs: pair(q.get('gangs')),
    starters: pair(q.get('starters')),
    scenario: q.get('scenario'),
    board: q.get('board'),
    speed: speed === 'normal' || speed === 'fast' || speed === 'instant' ? speed : null,
    fixture: q.get('fixture'),
  }
}

export function currentParams(): UrlParams {
  return parseParams(typeof location === 'undefined' ? '' : location.search)
}
