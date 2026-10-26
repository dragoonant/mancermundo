// ACT module stub (S1): owns the `action` namespace. Every action is rejected with E_TODO until its stage lands.
import { stubModule } from './registry'

export const activationModule = stubModule('activation', ['action'])
