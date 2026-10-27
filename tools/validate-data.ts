/**
 * npm run validate:data [-- --print gangs] [--allow-pending-codes] [--no-sources] [--quiet]
 *
 * Prints `ok (<n> records)` (after a table of the data files and the core records) or `path: message` lines and exits non-zero.
 */
import { validateAll } from '../src/data/validate'
import '../src/engine'
import { registeredCodeHooks } from '../src/engine/code-hooks'
import { starterGangCost } from '../src/data/roster'
import type { ActionData, ConstantsData, DataBundle, DiceData, TraitData } from '../src/data/types'

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(name)
const printWhat = args.includes('--print') ? args[args.indexOf('--print') + 1] : undefined

const result = validateAll({ registeredCodes: new Set(registeredCodeHooks()), allowPendingCodes: flag('--allow-pending-codes'), sourcesDir: flag('--no-sources') ? false : undefined })

const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length))

function printFiles(): void {
  console.log('data files')
  for (const f of result.summaries) console.log(`  ${pad(f.path, 34)} ${pad(f.def, 14)} ${f.records}`)
}

function printCore(): void {
  const rec = (id: string) => result.index.byId[id]
  const ofDef = (def: string) => result.summaries.filter((s) => s.def === def).flatMap((s) => s.ids)
  console.log('\ncore actions (id, cost, statuses)')
  for (const id of ofDef('action')) {
    const a = rec(id) as ActionData
    console.log(`  ${pad(a.id, 30)} ${pad(a.cost, 7)} ${a.statuses.join('/')}${a.requires.length ? `  needs ${a.requires.join(',')}` : ''}`)
  }
  for (const id of ofDef('dice')) {
    const d = rec(id) as DiceData
    console.log(`\ncore dice ${d.id}: firepower ${d.firepower.faces.map((f) => `${f.hits}${f.ammo ? '*' : ''}`).join(' ')} | injury ${d.injury.faces.map((f) => f.result[0].toUpperCase()).join('')} | scatter ${d.scatter.faces.map((f) => f.kind[0]).join('')}`)
  }
  for (const id of ofDef('constants')) {
    const c = rec(id) as ConstantsData
    console.log(`core constants ${c.id}: ${Object.keys(c).filter((k) => k !== 'id' && k !== 'source').length} groups (radii nerve ${c.radii.nerve}, group ${c.radii.groupActivation}, lead ${c.radii.leadingByExampleLeader}/${c.radii.leadingByExampleChampion}; crew caps ${c.crewCap.map((r) => `${r.min}-${r.max}:${r.cap}`).join(' ')})`)
  }
  const traits = ofDef('trait').map((id) => rec(id) as TraitData)
  console.log(`\ncore traits (${traits.length}; * = implemented for v1)`)
  console.log('  ' + traits.map((t) => `${t.implemented ? '*' : ''}${t.name}`).join(', '))
  for (const kind of ['weapon', 'wargear', 'skill', 'rule'] as const) {
    const ids = result.summaries.filter((s) => s.def === kind && s.path.startsWith('core/')).flatMap((s) => s.ids)
    console.log(`core ${kind} records: ${ids.length}${ids.length ? ' (' + ids.join(', ') + ')' : ''}`)
  }
}

function printGangs(bundle: DataBundle): void {
  const gangs = Object.values(bundle.starterGangs)
  if (gangs.length === 0) console.log('\nno starter gangs in the data yet')
  for (const sg of gangs) {
    console.log(`\n${sg.name} (${sg.id}, ${bundle.houses[sg.house]?.name ?? sg.house}) - ${starterGangCost(bundle, sg)} / ${sg.credits} credits`)
    for (const f of sg.fighters) {
      const t = bundle.fighterTypes[f.type]
      const cost = (t?.cost ?? 0)
      console.log(`  ${pad(f.name, 18)} ${pad(t?.name ?? f.type, 20)} ${pad(t?.role ?? '?', 10)} base ${cost}  weapons ${f.weapons.join(', ') || '-'}  wargear ${f.wargear.join(', ') || '-'}`)
    }
  }
}

if (!flag('--quiet')) {
  printFiles()
  printCore()
  if (printWhat === 'gangs' && result.bundle) printGangs(result.bundle)
  if (result.hooks.length > 0) {
    console.log('\ncode hooks used by data')
    for (const h of result.hooks) console.log(`  ${pad(h.name, 28)} ${h.usedBy.join(', ')}`)
  }
  console.log('')
}

if (result.errors.length > 0) {
  for (const line of result.errors) console.error(line)
  console.error(`${result.errors.length} problem(s)`)
  process.exit(1)
}
console.log(`ok (${result.records} records)`)
