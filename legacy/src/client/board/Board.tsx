// The battle canvas: killzone mat, terrain, zones, markers, operatives, interaction overlays and the camera.
// frameloop="demand": every async change calls invalidate() (animStore.setRepaint wires the director to it).
import { Suspense, useEffect, useMemo } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { SRGBColorSpace } from 'three'
import type { GameState } from '@/engine'
import { BattleOperative, Corpses } from '../figures/Operative'
import { clickOperative, clickPoint, hoverPoint, optionOperative } from '../interaction/controller'
import { DeployGhost, MovePreviewLayer, PlaceOverlay, SpotRings, TargetBadges } from '../interaction/Overlays'
import { currentParams } from '../params'
import { setRepaint } from '../presentation/animStore'
import { useFx } from '../presentation/fxStore'
import { useDisplayState, useSettled } from '../presentation/presentedStore'
import { useSettings } from '../presentation/settings'
import { humanToAct, useGame } from '../store/game'
import { useUi, type Pt } from '../ui/uiStore'
import { CameraRig } from './CameraRig'
import { FpsProbe } from './FpsProbe'
import { makeMatTexture } from './matTexture'
import { MeasureLayer } from './MeasureLayer'
import { SightlineLayer } from './Sightlines'
import { Terrain } from './Terrain'
import { Vfx } from './Vfx'
import { Markers, Zones } from './Zones'

function Repaint() {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    setRepaint(invalidate)
    invalidate()
    return () => setRepaint(() => {})
  }, [invalidate])
  return null
}

function Mat({ w, h, low }: { w: number; h: number; low: boolean }) {
  const invalidate = useThree((s) => s.invalidate)
  const tex = useMemo(() => makeMatTexture(w, h, low), [w, h, low])
  useEffect(() => {
    invalidate()
    return () => tex.dispose()
  }, [tex, invalidate])
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      receiveShadow
      onPointerMove={(e) => {
        e.stopPropagation()
        hoverPoint({ x: e.point.x, z: e.point.z, y: 0 })
      }}
      onPointerOut={() => hoverPoint(null)}
      onClick={(e) => {
        if (e.delta > 6) return
        e.stopPropagation()
        clickPoint({ x: e.point.x, z: e.point.z, y: 0 })
      }}
    >
      <planeGeometry args={[w, h]} />
      <meshStandardMaterial map={tex} roughness={0.92} metalness={0.05} />
    </mesh>
  )
}

function Scene({ state }: { state: GameState }) {
  const low = useSettings((s) => s.lowGraphics)
  const pending = useGame((s) => s.pending)
  const settled = useSettled()
  const selectedOp = useUi((s) => s.selectedOp)
  const hoverOp = useUi((s) => s.hoverOp)
  const hoverZone = useUi((s) => s.hoverZone)
  const human = settled ? humanToAct() : null
  const woundOverride = useFx((s) => s.wounds)
  const w = state.map.size.x
  const h = state.map.size.z
  const onPoint = (p: Pt | null, click: boolean) => (click && p ? clickPoint(p) : hoverPoint(p))
  const deployRegion = pending?.kind === 'setup.deploy' && human && pending.constraints?.region ? pending.constraints.region : null
  const choosable = new Set<string>(
    pending?.kind === 'firefight.activate' && human ? [...((pending.context.ready as string[]) ?? []), ...((pending.context.counteract as string[]) ?? [])] : [],
  )
  // guard interrupts: the operatives on Guard that can answer are ringed like activation choices
  if (pending?.kind === 'guard.interrupt' && human) for (const o of pending.options ?? []) {
    const id = optionOperative(o)
    if (id) choosable.add(id)
  }
  const activation = state.firefight.activation
  return (
    <>
      <color attach="background" args={['#0a0a10']} />
      <ambientLight intensity={0.75} />
      <hemisphereLight args={['#aab8d0', '#20222a', 0.5]} />
      <directionalLight
        position={[9, 22, 12]}
        intensity={1.5}
        castShadow={!low}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={16}
        shadow-camera-bottom={-16}
        shadow-camera-near={1}
        shadow-camera-far={60}
      />
      <Mat w={w} h={h} low={low} />
      <Terrain map={state.map} onPoint={onPoint} />
      <Zones state={state} deployRegion={deployRegion} hoverZone={hoverZone} />
      <Markers state={state} />
      <Suspense fallback={null}>
        {Object.values(state.operatives)
          .filter((o) => o.status === 'active')
          .map((op) => (
            <BattleOperative
              key={op.id}
              op={woundOverride[op.id] !== undefined ? { ...op, wounds: woundOverride[op.id]! } : op}
              apSpent={activation && activation.operativeId === op.id && !activation.counteract ? activation.apSpent : null}
              selected={selectedOp === op.id}
              hovered={hoverOp === op.id}
              choosable={choosable.has(op.id)}
              onSelect={clickOperative}
              onHover={(id) => useUi.setState({ hoverOp: id })}
            />
          ))}
      </Suspense>
      {pending && human && pending.kind === 'setup.deploy' && <DeployGhost state={state} pending={pending} />}
      {pending && human && pending.kind === 'move.path' && <MovePreviewLayer state={state} pending={pending} />}
      {pending && human && (pending.kind === 'shoot.target' || pending.kind === 'fight.target') && <TargetBadges state={state} pending={pending} />}
      {pending && human && (pending.kind === 'setup.objective' || pending.kind === 'ability.choice') && <SpotRings pending={pending} />}
      {pending && human && (pending.kind === 'marker.place' || pending.kind === 'setup.equipMarker') && <PlaceOverlay state={state} pending={pending} />}
      <SightlineLayer />
      <MeasureLayer />
      <Corpses />
      <Vfx />
      <CameraRig halfX={w / 2} halfZ={h / 2} />
      <Repaint />
      {currentParams().fps && <FpsProbe />}
    </>
  )
}

export function BoardCanvas() {
  const state = useDisplayState()
  const low = useSettings((s) => s.lowGraphics)
  if (!state) return null
  return (
    <Canvas
      data-testid="board-canvas"
      camera={{ position: [0, 25, 21], fov: 42, near: 0.1, far: 200 }}
      frameloop="demand"
      shadows={!low}
      dpr={low ? 1 : [1, 2]}
      gl={{ antialias: !low, preserveDrawingBuffer: true }}
      onCreated={({ gl }) => {
        gl.outputColorSpace = SRGBColorSpace
      }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <Scene state={state} />
    </Canvas>
  )
}
