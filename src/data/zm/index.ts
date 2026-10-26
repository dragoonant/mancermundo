import type { DataFile } from '../types'
import junction from './tiles/junction.json'
import crossroads from './tiles/crossroads.json'
import chamber from './tiles/chamber.json'
import bulkhead from './tiles/bulkhead.json'
import ductRoom from './tiles/duct-room.json'
import loadingBay from './tiles/loading-bay.json'
import foundryRun from './boards/foundry-run.json'
import bulkheadGauntlet from './boards/bulkhead-gauntlet.json'
import cisternCrossing from './boards/cistern-crossing.json'
import hiveHeart from './boards/hive-heart.json'
import sumpWarren from './boards/sump-warren.json'

/**
 * Zone Mortalis tiles (`zm/tiles/<id>.json`, six own-design 12" tiles) and boards (`zm/boards/<id>.json`, three 2x3 and two
 * brick7). One record per file. Geometry checks live in ./checks.ts.
 */
export const ZM_FILES: DataFile[] = [
  { path: 'zm/tiles/junction.json', schema: 'zm', def: 'tile', array: false, data: junction },
  { path: 'zm/tiles/crossroads.json', schema: 'zm', def: 'tile', array: false, data: crossroads },
  { path: 'zm/tiles/chamber.json', schema: 'zm', def: 'tile', array: false, data: chamber },
  { path: 'zm/tiles/bulkhead.json', schema: 'zm', def: 'tile', array: false, data: bulkhead },
  { path: 'zm/tiles/duct-room.json', schema: 'zm', def: 'tile', array: false, data: ductRoom },
  { path: 'zm/tiles/loading-bay.json', schema: 'zm', def: 'tile', array: false, data: loadingBay },
  { path: 'zm/boards/foundry-run.json', schema: 'zm', def: 'board', array: false, data: foundryRun },
  { path: 'zm/boards/bulkhead-gauntlet.json', schema: 'zm', def: 'board', array: false, data: bulkheadGauntlet },
  { path: 'zm/boards/cistern-crossing.json', schema: 'zm', def: 'board', array: false, data: cisternCrossing },
  { path: 'zm/boards/hive-heart.json', schema: 'zm', def: 'board', array: false, data: hiveHeart },
  { path: 'zm/boards/sump-warren.json', schema: 'zm', def: 'board', array: false, data: sumpWarren },
]
