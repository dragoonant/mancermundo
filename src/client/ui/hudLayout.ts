// Shared HUD geometry for touch devices. The system overlay covers the top-right corner of the screen (about
// 110 x 120 CSS px on the owner's iPhone / iPad; safe-area insets do not report it), so the HUD keeps clear of it:
// the bar stops short of the corner, the buttons sit in a toolbar row under the bar on the left, and the measure /
// sight-line panels open below that row.

/** Corner of a touch screen the system overlay covers (CSS px). */
export const OVERLAY_W = 120
export const OVERLAY_H = 130

/** Touch layout: the toolbar row's top, its height (44 px targets on phones), and the first y below it for other panels. */
export function touchToolbar(compact: boolean): { top: number; height: number; below: number } {
  const top = compact ? 66 : 62
  const height = compact ? 44 : 32
  return { top, height, below: top + height + 6 }
}
