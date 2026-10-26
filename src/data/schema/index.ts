import common from './common.schema.json'
import datacard from './datacard.schema.json'
import weapon from './weapon.schema.json'
import ability from './ability.schema.json'
import ploy from './ploy.schema.json'
import equipment from './equipment.schema.json'
import team from './team.schema.json'
import weaponRule from './weapon-rule.schema.json'
import mission from './mission.schema.json'
import killzoneLayout from './killzone-layout.schema.json'

/** Mirror of docs/spec/schemas (the validator checks the two stay identical). */
export const SCHEMAS: Record<string, object> = {
  common,
  datacard,
  weapon,
  ability,
  ploy,
  equipment,
  team,
  'weapon-rule': weaponRule,
  mission,
  'killzone-layout': killzoneLayout,
}
