import type { DataFile } from '../types'
import tunnelSkirmish from './tunnel-skirmish.json'
import smashAndGrab from './smash-and-grab.json'
import forgottenRiches from './forgotten-riches.json'

/** Scenario files (`scenarios/<id>.json`), one record each: Tunnel Skirmish, Smash & Grab, Forgotten Riches (11-scenarios.md). */
export const SCENARIO_FILES: DataFile[] = [
  { path: 'scenarios/tunnel-skirmish.json', schema: 'scenario', def: 'scenario', array: false, data: tunnelSkirmish },
  { path: 'scenarios/smash-and-grab.json', schema: 'scenario', def: 'scenario', array: false, data: smashAndGrab },
  { path: 'scenarios/forgotten-riches.json', schema: 'scenario', def: 'scenario', array: false, data: forgottenRiches },
]
