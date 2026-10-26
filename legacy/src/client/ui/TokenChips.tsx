// DOM side of the operative tokens: a small SVG glyph (same shapes and colours as the 3D marker) and the row of
// chips on the operative card. Each chip has the shared Tooltip; on touch a tap opens it.
import type { Operative } from '@/engine'
import { glyphPoints, tokenDef, type TokenGlyph } from './tokenDefs'
import { tokenTip } from './tokenInfo'
import { seatColor } from './widgets'
import { Tooltip } from './Tooltip'

export function TokenGlyphIcon({ glyph, size = 12 }: { glyph: TokenGlyph; size?: number }) {
  const r = size / 2
  return (
    <svg aria-hidden width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ verticalAlign: -2 }}>
      {glyph.sides >= 20 ? (
        <circle cx={r} cy={r} r={r - 1} fill={glyph.ring ? 'none' : glyph.color} stroke={glyph.color} strokeWidth={glyph.ring ? 1.6 : 0} />
      ) : (
        <polygon points={glyphPoints(glyph.sides, size)} fill={glyph.ring ? 'none' : glyph.color} stroke={glyph.color} strokeWidth={glyph.ring ? 1.6 : 0} strokeLinejoin="round" />
      )}
    </svg>
  )
}

/** The operative's tokens as chips ("Markerlight x2"); nothing when it holds none. */
export function TokenChips({ tokens }: { tokens: Operative['tokens'] }) {
  const list = (tokens ?? []).filter((t) => t.count > 0)
  if (list.length === 0) return null
  return (
    <span data-testid="card-tokens" style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '2px 10px' }}>
      {list.map((t) => {
        const tip = tokenTip(t)
        const def = tokenDef(t.kind)
        return (
          <Tooltip key={`${t.kind}:${t.owner}`} title={tip.title} body={tip.body}>
            <span data-testid="token-chip" data-token={t.kind} style={{ borderBottom: `2px solid ${seatColor(t.owner)}`, cursor: 'help' }}>
              <TokenGlyphIcon glyph={def.glyph} /> {def.label}
              {t.count > 1 ? <b> x{t.count}</b> : null}
            </span>
          </Tooltip>
        )
      })}
    </span>
  )
}
