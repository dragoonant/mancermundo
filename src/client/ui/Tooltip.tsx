// Shared styled tooltip. Replaces native `title=` popups (banned by tests/client/noNativeTooltips.test.ts).
// Usage: <Tooltip title="Rotate" body="15 degrees (Q)">{<button>..</button>}</Tooltip>
// The child must be a single element; it receives hover/focus/tap handlers and aria-describedby. The popup is
// portalled to <body> (never clipped; works from inside drei <Html>), ignores the pointer, and flips/clamps to
// stay on screen. Hover shows after a short delay; keyboard focus shows at once; on touch a tap toggles it and a
// tap elsewhere closes it. Pass no title (or `disabled`) to render the child untouched.
import {
  cloneElement, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type ReactElement, type ReactNode, type SyntheticEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { colors, panel } from './theme'

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right'

const GAP = 8
const MARGIN = 8
const HOVER_DELAY_MS = 150

const tipBox: CSSProperties = {
  ...panel,
  position: 'fixed',
  maxWidth: 260,
  padding: '7px 10px',
  fontSize: 12,
  lineHeight: 1.4,
  pointerEvents: 'none',
  zIndex: 2000,
  boxSizing: 'border-box',
}

interface Rect { left: number; top: number; right: number; bottom: number }

function place(anchor: Rect, w: number, h: number, wanted: TooltipPlacement): { left: number; top: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const fits = (p: TooltipPlacement) => {
    if (p === 'top') return anchor.top - GAP - h >= MARGIN
    if (p === 'bottom') return anchor.bottom + GAP + h <= vh - MARGIN
    if (p === 'left') return anchor.left - GAP - w >= MARGIN
    return anchor.right + GAP + w <= vw - MARGIN
  }
  const opposite: Record<TooltipPlacement, TooltipPlacement> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }
  const p = fits(wanted) || !fits(opposite[wanted]) ? wanted : opposite[wanted]
  const cx = (anchor.left + anchor.right) / 2
  const cy = (anchor.top + anchor.bottom) / 2
  let left: number
  let top: number
  if (p === 'top') { left = cx - w / 2; top = anchor.top - GAP - h }
  else if (p === 'bottom') { left = cx - w / 2; top = anchor.bottom + GAP }
  else if (p === 'left') { left = anchor.left - GAP - w; top = cy - h / 2 }
  else { left = anchor.right + GAP; top = cy - h / 2 }
  return {
    left: Math.max(MARGIN, Math.min(left, vw - w - MARGIN)),
    top: Math.max(MARGIN, Math.min(top, vh - h - MARGIN)),
  }
}

function Popup({ id, anchor, placement, title, body }: { id: string; anchor: Rect; placement: TooltipPlacement; title: ReactNode; body?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos(place(anchor, width, height, placement))
  }, [anchor, placement])
  return createPortal(
    <div
      ref={ref}
      id={id}
      role="tooltip"
      data-testid="tooltip"
      style={{ ...tipBox, left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
    >
      <div style={{ fontWeight: 700, color: colors.accent }}>{title}</div>
      {body != null && body !== false && <div style={{ marginTop: 2, color: colors.text }}>{body}</div>}
    </div>,
    document.body,
  )
}

/** The same popup anchored at a screen point instead of an element (3D board markers, which have no DOM node). */
export function PointTooltip({ x, y, title, body, placement = 'top' }: { x: number; y: number; title: ReactNode; body?: ReactNode; placement?: TooltipPlacement }) {
  const id = useId()
  const anchor = useMemo(() => ({ left: x - 6, top: y - 6, right: x + 6, bottom: y + 6 }), [x, y])
  return <Popup id={id} anchor={anchor} placement={placement} title={title} body={body} />
}

interface ChildProps {
  onPointerEnter?: (e: SyntheticEvent) => void
  onPointerLeave?: (e: SyntheticEvent) => void
  onFocus?: (e: SyntheticEvent) => void
  onBlur?: (e: SyntheticEvent) => void
  onClick?: (e: SyntheticEvent) => void
  onPointerDown?: (e: SyntheticEvent) => void
  'aria-describedby'?: string
}

export function Tooltip({ title, body, placement = 'top', disabled, wrap, children }: {
  title?: ReactNode
  body?: ReactNode
  placement?: TooltipPlacement
  disabled?: boolean
  /** Wrap the child in a span that hosts the hover handlers (the child gets pointer-events:none). Use for disabled buttons, which swallow pointer events. */
  wrap?: boolean
  children: ReactElement<ChildProps>
}) {
  const id = useId()
  const [anchor, setAnchor] = useState<Rect | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const el = useRef<HTMLElement | null>(null)
  const touchOpen = useRef(false)
  const lastWasTouch = useRef(false)

  const clear = useCallback(() => { if (timer.current) { clearTimeout(timer.current); timer.current = null } }, [])
  const measure = useCallback((target: HTMLElement) => {
    el.current = target
    const r = target.getBoundingClientRect()
    setAnchor({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })
  }, [])
  const hide = useCallback(() => { clear(); touchOpen.current = false; setAnchor(null) }, [clear])
  useEffect(() => clear, [clear])

  // Tap elsewhere closes a touch-opened tooltip; scrolling/resizing closes any (the anchor rect would be stale).
  const open = anchor !== null
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (touchOpen.current && el.current && !el.current.contains(e.target as Node)) hide()
    }
    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [open, hide])

  if (disabled || title == null || title === false) return children

  const cp = children.props
  const pointerType = (e: SyntheticEvent) => (e.nativeEvent as PointerEvent).pointerType
  const handlers: ChildProps = {
    'aria-describedby': anchor ? id : cp['aria-describedby'],
    onPointerDown: (e) => { lastWasTouch.current = pointerType(e) === 'touch'; cp.onPointerDown?.(e) },
    onPointerEnter: (e) => {
      cp.onPointerEnter?.(e)
      if (pointerType(e) === 'touch') return
      const target = e.currentTarget as HTMLElement
      clear()
      timer.current = setTimeout(() => measure(target), HOVER_DELAY_MS)
    },
    onPointerLeave: (e) => {
      cp.onPointerLeave?.(e)
      if (!touchOpen.current) hide()
    },
    onFocus: (e) => {
      cp.onFocus?.(e)
      // Focus from a tap is handled by the click toggle; keyboard focus shows immediately.
      if (!lastWasTouch.current) measure(e.currentTarget as HTMLElement)
    },
    onBlur: (e) => { cp.onBlur?.(e); hide() },
    onClick: (e) => {
      cp.onClick?.(e)
      if (!lastWasTouch.current) return
      if (touchOpen.current) hide()
      else { touchOpen.current = true; measure(e.currentTarget as HTMLElement) }
    },
  }
  const cloned = wrap
    ? (
      <span style={{ display: 'inline-flex' }} {...(handlers as object)}>
        {cloneElement(children as ReactElement<{ style?: CSSProperties }>, { style: { ...(children.props as { style?: CSSProperties }).style, pointerEvents: 'none' } })}
      </span>
    )
    : cloneElement(children, handlers)

  return (
    <>
      {cloned}
      {anchor && <Popup id={id} anchor={anchor} placement={placement} title={title} body={body} />}
    </>
  )
}
