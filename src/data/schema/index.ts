import common from './common.schema.json'
import core from './core.schema.json'
import item from './item.schema.json'
import gang from './gang.schema.json'
import zm from './zm.schema.json'
import scenario from './scenario.schema.json'

/** The six JSON Schema 2020-12 files (one copy only). `common` is referenced by `$ref` from the others. */
export const SCHEMAS: Record<string, object> = {
  common,
  core,
  item,
  gang,
  zm,
  scenario,
}

export const SCHEMA_ID_BASE = 'https://mancermundo.dev/schemas/'
export const schemaId = (name: string): string => `${SCHEMA_ID_BASE}${name}.schema.json`
