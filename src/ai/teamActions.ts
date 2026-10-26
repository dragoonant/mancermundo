// Value of the unique actions the M9 teams bring (Markerlight, Signal, Medikit, Reanimate, Flail, Soulsight...), in the
// planner's currency (wounds of expected damage). Each is a cheap heuristic over the view: the engine decides legality
// (the offers come from `abilityOffers`), this only says how much an offered action is worth next to Shoot or Fight, so
// the planner will spend an AP on it when it pays off. Unknown abilities are worth nothing and are never planned.
import type { Action, GameState, Operative } from '@/engine'
import type { AbilityOffer } from '@/engine/abilities'
import { bodyOf, visible } from '@/engine/los'
import { distanceBetween } from '@/engine/measure'
import { enemiesOf, friendsOf } from '@/engine/state'
import { tokenCount } from '@/engine/tokens'
import type { AiCtx } from './tiers'

const ML = 'pf.markerlight'
/** Team mines laid with the shared Place Marker (batch C: the spot filter replaced their own actions). */
const MINES = ['ks.meltaMine', 'ph.haywire-mine']
const POISON = 'pm.poison'
const SOULSIGHT = 'wyr.soulsight'

const hasRanged = (v: GameState, o: Operative): boolean => o.weapons.some((w) => v.data.weapons[w]?.type === 'ranged')
const wounded = (o: Operative): number => Math.max(0, o.maxWounds - o.wounds)

/** Friendly ranged operatives (not `op`) that stand a chance to shoot `target` this turning point. */
function shootersFor(v: GameState, op: Operative, target: Operative): number {
  let n = 0
  for (const f of friendsOf(v, op)) {
    if (!f.ready || !hasRanged(v, f)) continue
    if (distanceBetween(bodyOf(f), bodyOf(target)) > 18) continue
    if (visible(v, bodyOf(f), bodyOf(target))) n++
  }
  return n
}

const MARKERLIGHT_STEP = [1, 0.8, 0.6, 0.45, 0]

function value(ctx: AiCtx, v: GameState, op: Operative, offer: AbilityOffer): number {
  const id = offer.abilityId
  const target = typeof offer.params.targetId === 'string' ? v.operatives[offer.params.targetId] : undefined
  switch (id) {
    // ---- Pathfinders
    case 'pf.a.markerlight':
    case 'pf.a.markerlight-shasla': {
      if (!target || target.seat === op.seat) return 0
      const have = tokenCount(v, target.id, ML, op.seat)
      const gain = offer.params.param === 'himl' ? 1.6 : 1
      const own = hasRanged(v, op) ? 0.35 : 0
      return (0.45 + 0.3 * shootersFor(v, op, target) + own) * (MARKERLIGHT_STEP[Math.min(4, have)] ?? 0) * gain
    }
    case 'pf.a.signal':
      return target && target.seat === op.seat && target.ready ? 1.2 : 0
    case 'pf.a.system-jam':
      return target && target.seat !== op.seat ? (target.ready ? 1.1 : 0.2) : 0
    case 'pf.a.medikit':
      return target && target.seat === op.seat ? Math.min(wounded(target), 4) * 0.6 : 0
    case 'pf.a.pulse-accelerator': {
      const near = friendsOf(v, op).filter((f) => f.ready && distanceBetween(bodyOf(f), bodyOf(op)) <= 3.5).length
      return near > 0 ? 0.5 + 0.3 * near : 0
    }
    case 'pf.a.photon-grenade':
      return target && target.seat !== op.seat && target.ready ? 0.6 : 0
    case 'pf.a.remote-pilot':
      // the drone's free action may not Shoot and moves 2 inches at most: not worth the controller's AP
      return 0
    // ---- Hierotek Circle
    case 'hie.a.reanimate':
      return 3
    case 'hie.a.accelerate':
      return target && target.seat === op.seat && target.ready ? 1.3 : 0
    case 'hie.a.canoptek-repair':
      return target && target.seat === op.seat ? Math.min(wounded(target), 6) * 0.5 : 0
    case 'hie.a.reinforce-metal':
    case 'hie.a.chronometron':
    case 'hie.a.augment-weapon':
      return target && target.seat === op.seat && target.ready ? 0.9 : 0
    case 'hie.a.vision-of-madness':
      return target && target.seat !== op.seat ? (target.ready ? 1.1 : 0.2) : 0
    case 'hie.a.timesplinter':
      return target && target.seat === op.seat && !target.ready ? 1.1 : 0
    case 'hie.a.interstitial-command':
    case 'hie.a.interstitial-command-despotek':
      return target && target.seat === op.seat && target.ready ? 1.6 : 0
    case 'hie.a.nightmare-shroud':
      return enemiesOf(v, op).some((e) => distanceBetween(bodyOf(e), bodyOf(op)) <= 8) ? 0.8 : 0
    case 'hie.a.nanomine':
    case 'hie.a.harbinger-of-despair': {
      // a marker placed where enemies will pass: only worth it if no marker of the kind stands yet
      const kind = id === 'hie.a.nanomine' ? 'hie.nanomine' : 'hie.despair'
      return v.markers.some((m) => m.equipmentId === kind && m.owner === op.seat) ? 0 : 0.7
    }
    // ---- Plague Marines
    case 'pm.a.flail': {
      let total = 0
      for (const o of Object.values(v.operatives)) {
        if (o.id === op.id || o.status !== 'active') continue
        if (distanceBetween(bodyOf(op), bodyOf(o)) > 2 || !visible(v, bodyOf(op), bodyOf(o))) continue
        const dmg = Math.min(4, o.wounds)
        total += o.seat === op.seat ? -dmg * 1.2 : dmg + (tokenCount(v, o.id, POISON, op.seat) === 0 ? 0.4 : 0)
      }
      return Math.max(0, total) * 0.9
    }
    case 'pm.a.poisonous-miasma': {
      if (!target || target.seat === op.seat) return 0
      return tokenCount(v, target.id, POISON, op.seat) > 0 ? 1.5 : 1.1
    }
    case 'pm.a.putrescent-vitality':
      return target && target.seat === op.seat ? Math.min(wounded(target), 7) * 0.5 : 0
    // ---- Wyrmblade
    case 'wyr.a.target-vulnerability':
      return enemiesOf(v, op).some((e) => visible(v, bodyOf(op), bodyOf(e))) ? 0.7 : 0
    case 'wyr.a.familiars-soulsight-sniper':
    case 'wyr.a.familiars-soulsight-talon':
      return target && target.seat !== op.seat && tokenCount(v, target.id, SOULSIGHT, op.seat) === 0 ? 0.9 : 0
    case 'wyr.a.assassinate':
      return target && target.seat !== op.seat ? 2 : 0
    // ---- Legionaries
    case 'lg.a.grisly-mark': {
      // a 2 AP, once-per-battle marker: worth it only beside an objective the enemy will come to contest
      const objectives = v.markers.filter((m) => m.kind === 'objective')
      const beside = objectives.some((m) => Math.hypot(m.pos.x - op.pos.x, m.pos.z - op.pos.z) <= 4)
      return beside && enemiesOf(v, op).some((e) => e.status === 'active') ? 1.3 : 0
    }
    // ---- Kasrkin
    case 'ks.a.tactical-command':
      // a free extra skill for one operative: best for a ready shooter; moving the Clearance Sweep marker is a small gain
      if (offer.params.param === 'sweep') return 0.3
      return target && target.seat === op.seat ? (target.ready ? 1.1 : 0.4) + (hasRanged(v, target) ? 0.2 : 0) : 0
    case 'ks.a.medikit':
      return target && target.seat === op.seat ? Math.min(wounded(target), 5) * 0.6 : 0
    case 'ks.a.auspex-scan':
      // strips obscuring and feeds Elimination Pattern: worth it while enemies stand within 8 inches
      return enemiesOf(v, op).some((e) => e.status === 'active' && distanceBetween(bodyOf(e), bodyOf(op)) <= 8) ? 0.9 : 0
    case 'ks.a.battle-comms':
      return target && target.seat === op.seat && target.ready ? 1.2 : 0
    // ---- Place Marker (shared action): only the team mines are worth planning; other carried markers stay put
    case 'marker:place': {
      const m = v.markers.find((k) => k.id === offer.params.markerId)
      if (!m || !m.equipmentId || !MINES.includes(m.equipmentId)) return 0
      // the Melta Mine (2D6+3) and the Haywire Mine hit whoever walks into them: lay one while enemies are close enough,
      // or beside an objective the enemy has to come to
      // (a triggered Melta Mine is 2D6+3 damage, so a well-laid one is worth more than most single shots)
      if (enemiesOf(v, op).some((e) => e.status === 'active' && distanceBetween(bodyOf(e), bodyOf(op)) <= 10)) return 1.8
      return v.markers.some((k) => k.kind === 'objective' && Math.hypot(k.pos.x - op.pos.x, k.pos.z - op.pos.z) <= 4) ? 1.2 : 0.4
    }
    case 'ks.a.place-melta-mine':
      // 2D6+3 to whoever walks into it: worth placing while enemies are close enough to come to it
      return enemiesOf(v, op).some((e) => e.status === 'active' && distanceBetween(bodyOf(e), bodyOf(op)) <= 10) ? 1.2 : 0.4
    // ---- Tempestus Aquilons
    case 'ta.a.command': {
      // +1 APL for a ready friend; best for a shooter or fighter that is close to the enemy
      if (!target || target.seat !== op.seat || !target.ready) return 0
      const near = enemiesOf(v, target).some((e) => e.status === 'active' && distanceBetween(bodyOf(e), bodyOf(target)) <= 14)
      return near ? 1.3 : 0.8
    }
    // landing is decided before the activation is planned (moves.ts activate): never part of a plan
    case 'ta.a.land':
      return 0
    // ---- Blooded
    case 'bl.a.signal':
      return target && target.seat === op.seat && target.ready ? 1.2 : 0
    case 'bl.a.sacrilegious-actuation':
      // a token for the pool: modest, so a good attack still comes first
      return 0.9
    case 'bl.a.stimms': {
      // Rejuvenated heals what is missing; Enraged suits a fighter, Fortified anyone about to be shot
      if (!target || target.seat !== op.seat) return 0
      const k = String(offer.params.param ?? '')
      if (k === 'rejuvenated') return Math.min(wounded(target), 5) * 0.55
      const fighter = target.weapons.some((w) => v.data.weapons[w]?.type === 'melee' && v.data.weapons[w]!.atk * v.data.weapons[w]!.dmg.normal >= 12)
      return k === 'enraged' ? (fighter ? 0.8 : 0.2) : 0.6
    }
    case 'bl.a.enforce':
      // a free quick action for a ready friend (it cannot be a 2 AP action)
      return target && target.seat === op.seat && target.ready ? 1.3 : 0
    // ---- Fellgor Ravagers
    case 'fg.a.gong-knell':
      // a better Save while shot at: worth an AP when an enemy can see the Deathknell
      return enemiesOf(v, op).some((e) => e.status === 'active' && distanceBetween(bodyOf(e), bodyOf(op)) <= 14 && visible(v, bodyOf(e), bodyOf(op))) ? 0.7 : 0.1
    case 'fg.a.sweeping-blow': {
      // D3+1 (about 3) to everything it can see within 2 inches: friends count against it
      let total = 0
      for (const o of Object.values(v.operatives)) {
        if (o.id === op.id || o.status !== 'active' || o.wounds <= 0) continue
        if (distanceBetween(bodyOf(op), bodyOf(o)) > 2 || !visible(v, bodyOf(op), bodyOf(o))) continue
        const dmg = Math.min(3, o.wounds)
        total += o.seat === op.seat ? -dmg * 1.4 : dmg + 0.3
      }
      return Math.max(0, total) * 0.9
    }
    case 'fg.a.cleaver-flurry': {
      // 2 AP for D3+1 on each enemy passed: worth it with two or more enemies about 8 inches away
      const near = enemiesOf(v, op).filter((e) => e.status === 'active' && distanceBetween(bodyOf(op), bodyOf(e)) <= 8).length
      return near >= 2 ? 1.1 * near : 0
    }
    case 'fg.a.uncompromising-attack':
      // a free Fight and a free Shoot for 1 AP: worth it in melee
      return enemiesOf(v, op).some((e) => e.status === 'active' && distanceBetween(bodyOf(op), bodyOf(e)) <= 1.2) ? 2.4 : 0
    case 'fg.a.incite-fury':
      return target && target.seat === op.seat && target.ready ? 1.2 : 0
    case 'fg.a.apoplectic-rejuvenation':
      // 2D3 averages 4 wounds, 6 after a fight kill
      return target && target.seat === op.seat ? Math.min(wounded(target), 5) * 0.6 : 0
    case 'fg.a.mantle-of-darkness':
      // hides concealed friends in cover; worth it when some friend is on Conceal near the Shaman
      return friendsOf(v, op).some((f) => f.order === 'conceal' && distanceBetween(bodyOf(f), bodyOf(op)) <= 3) ? 0.7 : 0.1
    case 'fg.a.pox-bomb-stun':
      // a stun plus half the roll in damage on a 3+
      return target && target.seat !== op.seat ? (target.ready ? 1.2 : 0.7) : 0
    // ---- Hunter Clade
    case 'hc.a.signal':
      // +1 APL for a ready friend is worth most when that friend is close to the fight
      return target && target.seat === op.seat && target.ready ? 1.2 : 0
    case 'hc.a.spot': {
      // marks an enemy for the friends within 3 inches of the Surveyor: worth it when some friend can shoot it
      if (!target || target.seat === op.seat) return 0
      const shooters = friendsOf(v, op).filter((f) => f.ready && hasRanged(v, f) && distanceBetween(bodyOf(f), bodyOf(op)) <= 3).length
      return 0.4 + 0.35 * shooters + (hasRanged(v, op) ? 0.2 : 0)
    }
    // ---- Hearthkyn Salvagers
    case 'hk.a.knux-smash':
      // D3+1 damage (about 3 on average) plus a free Charge
      return target && target.seat !== op.seat ? Math.min(target.wounds, 3) + 0.6 : 0
    case 'hk.a.signal':
      return target && target.seat === op.seat && target.ready ? 1.2 : 0
    case 'hk.a.system-jam':
      return target && target.seat !== op.seat ? (target.ready ? 0.9 : 0.2) : 0
    case 'hk.a.medikit':
      return target && target.seat === op.seat ? Math.min(wounded(target), 4) * 0.6 : 0
    case 'hk.a.utility-grenade': {
      // a tax on mission actions near an objective the enemy will contest; one marker at a time is plenty
      const mine = v.markers.some((m) => m.equipmentId === 'hk.utility-grenade' && m.owner === op.seat)
      const beside = v.markers.some((m) => m.kind === 'objective' && Math.hypot(m.pos.x - op.pos.x, m.pos.z - op.pos.z) <= 7)
      return !mine && beside ? 0.4 : 0
    }
    case 'hk.a.accelerated-appraisal': {
      const kind = offer.params.param === 'defence' ? 'hk.defence-marker' : 'hk.attack-marker'
      const inPlay = v.markers.some((m) => (m.equipmentId === 'hk.attack-marker' || m.equipmentId === 'hk.defence-marker') && m.owner === op.seat)
      return inPlay ? 0 : kind === 'hk.attack-marker' ? 0.8 : 0.6
    }
    case 'hk.a.spot': {
      if (!target || target.seat === op.seat || tokenCount(v, target.id, 'hk.spot', op.seat) > 0) return 0
      const shooters = friendsOf(v, op).filter((f) => f.ready && hasRanged(v, f) && distanceBetween(bodyOf(f), bodyOf(op)) <= 3).length
      return 0.4 + 0.35 * shooters + (hasRanged(v, op) ? 0.2 : 0)
    }
    case 'hk.a.pan-spectral-scan': {
      const placed = v.markers.some((m) => m.equipmentId === 'hk.pan-spectral-scan' && m.owner === op.seat)
      return placed ? 0 : 0.8
    }
    // ---- Phobos Strike Team
    case 'ph.a.helix-gauntlet':
      return target && target.seat === op.seat ? Math.min(wounded(target), 6) * 0.55 : 0
    case 'ph.a.auspex-scan': {
      // worth an AP while enemies stand within 8" of the Voxbreaker and friends can shoot them
      const foes = enemiesOf(v, op).filter((e) => e.status === 'active' && distanceBetween(bodyOf(e), bodyOf(op)) <= 8)
      const shooters = friendsOf(v, op).filter((f) => f.ready && hasRanged(v, f)).length
      return foes.length > 0 ? 0.3 + 0.25 * Math.min(shooters, 3) + (hasRanged(v, op) ? 0.2 : 0) : 0
    }
    // Guerrilla Warfare only changes an order: never worth the AP to the planner
    case 'ph.a.guerrilla-warfare':
      return 0
    // ---- Hand of the Archon
    case 'ha.a.torment-grenade': {
      // the target and everyone within 1" of it (friends too) test: D6 plus 1 for a Save of 4+ or worse, D3 damage and a Poison token on a 3+
      if (!target || target.seat === op.seat) return 0
      let total = 0
      for (const o of Object.values(v.operatives)) {
        if (o.status !== 'active' || o.wounds <= 0) continue
        if (o.id !== target.id && distanceBetween(bodyOf(o), bodyOf(target)) > 1) continue
        const p = o.save >= 4 ? 5 / 6 : 4 / 6
        const dmg = Math.min(2, o.wounds)
        total += o.seat === op.seat ? -1.3 * dmg * p : (dmg + 0.7) * p
      }
      return Math.max(0, total) * 0.9
    }
    case 'ha.a.administer-drug':
      // healing a hurt friend; swapping a drug is never worth an AP to the planner
      return offer.params.param === 'heal' && target && target.seat === op.seat ? Math.min(wounded(target), 4) * 0.6 : 0
    case 'ha.a.mark':
      // Seek Light and no obscuring help most against a Conceal enemy hiding in cover
      return target && target.seat !== op.seat ? (target.order === 'conceal' ? 1 : 0.35) : 0
    // ---- Imperial Navy Breachers
    case 'nb.a.spot': {
      // Seek Light and no obscuring for the friends that can shoot the marked enemy; best against a Conceal enemy in cover
      if (!target || target.seat === op.seat) return 0
      const shooters = shootersFor(v, op, target)
      return 0.35 + 0.3 * shooters + (target.order === 'conceal' ? 0.4 : 0)
    }
    case 'nb.a.wayfind':
      return target && target.seat === op.seat && target.ready ? 1.2 : 0
    case 'nb.a.interference-pulse':
      // 3+ for 1 less APL on an enemy that has not acted yet
      return target && target.seat !== op.seat ? (target.ready ? 0.9 : 0.2) : 0
    case 'nb.a.boost': {
      // a 12" Charge is worth an AP only when an enemy sits just beyond the normal 10" reach
      const far = enemiesOf(v, op).some((e) => {
        const d = distanceBetween(bodyOf(op), bodyOf(e))
        return d > 10 && d <= 12.5
      })
      return far ? 0.8 : 0
    }
    // ---- Corsair Voidscarred
    case 'cv.a.soul-channel':
      // +1 APL for a ready friend; worth most when that friend is close to the fight
      return target && target.seat === op.seat && target.ready ? 1.2 : 0
    case 'cv.a.soul-heal':
      return target && target.seat === op.seat ? Math.min(wounded(target), 6) * 0.5 : 0
    case 'cv.a.warding-shield': {
      // ignores the next Normal Dmg die: worth an AP on a friend that will be shot at soon
      if (!target || target.seat !== op.seat || tokenCount(v, target.id, 'cv.shield', op.seat) > 0) return 0
      const near = enemiesOf(v, target).some((e) => distanceBetween(bodyOf(e), bodyOf(target)) <= 14)
      return near ? (target.ready ? 0.9 : 0.6) : 0.2
    }
    case 'cv.a.warp-fold': {
      // swap two friends: worth it when a ready one lands much nearer the enemy (or an objective) than it stood
      const [a, b] = String(offer.params.param ?? '').split('+').map((id) => v.operatives[id])
      if (!a || !b) return 0
      const gapOf = (o: Operative, at: Operative): number => Math.min(99, ...enemiesOf(v, o).map((e) => Math.hypot(e.pos.x - at.pos.x, e.pos.z - at.pos.z)))
      const gain = (o: Operative, at: Operative): number => (o.ready ? gapOf(o, o) - gapOf(o, at) : 0)
      return Math.max(0, Math.max(gain(a, b), gain(b, a)) - 3) * 0.12
    }
    case 'cv.a.pistol-barrage': {
      // two free Shoots: worth about one and a half Shoot actions when an enemy is in pistol reach
      const reach = enemiesOf(v, op).some((e) => distanceBetween(bodyOf(op), bodyOf(e)) <= 8 && visible(v, bodyOf(op), bodyOf(e)))
      return reach ? 2.4 : 0
    }
    case 'cv.a.blademaster':
      // a free Dash after a Charge: worth a little, to get clear or reach cover
      return 0.4
    // ---- Warpcoven
    case 'wc.a.protected-by-fate': {
      // re-rolls of any defence dice for the friend most likely to be shot next; one live token per team
      if (!target || target.seat !== op.seat || tokenCount(v, target.id, 'wc.protected', op.seat) > 0) return 0
      const exposed = enemiesOf(v, target).some((e) => e.status === 'active' && distanceBetween(bodyOf(e), bodyOf(target)) <= 14 && visible(v, bodyOf(e), bodyOf(target)))
      return exposed ? 0.7 + 0.05 * Math.min(wounded(target), 5) + (target.ready ? 0 : 0.1) : 0.1
    }
    case 'wc.a.ravage-destiny': {
      // the enemy best placed to shoot or to hold a marker loses its 6s and 1 APL of control
      if (!target || target.seat === op.seat || tokenCount(v, target.id, 'wc.ravaged', op.seat) > 0) return 0
      const atk = target.weapons.reduce((m, w) => Math.max(m, v.data.weapons[w]?.atk ?? 0), 0)
      const onObjective = v.markers.some((m) => m.kind === 'objective' && Math.hypot(m.pos.x - target.pos.x, m.pos.z - target.pos.z) <= 3)
      return 0.45 + 0.1 * atk + (onObjective ? 0.4 : 0) + (target.ready ? 0.2 : 0)
    }
    case 'wc.a.reconstitution-ritual':
      // 2D3 averages 4 wounds
      return target && target.seat === op.seat ? Math.min(wounded(target), 4) * 0.7 : 0
    case 'wc.a.temporal-flux': {
      // the marker snaps a friend back beside it after that friend's next activation: shoot-and-scoot. Worth most for a
      // ready friend with enemies about to be in reach; the marker spot (param "x,z") is best on the far side from them
      if (!target || target.seat !== op.seat || target.wounds <= 0) return 0
      const foes = enemiesOf(v, op).filter((e) => e.status === 'active')
      if (!foes.some((e) => distanceBetween(bodyOf(e), bodyOf(target)) <= 16)) return 0
      const [x, z] = String(offer.params.param ?? '').split(',').map(Number)
      const away = x !== undefined && z !== undefined && Number.isFinite(x) && Number.isFinite(z) ? Math.min(...foes.map((e) => Math.hypot(e.pos.x - x, e.pos.z - z)), 14) : 0
      return (target.ready ? 0.95 : 0.35) + (hasRanged(v, target) ? 0.15 : 0) + 0.02 * away
    }
    case 'wc.a.alight': {
      // Ceaseless for every friendly weapon against it: worth more the more of the coven can reach it
      if (!target || target.seat === op.seat || tokenCount(v, target.id, 'wc.alight', op.seat) > 0) return 0
      return 0.4 + 0.25 * shootersFor(v, op, target) + (hasRanged(v, op) ? 0.2 : 0)
    }
    case 'wc.a.brayhorn':
      // free: +1" Move for every ready Tzaangor
      return friendsOf(v, op).some((f) => f.ready && v.data.datacards[f.datacardId]?.keywords.includes('TZAANGOR')) ? 0.4 : 0
    // ---- Farstalker Kinband
    case 'fk.a.energise':
      // Lethal 5+ on every arrow is worth the AP only with a target in sight and not already in force
      return !v.effects.some((e) => e.source === 'fk.energise' && e.operativeId === op.id) && enemiesOf(v, op).some((e) => e.status === 'active' && visible(v, bodyOf(op), bodyOf(e))) ? 0.9 : 0
    case 'fk.a.long-sight':
      return !v.effects.some((e) => e.source === 'fk.longSight' && e.operativeId === op.id) && enemiesOf(v, op).some((e) => e.status === 'active' && visible(v, bodyOf(op), bodyOf(e))) ? 0.8 : 0
    case 'fk.a.stealth-attack':
      // a free Charge, a free Fight and a bonus strike for 2 AP: worth it whenever an enemy is within reach
      return enemiesOf(v, op).some((e) => e.status === 'active' && distanceBetween(bodyOf(op), bodyOf(e)) <= 7) ? 2.8 : 0
    case 'fk.a.marked-for-the-hunt':
      return v.markers.some((m) => m.equipmentId === 'fk.pechra' && m.owner === op.seat) ? 0 : 0.5
    case 'fk.a.from-the-eye-above':
      return target && target.seat === op.seat && target.ready ? 1.2 : 0
    case 'fk.a.gather':
      // two moves around a marker that no v1 mission uses: the planner never spends the AP
      return 0
    // ---- Scout Squad
    case 'ss.a.guidance-and-experience':
      // a free +1 APL for a ready friend, worth more when that friend is close to the fight
      if (!target || target.seat !== op.seat || !target.ready || target.aplMods >= 1) return 0
      return 1.3 + (enemiesOf(v, target).some((e) => e.status === 'active' && distanceBetween(bodyOf(target), bodyOf(e)) <= 10) ? 0.3 : 0)
    case 'ss.a.optics':
      // no obscuring for the Sniper's own shots: worth an AP with an enemy in sight and no Optics running
      return tokenCount(v, op.id, 'ss.optics', op.seat) === 0 && enemiesOf(v, op).some((e) => e.status === 'active' && visible(v, bodyOf(op), bodyOf(e))) ? 0.7 : 0
    case 'ss.a.track-enemy': {
      // Seek Light for the whole squad against one enemy; best against a Conceal enemy the friends can shoot
      if (!target || target.seat === op.seat || tokenCount(v, target.id, 'ss.trackEnemy', op.seat) > 0) return 0
      return 0.35 + 0.3 * shootersFor(v, op, target) + (target.order === 'conceal' ? 0.4 : 0)
    }
    case 'ss.a.auspex-scan': {
      // no obscuring against enemies within 8" of the Tracker: worth an AP while friends can shoot some
      if (tokenCount(v, op.id, 'ss.auspexScan', op.seat) > 0) return 0
      const foes = enemiesOf(v, op).filter((e) => e.status === 'active' && distanceBetween(bodyOf(e), bodyOf(op)) <= 8)
      const shooters = friendsOf(v, op).filter((f) => f.ready && hasRanged(v, f)).length
      return foes.length > 0 ? 0.3 + 0.25 * Math.min(shooters, 3) + (hasRanged(v, op) ? 0.2 : 0) : 0
    }
    // ---- Novitiates
    case 'nv.a.stirring-rhetoric': {
      // +1 APL for a ready friend, worth more when that friend is close to the enemy
      if (!target || target.seat !== op.seat || !target.ready) return 0
      return 1.1 + (enemiesOf(v, target).some((e) => e.status === 'active' && distanceBetween(bodyOf(target), bodyOf(e)) <= 10) ? 0.3 : 0)
    }
    case 'nv.a.auto-broadcaster': {
      // a 0 AP action: it stops enemy re-rolls where the fight will be, so place or move it once the enemy is near
      const mine = v.markers.some((m) => m.equipmentId === 'nv.auto-broadcaster' && m.owner === op.seat)
      const near = enemiesOf(v, op).some((e) => e.status === 'active' && distanceBetween(bodyOf(e), bodyOf(op)) <= 11)
      return near ? (mine ? 0.3 : 0.9) : 0.1
    }
    case 'nv.a.whip-into-frenzy': {
      // two Fights (the first free) and +1 APL: worth it for a friend that can reach an enemy
      if (!target || target.seat !== op.seat || !target.ready) return 0
      return enemiesOf(v, target).some((e) => e.status === 'active' && distanceBetween(bodyOf(target), bodyOf(e)) <= 8) ? 1.9 : 0
    }
    case 'nv.a.chirurgeons-tools':
      return target && target.seat === op.seat ? Math.min(wounded(target), 5) * 0.6 : 0
    // ---- Chaos Cult
    case 'cc.a.incite-slaughter':
      // a free Fight for a friend that already has an enemy in its control range (the offer only exists for those)
      return target && target.seat === op.seat ? 1.6 : 0
    case 'cc.a.incite-urgency': {
      // a free Dash or a Charge of 3": worth it when an enemy is close enough for the friend to reach
      if (!target || target.seat !== op.seat) return 0
      return enemiesOf(v, target).some((e) => e.status === 'active' && distanceBetween(bodyOf(target), bodyOf(e)) <= 4.5) ? 1.0 : 0.2
    }
    case 'cc.a.ruinous-icon': {
      // Invigoration for a cult that is about to be hit, Deterioration for foes the cult is about to hit; both need foes near
      const foes = enemiesOf(v, op).filter((e) => e.status === 'active' && distanceBetween(bodyOf(e), bodyOf(op)) <= 4).length
      if (foes === 0) return 0
      const friends = friendsOf(v, op).filter((f) => f.datacardId.startsWith('cc.') && distanceBetween(bodyOf(f), bodyOf(op)) <= 4).length + 1
      return offer.params.param === 'invigoration' ? 0.35 + 0.2 * Math.min(friends, 4) : 0.5 + 0.3 * Math.min(foes, 3)
    }
    case 'cc.a.heinous-deluge':
      // 1 less APL for the enemy's next activation: best on one that has not acted yet
      return target && target.seat !== op.seat ? (target.ready ? 1.0 : 0.25) + (target.apl >= 3 ? 0.2 : 0) : 0
    case 'cc.a.malefic-vortex': {
      // 1 damage now and in every later Ready step to each enemy within 2" of the marker
      const [x, z] = String(offer.params.param ?? '').split(',').map(Number)
      if (x === undefined || z === undefined || !Number.isFinite(x) || !Number.isFinite(z)) return 0
      const foes = enemiesOf(v, op).filter((e) => e.status === 'active' && Math.hypot(e.pos.x - x, e.pos.z - z) - e.baseRadius <= 2).length
      const placed = v.markers.some((m) => m.equipmentId === 'cc.maleficVortex' && m.owner === op.seat)
      return foes > 0 ? 0.8 * Math.min(foes, 3) + (placed ? 0 : 0.2) : 0
    }
    case 'nv.a.raise-icon': {
      // 1 Faith, plus the turning point number while standing on an objective
      const holds = v.markers.some((m) => m.kind === 'objective' && Math.hypot(m.pos.x - op.pos.x, m.pos.z - op.pos.z) <= 2)
      return holds ? 0.9 + 0.35 * v.turningPoint : 0.5
    }
    // ---- Goremongers
    case 'gm.a.transfusion-ritual': {
      // one gore level from the Bloodtaker to a friend: best for an empty friend, and when the Bloodtaker has gore to spare
      if (!target || target.seat !== op.seat) return 0
      const mine = tokenCount(v, op.id, 'gm.gore', op.seat)
      const theirs = tokenCount(v, target.id, 'gm.gore', op.seat)
      const gain = theirs === 0 ? 1.2 : theirs === 1 ? 0.6 : 0
      return Math.max(0, gain - (mine <= 1 ? 0.45 : 0.1)) * (target.ready ? 1.2 : 0.7)
    }
    case 'gm.a.gore-fuel': {
      // Severe on the fleshskewer is worth a level only with an enemy in reach of the next Shoot or Fight
      const foes = enemiesOf(v, op).filter((e) => e.status === 'active' && distanceBetween(bodyOf(e), bodyOf(op)) <= 11)
      return foes.length > 0 ? (tokenCount(v, op.id, 'gm.gore', op.seat) >= 2 ? 0.9 : 0.5) : 0
    }
    case 'gm.a.dash-and-spray': {
      // a free Dash and a free focused Shoot for 1 AP: worth a lot while an enemy is within Dash plus Range
      const foes = enemiesOf(v, op).filter((e) => e.status === 'active' && distanceBetween(bodyOf(e), bodyOf(op)) <= 11 && visible(v, bodyOf(op), bodyOf(e)))
      return foes.length > 0 ? 2.0 : 0
    }
    // ---- Exaction Squad
    case 'ex.a.deploy-nuncio-aquila': {
      // a 0 AP action: enemies near the marker pay more AP for markers and mission actions and count less APL. Place it once,
      // and move it only when no enemy stands near it any more
      const m = v.markers.find((k) => k.equipmentId === 'ex.nuncio' && k.owner === op.seat)
      const foes = enemiesOf(v, op).filter((e) => e.status === 'active')
      if (!m) return foes.length > 0 ? 0.8 : 0.3
      return foes.some((e) => Math.hypot(e.pos.x - m.pos.x, e.pos.z - m.pos.z) <= 4) ? 0 : 0.5
    }
    case 'ex.a.medikit':
      return target && target.seat === op.seat ? Math.min(wounded(target), 5) * 0.6 : 0
    case 'ex.a.apprehend':
      // free: pins an enemy in the mastiff's control range (Hit worse, no Fall Back)
      return target && target.seat !== op.seat && tokenCount(v, target.id, 'ex.apprehend', op.seat) === 0 ? 1.4 : 0
    case 'ex.a.veriscant': {
      // Lethal 5+ and Severe for every friendly weapon against one enemy
      if (!target || target.seat === op.seat || tokenCount(v, target.id, 'ex.veriscant', op.seat) > 0) return 0
      return 0.4 + 0.3 * shootersFor(v, op, target) + (hasRanged(v, op) ? 0.2 : 0)
    }
    case 'ex.a.optics':
      return tokenCount(v, op.id, 'ex.marksman-optics', op.seat) === 0 && enemiesOf(v, op).some((e) => e.status === 'active' && visible(v, bodyOf(op), bodyOf(e))) ? 0.8 : 0
    case 'ex.a.spot': {
      // Seek Light and no obscuring for the friends that can shoot the spotted enemy; best against a Conceal enemy in cover
      if (!target || target.seat === op.seat || tokenCount(v, target.id, 'ex.revelatum-spot', op.seat) > 0) return 0
      return 0.35 + 0.3 * shootersFor(v, op, target) + (target.order === 'conceal' ? 0.4 : 0)
    }
    case 'ex.a.signal':
      return target && target.seat === op.seat && target.ready ? 1.2 : 0
    default:
      return 0
  }
}

/**
 * Offered team actions worth planning, best first (at most `max`). `performed` lists the actions already in the plan so
 * the same ability is not planned twice in one activation.
 */
export function teamActionCandidates(ctx: AiCtx, v: GameState, op: Operative, offers: AbilityOffer[], performed: string[], max = 3): { offer: AbilityOffer; value: number }[] {
  const out: { offer: AbilityOffer; value: number }[] = []
  for (const o of offers) {
    if (performed.includes(o.action)) continue
    let val = 0
    try {
      val = value(ctx, v, op, o)
    } catch {
      val = 0
    }
    if (val > 0.05) out.push({ offer: o, value: val - 0.1 * o.cost })
  }
  out.sort((a, b) => b.value - a.value)
  return out.slice(0, max)
}

/**
 * The position of a Place Marker (`marker.place` without a pointHook): a team mine goes on the offered spot nearest an
 * enemy (the spot filter already keeps it legal), any other marker where the operative stands. Free-point decisions
 * (context.pointHook) are left to their own policies (null).
 */
export function placeMarker(ctx: AiCtx): Action | null {
  const p = ctx.pending
  const v = ctx.view
  if (typeof p.context.pointHook === 'string') return null
  const op = v.operatives[String(p.context.operativeId ?? '')]
  if (!op) return null
  const spots = (p.context.spots as { x: number; z: number }[] | undefined) ?? [{ x: op.pos.x, z: op.pos.z }]
  if (spots.length === 0) return null
  const m = v.markers.find((k) => k.id === p.context.markerId)
  const foes = enemiesOf(v, op).filter((e) => e.status === 'active')
  let pick = spots[0]!
  if (m?.equipmentId && MINES.includes(m.equipmentId) && foes.length > 0) {
    let best = Infinity
    for (const s of spots) {
      const d = Math.min(...foes.map((e) => Math.hypot(e.pos.x - s.x, e.pos.z - s.z)))
      if (d < best) {
        best = d
        pick = s
      }
    }
  }
  return { type: 'marker.place', seat: p.seat, decisionId: p.id, payload: { x: pick.x, z: pick.z } } as Action
}
