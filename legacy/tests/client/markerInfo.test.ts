import { describe, expect, it } from 'vitest'
import { apTip, orderTip, woundTip } from '../../src/client/ui/markerInfo'

describe('overhead marker tooltips', () => {
  it('names the order token by shape and colour', () => {
    expect(orderTip('conceal').title).toMatch(/Conceal.*blue square/)
    expect(orderTip('engage').title).toMatch(/Engage.*orange diamond/)
  })

  it('AP pips describe the activation state', () => {
    expect(apTip(3, 1, true, true).body).toContain('1 of 3 AP left')
    expect(apTip(2, 2, false, true).body).toContain('Ready')
    expect(apTip(2, 0, false, false).body).toContain('Expended')
  })

  it('wound bar flags injured', () => {
    expect(woundTip(4, 10, true).body).toMatch(/^Injured/)
    expect(woundTip(10, 10, false).title).toBe('Wounds 10/10')
  })
})
