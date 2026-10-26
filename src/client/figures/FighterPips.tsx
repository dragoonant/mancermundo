// The small tokens over a fighter on the board: a pip per Wound (filled while it is left), a red mark per Flesh Wound, and a chip
// for each state worth seeing at a glance - Ready (can still activate), Broken, Blaze, Blind, Out of Ammo and the other
// conditions. Pure view of the fighter record; `pips` is separate so tests can check what is shown without a canvas.
import { Html } from '@react-three/drei'
import type { Fighter } from '@/engine'
import { colors } from '../ui/theme'

export interface Chip {
  id: string
  label: string
  colour: string
  title: string
}

const CONDITION_CHIPS: Record<string, Omit<Chip, 'id'>> = {
  broken: { label: 'BRK', colour: '#b46bff', title: 'Broken' },
  blaze: { label: 'FIRE', colour: '#ff8a2a', title: 'On fire (Blaze)' },
  blind: { label: 'BLD', colour: '#9aa0b8', title: 'Blinded' },
  disarmed: { label: 'DIS', colour: '#9aa0b8', title: 'Disarmed' },
  concussion: { label: 'CON', colour: '#7fc8ff', title: 'Concussed' },
  insane: { label: 'INS', colour: '#ff5fa0', title: 'Insane' },
  entangled: { label: 'ENT', colour: '#9fe3a0', title: 'Entangled' },
}

/** Whether any weapon the fighter carries has run dry (out, jammed or spent). */
export const outOfAmmo = (f: Fighter): boolean => f.weapons.some((w) => w.ammo !== 'ok')

/** The chips over a fighter, in a fixed order. `ready`: the Action phase is on and the fighter has not activated. */
export function chipsFor(f: Fighter, ready: boolean): Chip[] {
  const out: Chip[] = []
  if (ready && f.ready) out.push({ id: 'ready', label: 'RDY', colour: '#3fc46b', title: 'Ready: can still activate this round' })
  for (const [id, def] of Object.entries(CONDITION_CHIPS)) if (f.conditions[id]) out.push({ id, ...def })
  if (outOfAmmo(f)) out.push({ id: 'ammo', label: 'AMMO', colour: '#ff6a5f', title: 'A weapon is out of ammo' })
  return out
}

export interface Pips {
  /** Wounds left, Wounds lost (capped for a big fighter), Flesh Wounds taken */
  left: number
  lost: number
  flesh: number
}

export function pips(f: Fighter, wounds?: number): Pips {
  const shown = Math.max(0, wounds ?? f.wounds)
  const max = Math.min(12, f.maxWounds)
  return { left: Math.min(shown, max), lost: Math.max(0, max - shown), flesh: f.fleshWounds }
}

export function FighterPips({ f, y, ready, wounds }: { f: Fighter; y: number; ready: boolean; wounds?: number }) {
  const p = pips(f, wounds)
  const chips = chipsFor(f, ready)
  return (
    <Html position={[0, y, 0]} center zIndexRange={[8, 0]} style={{ pointerEvents: 'none' }}>
      <div data-testid={`fighter-pips-${f.id}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
        <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          {Array.from({ length: p.left }, (_, i) => (
            <span key={`w${i}`} data-pip="wound" style={{ width: 6, height: 6, borderRadius: 3, background: '#e8e8f2', border: '1px solid rgba(0,0,0,0.6)' }} />
          ))}
          {Array.from({ length: p.lost }, (_, i) => (
            <span key={`l${i}`} data-pip="lost" style={{ width: 6, height: 6, borderRadius: 3, background: 'transparent', border: '1px solid rgba(232,232,242,0.45)' }} />
          ))}
          {Array.from({ length: p.flesh }, (_, i) => (
            <span key={`f${i}`} data-pip="flesh" style={{ width: 5, height: 5, background: '#ff4a3f', border: '1px solid rgba(0,0,0,0.6)', transform: 'rotate(45deg)', marginLeft: i === 0 ? 3 : 0 }} />
          ))}
        </div>
        {chips.length > 0 && (
          <div style={{ display: 'flex', gap: 2 }}>
            {chips.map((c) => (
              <span
                key={c.id}
                data-chip={c.id}
                aria-label={c.title}
                style={{ font: '800 8px system-ui, sans-serif', letterSpacing: '0.04em', padding: '0 3px', borderRadius: 3, background: 'rgba(14,15,22,0.88)', border: `1px solid ${c.colour}`, color: c.colour === '#9aa0b8' ? colors.muted : c.colour }}
              >
                {c.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </Html>
  )
}
