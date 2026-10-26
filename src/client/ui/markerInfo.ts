// What the markers floating over each operative mean (order token, AP pips, wound bar). One source of wording
// for the 3D hover tooltip (BoardTooltip) and the operative card legend. Numbers come from the engine state.
import type { Order } from '@/engine'
import { create } from 'zustand'

export interface MarkerTip {
  title: string
  body: string
}

export const ORDER_COLOR: Record<Order, string> = { engage: '#ff8a2a', conceal: '#6fb7ff' }
export const AP_LIT = '#ffe066'
export const AP_DARK = '#33343c'

export function orderTip(order: Order): MarkerTip {
  return order === 'conceal'
    ? {
        title: 'Conceal order (blue square)',
        body: 'Cannot be shot at while in cover. It cannot Shoot (except with Silent weapons), Charge or counteract, but it can still Fight.',
      }
    : {
        title: 'Engage order (orange diamond)',
        body: 'Acts normally: can Shoot, Charge and counteract, but can be targeted even while in cover.',
      }
}

export function apTip(apl: number, lit: number, active: boolean, ready: boolean): MarkerTip {
  const state = active ? `${lit} of ${apl} AP left this activation.` : ready ? `Ready: ${apl} AP to spend when activated.` : 'Expended: already activated this turning point.'
  return { title: `Action points (APL ${apl})`, body: `${state} Yellow dots are AP still available.` }
}

export function woundTip(wounds: number, maxWounds: number, injured: boolean): MarkerTip {
  return {
    title: `Wounds ${wounds}/${maxWounds}`,
    body: injured ? 'Injured: below half its starting wounds, so it moves 2" less and its Hit is 1 worse.' : 'Remaining wounds. Below half it becomes injured.',
  }
}

/** The marker the pointer is over on the board, in screen pixels. The DOM side draws it with PointTooltip. */
export const useBoardTip = create<{ tip: (MarkerTip & { x: number; y: number }) | null }>(() => ({ tip: null }))
