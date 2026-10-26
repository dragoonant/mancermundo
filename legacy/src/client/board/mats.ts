// Killzone floor mats: six generated top-down textures (public/assets/mats, see MATS.md). The mat is chosen from the
// game seed so a given game always looks the same; `?mat=<id>` forces one. Pure data and functions (no DOM at import).

export interface MatDef {
  id: string
  name: string
  /** file under public/assets/mats/ (1024x1024 seamless JPEG) */
  file: string
  /** tiles across the 30" width; the texture is square, so the 22" side repeats by 22/30 of this. Sized so plates read 2-3" wide. */
  repeat: number
  /** multiply colour applied over the texture so figures, terrain and the grid stay readable */
  tint: string
  /** brightness gain (1-2) applied before the tint, for textures generated too dark to read figures against */
  gain?: number
}

export const MATS: readonly MatDef[] = [
  { id: 'plasteel-deck', name: 'Plasteel deck', file: 'plasteel-deck.jpg', repeat: 2.7, tint: '#c9ced6' },
  { id: 'rust-grating', name: 'Rust grating', file: 'rust-grating.jpg', repeat: 2.4, tint: '#8f8a86' },
  { id: 'cracked-concrete', name: 'Cracked concrete', file: 'cracked-concrete.jpg', repeat: 4, tint: '#7d8087' },
  { id: 'ash-waste', name: 'Ash waste', file: 'ash-waste.jpg', repeat: 3, tint: '#8f8a85' },
  { id: 'gothic-flagstones', name: 'Gothic flagstones', file: 'gothic-flagstones.jpg', repeat: 2.2, tint: '#e6e6ea', gain: 1.4 },
  { id: 'blood-foundry', name: 'Blood foundry', file: 'blood-foundry.jpg', repeat: 2.7, tint: '#dcd8d6', gain: 1.45 },
]

export const MAT_IDS: readonly string[] = MATS.map((m) => m.id)

export function matById(id: string | null | undefined): MatDef | null {
  return MATS.find((m) => m.id === id) ?? null
}

/** FNV-1a 32-bit with a final avalanche, so near-identical seeds ("1", "2", "e2e-1") spread over the six mats. */
function hashSeed(seed: string | number): number {
  const s = String(seed)
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/** The mat for a game seed: deterministic, every mat reachable. */
export function pickMat(seed: string | number): MatDef {
  return MATS[hashSeed(seed) % MATS.length]!
}

/** `?mat=<id>` from a query string; null when absent or unknown. */
export function matOverride(search: string): MatDef | null {
  return matById(new URLSearchParams(search).get('mat'))
}

const PREF_KEY = 'ms.mat'

/** The floor mat chosen on the Start screen: a mat id, or 'random' (the seed picks, a new look each game). */
export function getMatPref(): string {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(PREF_KEY) : null
    if (v && matById(v)) return v
  } catch {
    // storage may be blocked
  }
  return 'random'
}

export function setMatPref(id: string): void {
  try {
    localStorage.setItem(PREF_KEY, id)
  } catch {
    // ignore
  }
}

/** URL override first, then the Start screen's pick (`pref`, a mat id; 'random' or null falls through), then the seed pick. */
export function chooseMat(seed: string | number, search = '', pref: string | null = null): MatDef {
  return matOverride(search) ?? matById(pref) ?? pickMat(seed)
}

/** Thumbnail URL for the Start screen picker (192x192 JPEG). */
export function matThumbUrl(id: string, base = ''): string {
  return `${base}assets/mats/${id}-thumb.jpg`
}
