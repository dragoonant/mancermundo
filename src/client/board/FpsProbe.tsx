// `?fps` overlay: frames drawn per second, draw calls, triangles and GPU resources. The board renders on demand
// (frameloop="demand"), so a still board reads 0 fps; orbit the camera or play an animation to see the draw rate.
// It writes straight to a fixed DOM node (no React state), so measuring never causes renders of its own.
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'

export function FpsProbe() {
  const gl = useThree((s) => s.gl)
  const frames = useRef(0)
  const peak = useRef(0)
  useFrame(() => {
    frames.current++
  })
  useEffect(() => {
    const el = document.createElement('div')
    el.setAttribute('data-testid', 'fps-overlay')
    el.style.cssText = 'position:fixed;left:8px;top:8px;z-index:2000;padding:4px 8px;border-radius:6px;background:rgba(0,0,0,0.72);color:#9dffb0;font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;pointer-events:none;white-space:pre'
    document.body.appendChild(el)
    let last = performance.now()
    const timer = setInterval(() => {
      const now = performance.now()
      const fps = (frames.current * 1000) / (now - last)
      frames.current = 0
      last = now
      peak.current = Math.max(peak.current * 0.98, fps)
      const i = gl.info
      el.textContent = `${fps.toFixed(0)} fps (peak ${peak.current.toFixed(0)}, on demand)\ncalls ${i.render.calls}  tris ${i.render.triangles}\ngeo ${i.memory.geometries}  tex ${i.memory.textures}`
    }, 500)
    return () => {
      clearInterval(timer)
      el.remove()
    }
  }, [gl])
  return null
}
