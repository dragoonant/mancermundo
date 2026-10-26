// The lab viewer (stage S2L): renders a chosen Zone Mortalis board in 3D with the two starter gangs at their deployment
// points. Query parameters: ?board=<id|slug>&scenario=<id>&a=<starter id>&b=<starter id>&zones=0&figs=0&cam=top&menu=0. The page is only
// a viewer; the game screens arrive with S5a.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Canvas } from '@react-three/fiber'
import { compileBoard, initialDoors, withDoor, type DoorStates } from '@/engine/board'
import type { BoardDef } from '@/engine/types'
import { loadBundle } from '@/data'
import type { DataBundle, StarterGangData } from '@/data/types'
import { DOOR_COLORS, ZmBoard } from '../board/ZmBoard'
import { CameraRig, homePose, type CameraPreset } from '../board/CameraRig'
import { buttonActive, buttonBase, colors, fontStack, panel } from '../ui/theme'
import { LabFighter, SEAT_COLOR } from './LabFighter'
import { DeploymentZones, Objectives } from './LabOverlays'
import { placeGang, zoneCentre, zonesFor, type PlacedFighter } from './placement'

const DEFAULT_BOARD = 'zm.b.foundry-run'

let bundleCache: DataBundle | undefined
const bundle = (): DataBundle => (bundleCache ??= loadBundle())

function resolveBoard(b: DataBundle, wanted: string | null): string {
  const ids = Object.keys(b.boards).sort()
  if (wanted) {
    if (b.boards[wanted]) return wanted
    const hit = ids.find((id) => id === `zm.b.${wanted}` || id.endsWith(`.${wanted}`))
    if (hit) return hit
  }
  return b.boards[DEFAULT_BOARD] ? DEFAULT_BOARD : ids[0]!
}

function gangsOf(b: DataBundle): StarterGangData[] {
  return Object.values(b.starterGangs).sort((p, q) => (p.id < q.id ? -1 : 1))
}

const cycle = { closed: 'open', open: 'destroyed', destroyed: 'closed' } as const

const sel: CSSProperties = { ...buttonBase, width: '100%', padding: '6px 8px', background: 'rgba(20,22,32,0.95)', fontWeight: 500 }
const label: CSSProperties = { display: 'block', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: colors.muted, margin: '10px 0 4px' }

export function Lab() {
  const b = bundle()
  const params = useMemo(() => new URLSearchParams(location.search), [])
  const boardIds = useMemo(() => Object.keys(b.boards).sort(), [b])
  const gangs = useMemo(() => gangsOf(b), [b])
  const [boardId, setBoardId] = useState(() => resolveBoard(b, params.get('board')))
  const board = b.boards[boardId]!
  const scenarioIds = useMemo(() => board.scenarios.filter((s) => b.scenarios[s]), [board, b])
  const [scenarioWanted, setScenario] = useState<string | null>(params.get('scenario'))
  const scenarioId = scenarioWanted && scenarioIds.includes(scenarioWanted) ? scenarioWanted : scenarioIds[0]
  const gangDefault = (house: string, fallback: number) => gangs.find((g) => g.house === house)?.id ?? gangs[fallback]?.id ?? ''
  const [gangA, setGangA] = useState(() => (gangs.some((g) => g.id === params.get('a')) ? params.get('a')! : gangDefault('goliath', 0)))
  const [gangB, setGangB] = useState(() => (gangs.some((g) => g.id === params.get('b')) ? params.get('b')! : gangDefault('escher', 1)))
  const [zonesOn, setZonesOn] = useState(params.get('zones') !== '0')
  const [figsOn, setFigsOn] = useState(params.get('figs') !== '0')
  const [menuOpen, setMenuOpen] = useState(params.get('menu') !== '0')
  const [preset, setPreset] = useState<CameraPreset | null>(() => {
    const c = params.get('cam')
    return c === 'top' || c === 'left' || c === 'right' ? { id: c, n: 1 } : null
  })

  const def: BoardDef = useMemo(() => compileBoard(board, b.tiles), [board, b])
  const [doors, setDoors] = useState<DoorStates>(() => initialDoors(def))
  const firstBoard = useRef(true)
  useEffect(() => {
    setDoors(initialDoors(def))
    // a new board is re-framed; the first one keeps the camera the address asked for
    if (firstBoard.current) firstBoard.current = false
    else setPreset((p) => ({ id: 'home', n: (p?.n ?? 0) + 1 }))
  }, [def])

  const rule = useMemo(() => {
    const d = scenarioId ? b.scenarios[scenarioId]?.deployment : undefined
    return d ?? { kind: 'standard' as const, minFromCentreline: 12 }
  }, [scenarioId, b])
  const zones = useMemo(() => zonesFor(def, rule), [def, rule])
  const fighters: PlacedFighter[] = useMemo(() => {
    const init = initialDoors(def)
    const ga = b.starterGangs[gangA]
    const gb = b.starterGangs[gangB]
    const out: PlacedFighter[] = []
    if (ga) out.push(...placeGang(b, def, init, ga, 'A', zones.A, zoneCentre(zones.B)))
    if (gb) out.push(...placeGang(b, def, init, gb, 'B', zones.B, zoneCentre(zones.A)))
    return out
  }, [b, def, zones, gangA, gangB])

  // keep the address bar in step with the pickers so a view can be shared or reloaded
  useEffect(() => {
    const q = new URLSearchParams(location.search)
    q.set('board', boardId)
    if (scenarioId) q.set('scenario', scenarioId)
    q.set('a', gangA)
    q.set('b', gangB)
    history.replaceState(null, '', `${location.pathname}?${q.toString()}${location.hash}`)
  }, [boardId, scenarioId, gangA, gangB])

  const ready = useMemo(() => ({ board: boardId, walls: def.walls.length, doors: def.doors.length, fighters: fighters.length }), [boardId, def, fighters])
  useEffect(() => {
    ;(window as unknown as { __lab?: unknown }).__lab = ready
  }, [ready])

  const onDoorClick = useCallback(
    (id: string) =>
      setDoors((d) => {
        const rec = d[id]
        return rec ? withDoor(d, id, { state: cycle[rec.state] }) : d
      }),
    [],
  )
  const setAll = (state: 'closed' | 'open') => setDoors((d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, { ...v, state, locked: state === 'closed' ? def.doors.find((x) => x.id === k)?.lockedAtStart ?? v.locked : v.locked }])))

  const halfX = (def.bounds.maxX - def.bounds.minX) / 2
  const halfZ = (def.bounds.maxZ - def.bounds.minZ) / 2
  const home = homePose(halfX, halfZ)
  const nameOf = (id: string) => b.boards[id]!.name
  const tag = (g: StarterGangData) => `${b.houses[g.house]?.name ?? g.house}: ${g.name}`

  return (
    <div style={{ position: 'fixed', inset: 0, fontFamily: fontStack, color: colors.text }}>
      <Canvas
        shadows="percentage"
        frameloop="demand"
        dpr={[1, 2]}
        camera={{ position: home, fov: 42, near: 0.2, far: 220 }}
        gl={{ antialias: true }}
        style={{ position: 'absolute', inset: 0 }}
      >
        <color attach="background" args={['#0a0a10']} />
        <fog attach="fog" args={['#0a0a10', 70, 140]} />
        <ambientLight intensity={0.85} color="#c9d3e6" />
        <hemisphereLight args={['#b9c6e0', '#3a2a20', 0.9]} />
        <directionalLight
          position={[-16, 36, 20]}
          intensity={2.6}
          color="#fff2dc"
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-26}
          shadow-camera-right={26}
          shadow-camera-top={26}
          shadow-camera-bottom={-26}
          shadow-camera-near={5}
          shadow-camera-far={90}
          shadow-bias={-0.0004}
          shadow-normalBias={0.03}
        />
        <directionalLight position={[18, 14, -22]} intensity={0.8} color="#ffa968" />
        <ZmBoard def={def} doors={doors} onDoorClick={onDoorClick} />
        {zonesOn && <DeploymentZones zones={zones} />}
        <Objectives spots={def.casketSpots} />
        {figsOn && fighters.map((f) => <LabFighter key={`${f.id}:${gangA}:${gangB}`} f={f} />)}
        <CameraRig halfX={halfX} halfZ={halfZ} preset={preset} leftDrag />
      </Canvas>

      <header style={{ position: 'absolute', top: 'calc(10px + var(--safe-top))', left: 'calc(14px + var(--safe-left))', pointerEvents: 'none' }}>
        <h1 style={{ margin: 0, fontSize: 22, letterSpacing: '0.2em', textTransform: 'uppercase', textShadow: '0 2px 10px #000' }}>Mancermundo</h1>
        <div style={{ fontSize: 12, color: colors.muted, letterSpacing: '0.08em', textShadow: '0 1px 6px #000' }}>
          {nameOf(boardId)} · {def.layout === '2x3' ? '24 x 36' : '7 tiles'} · {fighters.length} fighters
        </div>
      </header>

      <footer
        style={{ position: 'absolute', bottom: 'calc(8px + var(--safe-bottom))', left: 'calc(14px + var(--safe-left))', fontSize: 11, color: colors.muted, textShadow: '0 1px 6px #000', pointerEvents: 'none', maxWidth: '60vw' }}
      >
        Fan-made project. Not affiliated with or endorsed by Games Workshop. Art, text and models are original.
      </footer>

      <button
        type="button"
        onClick={() => setMenuOpen((o) => !o)}
        aria-expanded={menuOpen}
        style={{ ...buttonBase, position: 'absolute', top: 'calc(10px + var(--safe-top))', right: 'calc(10px + var(--safe-right))', zIndex: 3, background: 'rgba(14,15,22,0.92)' }}
      >
        {menuOpen ? 'Hide panel' : 'Lab'}
      </button>
      {menuOpen && (
        <aside
          className="ms-touch"
          style={{
            ...panel,
            position: 'absolute',
            top: 'calc(54px + var(--safe-top))',
            right: 'calc(10px + var(--safe-right))',
            width: 'min(300px, calc(100vw - 24px))',
            maxHeight: 'calc(100dvh - 120px)',
            overflowY: 'auto',
            padding: '4px 14px 14px',
            fontSize: 13,
            zIndex: 2,
          }}
        >
          <label style={label} htmlFor="lab-board">Board</label>
          <select id="lab-board" style={sel} value={boardId} onChange={(e) => setBoardId(e.target.value)}>
            {boardIds.map((id) => (
              <option key={id} value={id}>
                {nameOf(id)} ({b.boards[id]!.layout === '2x3' ? '24 x 36' : '7 tiles'})
              </option>
            ))}
          </select>
          <label style={label} htmlFor="lab-scn">Deployment</label>
          <select id="lab-scn" style={sel} value={scenarioId ?? ''} onChange={(e) => setScenario(e.target.value)}>
            {scenarioIds.map((id) => (
              <option key={id} value={id}>
                {b.scenarios[id]!.name}
              </option>
            ))}
          </select>
          <label style={{ ...label, color: SEAT_COLOR.A }} htmlFor="lab-a">Gang A</label>
          <select id="lab-a" style={sel} value={gangA} onChange={(e) => setGangA(e.target.value)}>
            {gangs.map((g) => (
              <option key={g.id} value={g.id}>{tag(g)}</option>
            ))}
          </select>
          <label style={{ ...label, color: SEAT_COLOR.B }} htmlFor="lab-b">Gang B</label>
          <select id="lab-b" style={sel} value={gangB} onChange={(e) => setGangB(e.target.value)}>
            {gangs.map((g) => (
              <option key={g.id} value={g.id}>{tag(g)}</option>
            ))}
          </select>

          <span style={label}>Show</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" style={zonesOn ? buttonActive : buttonBase} onClick={() => setZonesOn((v) => !v)}>Zones</button>
            <button type="button" style={figsOn ? buttonActive : buttonBase} onClick={() => setFigsOn((v) => !v)}>Fighters</button>
          </div>

          <span style={label}>Doors ({def.doors.length}) — click a panel to cycle</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" style={buttonBase} onClick={() => setAll('closed')}>Close all</button>
            <button type="button" style={buttonBase} onClick={() => setAll('open')}>Open all</button>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8, fontSize: 11, color: colors.muted }}>
            {(['closed', 'locked', 'open', 'destroyed'] as const).map((k) => (
              <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <i style={{ width: 10, height: 10, background: DOOR_COLORS[k], display: 'inline-block', borderRadius: 2 }} />
                {k}
              </span>
            ))}
          </div>

          <span style={label}>Camera</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(['home', 'top', 'left', 'right'] as const).map((id) => (
              <button key={id} type="button" style={buttonBase} onClick={() => setPreset((p) => ({ id, n: (p?.n ?? 0) + 1 }))}>
                {id === 'left' ? 'Turn left' : id === 'right' ? 'Turn right' : id === 'top' ? 'Top down' : 'Overview'}
              </button>
            ))}
          </div>
          <p style={{ margin: '10px 0 0', fontSize: 11, lineHeight: 1.4, color: colors.muted }}>
            Drag to orbit, shift-drag or WASD to pan, wheel to zoom. Touch: one finger pans, two fingers pinch, twist and tilt.
          </p>
        </aside>
      )}
    </div>
  )
}
