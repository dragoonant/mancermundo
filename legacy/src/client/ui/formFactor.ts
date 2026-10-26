// Form-factor detection (M11 mobile support).
//
//   getFormFactor()  -> { touch, compact, portrait, phone }   (plain snapshot, safe outside React)
//   useFormFactor()  -> same value as a React hook; re-renders on resize / orientationchange /
//                       visualViewport resize through ONE shared listener (useSyncExternalStore).
//
// touch    primary pointer is coarse (or the device reports touch points and has no fine pointer).
// phone    touch and the short side of the window is under 500 CSS px (phones, not tablets).
// compact  the small-touch-screen layout. Today compact === phone: tablets keep the desktop layout.
//          Desktop (compact false) must look and behave exactly as it did before M11.
// portrait window is taller than wide.
//
// Testing override: `?ff=compact` forces touch/compact/phone true, `?ff=desktop` forces them all false
// (portrait is always measured from the real window). Every change also mirrors onto
// document.documentElement.dataset.ff = 'compact' | 'desktop' so CSS can key off it.
import { useSyncExternalStore } from 'react'

export type FormFactor = { touch: boolean; compact: boolean; portrait: boolean; phone: boolean }

const SERVER: FormFactor = { touch: false, compact: false, portrait: false, phone: false }

function override(): 'compact' | 'desktop' | null {
  if (typeof window === 'undefined') return null
  try {
    const v = new URLSearchParams(window.location.search).get('ff')
    return v === 'compact' || v === 'desktop' ? v : null
  } catch {
    return null
  }
}

function mq(query: string): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia(query).matches
  } catch {
    return false
  }
}

function measure(): FormFactor {
  if (typeof window === 'undefined') return SERVER
  const w = window.innerWidth
  const h = window.innerHeight
  const portrait = h > w
  const ff = override()
  if (ff === 'compact') return { touch: true, compact: true, portrait, phone: true }
  if (ff === 'desktop') return { touch: false, compact: false, portrait, phone: false }
  const touch = mq('(pointer: coarse)') || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0 && !mq('(pointer: fine)'))
  const phone = touch && Math.min(w, h) < 500
  return { touch, compact: phone, portrait, phone }
}

let current: FormFactor | null = null
const listeners = new Set<() => void>()
let attached = false

function same(a: FormFactor, b: FormFactor): boolean {
  return a.touch === b.touch && a.compact === b.compact && a.portrait === b.portrait && a.phone === b.phone
}

function publish(ff: FormFactor): void {
  if (typeof document !== 'undefined') document.documentElement.dataset.ff = ff.compact ? 'compact' : 'desktop'
}

function refresh(): void {
  const next = measure()
  if (current && same(current, next)) return
  current = next
  publish(next)
  listeners.forEach((l) => l())
}

function attach(): void {
  if (attached || typeof window === 'undefined') return
  attached = true
  window.addEventListener('resize', refresh)
  window.addEventListener('orientationchange', refresh)
  window.visualViewport?.addEventListener('resize', refresh)
}

/** Current form factor. Cheap: cached after the first call and kept fresh by the shared listener. */
export function getFormFactor(): FormFactor {
  if (typeof window === 'undefined') return SERVER
  if (!current) {
    current = measure()
    publish(current)
  }
  attach()
  return current
}

function subscribe(cb: () => void): () => void {
  attach()
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function useFormFactor(): FormFactor {
  return useSyncExternalStore(subscribe, getFormFactor, () => SERVER)
}

// Mark <html data-ff> as early as possible (at import) so CSS keyed on it is right before first paint.
if (typeof window !== 'undefined') getFormFactor()
