import type { DataFile } from '../types'
import golHouse from './goliath/house.json'
import golFighters from './goliath/fighters.json'
import golWeapons from './goliath/weapons.json'
import golWargear from './goliath/wargear.json'
import golSkills from './goliath/skills.json'
import golRules from './goliath/rules.json'
import golLists from './goliath/equipment-lists.json'
import golStarters from './goliath/starter-gangs.json'
import escHouse from './escher/house.json'
import escFighters from './escher/fighters.json'
import escWeapons from './escher/weapons.json'
import escWargear from './escher/wargear.json'
import escSkills from './escher/skills.json'
import escRules from './escher/rules.json'
import escLists from './escher/equipment-lists.json'
import escStarters from './escher/starter-gangs.json'

/**
 * Gang data files (`gangs/<house>/{house,fighters,weapons,wargear,skills,rules,equipment-lists,starter-gangs}.json`).
 * Stage S1G lists its files here; a house added later appends its eight files.
 */
export const GANG_FILES: DataFile[] = [
  { path: 'gangs/goliath/house.json', schema: 'gang', def: 'house', array: false, data: golHouse },
  { path: 'gangs/goliath/fighters.json', schema: 'gang', def: 'fighterType', array: true, data: golFighters },
  { path: 'gangs/goliath/weapons.json', schema: 'item', def: 'weapon', array: true, data: golWeapons },
  { path: 'gangs/goliath/wargear.json', schema: 'item', def: 'wargear', array: true, data: golWargear },
  { path: 'gangs/goliath/skills.json', schema: 'gang', def: 'skill', array: true, data: golSkills },
  { path: 'gangs/goliath/rules.json', schema: 'gang', def: 'rule', array: true, data: golRules },
  { path: 'gangs/goliath/equipment-lists.json', schema: 'gang', def: 'equipmentList', array: true, data: golLists },
  { path: 'gangs/goliath/starter-gangs.json', schema: 'gang', def: 'starterGang', array: true, data: golStarters },
  { path: 'gangs/escher/house.json', schema: 'gang', def: 'house', array: false, data: escHouse },
  { path: 'gangs/escher/fighters.json', schema: 'gang', def: 'fighterType', array: true, data: escFighters },
  { path: 'gangs/escher/weapons.json', schema: 'item', def: 'weapon', array: true, data: escWeapons },
  { path: 'gangs/escher/wargear.json', schema: 'item', def: 'wargear', array: true, data: escWargear },
  { path: 'gangs/escher/skills.json', schema: 'gang', def: 'skill', array: true, data: escSkills },
  { path: 'gangs/escher/rules.json', schema: 'gang', def: 'rule', array: true, data: escRules },
  { path: 'gangs/escher/equipment-lists.json', schema: 'gang', def: 'equipmentList', array: true, data: escLists },
  { path: 'gangs/escher/starter-gangs.json', schema: 'gang', def: 'starterGang', array: true, data: escStarters },
]
