// Deterministic randomness: xoshiro128** seeded from sha256(seed). Pure TypeScript so the engine
// runs in the browser and workers. `state.rng` is authoritative; `step` restores it, rolls, and
// serialises it back.
import type { RngState } from './types'

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
])

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n))
}

/** SHA-256 of a UTF-8 string, as eight big-endian 32-bit words. */
export function sha256Words(text: string): Uint32Array {
  const bytes = new TextEncoder().encode(text)
  const bitLen = bytes.length * 8
  const padded = new Uint8Array((((bytes.length + 9 + 63) >> 6) << 6))
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000), false)
  view.setUint32(padded.length - 4, bitLen >>> 0, false)

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  const w = new Uint32Array(64)
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false)
    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15]!
      const w2 = w[i - 2]!
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3)
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10)
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0
    }
    let a = h[0]!
    let b = h[1]!
    let c = h[2]!
    let d = h[3]!
    let e = h[4]!
    let f = h[5]!
    let g = h[6]!
    let hh = h[7]!
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (hh + S1 + ch + K[i]! + w[i]!) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) >>> 0
      hh = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }
    h[0] = (h[0]! + a) >>> 0
    h[1] = (h[1]! + b) >>> 0
    h[2] = (h[2]! + c) >>> 0
    h[3] = (h[3]! + d) >>> 0
    h[4] = (h[4]! + e) >>> 0
    h[5] = (h[5]! + f) >>> 0
    h[6] = (h[6]! + g) >>> 0
    h[7] = (h[7]! + hh) >>> 0
  }
  return h
}

export function sha256Hex(text: string): string {
  return Array.from(sha256Words(text), (n) => n.toString(16).padStart(8, '0')).join('')
}

/** 32-bit FNV-1a over UTF-16 code units, as 8 hex characters. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export interface Rng {
  /** uniform integer 1..6 */
  d6(): number
  /** state to store back into `GameState.rng`, or null when the source is external (scripted) */
  serialize(): RngState | null
}

export function d3(rng: Rng): number {
  return Math.ceil(rng.d6() / 2)
}

function rotl(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k))
}

export class SeededRng implements Rng {
  private s0: number
  private s1: number
  private s2: number
  private s3: number

  private constructor(s: [number, number, number, number]) {
    this.s0 = s[0] >>> 0
    this.s1 = s[1] >>> 0
    this.s2 = s[2] >>> 0
    this.s3 = s[3] >>> 0
  }

  static fromSeed(seed: string): SeededRng {
    const w = sha256Words(seed)
    const s: [number, number, number, number] = [w[0]!, w[1]!, w[2]!, w[3]!]
    if ((s[0] | s[1] | s[2] | s[3]) === 0) s[0] = 1
    return new SeededRng(s)
  }

  static restore(state: RngState): SeededRng {
    return new SeededRng(state.s)
  }

  /** next raw uint32 (xoshiro128**) */
  next32(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5), 7), 9) >>> 0
    const t = this.s1 << 9
    this.s2 ^= this.s0
    this.s3 ^= this.s1
    this.s1 ^= this.s2
    this.s0 ^= this.s3
    this.s2 ^= t
    this.s3 = rotl(this.s3, 11)
    return result
  }

  /** uniform integer in [0, n) without modulo bias */
  int(n: number): number {
    const limit = 0x100000000 - (0x100000000 % n)
    let v = this.next32()
    while (v >= limit) v = this.next32()
    return v % n
  }

  d6(): number {
    return this.int(6) + 1
  }

  serialize(): RngState {
    return { s: [this.s0 >>> 0, this.s1 >>> 0, this.s2 >>> 0, this.s3 >>> 0] }
  }
}

/** Forced dice for golden tests. Throws when the script runs out so a short script is never silent. */
export class ScriptedRng implements Rng {
  private i = 0
  constructor(private readonly values: number[]) {
    for (const v of values) {
      if (!Number.isInteger(v) || v < 1 || v > 6) throw new Error(`ScriptedRng: ${v} is not a D6 result`)
    }
  }
  d6(): number {
    if (this.i >= this.values.length) throw new Error('ScriptedRng: script exhausted')
    return this.values[this.i++]!
  }
  get remaining(): number {
    return this.values.length - this.i
  }
  serialize(): null {
    return null
  }
}

export function serializeRng(rng: SeededRng): RngState {
  return rng.serialize()
}
export function restoreRng(state: RngState): SeededRng {
  return SeededRng.restore(state)
}
