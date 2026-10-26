// The selected fighter's card (compact; S5c replaces it with the full FighterCard of Panels.tsx): name, type, the profile line with
// the engine's effective values, wounds and Flesh Wounds, status and conditions, weapons with their ammo state. Every number is
// read through `query.*` from the display state.
import { query, type GameState, type StatKey } from '@/engine'
import { humanize, postureWord, weaponName } from '../game/labels'
import { useDisplayState } from '../presentation/presentedStore'
import { colors, fontStack, panel } from './theme'
import { useUi } from './uiStore'
import { seatColor } from './widgets'

const KEYS: StatKey[] = ['M', 'WS', 'BS', 'S', 'T', 'W', 'I', 'A', 'Ld', 'Cl', 'Wil', 'Int']

function shown(state: GameState, id: string, key: StatKey): string {
  const v = query.stat(state, id, key)
  return key === 'M' ? `${v}"` : query.isTargetNumber(key) ? `${v}+` : String(v)
}

export function FighterStrip() {
  const state = useDisplayState()
  const selected = useUi((s) => s.selected)
  const hover = useUi((s) => s.hoverFighter)
  const id = hover && state?.fighters[hover] ? hover : selected
  const f = state && id ? state.fighters[id] : undefined
  if (!state || !f) return null
  const type = state.data.fighterTypes[f.typeId]
  return (
    <div data-testid="fighter-card" data-fighter={f.id} style={{ ...panel, width: 290, padding: '8px 10px', fontFamily: fontStack, fontSize: 12, pointerEvents: 'auto', boxSizing: 'border-box', borderTop: `4px solid ${seatColor(f.seat)}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <b style={{ fontSize: 14 }}>{f.name}</b>
        <span style={{ color: colors.muted }}>{type?.name ?? f.role}</span>
      </div>
      <div style={{ color: colors.muted, margin: '2px 0 6px' }}>
        {f.location !== 'board' ? humanize(f.location) : humanize(query.status(state, f.id))}
        {f.posture !== 'standing' ? ` · ${postureWord(f.posture)}` : ''}
        {f.ready && state.phase === 'action' ? ' · ready' : ''}
        {Object.keys(f.conditions).length > 0 ? ` · ${Object.keys(f.conditions).map((c) => humanize(c).toLowerCase()).join(', ')}` : ''}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 2, textAlign: 'center', marginBottom: 6 }} data-testid="fighter-profile">
        {KEYS.map((k) => {
          const base = f.stats[k]
          const eff = query.stat(state, f.id, k)
          return (
            <div key={k} style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 4, padding: '2px 0' }}>
              <div style={{ fontSize: 10, color: colors.muted }}>{k}</div>
              <div style={{ fontWeight: 700, color: eff !== base ? colors.accent : colors.text }}>{shown(state, f.id, k)}</div>
            </div>
          )
        })}
      </div>
      <div style={{ marginBottom: 4 }}>
        Wounds <b>{f.wounds}/{f.maxWounds}</b>
        {f.fleshWounds > 0 && <span style={{ color: '#ff8a7a' }}> · {f.fleshWounds} Flesh Wound{f.fleshWounds === 1 ? '' : 's'}</span>}
      </div>
      <div style={{ color: colors.muted }}>
        {f.weapons.map((w) => `${weaponName(state, w.weaponId)}${w.ammo !== 'ok' ? ` (${w.ammo === 'out' ? 'out of ammo' : w.ammo})` : ''}`).join(' · ') || 'Unarmed'}
      </div>
      {f.wargear.length > 0 && <div style={{ color: colors.muted }}>{f.wargear.map((g) => state.data.wargear[g]?.name ?? g).join(' · ')}</div>}
    </div>
  )
}
