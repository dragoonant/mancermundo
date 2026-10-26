// three.js side of the effects engine: six instanced draw calls (billboards and ground quads, additive and normal;
// ribbons, additive and normal) fed from the engine's `draw`, plus a fixed set of point lights. One shared atlas
// texture, drawn at start-up. Nothing is allocated per frame: the instance buffers are written in place.
import {
  AdditiveBlending,
  BufferAttribute,
  CanvasTexture,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  Mesh,
  NoBlending,
  NormalBlending,
  PointLight,
  ShaderMaterial,
  type Blending,
} from 'three'
import { drawAtlas } from './atlas'
import type { FxEngine } from './engine'
import { CAPS, type FxWriter } from './types'

const COMMON_FRAG = `
uniform sampler2D uMap;
varying vec2 vUv;
varying vec4 vCol;
void main() {
  vec4 t = texture2D(uMap, vUv);
  gl_FragColor = vec4(vCol.rgb * t.rgb, t.a * vCol.a);
}`

const FRAME_UV = `
vec2 frameUv(float f, vec2 uvIn) {
  float col = mod(f, 4.0);
  float row = floor(f / 4.0);
  vec2 cell = uvIn * 0.984 + 0.008;
  return vec2((col + cell.x) * 0.25, (3.0 - row + cell.y) * 0.25);
}`

const BILL_VERT = `
attribute vec3 iPos;
attribute vec4 iMisc;
attribute vec3 iColor;
uniform float uBias;
uniform float uSize;
uniform float uGain;
varying vec2 vUv;
varying vec4 vCol;
${FRAME_UV}
void main() {
  float cr = cos(iMisc.y);
  float sr = sin(iMisc.y);
  vec2 q = position.xy * iMisc.x * uSize;
  vec2 r = vec2(cr * q.x - sr * q.y, sr * q.x + cr * q.y);
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  mv.xy += r;
  mv.z += uBias;
  gl_Position = projectionMatrix * mv;
  vUv = frameUv(iMisc.w, uv);
  vCol = vec4(iColor * uGain, iMisc.z);
}`

const FLAT_VERT = `
attribute vec3 iPos;
attribute vec4 iMisc;
attribute vec3 iColor;
uniform float uSize;
uniform float uGain;
varying vec2 vUv;
varying vec4 vCol;
${FRAME_UV}
void main() {
  float cr = cos(iMisc.y);
  float sr = sin(iMisc.y);
  vec2 q = position.xy * iMisc.x * uSize;
  vec2 r = vec2(cr * q.x - sr * q.y, sr * q.x + cr * q.y);
  vec3 wp = iPos + vec3(r.x, 0.0, -r.y);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(wp, 1.0);
  vUv = frameUv(iMisc.w, uv);
  vCol = vec4(iColor * uGain, iMisc.z);
}`

const BEAM_VERT = `
attribute vec3 iP0;
attribute vec3 iP1;
attribute vec4 iW;
attribute vec4 iC;
uniform float uBias;
uniform float uSize;
uniform float uGain;
varying vec2 vUv;
varying vec4 vCol;
${FRAME_UV}
void main() {
  float x = position.x + 0.5;
  vec3 a = (modelViewMatrix * vec4(iP0, 1.0)).xyz;
  vec3 b = (modelViewMatrix * vec4(iP1, 1.0)).xyz;
  vec3 d = b - a;
  vec3 side = vec3(-d.y, d.x, 0.0);
  float sl = length(side);
  side = sl > 1e-5 ? side / sl : vec3(1.0, 0.0, 0.0);
  vec3 p = mix(a, b, x) + side * position.y * mix(iW.x, iW.y, x) * uSize;
  p.z += uBias;
  gl_Position = projectionMatrix * vec4(p, 1.0);
  vUv = frameUv(iC.w, vec2(x, position.y + 0.5));
  vCol = vec4(iC.rgb * uGain, mix(iW.z, iW.w, x));
}`

function plane(): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3))
  g.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2))
  g.setIndex([0, 1, 2, 0, 2, 3])
  return g
}

function material(vert: string, map: CanvasTexture, blending: Blending, bias: number, depthTest = true, size = 1, gain = 1): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: vert,
    fragmentShader: COMMON_FRAG,
    uniforms: { uMap: { value: map }, uBias: { value: bias }, uSize: { value: size }, uGain: { value: gain } },
    transparent: true,
    depthWrite: false,
    depthTest,
    blending,
    side: DoubleSide,
    polygonOffset: vert === FLAT_VERT,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
}

class BillBatch {
  n = 0
  readonly mesh: Mesh
  readonly pos: Float32Array
  readonly misc: Float32Array
  readonly col: Float32Array
  private readonly aPos: InstancedBufferAttribute
  private readonly aMisc: InstancedBufferAttribute
  private readonly aCol: InstancedBufferAttribute
  private readonly geo: InstancedBufferGeometry
  constructor(readonly cap: number, mat: ShaderMaterial, order: number) {
    this.geo = plane()
    this.pos = new Float32Array(cap * 3)
    this.misc = new Float32Array(cap * 4)
    this.col = new Float32Array(cap * 3)
    this.aPos = new InstancedBufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage)
    this.aMisc = new InstancedBufferAttribute(this.misc, 4).setUsage(DynamicDrawUsage)
    this.aCol = new InstancedBufferAttribute(this.col, 3).setUsage(DynamicDrawUsage)
    this.geo.setAttribute('iPos', this.aPos)
    this.geo.setAttribute('iMisc', this.aMisc)
    this.geo.setAttribute('iColor', this.aCol)
    this.geo.instanceCount = 0
    this.mesh = new Mesh(this.geo, mat)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = order
  }
  push(x: number, y: number, z: number, size: number, rot: number, alpha: number, frame: number, r: number, g: number, b: number): void {
    if (this.n >= this.cap) return
    const i = this.n++
    this.pos[i * 3] = x
    this.pos[i * 3 + 1] = y
    this.pos[i * 3 + 2] = z
    this.misc[i * 4] = size
    this.misc[i * 4 + 1] = rot
    this.misc[i * 4 + 2] = alpha
    this.misc[i * 4 + 3] = frame
    this.col[i * 3] = r
    this.col[i * 3 + 1] = g
    this.col[i * 3 + 2] = b
  }
  finish(): void {
    this.geo.instanceCount = this.n
    this.mesh.visible = this.n > 0
    this.aPos.needsUpdate = this.aMisc.needsUpdate = this.aCol.needsUpdate = true
  }
  dispose(): void {
    this.geo.dispose()
    ;(this.mesh.material as ShaderMaterial).dispose()
  }
}

class BeamBatch {
  n = 0
  readonly mesh: Mesh
  readonly p0: Float32Array
  readonly p1: Float32Array
  readonly w: Float32Array
  readonly c: Float32Array
  private readonly a0: InstancedBufferAttribute
  private readonly a1: InstancedBufferAttribute
  private readonly aw: InstancedBufferAttribute
  private readonly ac: InstancedBufferAttribute
  private readonly geo: InstancedBufferGeometry
  constructor(readonly cap: number, mat: ShaderMaterial, order: number) {
    this.geo = plane()
    this.p0 = new Float32Array(cap * 3)
    this.p1 = new Float32Array(cap * 3)
    this.w = new Float32Array(cap * 4)
    this.c = new Float32Array(cap * 4)
    this.a0 = new InstancedBufferAttribute(this.p0, 3).setUsage(DynamicDrawUsage)
    this.a1 = new InstancedBufferAttribute(this.p1, 3).setUsage(DynamicDrawUsage)
    this.aw = new InstancedBufferAttribute(this.w, 4).setUsage(DynamicDrawUsage)
    this.ac = new InstancedBufferAttribute(this.c, 4).setUsage(DynamicDrawUsage)
    this.geo.setAttribute('iP0', this.a0)
    this.geo.setAttribute('iP1', this.a1)
    this.geo.setAttribute('iW', this.aw)
    this.geo.setAttribute('iC', this.ac)
    this.geo.instanceCount = 0
    this.mesh = new Mesh(this.geo, mat)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = order
  }
  push(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, w0: number, w1: number, a0: number, a1: number, frame: number, r: number, g: number, b: number): void {
    if (this.n >= this.cap) return
    const i = this.n++
    this.p0[i * 3] = x0
    this.p0[i * 3 + 1] = y0
    this.p0[i * 3 + 2] = z0
    this.p1[i * 3] = x1
    this.p1[i * 3 + 1] = y1
    this.p1[i * 3 + 2] = z1
    this.w[i * 4] = w0
    this.w[i * 4 + 1] = w1
    this.w[i * 4 + 2] = a0
    this.w[i * 4 + 3] = a1
    this.c[i * 4] = r
    this.c[i * 4 + 1] = g
    this.c[i * 4 + 2] = b
    this.c[i * 4 + 3] = frame
  }
  finish(): void {
    this.geo.instanceCount = this.n
    this.mesh.visible = this.n > 0
    this.a0.needsUpdate = this.a1.needsUpdate = this.aw.needsUpdate = this.ac.needsUpdate = true
  }
  dispose(): void {
    this.geo.dispose()
    ;(this.mesh.material as ShaderMaterial).dispose()
  }
}

/** Point-light scale: engine intensities are "how bright it feels", three wants candela. */
const LIGHT_GAIN = 16
const LIGHT_RANGE = 9

export class FxRenderer implements FxWriter {
  readonly group = new Group()
  readonly lights: PointLight[] = []
  private readonly tex: CanvasTexture
  private readonly normBill: BillBatch
  private readonly addBill: BillBatch
  private readonly flatNorm: BillBatch
  private readonly flatAdd: BillBatch
  private readonly normBeam: BeamBatch
  private readonly addBeam: BeamBatch
  private readonly col = new Color()

  constructor() {
    this.group.name = 'weapon-fx'
    this.tex = new CanvasTexture(drawAtlas())
    this.tex.generateMipmaps = false
    this.tex.minFilter = LinearFilter
    this.tex.magFilter = LinearFilter
    const T = this.tex
    // draw order: ground decals, normal-blended things, then everything glowing
    this.flatNorm = new BillBatch(CAPS.flatNorm, material(FLAT_VERT, T, NormalBlending, 0, true, 1.05, 1), 20)
    this.normBeam = new BeamBatch(CAPS.beamNorm + 40, material(BEAM_VERT, T, NormalBlending, 0.12, false, 1.25, 1), 21)
    this.normBill = new BillBatch(CAPS.norm + 40, material(BILL_VERT, T, NormalBlending, 0.18, false, 1.25, 1), 22)
    this.flatAdd = new BillBatch(CAPS.flatAdd, material(FLAT_VERT, T, AdditiveBlending, 0, true, 1.1, 1.3), 23)
    this.addBeam = new BeamBatch(CAPS.beamAdd + CAPS.spark + CAPS.dynBeam, material(BEAM_VERT, T, AdditiveBlending, 0.22, false, 1.45, 1.3), 24)
    this.addBill = new BillBatch(CAPS.add + CAPS.dynBill, material(BILL_VERT, T, AdditiveBlending, 0.3, false, 1.4, 1.3), 25)
    for (const b of [this.flatNorm, this.normBeam, this.normBill, this.flatAdd, this.addBeam, this.addBill]) this.group.add(b.mesh)
    for (let i = 0; i < CAPS.lights; i++) {
      // always visible (see sync): a constant light count keeps every lit material on one program
      const l = new PointLight('#ff9a40', 0, LIGHT_RANGE, 2)
      this.lights.push(l)
      this.group.add(l)
    }
    void NoBlending
  }

  bill(layer: 0 | 1 | 2 | 3, x: number, y: number, z: number, size: number, rot: number, alpha: number, frame: number, r: number, g: number, b: number): void {
    const batch = layer === 0 ? this.addBill : layer === 1 ? this.normBill : layer === 2 ? this.flatAdd : this.flatNorm
    batch.push(x, y, z, size, rot, alpha, frame, r, g, b)
  }

  beam(norm: boolean, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, w0: number, w1: number, a0: number, a1: number, frame: number, r: number, g: number, b: number): void {
    ;(norm ? this.normBeam : this.addBeam).push(x0, y0, z0, x1, y1, z1, w0, w1, a0, a1, frame, r, g, b)
  }

  /** Copy the engine's current frame into the instance buffers and the lights. */
  sync(engine: FxEngine): void {
    this.flatNorm.n = this.normBeam.n = this.normBill.n = this.flatAdd.n = this.addBeam.n = this.addBill.n = 0
    engine.draw(this)
    this.flatNorm.finish()
    this.normBeam.finish()
    this.normBill.finish()
    this.flatAdd.finish()
    this.addBeam.finish()
    this.addBill.finish()
    const now = engine.clock
    for (let i = 0; i < this.lights.length; i++) {
      const L = this.lights[i]!
      const e = engine.lights[i]!
      let k = 0
      if (e.active && now >= e.t0) {
        const u = e.hold ? 1 : Math.max(0, 1 - (now - e.t0) / e.life)
        k = e.hold ? e.peak : e.peak * u * u
        if (e.flicker) k *= 0.78 + 0.22 * Math.sin(now * 61 + i * 7) * Math.sin(now * 23 + i) + 0.1 * Math.sin(now * 113)
      }
      // the lights stay visible (dark at intensity 0): three.js builds one shader program per point-light count for
      // every lit material, so switching lights on and off compiled a new set mid-shot on the first few volleys
      if (k > 0.02) {
        L.position.set(e.x, e.y, e.z)
        this.col.setRGB(e.r, e.g, e.b)
        L.color.copy(this.col)
        L.intensity = k * LIGHT_GAIN
      } else L.intensity = 0
    }
  }

  dispose(): void {
    for (const b of [this.flatNorm, this.normBeam, this.normBill, this.flatAdd, this.addBeam, this.addBill]) b.dispose()
    this.tex.dispose()
    for (const l of this.lights) l.dispose()
  }
}
