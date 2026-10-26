// Board effects. The weapon effects engine (src/client/vfx) draws everything that glows, burns or flies in six
// instanced draw calls; this component mounts it, advances it each frame (requesting the next frame only while
// something is alive, the board is demand-driven), moves the scene a hair for camera thumps and keeps the
// burning / injured emitters in step with the displayed state. Floating damage numbers and the CRIT glyph are
// small DOM labels from the fx store.
import { useEffect, useMemo, useRef } from 'react'
import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useFx, type Fx } from '../presentation/fxStore'
import { useDisplayState } from '../presentation/presentedStore'
import { syncRoster } from '../vfx/api'
import { fx, lowFx } from '../vfx/instance'
import { FxRenderer } from '../vfx/renderer'
import { warmScene, type WarmRenderer } from '../vfx/warmup'
import { glbStats, subscribeGlb } from '../figures/glbLoader'

const STYLE_ID = 'ms-fx-style'
function ensureStyle(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
  const s = document.createElement('style')
  s.id = STYLE_ID
  s.textContent =
    '@keyframes ms-fx-rise { 0% { transform: translateY(0) scale(0.6); opacity: 0 } 12% { opacity: 1; transform: translateY(-10px) scale(1.25) } 30% { transform: translateY(-20px) scale(1) } 100% { transform: translateY(-64px) scale(1); opacity: 0 } }' +
    '@keyframes ms-fx-crit { 0% { transform: translateY(6px) scale(0.4) rotate(-8deg); opacity: 0 } 14% { opacity: 1; transform: translateY(-8px) scale(1.5) rotate(-4deg) } 32% { transform: translateY(-16px) scale(1.1) rotate(-3deg) } 100% { transform: translateY(-56px) scale(1) rotate(-3deg); opacity: 0 } }'
  document.head.appendChild(s)
}

function FloatText({ fx: f }: { fx: Fx }) {
  ensureStyle()
  const crit = f.text === 'CRIT'
  return (
    <Html position={f.to} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
      <div
        data-testid="fx-text"
        data-fx-kind={crit ? 'crit' : 'number'}
        style={{
          animation: `${crit ? 'ms-fx-crit' : 'ms-fx-rise'} ${f.dur}ms ease-out forwards`,
          color: f.color,
          font: `900 ${Math.round(22 * f.size)}px system-ui`,
          letterSpacing: crit ? '0.08em' : undefined,
          textShadow: crit ? '0 0 10px #ff7a1a, 0 2px 3px #000, 0 0 3px #000, 0 0 12px #000' : '0 2px 3px #000, 0 0 3px #000, 0 0 8px #000',
          whiteSpace: 'nowrap',
        }}
      >
        {f.text}
      </div>
    </Html>
  )
}

const OFFSET: [number, number, number] = [0, 0, 0]
/** The shader warm-up starts this long after the board (or a figure GLB) appears, so the first paint is not held up. */
const WARM_DELAY_MS = 700
const AMBIENT_MS = 180
const AMBIENT_LOW_MS = 420

/** The engine's renderer, per-frame update, camera thump and burning / injured roster. */
function FxLayer() {
  const invalidate = useThree((s) => s.invalidate)
  const scene = useThree((s) => s.scene)
  const renderer = useMemo(() => new FxRenderer(), [])
  const state = useDisplayState()
  const ambientTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    fx.onWake = invalidate
    invalidate()
    return () => {
      fx.onWake = null
      if (ambientTimer.current !== null) clearTimeout(ambientTimer.current)
      scene.position.set(0, 0, 0)
      renderer.dispose()
    }
  }, [invalidate, renderer, scene])

  // compile every material (the hidden effect batches included) once the board is up and the figures have loaded,
  // and again after a later GLB arrives; already-compiled programs cost a cache lookup
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  useEffect(() => {
    let alive = true
    let running = false
    let again = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const schedule = () => {
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => void run(), WARM_DELAY_MS)
    }
    const run = async () => {
      timer = null
      if (!alive || glbStats().loading > 0) return // the last load to settle schedules it again
      if (running) {
        again = true
        return
      }
      running = true
      try {
        await warmScene(gl as unknown as WarmRenderer, scene, camera, () => alive)
      } finally {
        running = false
      }
      if (again && alive) {
        again = false
        schedule()
      }
    }
    schedule()
    const off = subscribeGlb(schedule)
    return () => {
      alive = false
      off()
      if (timer !== null) clearTimeout(timer)
    }
  }, [gl, scene, camera])

  useEffect(() => {
    syncRoster(state)
  }, [state])

  useFrame((s) => {
    const t0 = performance.now()
    const alive = fx.update()
    renderer.sync(fx)
    if (fx.liveCount() > 0) fx.noteCpu(performance.now() - t0)
    fx.shakeOffset(OFFSET, fx.clock)
    scene.position.set(OFFSET[0], OFFSET[1], 0)
    if (alive) s.invalidate()
    else if (fx.ambient() && !fx.frozen && ambientTimer.current === null) {
      // only slow persistent effects remain (injured drips): a few frames a second, not a render loop
      ambientTimer.current = setTimeout(
        () => {
          ambientTimer.current = null
          invalidate()
        },
        lowFx() ? AMBIENT_LOW_MS : AMBIENT_MS,
      )
    }
  })

  return <primitive object={renderer.group} />
}

export function Vfx() {
  const list = useFx((s) => s.list)
  return (
    <>
      <FxLayer />
      {list
        .filter((f) => f.kind === 'text')
        .map((f) => (
          <FloatText key={f.id} fx={f} />
        ))}
    </>
  )
}
