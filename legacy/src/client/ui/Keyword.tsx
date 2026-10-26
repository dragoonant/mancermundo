// Hoverable / tappable game terms. <Keyword term="Piercing 1"> underlines the text with a dotted line and shows what the term
// means and does in play (src/client/game/glossary.ts) in the shared Tooltip. <KeywordText text="..."/> does the same for every
// glossary term found in a plain sentence. Unknown terms render as plain text.
//
// Touch: a tap on a keyword in running text opens its tooltip and is swallowed here; a keyword inside a button (an order card,
// an option) lets the tap through, so a tap anywhere on the button presses it, as it does with a mouse. A mouse click always
// falls through to the parent. Do not put a Keyword inside the child of another <Tooltip>: both would open.
import { Fragment, memo, useRef, type ReactNode, type SyntheticEvent } from 'react'
import { KIND_LABEL, linkTerms, lookupTerm, weaponRuleParts, type GlossaryEntry, type GlossaryKind, type WeaponRuleUseLike } from '../game/glossary'
import { colors } from './theme'
import { Tooltip } from './Tooltip'

const underline = { borderBottom: `1px dotted ${colors.muted}`, cursor: 'help' } as const

function TipBody({ entry }: { entry: GlossaryEntry }) {
  return (
    <>
      <div style={{ fontSize: 10, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6 }}>{KIND_LABEL[entry.kind]}</div>
      {entry.body}
    </>
  )
}

function KeywordTip({ entry, children }: { entry: GlossaryEntry; children: ReactNode }) {
  const touch = useRef(false)
  return (
    <Tooltip title={entry.term} body={<TipBody entry={entry} />}>
      <span
        data-keyword={entry.term}
        style={underline}
        onPointerDown={(e: SyntheticEvent) => {
          touch.current = (e.nativeEvent as PointerEvent).pointerType === 'touch'
        }}
        onClick={(e: SyntheticEvent) => {
          // a touch tap only opens the tooltip, unless the keyword sits in a button: the button is what the tap means.
          // A mouse click is left alone for the parent.
          const inButton = !!(e.currentTarget as HTMLElement).parentElement?.closest('button, [role="button"]')
          if (touch.current && !inButton) {
            e.stopPropagation()
            e.preventDefault()
          }
        }}
      >
        {children}
      </span>
    </Tooltip>
  )
}

/** One term with its tooltip. `children` is what is shown (default: the term itself); `kind` prefers one kind when a name is shared. */
export function Keyword({ term, kind, children }: { term: string; kind?: GlossaryKind; children?: ReactNode }) {
  const entry = lookupTerm(term, kind)
  const label = children ?? term
  if (!entry) return <>{label}</>
  return <KeywordTip entry={entry}>{label}</KeywordTip>
}

/** Free text with every glossary term linked. Cheap: segments are cached per string. `keywords={false}` leaves operative keywords (and names such as Boss Nob) plain. */
export const KeywordText = memo(function KeywordText({ text, keywords }: { text: string; keywords?: boolean }) {
  const segs = linkTerms(text, { keywords })
  if (segs.length === 1 && typeof segs[0] === 'string') return <>{text}</>
  return (
    <>
      {segs.map((s, i) =>
        typeof s === 'string' ? (
          <Fragment key={i}>{s}</Fragment>
        ) : (
          <KeywordTip key={i} entry={s.entry}>
            {s.text}
          </KeywordTip>
        ),
      )}
    </>
  )
})

/** The rules on one weapon profile, each its own keyword ("Piercing 1, Blast 2″"). Renders `empty` when there are none. */
export function WeaponRules({ rules, empty = null }: { rules: readonly WeaponRuleUseLike[] | undefined; empty?: ReactNode }) {
  if (!rules || rules.length === 0) return <>{empty}</>
  return (
    <>
      {rules.map((r, i) => {
        const { term, label } = weaponRuleParts(r)
        return (
          <Fragment key={`${r.rule}-${i}`}>
            {i > 0 && ', '}
            <Keyword term={term} kind="weaponRule">
              {label}
            </Keyword>
          </Fragment>
        )
      })}
    </>
  )
}
