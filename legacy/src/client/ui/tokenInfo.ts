// Operative token wording for hover tooltips. Counts, owners and expiry come from the engine (`Operative.tokens`);
// the look of each kind is in tokenDefs.ts and the long explanations are glossary entries in the team files.
import type { OperativeToken } from '@/engine'
import { lookupTerm } from '../game/glossary'
import { SEAT_NAME } from '../game/labels'
import type { MarkerTip } from './markerInfo'
import { tokenDef } from './tokenDefs'

const EXPIRY_TEXT: Record<string, string> = {
  battle: 'It lasts the rest of the battle.',
  turningPointEnd: 'It goes at the end of the turning point.',
  sourceNextActivation: 'It goes when the operative that placed it next activates.',
  sourceIncapacitated: 'It goes if the operative that placed it is incapacitated.',
  holderActivationEnd: 'It goes when the holder\'s activation ends.',
}

/** Hover title and body for one token stack, e.g. "Markerlight tokens x2". */
export function tokenTip(t: OperativeToken): MarkerTip {
  const d = tokenDef(t.kind)
  const entry = lookupTerm(d.term)
  const expiry = (t.expires ?? []).map((e) => EXPIRY_TEXT[e]).filter(Boolean).join(' ')
  const detail = d.detail?.(t.data)
  return {
    title: `${d.label} token${t.count > 1 ? ` x${t.count}` : ''} (${SEAT_NAME[t.owner]})`,
    body: `${entry?.body ?? d.body}${detail ? ` ${detail}` : ''}${expiry ? ` ${expiry}` : ''}`,
  }
}
