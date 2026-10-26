import type { MissionData } from './types'

/**
 * Enemy incapacitations needed for kill grades 1..5, given the enemy's starting number of
 * non-Expendable operatives. Counts outside the table use the nearest row when `clamp` is set.
 */
export function killGradeThresholds(mission: Pick<MissionData, 'killOp'>, startingOperatives: number): number[] {
  const table = mission.killOp.gradeTable
  const keys = Object.keys(table)
    .map(Number)
    .sort((a, b) => a - b)
  if (keys.length === 0) throw new Error('empty kill grade table')
  let key = startingOperatives
  if (!(String(key) in table)) {
    if (!mission.killOp.clamp) throw new Error(`no kill grade row for ${startingOperatives} operatives`)
    key = startingOperatives < keys[0] ? keys[0] : keys[keys.length - 1]
  }
  return [...table[String(key)]]
}

/** The grade (0..5) reached after `incapacitated` enemy operatives were removed. */
export function killGradeFor(thresholds: readonly number[], incapacitated: number): number {
  let grade = 0
  for (const t of thresholds) if (incapacitated >= t) grade++
  return grade
}
