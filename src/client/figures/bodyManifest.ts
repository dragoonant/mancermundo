// Body GLB lookup for the figures: `public/assets/models/manifest.json` is fetched once; when it lists a body for a fighter's
// `figure.archetype` (the manifest key, or an entry's own `archetype` field) the renderer loads that GLB, otherwise it keeps the
// procedural stand-in. A missing, empty or malformed manifest is not an error. Same shape as the legacy manifest, read leniently:
//   { "bodies": { "<archetype>": { "file": "bodies/goliath-ganger.glb", "facing": "-Z", "variants": ["..."] } } }
// A body file may be a bare name (then under bodies/) or a path under assets/models; the ".glb" extension is optional.
import { useEffect, useState } from 'react'

export interface BodyEntry {
  file: string
  archetype?: string
  /** only present when the mesh faces -Z: the renderer turns it by PI */
  facing?: '+Z' | '-Z'
  /** alternate bodies for the same archetype; a fighter picks one by its id so a gang does not repeat */
  variants?: string[]
}

export type BodyManifest = Record<string, BodyEntry>

let current: BodyManifest = {}
let request: Promise<BodyManifest> | null = null
const listeners = new Set<() => void>()

/** Pull the body entries out of whatever the manifest holds (an object keyed by archetype, or an array of entries). */
export function parseBodies(raw: unknown): BodyManifest {
  const out: BodyManifest = {}
  const bodies = raw && typeof raw === 'object' ? (raw as { bodies?: unknown }).bodies : undefined
  const add = (key: string | undefined, e: unknown) => {
    if (!e || typeof e !== 'object') return
    const entry = e as Partial<BodyEntry>
    if (typeof entry.file !== 'string' || !entry.file) return
    const k = key ?? entry.archetype
    if (k) out[k] = { file: entry.file, archetype: entry.archetype, facing: entry.facing, variants: Array.isArray(entry.variants) ? entry.variants.filter((v): v is string => typeof v === 'string') : undefined }
  }
  if (Array.isArray(bodies)) for (const e of bodies) add(undefined, e)
  else if (bodies && typeof bodies === 'object') for (const [k, e] of Object.entries(bodies)) add(k, e)
  return out
}

export function loadBodyManifest(): Promise<BodyManifest> {
  request ??= fetch(`${import.meta.env.BASE_URL}assets/models/manifest.json`)
    .then((r) => (r.ok ? (r.json() as Promise<unknown>) : Promise.resolve({})))
    .then((m) => {
      current = parseBodies(m)
      listeners.forEach((l) => l())
      return current
    })
    .catch(() => current)
  return request
}

export function useBodyManifest(): BodyManifest {
  const [m, setM] = useState(current)
  useEffect(() => {
    const l = () => setM(current)
    listeners.add(l)
    void loadBodyManifest()
    return () => {
      listeners.delete(l)
    }
  }, [])
  return m
}

/** Slug (under assets/models, no extension) of a manifest file entry. */
export function slugOf(file: string): string {
  const bare = file.replace(/\.glb$/i, '')
  return bare.includes('/') ? bare : `bodies/${bare}`
}

/** The body entry and GLB slug serving a fighter, or null when the manifest has none for its archetype. */
export function bodyFor(manifest: BodyManifest, archetype: string, fighterId: string): { slug: string; flip: boolean } | null {
  const e = manifest[archetype] ?? Object.values(manifest).find((b) => b.archetype === archetype)
  if (!e) return null
  const files = [e.file, ...(e.variants ?? [])]
  let h = 0
  for (let i = 0; i < fighterId.length; i++) h = (h * 31 + fighterId.charCodeAt(i)) >>> 0
  const file = files[h % files.length]!
  return { slug: slugOf(file), flip: e.facing === '-Z' }
}
