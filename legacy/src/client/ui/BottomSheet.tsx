// Bottom sheet for the compact (phone) layout (M11). DecisionPrompt renders into this instead of its
// floating desktop panels: full width of the overlay layer (App.tsx already insets that by the safe areas), at most 45dvh tall, a header that doubles as
// a drag handle (tap or swipe it to collapse the sheet to a one-line summary so the board shows), a
// scrolling body, and a footer that stays pinned to the bottom edge so the main action is always in reach.
//
//   header   [handle + title (tap / swipe)] [collapsed-only primary action] [chevron]
//   body     scrolls; everything the prompt has to say
//   footer   sticky; the action row (only while expanded — the header carries the primary action when collapsed)
//
// Collapse is driven two ways: the player (handle, chevron) and `auto` — whenever `auto` or `autoKey`
// changes the sheet snaps to `auto` (true = collapsed), so a decision that needs a board tap opens tucked
// away and a staged move collapses itself. While a move is `staged` the sheet becomes a one-line pill on the
// left of the bottom row and the touch Confirm/Cancel bar takes the right of that same row (see STAGED_BAR_PX),
// so sheet + bar + formation strip stack to about 116px. The sheet never runs under the right-edge camera column.
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { colors, fontStack, panel } from './theme'

const TOUCH_MIN = 44
const SWIPE_PX = 18

/** Width kept clear at the right edge of the overlay layer for the camera button column (40px + gutters). */
export const CAMERA_COL_PX = 56
/** Width of the touch Confirm / Cancel bar while a move is staged (it sits at the right of the bottom row). */
export const STAGED_BAR_PX = 288
/** Height of the staged bottom row (bar and collapsed sheet pill) and of the formation strip above it. */
export const STAGED_ROW_PX = 52

// Every button inside a sheet gets a 44px touch target, whichever component rendered it (WeaponPanel,
// RerollTray, ...). Inline styles never set min-height, so this wins without touching those files.
const SHEET_CSS = `
.ms-sheet { max-height: 45vh; max-height: 45dvh; bottom: 6px; }
@media (max-height: 420px) { .ms-sheet { max-height: 68vh; max-height: 68dvh; } }
.ms-sheet[data-staged="true"] { right: ${CAMERA_COL_PX + STAGED_BAR_PX + 6}px; min-height: ${STAGED_ROW_PX}px; justify-content: center; }
.ms-sheet[data-staged="true"][data-collapsed="false"] { z-index: 46; justify-content: flex-start; }
.ms-sheet button { min-height: ${TOUCH_MIN}px; min-width: ${TOUCH_MIN}px; touch-action: manipulation; }
.ms-sheet-body { overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
`

const sheet: CSSProperties = {
  ...panel,
  position: 'absolute',
  left: 8,
  right: CAMERA_COL_PX,
  display: 'flex',
  flexDirection: 'column',
  boxSizing: 'border-box',
  overflow: 'hidden',
  pointerEvents: 'auto',
  zIndex: 30,
}

const headerRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '0 6px 0 12px', flex: '0 0 auto', minHeight: TOUCH_MIN }

const handleZone: CSSProperties = {
  flex: 1,
  minWidth: 0,
  minHeight: TOUCH_MIN,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  gap: 3,
  cursor: 'pointer',
  touchAction: 'none', // the swipe is ours, not the page's
  userSelect: 'none',
  WebkitUserSelect: 'none',
}

const grip: CSSProperties = { width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.28)' }
const titleStyle: CSSProperties = { fontFamily: fontStack, fontWeight: 700, fontSize: 14, color: colors.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }

const chevron: CSSProperties = {
  fontFamily: fontStack,
  fontSize: 16,
  color: colors.text,
  background: 'rgba(255,255,255,0.08)',
  border: `1px solid ${colors.border}`,
  borderRadius: 8,
  cursor: 'pointer',
  flex: '0 0 auto',
}

const bodyStyle: CSSProperties = { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '2px 12px 8px', display: 'flex', flexDirection: 'column', gap: 6 }
const footerStyle: CSSProperties = {
  flex: '0 0 auto',
  padding: '4px 12px',
  borderTop: `1px solid ${colors.border}`,
  background: colors.bg,
}

export function BottomSheet({
  testId,
  title,
  auto = false,
  autoKey = '',
  staged = false,
  summary,
  footer,
  children,
}: {
  testId: string
  title: ReactNode
  /** Collapsed state to snap to whenever `auto` or `autoKey` changes. */
  auto?: boolean
  autoKey?: string
  /** A move is staged: dock as a narrow pill beside the touch Confirm/Cancel bar instead of stacking above it. */
  staged?: boolean
  /** Shown beside the title while collapsed: the primary action. */
  summary?: ReactNode
  /** Pinned under the scrolling body while expanded. */
  footer?: ReactNode
  children?: ReactNode
}) {
  const [collapsed, setCollapsed] = useState(auto)
  useEffect(() => { setCollapsed(auto) }, [auto, autoKey])

  const startY = useRef<number | null>(null)
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    startY.current = e.clientY
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* not every pointer can be captured */ }
  }
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    const y0 = startY.current
    startY.current = null
    if (y0 === null) return
    const dy = e.clientY - y0
    if (dy > SWIPE_PX) setCollapsed(true)
    else if (dy < -SWIPE_PX) setCollapsed(false)
    else setCollapsed((c) => !c)
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setCollapsed((c) => !c)
    }
  }

  return (
    <div className="ms-sheet" style={sheet} data-testid={testId} data-collapsed={collapsed ? 'true' : 'false'} data-staged={staged ? 'true' : 'false'}>
      <style>{SHEET_CSS}</style>
      <div style={headerRow}>
        <div
          style={handleZone}
          role="button"
          tabIndex={0}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand prompt' : 'Collapse prompt'}
          data-testid="prompt-sheet-handle"
          onPointerDown={onDown}
          onPointerUp={onUp}
          onPointerCancel={() => { startY.current = null }}
          onKeyDown={onKey}
        >
          <div style={grip} />
          <div style={titleStyle}>{title}</div>
        </div>
        {collapsed && summary}
        <button
          type="button"
          style={chevron}
          data-testid="prompt-sheet-toggle"
          aria-label={collapsed ? 'Expand prompt' : 'Collapse prompt'}
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? '▲' : '▼'}
        </button>
      </div>
      {/* the body stays mounted while collapsed so panels with their own state (weapon picks, dice picks) survive */}
      <div className="ms-sheet-body" style={collapsed ? { ...bodyStyle, display: 'none' } : bodyStyle} data-testid="prompt-sheet-body">{children}</div>
      {!collapsed && footer && <div style={footerStyle} data-testid="prompt-sheet-footer">{footer}</div>}
    </div>
  )
}
