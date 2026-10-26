// The fighter card slot of the battle screen: the hovered fighter, else the selected one, drawn from the DISPLAY state. On a phone the
// card would cover the board, so it is a small button that opens the card as a sheet.
import { createPortal } from 'react-dom'
import { useDisplayState } from '../presentation/presentedStore'
import { FighterCard } from './Panels'
import { useFormFactor } from './formFactor'
import { panel } from './theme'
import { useUi } from './uiStore'
import { Btn, seatColor } from './widgets'

export function FighterStrip() {
  const state = useDisplayState()
  const selected = useUi((s) => s.selected)
  const hover = useUi((s) => s.hoverFighter)
  const cardOpen = useUi((s) => s.cardOpen)
  const ff = useFormFactor()
  const id = hover && state?.fighters[hover] ? hover : selected
  const f = state && id ? state.fighters[id] : undefined
  if (!state || !f) return null
  if (!ff.compact) return <FighterCard state={state} fighterId={f.id} width={310} />
  if (!cardOpen) {
    return (
      <Btn data-testid="fighter-card-open" onClick={() => useUi.setState({ cardOpen: true })} style={{ ...panel, borderLeft: `4px solid ${seatColor(f.seat)}`, pointerEvents: 'auto', minHeight: 44, maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {f.name} · {f.wounds}/{f.maxWounds} W
      </Btn>
    )
  }
  return createPortal(
    <div className="ms-touch" data-testid="fighter-sheet" style={{ position: 'fixed', inset: 0, background: 'rgba(5,5,10,0.6)', display: 'grid', placeItems: 'center', zIndex: 80, padding: 8 }} onClick={() => useUi.setState({ cardOpen: false })}>
      <div onClick={(e) => e.stopPropagation()}>
        <FighterCard state={state} fighterId={f.id} width="min(520px, calc(100vw - 16px))" onClose={() => useUi.setState({ cardOpen: false })} />
      </div>
    </div>,
    document.body,
  )
}
