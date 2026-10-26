// URL parameters (client/params.ts): defaults, the two-gang pairs, the lab flag and lenient junk handling.
import { describe, expect, it } from 'vitest'
import { parseParams } from '../../src/client/params'

describe('parseParams', () => {
  it('an empty address is the menu: human against bot, nothing chosen', () => {
    const p = parseParams('')
    expect(p).toMatchObject({ test: false, lab: false, fps: false, ff: null, seed: null, gangs: null, starters: null, scenario: null, board: null, speed: null })
    expect(p.seats).toEqual(['human', 'bot'])
  })

  it('?test=1 with seats, seed, scenario, board and speed', () => {
    const p = parseParams('?test=1&seats=bot,human&seed=abc&scenario=tunnel-skirmish&board=foundry-run&speed=instant')
    expect(p.test).toBe(true)
    expect(p.seats).toEqual(['bot', 'human'])
    expect(p).toMatchObject({ seed: 'abc', scenario: 'tunnel-skirmish', board: 'foundry-run', speed: 'instant' })
  })

  it('gangs and starters are pairs; one value is not a pair', () => {
    expect(parseParams('?gangs=gol,esc').gangs).toEqual(['gol', 'esc'])
    expect(parseParams('?starters=gol.sg.starter-1,esc.sg.starter-2').starters).toEqual(['gol.sg.starter-1', 'esc.sg.starter-2'])
    expect(parseParams('?gangs=gol').gangs).toBeNull()
  })

  it('?lab is a flag, ?ff only takes compact or desktop, junk is ignored', () => {
    expect(parseParams('?lab&board=hive-heart').lab).toBe(true)
    expect(parseParams('?ff=compact').ff).toBe('compact')
    expect(parseParams('?ff=desktop').ff).toBe('desktop')
    expect(parseParams('?ff=huge&speed=warp&seats=a,b').ff).toBeNull()
    const p = parseParams('?speed=warp&seats=a,b')
    expect(p.speed).toBeNull()
    expect(p.seats).toEqual(['human', 'bot'])
  })
})
