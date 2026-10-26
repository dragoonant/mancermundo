// ?gallery: every datacard of every team as a stand-in or GLB (whichever the manifest provides), each with
// its default loadout (placeholder weapon at the measured hand socket), for the QC pass of the art pipeline.
// Buttons: front / three-quarter camera and a "sockets" toggle that draws a small sphere at every socket.
import { useEffect, useMemo, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Html, OrbitControls } from '@react-three/drei'
import { defaultLoadout, expandWeaponRef, type DatacardData } from '@/data'
import { chosenWeaponIds, dataBundle } from '../game/adapter'
import { teamList } from '../game/defaults'
import { colors, fontStack } from '../ui/theme'
import { glbStats } from './glbLoader'
import { AOD_SLUGS, KOMMANDO_SLUGS } from './attachmentFor'
import { HOLDS } from './hold'
import { Figure, hasGlbBody, seatColor } from './Operative'
import { useModelManifest, type SocketName, type V3 } from './manifest'

const COLS = 5
const GAP_X = 2.4
const GAP_Z = 3.0
const TARGET: V3 = [0, 0.55, 0]

type View = 'front' | 'three-quarter'
const VIEWS: Record<View, { az: number; el: number; dist: number }> = {
  front: { az: 0, el: 0.45, dist: 16 },
  'three-quarter': { az: 0.6, el: 0.5, dist: 16 },
}

// Attachment pages: each attachment mounted on a body at its hold socket, the figure turned to show the holding
// hand's side (right-hand weapons, belt grenades: right side; left-hand melee: left side).
const ATT_PAGE = 8
const ATT_TURN = 1.3
const ATT_TEAMS = [
  { id: 'kom', label: 'Kommando attachments', slugs: KOMMANDO_SLUGS, body: 'kom-boy', cols: 5, major: { h: 0.3, s: 0.5, l: 0.4 }, minor: { h: 0.02, s: 0.6, l: 0.4 } },
  { id: 'aod', label: 'Angels of Death attachments', slugs: AOD_SLUGS, body: 'aod-intercessor-warrior', cols: 4, major: { h: 0.6, s: 0.6, l: 0.4 }, minor: { h: 0.12, s: 0.7, l: 0.5 } },
] as const

const SOCKET_COLOR: Record<SocketName, string> = {
  handR: '#ff3b3b',
  handL: '#3b8bff',
  back: '#ffe14a',
  beltR: '#ff9f2e',
  beltL: '#37d6ff',
  shoulderR: '#ff7bd5',
  shoulderL: '#a06bff',
  head: '#ffffff',
}

function CameraPreset({ view, zoom }: { view: View; zoom: number }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as { target: { set(x: number, y: number, z: number): void }; update(): void } | null
  useEffect(() => {
    const v = VIEWS[view]
    camera.position.set(TARGET[0] + v.dist * zoom * Math.sin(v.az) * Math.cos(v.el), TARGET[1] + v.dist * zoom * Math.sin(v.el), TARGET[2] + v.dist * zoom * Math.cos(v.az) * Math.cos(v.el))
    camera.lookAt(...TARGET)
    controls?.target.set(...TARGET)
    controls?.update()
  }, [view, zoom, camera, controls])
  return null
}

function Sockets({ sockets }: { sockets: Partial<Record<SocketName, V3>> }) {
  return (
    <>
      {(Object.entries(sockets) as [SocketName, V3][]).map(([name, p]) => (
        <mesh key={name} position={p} renderOrder={10}>
          <sphereGeometry args={[0.045, 12, 8]} />
          <meshBasicMaterial color={SOCKET_COLOR[name]} depthTest={false} />
        </mesh>
      ))}
    </>
  )
}

function AttachmentGrid({ team, page }: { team: (typeof ATT_TEAMS)[number]; page: number | null }) {
  const manifest = useModelManifest()
  const slugs = page === null ? team.slugs : team.slugs.slice(page * ATT_PAGE, (page + 1) * ATT_PAGE)
  const cols = page === null ? team.cols : 4
  const rows = Math.ceil(slugs.length / cols)
  return (
    <>
      {slugs.map((slug, n) => {
        const col = n % cols
        const row = Math.floor(n / cols)
        const x = (col - (cols - 1) / 2) * GAP_X
        const z = (row - (rows - 1) / 2) * (page === null ? 2.5 : 3.0)
        const entry = manifest.attachments[slug]
        const turn = entry && HOLDS[entry.holdClass].socket === 'handL' ? -ATT_TURN : ATT_TURN
        return (
          <group key={slug} position={[x, 0, z]}>
            <group rotation={[0, turn, 0]}>
              <Figure spec={{ archetype: team.body, height: 1.4, baseRadius: 0.63, major: team.major, minor: team.minor, weaponIds: [], attachSlugs: [slug], seatColor: '#888888' }} />
            </group>
            <Html position={[0, 0, 0.95]} center distanceFactor={9} style={{ pointerEvents: 'none' }}>
              <div data-testid={`attach-${slug}`} style={{ font: '600 11px system-ui', color: '#fff', textAlign: 'center', whiteSpace: 'nowrap', textShadow: '0 0 3px #000' }}>
                {slug}
                <div style={{ color: entry ? '#6dff9a' : '#ffcf5a', fontWeight: 400 }}>{entry ? `${entry.holdClass} ${entry.lengthIn ?? ''}"` : 'box (no GLB)'}</div>
              </div>
            </Html>
          </group>
        )
      })}
    </>
  )
}

export function Gallery() {
  const b = dataBundle()
  const manifest = useModelManifest()
  const [view, setView] = useState<View>('front')
  const [sockets, setSockets] = useState(false)
  const [teamIx, setTeamIx] = useState<number | null>(null)
  // attachment pages: null = bodies gallery; else the attachment team index and page (null = all of the team)
  const [attTeam, setAttTeam] = useState<number | null>(null)
  const [attPage, setAttPage] = useState<number | null>(null)
  const allCards = useMemo(
    () =>
      teamList(b).flatMap((t) =>
        Object.values(b.byId)
          .filter((r): r is DatacardData => (r as DatacardData).team === t.id && 'figure' in r)
          .map((c) => ({ card: c, team: t, seat: (teamList(b).indexOf(t) === 0 ? 'A' : 'B') as 'A' | 'B' })),
      ),
    [b],
  )
  const cards = teamIx === null ? allCards : allCards.filter((c) => c.team.id === teamList(b)[teamIx]?.id)
  const rows = Math.ceil(cards.length / COLS)

  // load counters for e2e (window.__ms is installed for ?gallery by store/testHooks)
  useEffect(() => {
    const publish = () => {
      const ms = (window.__ms ?? (window.__ms = {} as NonNullable<typeof window.__ms>)) as unknown as Record<string, unknown>
      ms.glbStats = (prefix = 'bodies/') => glbStats(prefix)
      ms.glbBodiesLoaded = () => glbStats('bodies/').loaded
      ms.galleryView = () => ({ view, sockets, attTeam, attPage })
      ms.attachmentsLoaded = () => glbStats('attachments/').loaded
    }
    publish()
  }, [view, sockets, attTeam, attPage])

  const btn = (active: boolean): React.CSSProperties => ({
    background: active ? colors.accent : '#262a36',
    color: active ? '#000' : colors.text,
    border: '1px solid #4a5062',
    borderRadius: 4,
    padding: '3px 10px',
    marginLeft: 6,
    cursor: 'pointer',
    font: '600 12px system-ui',
  })

  return (
    <div data-testid="gallery" style={{ position: 'fixed', inset: 0, background: '#0a0a10', color: colors.text, fontFamily: fontStack }}>
      <div style={{ position: 'absolute', top: 8, left: 12, zIndex: 5, fontSize: 13, display: 'flex', alignItems: 'center' }}>
        <b>Figure gallery</b>&nbsp;&middot; {allCards.length} datacards &middot; {Object.keys(manifest.bodies).length} GLB bodies listed &middot;&nbsp;
        <a style={{ color: colors.accent }} href="./">back</a>
        <button data-testid="view-front" style={btn(view === 'front')} onClick={() => setView('front')}>
          Front
        </button>
        <button data-testid="view-three-quarter" style={btn(view === 'three-quarter')} onClick={() => setView('three-quarter')}>
          Three-quarter
        </button>
        <button data-testid="team-all" style={btn(teamIx === null)} onClick={() => setTeamIx(null)}>
          All
        </button>
        {teamList(b).map((t, i) => (
          <button key={t.id} data-testid={`team-${i}`} style={btn(teamIx === i)} onClick={() => setTeamIx(i)}>
            {t.name}
          </button>
        ))}
        <button data-testid="toggle-sockets" style={btn(sockets)} onClick={() => setSockets((s) => !s)}>
          Sockets {sockets ? 'on' : 'off'}
        </button>
        <button data-testid="att-off" style={btn(attTeam === null)} onClick={() => setAttTeam(null)}>
          Bodies
        </button>
        {ATT_TEAMS.map((t, i) => (
          <button key={t.id} data-testid={`att-${t.id}`} style={btn(attTeam === i)} onClick={() => (setAttTeam(i), setAttPage(null))}>
            {t.id === 'kom' ? 'Kom attachments' : 'AoD attachments'}
          </button>
        ))}
        {attTeam !== null &&
          [null, ...Array.from({ length: Math.ceil(ATT_TEAMS[attTeam]!.slugs.length / ATT_PAGE) }, (_, i) => i)].map((p) => (
            <button key={String(p)} data-testid={`att-page-${p ?? 'all'}`} style={btn(attPage === p)} onClick={() => setAttPage(p)}>
              {p === null ? 'All' : `p${p + 1}`}
            </button>
          ))}
      </div>
      <Canvas camera={{ position: [0, 7, 13], fov: 28 }} frameloop="always" dpr={[1, 2]} gl={{ preserveDrawingBuffer: true }}>
        <color attach="background" args={['#14151d']} />
        <ambientLight intensity={0.9} />
        <directionalLight position={[6, 12, 8]} intensity={1.6} />
        <gridHelper args={[COLS * GAP_X + 2, COLS * 2, '#3a3f4a', '#242833']} position={[0, 0, 0]} />
        {attTeam !== null && <AttachmentGrid team={ATT_TEAMS[attTeam]!} page={attPage} />}
        {attTeam === null && cards.map(({ card, team, seat }, n) => {
          const col = n % COLS
          const row = Math.floor(n / COLS)
          const x = (col - (COLS - 1) / 2) * GAP_X
          const z = (row - (rows - 1) / 2) * GAP_Z
          const weaponIds = [...new Set([...card.weapons.fixed.flatMap((r) => expandWeaponRef(r, b.weaponGroups)), ...chosenWeaponIds(card, defaultLoadout(card))])]
          const body = manifest.bodies[card.figure.archetype]
          const glb = hasGlbBody(card.figure.archetype, manifest)
          return (
            <group key={card.id} position={[x, 0, z]}>
              <Figure
                spec={{
                  archetype: card.figure.archetype,
                  height: Math.round(((card.base / 25.4) * 1.15 + 0.1) * 1000) / 1000,
                  baseRadius: card.base / 25.4 / 2,
                  major: team.paint.major,
                  minor: team.paint.minor,
                  weaponIds,
                  seatColor: seatColor(seat),
                }}
              />
              {sockets && body?.sockets && <Sockets sockets={body.sockets} />}
              <Html position={[0, 0, 0.75]} center distanceFactor={9} style={{ pointerEvents: 'none' }}>
                <div data-testid={`gallery-${card.id}`} style={{ font: '600 11px system-ui', color: '#fff', textAlign: 'center', whiteSpace: 'nowrap', textShadow: '0 0 3px #000' }}>
                  {card.figure.archetype}
                  <div style={{ color: glb ? '#6dff9a' : '#ffcf5a', fontWeight: 400 }}>{glb ? 'GLB body' : 'stand-in'}</div>
                </div>
              </Html>
            </group>
          )
        })}
        <OrbitControls makeDefault target={TARGET} maxPolarAngle={Math.PI / 2.05} />
        <CameraPreset view={view} zoom={attTeam !== null ? (attPage === null ? 1.25 : 0.82) : teamIx === null ? 1 : 0.95} />
      </Canvas>
    </div>
  )
}
