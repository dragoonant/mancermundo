// Namespace -> module table. Exactly one owner per decision-kind namespace. Every module exists from S1 as a stub, so a
// later stage edits only its own module file, never this table.
import { activationModule } from './activation'
import { endphaseModule } from './endphase'
import { fightModule } from './fight'
import { movementModule } from './movement'
import { priorityModule } from './priority'
import type { ModuleDef } from './registry'
import { scenariosModule } from './scenarios'
import { setupModule } from './setup'
import { shootModule } from './shoot'
import { skillsModule } from './skills'
import { EngineInvariantError } from './state'

export const ALL_MODULES: ModuleDef[] = [
  setupModule,
  priorityModule,
  activationModule,
  movementModule,
  shootModule,
  fightModule,
  endphaseModule,
  scenariosModule,
  skillsModule,
]

/** Decision kinds routed to a module other than their namespace owner: re-rolls granted by skills and wargear. */
const KIND_OVERRIDES: Record<string, ModuleDef> = {
  'dice.reroll': skillsModule,
}

let table: Map<string, ModuleDef> | null = null

function build(): Map<string, ModuleDef> {
  const m = new Map<string, ModuleDef>()
  for (const mod of ALL_MODULES) {
    for (const ns of mod.namespaces) {
      if (m.has(ns)) throw new EngineInvariantError(`namespace ${ns} has two owners`)
      m.set(ns, mod)
    }
  }
  return m
}

/** The module that owns a decision kind such as `action.choose`. */
export function moduleFor(kind: string): ModuleDef {
  const override = KIND_OVERRIDES[kind]
  if (override) return override
  table ??= build()
  const ns = kind.split('.')[0]!
  const mod = table.get(ns)
  if (!mod) throw new EngineInvariantError(`no module owns decision kind ${kind}`)
  return mod
}
