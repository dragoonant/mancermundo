// SHT module stub (S1): owns the `shoot` namespace. Every action is rejected with E_TODO until its stage lands.
import { stubModule } from './registry'

export const shootModule = stubModule('shoot', ['shoot'])
