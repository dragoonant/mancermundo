// The battle canvas: the Zone Mortalis board (ZmBoard, doors from the live game state), the fighters at their engine positions,
// the overlays of the pending decision, the transient effects and the camera. frameloop="demand": every async change calls
// invalidate() (animStore.setRepaint wires the director to it). The canvas draws the DISPLAY state (the presented-seq cursor), so
// nothing shows before the director has played it.
import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { SRGBColorSpace } from 'three'
import type { GameState } from '@/engine'
import { BattleFighter, placedFromState } from '../figures/BattleFighter'
import { useBodyManifest } from '../figures/bodyManifest'
import { ActionableDoors, DeployLayer, FX_CSS, FxLayer, MovePreviewLayer, SpotLayer, TargetBadges } from '../interaction/Overlays'
import { cancelDecision, clickDoor, clickFighter, clickPoint, hoverPoint, optionForFighter } from '../interaction/controller'
import type { PlacedFighter } from '../lab/placement'
import { setRepaint } from '../presentation/animStore'
import { useFx } from '../presentation/fxStore'
import { useDisplayState, useSettled } from '../presentation/presentedStore'
import { humanToAct, useGame } from '../store/game'
import { useUi } from '../ui/uiStore'
import { CameraRig, homePose, type CameraPreset } from './CameraRig'
import { ZmBoard } from './ZmBoard'

/** The battle frames the board a little wider than the lab does: the HUD above and the prompt below cover its edges. */
const FRAME = 1.12

function Repaint() {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    setRepaint(invalidate)
    invalidate()
    return () => setRepaint(() => {})
  }, [invalidate])
  return null
}

/** The invisible floor the pointer works on: hover shows the engine's verdict, click answers the continuous decisions. */
function Ground({ minX, maxX, minZ, maxZ }: { minX: number; maxX: number; minZ: number; maxZ: number }) {
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[(minX + maxX) / 2, 0.02, (minZ + maxZ) / 2]}
      visible={false}
      onPointerMove={(e) => {
        e.stopPropagation()
        hoverPoint({ x: e.point.x, z: e.point.z })
      }}
      onPointerOut={() => hoverPoint(null)}
      onClick={(e) => {
        if (e.delta > 6) return
        e.stopPropagation()
        clickPoint({ x: e.point.x, z: e.point.z })
      }}
      onContextMenu={(e) => {
        // a right click that did not drag the camera cancels a pending move
        if (e.delta > 6) return
        if (cancelDecision()) e.nativeEvent.preventDefault()
      }}
    >
      <planeGeometry args={[maxX - minX + 4, maxZ - minZ + 4]} />
      <meshBasicMaterial />
    </mesh>
  )
}

function Scene({ state }: { state: GameState }) {
  const pending = useGame((s) => s.pending)
  const settled = useSettled()
  const selected = useUi((s) => s.selected)
  const hoverFighter = useUi((s) => s.hoverFighter)
  const preset = useUi((s) => s.cameraPreset)
  const woundOverride = useFx((s) => s.wounds)
  const human = settled ? humanToAct() : null
  const def = state.board.def
  const halfX = ((def.bounds.maxX - def.bounds.minX) / 2) * FRAME
  const halfZ = ((def.bounds.maxZ - def.bounds.minZ) / 2) * FRAME
  const camPreset: CameraPreset | null = preset ? { id: preset.id, n: preset.nonce } : null
  const looks = useRef(new Map<string, PlacedFighter>())
  // the looks are cached per game and per manifest (the body list arrives after the first frame)
  const manifest = useBodyManifest()
  const gameKey = `${state.seed}:${Object.keys(manifest).length}`
  const lastKey = useRef(gameKey)
  if (lastKey.current !== gameKey) {
    looks.current.clear()
    lastKey.current = gameKey
  }
  const placedOf = (id: string): PlacedFighter => {
    let p = looks.current.get(id)
    if (!p) {
      p = placedFromState(state, state.fighters[id]!, manifest)
      looks.current.set(id, p)
    }
    return p
  }
  const choosable = new Set<string>()
  if (pending && human) {
    for (const f of Object.values(state.fighters)) if (optionForFighter(pending, f.id)) choosable.add(f.id)
  }
  const activeId = state.action.activation?.fighterId ?? null
  const onBoard = useMemo(() => Object.values(state.fighters).filter((f) => f.location === 'board'), [state.fighters])
  return (
    <>
      <color attach="background" args={['#0a0a10']} />
      <fog attach="fog" args={['#0a0a10', 80, 150]} />
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
      <ZmBoard def={def} doors={state.board.doors} onDoorClick={clickDoor} />
      <Ground {...def.bounds} />
      <Suspense fallback={null}>
        {onBoard.map((f) => (
          <BattleFighter
            key={f.id}
            f={f}
            placed={placedOf(f.id)}
            {...(woundOverride[f.id] !== undefined ? { wounds: woundOverride[f.id]! } : {})}
            selected={selected === f.id}
            hovered={hoverFighter === f.id}
            choosable={choosable.has(f.id)}
            active={activeId === f.id}
            showReady={state.phase === 'action'}
            onSelect={clickFighter}
            onHover={(id) => useUi.setState({ hoverFighter: id })}
          />
        ))}
      </Suspense>
      {pending && human && pending.kind === 'setup.deploy' && <DeployLayer state={state} pending={pending} />}
      {pending && human && pending.kind === 'move.path' && <MovePreviewLayer state={state} pending={pending} />}
      {pending && human && (pending.kind === 'setup.casket' || pending.kind === 'shoot.aim') && <SpotLayer pending={pending} />}
      {pending && human && (pending.kind === 'shoot.target' || pending.kind === 'shoot.allocate' || pending.kind === 'fight.after') && <TargetBadges state={state} pending={pending} />}
      {pending && human && <ActionableDoors def={def} pending={pending} />}
      <FxLayer />
      <CameraRig halfX={halfX} halfZ={halfZ} preset={camPreset} />
      <Repaint />
    </>
  )
}

export function BoardCanvas() {
  const state = useDisplayState()
  const home = useMemo(() => {
    if (!state) return [0, 40, 26] as [number, number, number]
    const b = state.board.def.bounds
    return homePose(((b.maxX - b.minX) / 2) * FRAME, ((b.maxZ - b.minZ) / 2) * FRAME)
  }, [state?.board.def.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!state) return null
  return (
    <>
      <style>{FX_CSS}</style>
      <Canvas
        data-testid="board-canvas"
        camera={{ position: home, fov: 42, near: 0.2, far: 220 }}
        frameloop="demand"
        shadows="percentage"
        dpr={[1, 2]}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = SRGBColorSpace
        }}
        style={{ position: 'absolute', inset: 0 }}
      >
        <Scene state={state} />
      </Canvas>
    </>
  )
}
