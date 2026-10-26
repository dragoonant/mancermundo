// SKL module stub (S1): owns the `skill` namespace (and, through the override in modules.ts, `dice.reroll`).
// Every action is rejected with E_TODO until S4K lands.
import { stubModule } from './registry'

export const skillsModule = stubModule('skills', ['skill'])
