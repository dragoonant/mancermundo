// Measure / line-of-sight tool (hotkey M, HUD button): click two points or operatives for the distance in inches
// (with the rounded-up increments), whether it is inside the 1" control range and, for two operatives, what each
// sees of the other. Strictly read-only: it never dispatches an action, so it works between decisions and on bot turns.
// The panel carries a drawer button (id 'measure') that folds it to a title tab. On touch devices it opens below the
// HUD toolbar row, clear of the system overlay in the top-right corner.
import { useEffect, type CSSProperties } from 'react'
import { MEASURE_COLOR } from '../board/MeasureLayer'
import { measure, type SightFacts } from '../interaction/sightlines'
import { useSight } from '../interaction/sightStore'
import { useDisplayState } from '../presentation/presentedStore'
import { CollapseButton, CollapsedTab, useCollapsed } from './collapse'
import { useFormFactor } from './formFactor'
import { touchToolbar } from './hudLayout'
import { colors, fontStack, panel } from './theme'
import { Tooltip } from './Tooltip'
import { Keyword, KeywordText } from './Keyword'
import { Btn } from './widgets'

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
}

/** M opens / closes the tool; Escape clears the line first, then closes the tool (and never cancels a staged move meanwhile). */
function useMeasureHotkeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e)) return
      const s = useSight.getState()
      if (e.key.toLowerCase() === 'm') {
        s.toggleMeasure()
        return
      }
      if (e.key === 'Escape' && s.measureOn) {
        e.stopImmediatePropagation()
        if (s.mA || s.mB) s.clearMeasure()
        else s.toggleMeasure()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
}

export function MeasureButton({ compact }: { compact: boolean }) {
  const on = useSight((s) => s.measureOn)
  return (
    <Tooltip title="Measure (M)" body="Click two points or two operatives for the distance, control range and what each sees of the other. Esc clears the line. Never changes the game.">
      <Btn
        data-testid="btn-measure"
        variant={on ? 'active' : 'base'}
        style={{ padding: compact ? '4px 6px' : '4px 8px', fontSize: compact ? 11 : 12 }}
        onClick={() => useSight.getState().toggleMeasure()}
      >
        {compact ? 'Ruler' : 'Measure'}
      </Btn>
    </Tooltip>
  )
}

function factsText(f: SightFacts): string {
  if (!f.visible) return 'not visible'
  if (f.forcedChoice) return 'visible, in cover or obscured (defender picks)'
  if (f.inCover && f.obscured) return 'visible, in cover and obscured'
  if (f.obscured) return 'visible, obscured'
  if (f.inCover) return 'visible, in cover'
  return 'visible, clear'
}

const box: CSSProperties = {
  ...panel,
  position: 'absolute',
  top: 66,
  left: '50%',
  transform: 'translateX(-50%)',
  width: 'min(380px, calc(100% - 640px))',
  minWidth: 300,
  padding: '8px 12px',
  boxSizing: 'border-box',
  pointerEvents: 'auto',
  fontFamily: fontStack,
  zIndex: 19,
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
}

const boxCompact: CSSProperties = { ...box, top: 56, left: 8, right: 'auto', width: 300, minWidth: 0, transform: 'none', padding: '4px 8px', gap: 1 }

export function MeasurePanel() {
  useMeasureHotkeys()
  const ff = useFormFactor()
  const compact = ff.compact
  const state = useDisplayState()
  const on = useSight((s) => s.measureOn)
  const a = useSight((s) => s.mA)
  const b = useSight((s) => s.mB)
  const [folded] = useCollapsed('measure')
  if (!on || !state) return null
  const top = ff.touch ? touchToolbar(compact).below : undefined
  const place: CSSProperties = compact ? { ...boxCompact, ...(top !== undefined ? { top } : {}) } : { ...box, ...(top !== undefined ? { top } : {}) }
  if (folded) {
    const tab: CSSProperties = compact ? { top: top ?? 56, left: 8 } : { top: top ?? 66, left: '50%', transform: 'translateX(-50%)' }
    return <CollapsedTab id="measure" title="Measure" accent={MEASURE_COLOR} style={{ position: 'absolute', zIndex: 19, ...tab }} />
  }
  const r = a && b ? measure(state, a, b) : null
  return (
    <div data-testid="measure-panel" className="ms-touch" style={place}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <b style={{ fontSize: 14, color: MEASURE_COLOR }}>Measure</b>
        <span style={{ display: 'flex', gap: 6 }}>
          <Btn data-testid="measure-clear" style={{ padding: '1px 7px', fontSize: 11 }} disabled={!a} onClick={() => useSight.getState().clearMeasure()}>
            Clear
          </Btn>
          <Btn data-testid="measure-close" style={{ padding: '1px 7px', fontSize: 11 }} onClick={() => useSight.getState().toggleMeasure()}>
            Done
          </Btn>
          <CollapseButton id="measure" title="measure panel" />
        </span>
      </div>
      {!a && <div data-testid="measure-hint" style={{ fontSize: 12, color: colors.muted }}>{compact ? 'Tap the first point (ground or operative).' : 'Click the first point: a spot on the board or an operative. Esc clears; M closes.'}</div>}
      {a && !b && <div data-testid="measure-hint" style={{ fontSize: 12, color: colors.muted }}>First point set. Now the second point.</div>}
      {r && (
        <div data-testid="measure-result" style={{ fontSize: 13 }}>
          <div style={{ fontSize: 12, color: colors.muted }}>
            {r.labelA} to {r.labelB}
          </div>
          <div data-testid="measure-distance" style={{ fontSize: 18, fontWeight: 800 }}>
            {r.inches.toFixed(2)}″
            <span style={{ fontSize: 12, fontWeight: 500, color: colors.muted }}> counts as {r.rounded}″ in rounded-up increments</span>
          </div>
          <div data-testid="measure-cr">
            Within 1″: <b style={{ color: r.within1 ? '#6dff9a' : colors.text }}>{r.within1 ? 'yes' : 'no'}</b>
            {r.inControlRange !== null && (
              <>
                {' · '}
                <Keyword term="Control range">control range</Keyword> (needs sight): <b style={{ color: r.inControlRange ? '#6dff9a' : colors.text }}>{r.inControlRange ? 'yes' : 'no'}</b>
              </>
            )}
          </div>
          {r.pointVisible !== null && (
            <div data-testid="measure-point-los">
              Line of sight to the point: <b>{r.pointVisible ? 'clear' : 'blocked'}</b>
            </div>
          )}
          {r.aSeesB && r.bSeesA && (
            <>
              <div data-testid="measure-a-sees-b">
                {r.labelA} sees {r.labelB}: <b><KeywordText text={factsText(r.aSeesB)} /></b>
              </div>
              <div data-testid="measure-b-sees-a">
                {r.labelB} sees {r.labelA}: <b><KeywordText text={factsText(r.bSeesA)} /></b>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
