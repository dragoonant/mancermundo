// Team builder: roster slots per the team's selection rules, per-operative loadout options from the
// datacard (illegal picks disabled with the reason), equipment picks up to the mission limit, team choices,
// and a live 3D preview of the selected operative. Legality comes from src/data helpers (validateRoster,
// validateLoadout, slotCost); this file only presents it.
import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { Group } from 'three'
import {
  allowedOperativePicks,
  defaultLoadout,
  defaultOperativePicks,
  enumerateLoadouts,
  operativeChoicesFor,
  expandWeaponRef,
  capProblems,
  teamCapProblems,
  slotCost,
  type DatacardData,
  type LoadoutChoice,
  type LoadoutSlot,
  type SelectionSlot,
  type TeamData,
  type WeaponData,
} from '@/data'
import type { Seat } from '@/engine'
import { dataBundle, flattenRoster, type SeatBuild } from '../game/adapter'
import { archetypeFor } from '../teams'
import { buildProblems, choiceOptions, randomBuildLoadouts, defaultBuild, defaultEquipmentPicks, equipmentFor, equipmentLimitOf, teamList } from '../game/defaults'
import { humanize } from '../game/labels'
import { isRangeRule, weaponReach } from '../game/glossary'
import { Figure, seatColor as figureSeatColor } from '../figures/Operative'
import { baseOfCard } from '../figures/OvalBase'
import { chosenWeaponIds } from '../game/adapter'
import { useSession } from '../store/session'
import { colors, fontStack, panel } from './theme'
import { Keyword, KeywordText, WeaponRules } from './Keyword'
import { Tooltip } from './Tooltip'
import { Btn, Dot, Muted } from './widgets'

const page: CSSProperties = {
  position: 'fixed',
  inset: 0,
  overflowY: 'auto',
  background: '#0d0e16',
  color: colors.text,
  fontFamily: fontStack,
  padding: 'max(12px, var(--safe-top)) 12px 16px',
  boxSizing: 'border-box',
}

const card: CSSProperties = { ...panel, padding: 12, boxSizing: 'border-box' }
const ENGINE_HEIGHT = (baseMm: number) => Math.round(((baseMm / 25.4) * 1.15 + 0.1) * 1000) / 1000

// ---------------------------------------------------------------- helpers

/**
 * Why `id` cannot be added to `slot` (null when it can). With `team`, the team-wide maximum caps count too (Kasrkin's
 * Gunners and Sharpshooter, the Farstalker Hounds), over `others`: the operatives already taken in the other slots.
 * Minimums and requirements (a Sorcerer, a Void-Jammer) cannot block an add; the roster check reports them.
 */
export function addProblem(
  slot: SelectionSlot,
  current: string[],
  id: string,
  team?: Pick<TeamData, 'selection'>,
  others: string[] = [],
  datacards: Record<string, Partial<Pick<DatacardData, 'name' | 'keywords'>>> = {},
): string | null {
  const repeatable = new Set(slot.repeatable ?? [])
  if (current.includes(id) && !repeatable.has(id)) return 'Only one of this operative is allowed.'
  if (slotCost(slot, [...current, id]) > slot.count) return `${slot.label ?? slot.id} is full (${slotCost(slot, current)}/${slot.count}).`
  const cap = capProblems(slot, [...current, id])[0]
  if (cap) return `${cap}.`
  if (team) {
    const maxOnly = { selection: { ...team.selection, caps: (team.selection.caps ?? []).filter((c) => c.max !== undefined).map((c) => ({ ...c, min: undefined })), requires: [] } }
    const teamCap = teamCapProblems(maxOnly, [...others, ...current, id], datacards)[0]
    if (teamCap) return `Roster: ${teamCap}.`
  }
  return null
}

export function weaponsOf(ref: string): WeaponData[] {
  const b = dataBundle()
  return expandWeaponRef(ref, b.weaponGroups)
    .map((id) => b.byId[id] as WeaponData | undefined)
    .filter((w): w is WeaponData => !!w)
}

function weaponLine(w: WeaponData): string {
  const rules = w.rules.filter((r) => !isRangeRule(r)).map((r) => `${humanize(r.rule.replace('core.wr.', ''))}${r.inches !== undefined ? ` ${r.inches}″` : r.x !== undefined ? ` ${r.x}` : ''}`).join(', ')
  return `Rng ${weaponReach(w).label} A${w.atk} ${w.hit} ${w.dmg.normal}/${w.dmg.crit}${rules ? ` · ${rules}` : ''}`
}

/** The stat line of each profile of a weapon, with every weapon rule as its own keyword. */
function WeaponLines({ ws }: { ws: WeaponData[] }) {
  return (
    <>
      {ws.map((w, i) => {
        const reach = weaponReach(w)
        const rules = w.rules.filter((r) => !isRangeRule(r))
        return (
          <span key={w.id}>
            {i > 0 && ' | '}
            {w.profile ? `${w.profile}: ` : ''}
            <Keyword term="Rng" /> <Keyword term={reach.term} kind="weaponRule">{reach.label}</Keyword> A{w.atk} {w.hit} {w.dmg.normal}/{w.dmg.crit}
            {rules.length > 0 && (
              <>
                {' · '}
                <WeaponRules rules={rules} />
              </>
            )}
          </span>
        )
      })}
    </>
  )
}

function WeaponName({ id }: { id: string }) {
  const ws = weaponsOf(id)
  const name = ws.length > 1 ? (ws[0]!.name) : (ws[0]?.name ?? humanize(id))
  return (
    <Tooltip title={name} body={ws.map((w) => `${w.profile ? `${w.profile}: ` : ''}${weaponLine(w)}`).join('\n') || 'Unknown weapon'}>
      <span style={{ borderBottom: `1px dotted ${colors.muted}` }}>{name}</span>
    </Tooltip>
  )
}

function nestedDefaults(card: DatacardData, slots: LoadoutSlot[]): LoadoutChoice {
  return defaultLoadout({ ...card, weapons: { fixed: [], options: slots } })
}

function nestedKeys(slots: LoadoutSlot[]): string[] {
  return slots.flatMap((s) => [s.id, ...(s.sets ?? []).flatMap((set) => nestedKeys(set.options ?? []))])
}

/** A random legal loadout for a datacard (uniform over every legal combination); the default when it has none. */
export function randomLoadout(card: DatacardData, rnd: () => number = Math.random): LoadoutChoice {
  const all = enumerateLoadouts(card)
  return all.length ? all[Math.floor(rnd() * all.length)]! : defaultLoadout(card)
}

/** The weapon names an operative carries for a loadout (fixed kit plus the chosen options). */
function carriedNames(card: DatacardData, choice: LoadoutChoice): string[] {
  const b = dataBundle()
  const ids = [...new Set([...card.weapons.fixed.flatMap((r) => expandWeaponRef(r, b.weaponGroups)), ...chosenWeaponIds(card, choice)])]
  const names = ids.map((id) => (b.byId[id] as WeaponData | undefined)?.name ?? humanize(id))
  return [...new Set(names)]
}

// ---------------------------------------------------------------- loadout editor

function SlotEditor({ card, slot, choice, onChange }: { card: DatacardData; slot: LoadoutSlot; choice: LoadoutChoice; onChange(c: LoadoutChoice): void }) {
  const answer = choice[slot.id] ?? []
  if (slot.sets) {
    const active = slot.sets.find((s) => s.id === answer[0])
    return (
      <div style={{ marginBottom: 10 }} data-testid={`loadout-slot-${slot.id}`}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{slot.label ?? humanize(slot.id)}</div>
        {slot.sets.map((set) => (
          <label key={set.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginBottom: 2 }}>
            <input
              type="radio"
              name={`${card.id}.${slot.id}`}
              data-testid={`set-${set.id}`}
              checked={answer[0] === set.id}
              onChange={() => {
                const next: LoadoutChoice = { ...choice }
                for (const other of slot.sets!) for (const k of nestedKeys(other.options ?? [])) delete next[k]
                next[slot.id] = [set.id]
                Object.assign(next, nestedDefaults(card, set.options ?? []))
                onChange(next)
              }}
            />
            {set.name}
          </label>
        ))}
        {active && (
          <div style={{ marginLeft: 18, marginTop: 4, borderLeft: `2px solid ${colors.border}`, paddingLeft: 8 }}>
            {(active.fixed?.length ?? 0) > 0 && (
              <div style={{ fontSize: 12, color: colors.muted, marginBottom: 4 }}>
                Comes with: {active.fixed!.map((f, i) => (
                  <span key={f}>
                    {i > 0 && ', '}
                    <WeaponName id={f} />
                  </span>
                ))}
              </div>
            )}
            {(active.options ?? []).map((o) => (
              <SlotEditor key={o.id} card={card} slot={o} choice={choice} onChange={onChange} />
            ))}
          </div>
        )}
      </div>
    )
  }
  const pick = slot.pick ?? 1
  return (
    <div style={{ marginBottom: 10 }} data-testid={`loadout-slot-${slot.id}`}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
        {slot.label ?? humanize(slot.id)} <span style={{ color: colors.muted, fontWeight: 400 }}>(choose {pick})</span>
      </div>
      {(slot.from ?? []).map((ref) => {
        const on = answer.includes(ref)
        const full = !on && answer.length >= pick
        const reason = full ? (pick === 1 ? 'Pick another to swap.' : `You already hold ${pick}; untick one first.`) : null
        const toggle = () => {
          if (on) {
            if (answer.length > (slot.min ?? pick)) onChange({ ...choice, [slot.id]: answer.filter((a) => a !== ref) })
            return
          }
          if (pick === 1) onChange({ ...choice, [slot.id]: [ref] })
          else if (!full) onChange({ ...choice, [slot.id]: [...answer, ref] })
        }
        const ws = weaponsOf(ref)
        const row = (
          <label
            key={ref}
            style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 13, marginBottom: 3, opacity: full && pick > 1 ? 0.45 : 1, cursor: full && pick > 1 ? 'not-allowed' : 'pointer' }}
          >
            <input
              type={pick === 1 ? 'radio' : 'checkbox'}
              name={`${card.id}.${slot.id}`}
              data-testid={`pick-${slot.id}-${ref}`}
              checked={on}
              disabled={full && pick > 1}
              onChange={toggle}
            />
            <span>
              <WeaponName id={ref} />
              <span style={{ display: 'block', fontSize: 11, color: colors.muted }}>
                <WeaponLines ws={ws} />
              </span>
            </span>
          </label>
        )
        return reason && pick > 1 ? (
          <Tooltip key={ref} title="Not allowed" body={reason} wrap>
            {row}
          </Tooltip>
        ) : (
          row
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------- preview

function Turntable({ children }: { children: ReactNode }) {
  const g = useRef<Group>(null)
  useFrame((_, dt) => {
    if (g.current) g.current.rotation.y += dt * 0.6
  })
  return <group ref={g}>{children}</group>
}

function Preview({ card, seat, weaponIds, teamId }: { card: DatacardData; seat: Seat; weaponIds: string[]; teamId: string }) {
  const paint = dataBundle().teams[teamId]!.paint
  const h = ENGINE_HEIGHT(card.base)
  const spec = {
    archetype: archetypeFor(card.id, card.figure.archetype, weaponIds, dataBundle().weaponGroups),
    height: h,
    ...baseOfCard(card, weaponIds),
    major: paint.major,
    minor: paint.minor,
    weaponIds,
    seatColor: figureSeatColor(seat),
  }
  return (
    <div data-testid="builder-preview" style={{ height: 240, background: 'radial-gradient(circle at 50% 60%, #242838, #0d0e16)', borderRadius: 8, overflow: 'hidden' }}>
      <Canvas camera={{ position: [0, h * 1.1, h * 3.2], fov: 38 }} frameloop="always" dpr={[1, 2]} gl={{ preserveDrawingBuffer: true }}>
        <ambientLight intensity={0.9} />
        <directionalLight position={[3, 5, 4]} intensity={1.6} />
        <Turntable>
          <Figure spec={spec} />
        </Turntable>
        <OrbitControls target={[0, h * 0.5, 0]} enablePan={false} minDistance={2} maxDistance={9} />
      </Canvas>
    </div>
  )
}

// ---------------------------------------------------------------- page

export function TeamBuilder() {
  const s = useSession()
  const b = dataBundle()
  const seat = s.builderSeat
  const build = s.builds[seat]
  const team = b.teams[build.teamId] as TeamData
  const mission = b.missions[s.missionId]!
  const [selectedIdx, setSelectedIdx] = useState(0)
  const ids = flattenRoster(team, build.roster)
  const idx = Math.min(selectedIdx, Math.max(0, ids.length - 1))
  const selectedCard = ids[idx] ? (b.byId[ids[idx]!] as DatacardData) : null
  const problemsA = useMemo(() => buildProblems(b, s.builds.A, mission.equipmentLimit), [b, s.builds.A, mission.equipmentLimit])
  const problemsB = useMemo(() => buildProblems(b, s.builds.B, mission.equipmentLimit), [b, s.builds.B, mission.equipmentLimit])
  const problems = seat === 'A' ? problemsA : problemsB
  const set = (next: SeatBuild) => s.setBuild(seat, next)
  // M9 batch B: a roster bonus (Hearthkyn Lugger) can raise the equipment limit
  const equipLimit = equipmentLimitOf(b, build, mission.equipmentLimit)

  const slotOffset = (slotId: string) => {
    let n = 0
    for (const sl of team.selection.slots) {
      if (sl.id === slotId) return n
      n += (build.roster[sl.id] ?? []).length
    }
    return n
  }
  const othersOf = (slot: SelectionSlot): string[] => team.selection.slots.filter((sl) => sl.id !== slot.id).flatMap((sl) => build.roster[sl.id] ?? [])
  const add = (slot: SelectionSlot, id: string) => {
    const cur = build.roster[slot.id] ?? []
    if (addProblem(slot, cur, id, team, othersOf(slot), b.byId as Record<string, DatacardData>)) return
    const at = slotOffset(slot.id) + cur.length
    const loadouts = [...build.loadouts]
    loadouts.splice(at, 0, defaultLoadout(b.byId[id] as DatacardData))
    // M9 batch B: per-operative keyword picks stay aligned with the flattened roster
    const picks = build.picks ? [...build.picks] : undefined
    // M9 batch C: a `unique` choice defaults to a pick no other operative holds yet
    const taken: Record<string, string[]> = {}
    for (const p of picks ?? []) for (const [k, v] of Object.entries(p ?? {})) (taken[k] ??= []).push(v)
    if (picks) picks.splice(at, 0, defaultOperativePicks(team, b.byId[id] as DatacardData, taken))
    set({ ...build, roster: { ...build.roster, [slot.id]: [...cur, id] }, loadouts, ...(picks ? { picks } : {}) })
    setSelectedIdx(at)
  }
  const remove = (slot: SelectionSlot, i: number) => {
    const cur = build.roster[slot.id] ?? []
    const at = slotOffset(slot.id) + i
    const loadouts = [...build.loadouts]
    loadouts.splice(at, 1)
    const picks = build.picks ? [...build.picks] : undefined
    if (picks) picks.splice(at, 1)
    set({ ...build, roster: { ...build.roster, [slot.id]: cur.filter((_, k) => k !== i) }, loadouts, ...(picks ? { picks } : {}) })
    setSelectedIdx(Math.max(0, at - 1))
  }

  const equipment = equipmentFor(b, team)
  const choice = build.loadouts[idx] ?? {}
  const weaponIds = selectedCard ? [...new Set([...selectedCard.weapons.fixed.flatMap((r) => expandWeaponRef(r, b.weaponGroups)), ...chosenWeaponIds(selectedCard, choice)])] : []

  return (
    <div className="ms-touch" style={page} data-testid="team-builder">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>Team builder</h2>
        {(['A', 'B'] as const).map((sd) => (
          <Btn key={sd} data-testid={`builder-seat-${sd}`} variant={sd === seat ? 'active' : 'base'} onClick={() => { s.setBuilderSeat(sd); setSelectedIdx(0) }}>
            <Dot seat={sd} />
            Seat {sd}: {b.teams[s.builds[sd].teamId]?.name}
            {(sd === 'A' ? problemsA : problemsB).length > 0 ? ' !' : ''}
          </Btn>
        ))}
        <select
          data-testid="builder-team"
          value={build.teamId}
          onChange={(e) => {
            s.setTeam(seat, e.target.value)
            setSelectedIdx(0)
          }}
          style={{ background: '#171a26', color: colors.text, border: `1px solid ${colors.border}`, borderRadius: 6, padding: 6 }}
        >
          {teamList(b).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <Btn onClick={() => set(defaultBuild(b, team))} data-testid="builder-reset">
          Reset to default
        </Btn>
        <Tooltip title="Randomise loadouts" body="Rolls a legal weapon loadout for every operative on this roster, keeping the team's weapon limits. The roster itself does not change.">
          <Btn data-testid="builder-randomise" onClick={() => set({ ...build, loadouts: randomBuildLoadouts(b, team, build) })}>
            Randomise loadouts
          </Btn>
        </Tooltip>
      </div>
      <Muted style={{ marginBottom: 10 }}>
        <KeywordText text={team.text} />
      </Muted>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: 10, alignItems: 'start' }}>
        {/* roster */}
        <div style={card} data-testid="builder-roster">
          {team.selection.slots.map((slot) => {
            const cur = build.roster[slot.id] ?? []
            const used = slotCost(slot, cur)
            return (
              <div key={slot.id} style={{ marginBottom: 14 }} data-testid={`slot-${slot.id}`}>
                <div style={{ fontWeight: 800, fontSize: 14 }}>
                  {slot.label ?? humanize(slot.id)}{' '}
                  <span data-testid={`slot-count-${slot.id}`} style={{ color: used === slot.count ? '#6dff9a' : colors.accent }}>
                    {used}/{slot.count}
                  </span>
                </div>
                {cur.map((id, i) => {
                  const c = b.byId[id] as DatacardData
                  const at = slotOffset(slot.id) + i
                  return (
                    <div
                      key={`${id}-${i}`}
                      data-testid={`pick-row-${slot.id}-${i}`}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px', marginTop: 3, borderRadius: 6, background: at === idx ? 'rgba(245,217,90,0.16)' : 'rgba(255,255,255,0.04)', cursor: 'pointer' }}
                      onClick={() => setSelectedIdx(at)}
                    >
                      <span style={{ flex: 1, fontSize: 13 }}>
                        {c.name}
                        <span data-testid={`pick-kit-${slot.id}-${i}`} style={{ display: 'block', fontSize: 11, color: colors.muted }}>
                          {carriedNames(c, build.loadouts[at] ?? {}).join(', ')}
                        </span>
                      </span>
                      <Btn data-testid={`remove-${slot.id}-${i}`} style={{ padding: '2px 8px' }} onClick={(e) => { e.stopPropagation(); remove(slot, i) }}>
                        Remove
                      </Btn>
                    </div>
                  )
                })}
                <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {slot.from.map((id) => {
                    const c = b.byId[id] as DatacardData
                    const why = addProblem(slot, cur, id, team, othersOf(slot), b.byId as Record<string, DatacardData>)
                    const btn = (
                      <Btn key={id} data-testid={`add-${id}`} disabled={!!why} style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => add(slot, id)}>
                        + {c.name}
                      </Btn>
                    )
                    return why ? (
                      <Tooltip key={id} title="Cannot add" body={why} wrap>
                        {btn}
                      </Tooltip>
                    ) : (
                      btn
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        {/* loadout */}
        <div style={card} data-testid="builder-loadout">
          {selectedCard ? (
            <>
              <div style={{ fontWeight: 800, fontSize: 15 }}>{selectedCard.name}</div>
              <div style={{ fontSize: 12, color: colors.muted, marginBottom: 6 }}>
                <Keyword term="APL" /> {selectedCard.stats.apl} &middot; <Keyword term="Move" /> {selectedCard.stats.move}&Prime; &middot; <Keyword term="Save" /> {selectedCard.stats.save} &middot;{' '}
                <Keyword term="Wounds" /> {selectedCard.stats.wounds}
              </div>
              <div data-testid="builder-keywords" style={{ fontSize: 11, color: colors.muted, marginBottom: 6 }}>
                {selectedCard.keywords.map((k, i) => (
                  <span key={k}>
                    {i > 0 && ' · '}
                    <Keyword term={k} kind="keyword" />
                  </span>
                ))}
              </div>
              {selectedCard.abilities.length + selectedCard.uniqueActions.length > 0 && (
                <div data-testid="builder-abilities" style={{ fontSize: 12, marginBottom: 6 }}>
                  <span style={{ color: colors.muted }}>Abilities: </span>
                  {[...selectedCard.abilities, ...selectedCard.uniqueActions].map((aid, i) => {
                    const name = (b.byId[aid] as { name?: string } | undefined)?.name
                    return name ? (
                      <span key={aid}>
                        {i > 0 && ', '}
                        <Keyword term={name} />
                      </span>
                    ) : null
                  })}
                </div>
              )}
              {selectedCard.weapons.fixed.length > 0 && (
                <div style={{ fontSize: 12, marginBottom: 8 }}>
                  Always carries:{' '}
                  {selectedCard.weapons.fixed.map((f, i) => (
                    <span key={f}>
                      {i > 0 && ', '}
                      <WeaponName id={f} />
                    </span>
                  ))}
                </div>
              )}
              {operativeChoicesFor(team, selectedCard).map((oc) => {
                const current = build.picks?.[idx]?.[oc.id] ?? defaultOperativePicks(team, selectedCard)[oc.id] ?? ''
                const allowed = allowedOperativePicks(oc, selectedCard)
                return (
                  <label key={oc.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 12, marginBottom: 6, alignItems: 'center' }}>
                    <span>{oc.label}</span>
                    <select
                      data-testid={`pick-${oc.id}`}
                      value={current}
                      onChange={(e) => {
                        const picks = ids.map((id, k) => build.picks?.[k] ?? defaultOperativePicks(team, b.byId[id] as DatacardData))
                        picks[idx] = { ...(picks[idx] ?? {}), [oc.id]: e.target.value }
                        set({ ...build, picks })
                      }}
                      style={{ background: '#171a26', color: colors.text, border: `1px solid ${colors.border}`, borderRadius: 6, padding: 4 }}
                    >
                      {oc.keywords.map((k) => (
                        <option key={k} value={k} disabled={!allowed.includes(k)}>
                          {humanize(k.toLowerCase())}
                          {allowed.includes(k) ? '' : ' (not for this operative)'}
                        </option>
                      ))}
                    </select>
                  </label>
                )
              })}
              {(selectedCard.weapons.options ?? []).length === 0 && <Muted>No loadout choices: this operative has a fixed kit.</Muted>}
              {(selectedCard.weapons.options ?? []).map((slot) => (
                <SlotEditor
                  key={slot.id}
                  card={selectedCard}
                  slot={slot}
                  choice={choice}
                  onChange={(c) => {
                    const loadouts = [...build.loadouts]
                    loadouts[idx] = c
                    set({ ...build, loadouts })
                  }}
                />
              ))}
              <Preview card={selectedCard} seat={seat} weaponIds={weaponIds} teamId={build.teamId} />
              <div data-testid="builder-carrying" style={{ fontSize: 12, marginTop: 4 }}>
                <span style={{ color: colors.muted }}>Carrying: </span>
                {carriedNames(selectedCard, choice).join(', ')}
              </div>
              <Muted style={{ marginTop: 4 }}>
                <KeywordText text={selectedCard.text} />
              </Muted>
            </>
          ) : (
            <Muted>Add operatives to the roster.</Muted>
          )}
        </div>

        {/* equipment + choices */}
        <div style={card} data-testid="builder-equipment">
          {(team.teamChoices ?? []).length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 4 }}>Team choices</div>
              {team.teamChoices!.map((tc) => (
                <label key={tc.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 12, marginBottom: 4, alignItems: 'center' }}>
                  <span>{tc.label}</span>
                  <select
                    data-testid={`choice-${tc.id}`}
                    value={build.choices?.[tc.id] ?? ''}
                    onChange={(e) => set({ ...build, choices: { ...(build.choices ?? {}), [tc.id]: e.target.value } })}
                    style={{ background: '#171a26', color: colors.text, border: `1px solid ${colors.border}`, borderRadius: 6, padding: 4 }}
                  >
                    <option value="">Choose...</option>
                    {choiceOptions(b, tc.group).map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  {build.choices?.[tc.id] && (
                    <span style={{ gridColumn: '1 / -1', color: colors.muted }}>
                      <KeywordText text={(b.byId[build.choices[tc.id]!] as { text?: string } | undefined)?.text ?? ''} />
                    </span>
                  )}
                </label>
              ))}
            </div>
          )}
          <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 4 }}>
            Equipment{' '}
            <span data-testid="equipment-count" style={{ color: colors.muted }}>
              {build.equipment.length}/{equipLimit}
            </span>
          </div>
          {equipment.map((e) => {
            const on = build.equipment.includes(e.id)
            const full = !on && build.equipment.length >= equipLimit
            const off = e.enabled === false
            const why = off ? 'Disabled in the current data.' : full ? `You already picked ${equipLimit}.` : null
            const picks = build.equipmentChoices?.[e.id] ?? []
            const toggle = () => {
              const choices = { ...(build.equipmentChoices ?? {}) }
              if (on) delete choices[e.id]
              else if (e.choice) choices[e.id] = defaultEquipmentPicks(e)
              set({ ...build, equipment: on ? build.equipment.filter((x) => x !== e.id) : [...build.equipment, e.id], equipmentChoices: choices })
            }
            const row = (
              <label key={e.id} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 12, marginBottom: 4, opacity: why ? 0.45 : 1 }}>
                <input type="checkbox" data-testid={`equip-${e.id}`} checked={on} disabled={!!why} onChange={toggle} />
                <span>
                  <b><Keyword term={e.name} kind="equipment" /></b> <span style={{ color: colors.muted }}>({e.scope})</span>
                  <span style={{ display: 'block', color: colors.muted }}>
                    <KeywordText text={e.text} />
                  </span>
                </span>
              </label>
            )
            return (
              <div key={e.id}>
                {why ? (
                  <Tooltip title="Not allowed" body={why} wrap>
                    {row}
                  </Tooltip>
                ) : (
                  row
                )}
                {on && e.choice && (
                  <div style={{ marginLeft: 22, marginBottom: 6, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', fontSize: 12 }}>
                    <span style={{ color: colors.muted }}>Pick {e.choice.pick}:</span>
                    {Array.from({ length: e.choice.pick }, (_, i) => (
                      <select
                        key={i}
                        data-testid={`equip-choice-${e.id}-${i}`}
                        value={picks[i] ?? ''}
                        onChange={(ev) => {
                          const next = [...picks]
                          next[i] = ev.target.value
                          set({ ...build, equipmentChoices: { ...(build.equipmentChoices ?? {}), [e.id]: next } })
                        }}
                        style={{ background: '#171a26', color: colors.text, border: `1px solid ${colors.border}`, borderRadius: 6, padding: 3 }}
                      >
                        {e.choice!.from.map((id) => {
                          const taken = !e.choice!.repeatable && picks.some((p, k) => p === id && k !== i)
                          return (
                            <option key={id} value={id} disabled={taken}>
                              {(b.byId[id] as { name?: string } | undefined)?.name ?? humanize(id)}
                              {taken ? ' (already picked)' : ''}
                            </option>
                          )
                        })}
                      </select>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div style={{ ...card, marginTop: 10 }}>
        {problems.length > 0 ? (
          <div data-testid="builder-problems" style={{ color: '#ff8a80', fontSize: 12 }}>
            {problems.map((p) => (
              <div key={p}>{p}</div>
            ))}
          </div>
        ) : (
          <div style={{ color: '#6dff9a', fontSize: 12 }} data-testid="builder-ok">
            Seat {seat} roster is legal ({ids.length} operatives).
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <Btn data-testid="builder-back" onClick={() => s.setScreen('start')}>
            Back
          </Btn>
          <Btn data-testid="builder-continue" variant="primary" disabled={problemsA.length + problemsB.length > 0} onClick={() => s.setScreen('briefing')}>
            Continue to briefing
          </Btn>
        </div>
      </div>
    </div>
  )
}
