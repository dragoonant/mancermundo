// MOV module stub (S1): owns the `move` namespace. Every action is rejected with E_TODO until its stage lands.
import { stubModule } from './registry'

export const movementModule = stubModule('movement', ['move'])
