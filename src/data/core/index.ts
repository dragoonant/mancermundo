import type { DataFile } from '../types'
import actions from './actions.json'
import dice from './dice.json'
import constants from './constants.json'
import traits from './traits.json'
import weapons from './weapons.json'
import wargear from './wargear.json'
import skills from './skills.json'
import fighterRules from './fighter-rules.json'

/** Core data files. Stage S1G fills weapons, wargear, skills and fighter-rules; only this index lists them. */
export const CORE_FILES: DataFile[] = [
  { path: 'core/actions.json', schema: 'core', def: 'action', array: true, data: actions },
  { path: 'core/dice.json', schema: 'core', def: 'dice', array: false, data: dice },
  { path: 'core/constants.json', schema: 'core', def: 'constants', array: false, data: constants },
  { path: 'core/traits.json', schema: 'core', def: 'trait', array: true, data: traits },
  { path: 'core/weapons.json', schema: 'item', def: 'weapon', array: true, data: weapons },
  { path: 'core/wargear.json', schema: 'item', def: 'wargear', array: true, data: wargear },
  { path: 'core/skills.json', schema: 'gang', def: 'skill', array: true, data: skills },
  { path: 'core/fighter-rules.json', schema: 'gang', def: 'rule', array: true, data: fighterRules },
]
