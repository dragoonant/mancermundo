// PRI module stub (S1): owns the `priority` namespace. Every action is rejected with E_TODO until its stage lands.
import { stubModule } from './registry'

export const priorityModule = stubModule('priority', ['priority'])
