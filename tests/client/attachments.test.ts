// Attachments: every weapon id in the data resolves to an attachment GLB that exists on disk, or an explicit
// "draws nothing"; every finalised mesh is a sane size; the placement plan handles pairs and the box fallback.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dataBundle } from '@/client/game/adapter'
import { AOD_SLUGS, ATTACHMENT_FOR, KOMMANDO_SLUGS, MAPPED_SLUGS, attachmentFor } from '@/client/figures/attachmentFor'
import { planAttachments } from '@/client/figures/Operative'
import { HOLDS } from '@/client/figures/hold'
import { pointOf, type ModelManifest } from '@/client/figures/manifest'

const modelsDir = resolve(__dirname, '../../public/assets/models')
const manifest = JSON.parse(readFileSync(resolve(modelsDir, 'manifest.json'), 'utf8')) as ModelManifest
const config = JSON.parse(readFileSync(resolve(__dirname, '../../tools/models/attachments.json'), 'utf8')) as Record<string, { lengthIn: number; holdClass: string }>
const weapons = Object.values(dataBundle().byId).filter((r) => 'atk' in r && 'dmg' in r) as unknown as { id: string }[]
const glbPath = (file: string) => resolve(modelsDir, file.includes('/') ? file : `attachments/${file}`)

describe('attachment mapping', () => {
  it('data has weapons to map', () => {
    expect(weapons.length).toBeGreaterThanOrEqual(50)
  })

  it('every weapon id resolves to an existing GLB or an explicit none', () => {
    const bad: string[] = []
    for (const w of weapons) {
      const slugs = attachmentFor(w.id)
      if (slugs === undefined) {
        bad.push(`${w.id}: unmapped`)
        continue
      }
      for (const s of slugs) {
        const e = manifest.attachments[s]
        if (!e) bad.push(`${w.id}: no manifest entry ${s}`)
        else if (!existsSync(glbPath(e.file))) bad.push(`${w.id}: missing file ${e.file}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('has no stale mapping entries and draws nothing only for natural / abstract weapons', () => {
    const ids = new Set(weapons.map((w) => w.id))
    expect(Object.keys(ATTACHMENT_FOR).filter((id) => !ids.has(id))).toEqual([])
    const none = Object.entries(ATTACHMENT_FOR).filter(([, v]) => v.length === 0).map(([id]) => id).sort()
    expect(none).toEqual(['aod.w.fists', 'kom.w.bite', 'kom.w.explosives', 'kom.w.fists'])
  })

  it('twin choppas draw two choppas, profile groups share one mesh', () => {
    expect(attachmentFor('kom.w.twin-choppas')).toEqual(['w-choppa', 'w-choppa'])
    expect(attachmentFor('kom.w.choppas-equipment')).toEqual(['w-choppa'])
    expect(attachmentFor('aod.w.heavy-bolter-focused')).toEqual(attachmentFor('aod.w.heavy-bolter-sweeping'))
    expect(attachmentFor('kom.w.scoped-big-shoota-concealed')).toEqual(attachmentFor('kom.w.scoped-big-shoota-sweeping'))
  })
})

describe('attachment manifest', () => {
  it('lists all 31 attachments with a config, an entry and a file', () => {
    const all = [...KOMMANDO_SLUGS, ...AOD_SLUGS]
    expect(all).toHaveLength(31)
    for (const s of all) {
      expect(config[s], `${s} in attachments.json`).toBeTruthy()
      const e = manifest.attachments[s]
      expect(e, `${s} in manifest`).toBeTruthy()
      expect(existsSync(glbPath(e!.file)), `${s} file`).toBe(true)
    }
    for (const s of MAPPED_SLUGS) expect(all).toContain(s)
  })

  it('entries carry class, length and grip at the origin; sizes stay small', () => {
    for (const [s, e] of Object.entries(manifest.attachments)) {
      expect(HOLDS[e.holdClass], `${s} class`).toBeTruthy()
      expect(e.holdClass).toBe(config[s]!.holdClass)
      expect(e.lengthIn).toBe(config[s]!.lengthIn)
      expect(pointOf(e.grip)).toEqual([0, 0, 0])
      expect(e.scale).toBe(1)
      if (e.holdClass === 'long' || e.holdClass === 'heavy') expect(e.support, `${s} support`).toBeTruthy()
      const kb = readFileSync(glbPath(e.file)).length / 1024
      expect(kb, `${s} size`).toBeLessThan(400)
    }
  })
})

describe('planAttachments', () => {
  const boxOnly: ModelManifest = { bodies: {}, attachments: {} }
  it('draws nothing for an explicit none, a box for an unmapped id', () => {
    expect(planAttachments({ ranged: null, melee: { id: 'kom.w.fists', hold: 'melee1h', melee: true } }, manifest)).toEqual([])
    const p = planAttachments({ ranged: { id: 'x.unknown', hold: 'rifle', melee: false }, melee: null }, boxOnly)
    expect(p).toHaveLength(1)
    expect(p[0]!.slug).toBeNull()
  })
  it('twin choppas: one per hand when the right hand is free, else the second hangs at the belt', () => {
    const twin = { id: 'kom.w.twin-choppas', hold: 'melee1h' as const, melee: true }
    const free = planAttachments({ ranged: null, melee: twin }, manifest)
    expect(free.map((p) => p.spec.socket)).toEqual(['handL', 'handR'])
    const busy = planAttachments({ ranged: { id: 'kom.w.slugga', hold: 'pistol', melee: false }, melee: twin }, manifest)
    expect(busy.map((p) => p.spec.socket)).toEqual(['handR', 'handL', 'beltR'])
  })
})
