// public/assets/models/manifest.json (docs/spec/30-figures.md section 2): which bodies and attachments have
// real GLBs. Fetched once at runtime; absent or empty means every operative uses the procedural stand-in.
import { useEffect, useState } from 'react'

export type HoldClass = 'pistol' | 'rifle' | 'long' | 'heavy' | 'melee1h' | 'melee2h' | 'shield' | 'pack' | 'grenade' | 'tool'
export type V3 = [number, number, number]

export type SocketName = 'handR' | 'handL' | 'back' | 'beltR' | 'beltL' | 'shoulderL' | 'shoulderR' | 'head'

export interface BodyEntry {
  file: string
  /** the datacard figure.archetype this body serves (the manifest key) */
  archetype?: string
  /** bbox height of the GLB including the base disc, inches */
  heightIn?: number
  /** figure height above the base disc, inches */
  figureHeightIn?: number
  /** top of the black base disc, inches */
  baseTopIn?: number
  baseMm?: number
  /** sockets were computed from the mesh by tools/models/measure-sockets.py */
  measured?: boolean
  /** only present when the mesh faces -Z: the renderer turns it by PI; sockets are already in the +Z frame */
  facing?: '+Z' | '-Z'
  sockets?: Partial<Record<SocketName, V3>>
  poses?: Partial<Record<'long' | 'heavy' | 'melee2h' | 'shield', string>>
  /** v2 bodies (docs/spec/30-figures.md section 7): the default weapons are part of the mesh, so no weapon attachment is mounted */
  weaponsBaked?: boolean
  /** alternate bodies for the same archetype (other poses); an operative picks one by its id so a squad does not repeat */
  variants?: string[]
}
/** A point in the attachment's own frame: [x, y, z] or {x, y, z}. */
export type PointLike = V3 | { x: number; y: number; z: number }
export const pointOf = (p: PointLike | undefined): V3 => (!p ? [0, 0, 0] : Array.isArray(p) ? p : [p.x, p.y, p.z])

/** One attachment GLB (docs/spec/30-figures.md section 3), keyed by slug (tools/models/attachments.json). The mesh
 * is authored at its final size: +X along the barrel / blade, y up, origin at the grip point. */
export interface AttachmentEntry {
  file: string
  holdClass: HoldClass
  /** length along +X, inches */
  lengthIn?: number
  grip?: PointLike
  /** support-hand point (long / heavy classes), attachment frame */
  support?: PointLike
  scale?: number
}
export interface ModelManifest {
  bodies: Record<string, BodyEntry>
  attachments: Record<string, AttachmentEntry>
}

export const EMPTY_MANIFEST: ModelManifest = { bodies: {}, attachments: {} }

let current: ModelManifest = EMPTY_MANIFEST
let request: Promise<ModelManifest> | null = null
const listeners = new Set<() => void>()

export function modelManifest(): ModelManifest {
  return current
}

export function loadModelManifest(): Promise<ModelManifest> {
  request ??= fetch(`${import.meta.env.BASE_URL}assets/models/manifest.json`)
    .then((r): Promise<Partial<ModelManifest>> => (r.ok ? (r.json() as Promise<Partial<ModelManifest>>) : Promise.resolve({})))
    .then((m) => {
      current = { bodies: m.bodies ?? {}, attachments: m.attachments ?? {} }
      listeners.forEach((l) => l())
      return current
    })
    .catch(() => current)
  return request
}

export function useModelManifest(): ModelManifest {
  const [m, setM] = useState(current)
  useEffect(() => {
    const l = () => setM(current)
    listeners.add(l)
    void loadModelManifest()
    return () => {
      listeners.delete(l)
    }
  }, [])
  return m
}

/** Slug (under assets/models, no extension) of a manifest file entry. */
export function slugOf(file: string, dir: 'bodies' | 'attachments'): string {
  const bare = file.replace(/\.glb$/i, '')
  return bare.includes('/') ? bare : `${dir}/${bare}`
}
