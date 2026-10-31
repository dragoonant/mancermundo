# Body concepts (bare-handed A-pose): SUPERSEDED STYLE TESTS

Status: superseded by the coordinator's course change (role poses with default weapons fused into the figure; no model-kit brand, "mecha" or style-label words; use the style sentence from the Mancermundo figure spec). These 8 images are kept only as style/proportion references. Do not use as final concepts.

Made in Google Gemini (Flash) via Claude in Chrome, 1024x572 canvas exports of blob images (tools/art/decode-bundle.cjs). One chat per house. 13 generations total (7 Goliath, 6 Escher). Contact sheet: contact.png (tools/art/contact_sheet.py).

## Goliath (chat gemini.google.com/app/663306aaf9aaea9b), 7 responses
Base prompt: "Generate an image: a highly detailed painted miniature figure of a Goliath ganger from an industrial forge-gang: a vat-grown hulking brute with massively muscled arms and chest, grey-ish skin, bald scarred head with a heavy brutish jaw, a studded leather harness across the bare chest, heavy trousers, a few chains and bolted iron plates, rust-red, black and bronze palette. Proportions: about 2.5 heads tall in total; the head is about 40 percent of the figure's total height and as wide as the shoulders; tiny torso, short thick legs with big chunky boots, short thick arms with oversized open hands. Crisp hard-surface panel lines. BOTH HANDS EMPTY and open with fingers spread, no weapons of any kind, no holstered guns, nothing held. Arms slightly away from the body in a neutral A-pose-ish stance. Full body, front three-quarter view, standing on a plain round black base, plain pure white background, even soft lighting, no shadows, no text or lettering or logos anywhere, exactly ONE single figure centred and not cropped."

| Resp | Result | Prompt summary |
|---|---|---|
| 1 | rejected, head about 30%, too realistic | base prompt |
| 2 | rejected, head still about 27% | "Edit this last image only: head far too small ... giant oversized block about 45 percent ... about 2.2 heads tall" |
| 3 | rejected (closer, about 33%) | "still not large-headed enough ... as tall as torso and legs combined (about 48 percent) ... bulk from chunky blocky armour plates" |
| 4 | PICKED: goliath-ganger (head about 37%, about 2.7 heads) | "make the head even bigger, a giant oversized ball about 50 percent ... short squat torso, legs a short stub above huge chunky boots" |
| 5 | PICKED: goliath-leader | "Start from the last image ... change only: gang leader: bigger and broader, heavier bolted iron plates on shoulders and chest, thick iron collar, trophy chains and small skull trophies, heavy studded belt, black mohawk strip, bare empty hands, no weapons" |
| 6 | PICKED: goliath-champion | "Start from the bald grey Goliath brute in the 4th image ... champion: slightly bigger, one large iron and bronze pauldron on left shoulder, short black mohawk, extra studded chest strap, heavy belt with bronze buckle plate" |
| 7 | PICKED: goliath-juve | "... juve: smaller younger scrappier (about 80 percent size, slimmer limbs), smooth youthful face with small scar, spiky rust-red mohawk, thinner patched harness, one short chain, single small iron plate, scuffed trousers" |

## Escher (chat gemini.google.com/app/3a482ee2202676ce), 6 responses
Base prompt: "Generate an image: a highly detailed painted miniature figure of an Escher ganger from an all-female punk gang: a lithe agile young woman with a wild bright pink and purple mohawk, a sharp confident face, dark synth-leather jacket and tight mesh sleeves, a few feathers in her hair, small chem vials on a belt, bright pink, purple, yellow and teal accents on dark leather. Proportions: about 2 heads tall in total; the head is enormous, about 45 percent of the figure's total height and as wide as the shoulders; tiny short torso, short thick legs with big chunky boots, short arms with big oversized open hands. Crisp hard-surface panel lines. BOTH HANDS EMPTY ... [rest as Goliath base prompt, 'no holstered guns or blades']"

| Resp | Result | Prompt summary |
|---|---|---|
| 1 | rejected, base cropped by bottom edge, oversized base | base prompt |
| 2 | rejected, base still cropped | "base is cropped and too large; smaller round base fully visible; head about 48%" |
| 3 | PICKED: escher-ganger (head with hair about 43%, about 2.5 to 2.8 heads) | "zoom out ... figure and base fill about 70 percent of image height, 12 percent white band below the base, small thin round black disc" |
| 4 | PICKED: escher-leader | "Start from the last image ... matriarch leader: ornate tall stand-up collar with gold and teal filigree, tall purple and gold crest with long feathers, ornate shoulder pieces with chem vials, long fitted dark coat-bodice with gold trim (no cape), gold chains" |
| 5 | PICKED: escher-champion | "Start from the 3rd image ... blade-duelist champion: teal and yellow mohawk swept to one side, light armour with teal and yellow plates, corset-vest, sash belt, fingerless gloves, NO sword/blade/sheath" |
| 6 | PICKED: escher-juve | "Start from the 3rd image ... juve: younger smaller (about 85 percent), cheeky grin, short yellow and teal ponytail-mohawk, cropped short jacket, mesh top, one chem vial on a cord, scuffed boots with pink laces" |

Total: 13 generations (7 + 6). Gemini quota: no rate limit hit; Pro account.

## QC notes
All 8 picks: one figure, round black base fully visible, white background, no text, open empty hands (Goliath hands slightly relaxed). Head about 2.5 to 2.8 heads tall, not the full 40 percent target. Goliath leader and champion are barely bigger than the ganger. Gemini edits reliably change gear but only gradually change head ratio.
