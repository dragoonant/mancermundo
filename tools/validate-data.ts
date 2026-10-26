import { validateAll } from '../src/data/validate'

const result = validateAll({ hooksFile: 'write' })
if (result.errors.length > 0) {
  for (const line of result.errors) console.error(line)
  console.error(`${result.errors.length} problem(s)`)
  process.exit(1)
}
console.log(`ok (${result.files} files, ${result.records} records)`)
