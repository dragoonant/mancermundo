"""Merge an extra units file into the pipeline's units.json (adds/overwrites those slugs only). Usage: merge_units.py extra.json"""
import json, sys
units = json.load(open('units.json', encoding='utf-8-sig'))
extra = json.load(open(sys.argv[1], encoding='utf-8-sig'))
units.update(extra)
json.dump(units, open('units.json', 'w', encoding='utf-8'), indent=2)
print('merged', len(extra), 'units; total', len(units))
