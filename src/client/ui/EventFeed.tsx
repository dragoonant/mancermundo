// The event feed: what has happened, in order, written by the director as each beat plays (nothing appears before its beat).
// Consecutive dice lines are grouped. Collapsible from the HUD.
import { useEffect, useRef } from 'react'
import { groupFeed, useFeedStore } from '../presentation/feedStore'
import { colors, fontStack, panel } from './theme'
import { useUi } from './uiStore'
import { seatColor } from './widgets'

export function EventFeed() {
  const feed = useFeedStore((s) => s.feed)
  const open = useUi((s) => s.feedOpen)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [feed.length, open])
  if (!open) return null
  const groups = groupFeed(feed.slice(-120))
  return (
    <div
      data-testid="event-feed"
      style={{ ...panel, width: 270, maxHeight: '42vh', overflowY: 'auto', padding: '6px 8px', fontFamily: fontStack, fontSize: 12, lineHeight: 1.4, pointerEvents: 'auto', boxSizing: 'border-box' }}
    >
      {groups.length === 0 && <div style={{ color: colors.muted }}>Nothing has happened yet.</div>}
      {groups.map((g) => (
        <div key={g[0]!.id} style={{ borderLeft: `3px solid ${g[0]!.seat ? seatColor(g[0]!.seat) : colors.border}`, paddingLeft: 6, marginBottom: 3, color: g[0]!.dice ? colors.muted : colors.text }}>
          {g.map((e) => (
            <div key={e.id}>{e.text}</div>
          ))}
        </div>
      ))}
      <div ref={end} />
    </div>
  )
}
