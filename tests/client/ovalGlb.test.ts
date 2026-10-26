// GLB figures on an oval footprint (Hunter Clade arquebus Gunner, 60x35mm) hide the GLB's round 25mm disc and stand on
// the oval plinth instead.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three'
import { dataBundle } from '@/client/game/adapter'
import { baseAxes, baseOfCard, setBakedBaseVisible } from '@/client/figures/OvalBase'

function glbNodes(file: string): string[] {
  const buf = readFileSync(resolve(process.cwd(), 'public/assets/models/bodies', file))
  const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8')) as { nodes: { name?: string }[]; materials: { name?: string }[] }
  return [...json.nodes.map((n) => n.name ?? ''), ...json.materials.map((m) => m.name ?? '')]
}

describe('oval GLB base', () => {
  it('OVAL-GLB-001 the arquebus Gunner body GLB carries a hideable round base the client recognises', () => {
    for (const f of ['hc-skitarii-ranger-gunner.glb', 'hc-skitarii-vanguard-gunner.glb']) {
      const names = glbNodes(f)
      expect(names, f).toContain('base')
      expect(names, f).toContain('base_black')
    }
  })

  it('OVAL-GLB-002 setBakedBaseVisible hides only the baked disc and reports whether one was found', () => {
    const root = new Group()
    const figure = new Mesh(new BoxGeometry(), new MeshStandardMaterial({ name: 'Material_0' }))
    figure.name = 'figure'
    const base = new Mesh(new BoxGeometry(), new MeshStandardMaterial({ name: 'base_black' }))
    base.name = 'base'
    root.add(figure, base)
    expect(setBakedBaseVisible(root, false)).toBe(true)
    expect(base.visible).toBe(false)
    expect(figure.visible).toBe(true)
    setBakedBaseVisible(root, true)
    expect(base.visible).toBe(true)
    expect(setBakedBaseVisible(new Group(), false)).toBe(false)
  })

  it('OVAL-GLB-003 the Gunner datacard resolves to a 60x35mm ellipse, round for everyone else', () => {
    const cards = dataBundle().byId as unknown as Record<string, Parameters<typeof baseOfCard>[0]>
    const g = baseOfCard(cards['hc.skitarii-ranger-gunner']!)
    expect(g.ovalHalfAxis).toBeGreaterThan(0)
    const { rx, rz } = baseAxes(g.baseRadius, g.ovalHalfAxis)
    expect(rx * 2 * 25.4).toBeCloseTo(35, 0)
    expect(rz * 2 * 25.4).toBeCloseTo(60, 0)
    expect(baseOfCard(cards['hc.skitarii-ranger-warrior']!).ovalHalfAxis).toBeUndefined()
  })
})
