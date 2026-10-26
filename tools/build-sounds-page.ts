// Rebuilds public/sounds.html (the audition page) from tools/audio-manifest.json and tools/audio-src/measure.json.
// Run with:  npx tsx tools/build-sounds-page.ts   (after tools/measure-audio.ts)
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
interface Item { id: string; kind: string; group: string; copyFrom?: string; text?: string; loop?: boolean }
const manifest = JSON.parse(await readFile(join(root, 'tools', 'audio-manifest.json'), 'utf8')) as { items: Item[] }
const measures = JSON.parse(await readFile(join(root, 'tools', 'audio-src', 'measure.json'), 'utf8')) as Record<string, { rms: number; peak: number; crest: number; seconds: number }>

const GROUPS: [string, string, string?][] = [
  ['music', 'Music'],
  ['ambience', 'Ambience (loops)'],
  ['narrator', 'Voice: bookmaker announcer', 'Original rasping underhive announcer (Qwen3-TTS voice design). Check that all 11 lines share one timbre.'],
  ['zone-mortalis', 'Zone Mortalis'],
  ['status', 'Status and round cues'],
  ['goliath', 'Goliath flavour'],
  ['escher', 'Escher flavour'],
  ['ui', 'UI and game-state stings'],
  ['weapons-guns', 'Weapons: guns', 'Ids still carry their Kill Team-era names; the sounds are generic autoguns, pistols, flamers and plasma. Re-skin per weapon in the weapon pass.'],
  ['weapons-explosives', 'Weapons: explosives and heavy'],
  ['weapons-melee', 'Weapons: melee'],
  ['impacts', 'Impacts'],
  ['deaths', 'Deaths'],
  ['movement', 'Movement'],
]
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
let body = ''
let total = 0
for (const [group, title, note] of GROUPS) {
  const items = manifest.items.filter((i) => i.group === group)
  if (!items.length) continue
  total += items.length
  const isMusic = group === 'music'
  body += `<h2>${title} <small>${items.length}</small></h2>\n${note ? `<p>${esc(note)}</p>\n` : ''}<ul${isMusic ? ' class="music"' : ''}>\n`
  for (const i of items) {
    const m = measures[i.id]
    const label = i.id.replace(/^[a-z]+-/, '').replace(/-/g, ' ')
    const stats = m ? `${m.seconds.toFixed(1)} s, rms ${m.rms.toFixed(2)}, crest ${m.crest.toFixed(1)}${i.loop ? ', loop' : ''}` : 'not generated yet'
    const badge = i.copyFrom ? '<em class="copy">from Mallet</em>' : '<em class="gen">generated</em>'
    const line = i.text ? ` <q>${esc(i.text)}</q>` : ''
    body += `<li><div><span>${esc(label)}</span><code>${i.id}</code> ${badge}${line}<small>${stats}</small></div><audio controls preload="none"${i.loop ? ' loop' : ''} src="audio/${i.id}.mp3"></audio></li>\n`
  }
  body += '</ul>\n'
}
const known = new Set(GROUPS.map((g) => g[0]))
const orphans = manifest.items.filter((i) => !known.has(i.group))
if (orphans.length) throw new Error(`items in unknown groups: ${orphans.map((o) => `${o.id}:${o.group}`).join(', ')}`)

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mancermundo sound check</title>
<style>
:root{--bg:#14161a;--fg:#e8e6e1;--muted:#9a978f;--card:#1e2127;--accent:#c9a227}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.4 system-ui,sans-serif;padding:16px;max-width:760px;margin-inline:auto}
h1{font-size:1.4rem;margin:.5rem 0}h2{font-size:1.1rem;color:var(--accent);margin-top:2rem}h2 small{color:var(--muted);font-weight:normal;margin-left:.4rem}
p{color:var(--muted)}ul{list-style:none;padding:0;margin:0}
li{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;background:var(--card);padding:10px 12px;border-radius:8px;margin:6px 0}
li span{text-transform:capitalize;margin-right:8px}code{color:var(--muted);font-size:.8rem}
li small{display:block;color:var(--muted);font-size:.75rem}q{display:block;font-size:.85rem}
em{font-style:normal;font-size:.7rem;padding:1px 6px;border-radius:9px;margin-left:4px}.copy{background:#2c3140;color:#9db4ff}.gen{background:#33301f;color:var(--accent)}
audio{width:100%;max-width:320px;height:36px}ul.music audio{max-width:100%}ul.music li{flex-direction:column;align-items:stretch}
a{color:var(--accent)}
</style></head><body>
<h1>Sound check</h1><p>${total} sounds grouped by use, so you can audition them. Nothing here has been verified by ear yet; name the ids you want redone. <a href="./">Back to the game</a></p>
${body}<script>document.addEventListener("play",e=>{for(const a of document.querySelectorAll("audio"))if(a!==e.target)a.pause()},true)</script>
</body></html>
`
await writeFile(join(root, 'public', 'sounds.html'), html)
console.log(`wrote public/sounds.html (${total} ids)`)
