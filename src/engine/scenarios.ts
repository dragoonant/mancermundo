// SCN module stub (S1): owns the `scenario` namespace and the battle-end `confirm`. Every action is rejected with E_TODO
// until S4 lands.
import { stubModule } from './registry'

export const scenariosModule = stubModule('scenarios', ['scenario', 'confirm'])
