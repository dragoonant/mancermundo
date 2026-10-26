// Registry of `{ "code": "<name>" }` escape hatches (docs/spec/20-data-schema.md section 11). Every name the data uses is
// registered here (core and scenario hooks) or from src/engine/gangs/<house>.ts (house hooks, imported through
// gangs/index.ts), with a params validator. tests/engine/code-hooks.test.ts proves each one fires in a real game
// (`hookFireCount(name) > 0`). A definition's `install` registers the engine hooks (hooks.ts) it needs.

export type CodeHookKind = 'skill' | 'rule' | 'wargear' | 'weapon' | 'scenario' | 'casket'

export interface CodeHookDef {
  name: string
  kind: CodeHookKind
  /** validate the data record's params; return an error message or null */
  params?: (p: Record<string, unknown> | undefined) => string | null
  /** register the engine hooks (registerHook) this code hook is made of; called once by installCodeHooks */
  install(): void
}

const registry = new Map<string, CodeHookDef>()
const installed = new Set<string>()
const fired = new Map<string, number>()

export function registerCodeHook(def: CodeHookDef): void {
  registry.set(def.name, def)
}

export function getCodeHook(name: string): CodeHookDef | undefined {
  return registry.get(name)
}

export function registeredCodeHooks(): string[] {
  return [...registry.keys()].sort()
}

/** Check a data record's params against the hook's validator; null when fine, a message when not or unregistered. */
export function checkCodeParams(name: string, params: Record<string, unknown> | undefined): string | null {
  const def = registry.get(name)
  if (!def) return `code hook ${name} is not registered`
  return def.params ? def.params(params) : null
}

/** Run `install` of each named hook once (all registered hooks when no names are given). */
export function installCodeHooks(names?: Iterable<string>): void {
  for (const name of names ?? [...registry.keys()]) {
    if (installed.has(name)) continue
    const def = registry.get(name)
    if (!def) continue
    installed.add(name)
    def.install()
  }
}

/** Passive hooks call this when their rule actually applies, so tests can prove the hook fired in a game. */
export function markFired(name: string): void {
  if (quiet > 0) return
  fired.set(name, (fired.get(name) ?? 0) + 1)
}

let quiet = 0
/** Run `fn` without counting fires (query.* runs hooks on hypothetical dice for the odds; that is not the rule firing). */
export function withoutFireCounts<T>(fn: () => T): T {
  quiet++
  try {
    return fn()
  } finally {
    quiet--
  }
}

export function hookFireCount(name: string): number {
  return fired.get(name) ?? 0
}

export function resetFireCounts(): void {
  fired.clear()
}
