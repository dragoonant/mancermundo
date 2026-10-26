#!/usr/bin/env python3
"""Builds the v2 figure concept prompts (art/concepts/v2/prompts-gemini.json) and figures.json.

One standalone prompt per figure: subject and gear, which hand holds what, the pose line,
the style sentence, framing. Run:  python tools/art/v2_prompts.py
"""
import json, os, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "art", "concepts", "v2")

STYLE = ("Proportions: a super-deformed heroic figure with bobblehead proportions and a gigantic round head, exactly two and a half heads tall, "
         "the enormous head alone about half of the total height (almost as tall as the whole body below it, about 50%) and as wide as the shoulders, "
         "a tiny very short compact chest, chunky limbs, very short thick legs with big feet, short arms with oversized hands; dense layered "
         "hard-surface panel detail with fine panel lines, rivets and small accents; glossy painted tabletop-miniature finish, crisp edges, saturated colours.")
FRAME = ("Whole figure standing on a plain round black base, studio product photo, three-quarter view from slightly "
         "below, soft even lighting, pure white seamless background, no text, no lettering, no logos, no emblems.")

# ---- bodies -------------------------------------------------------------
GOL = {
    "tyrant": "a vat-grown stocky, brutish forge-gang warlord with grey skin, a bald scarred head with a thick braided topknot, a heavy brow and jaw, modest-sized bolted dark-bronze iron shoulder plates, a rust-red studded leather harness, a thick iron collar, hanging chains, a belt of small trophy skulls and a heavy furnace-plate chest piece",
    "stimmer": "a vat-grown stocky, brutish forge-gang berserker with grey skin, a bald head with a wild topknot, bulging veins, glass injector tubes strapped to both forearms, a rust-red studded leather harness, a few chains and bolted dark-bronze iron plates",
    "boss": "a vat-grown stocky, brutish forge-gang boss with grey skin, a bald scarred head, one large bolted dark-bronze iron shoulder plate, a rust-red studded leather harness, a heavy chain and a studded belt",
    "bruiser": "a vat-grown stocky, brutish forge-gang brute with grey skin, a bald scarred head with a heavy brutish jaw, a rust-red studded leather harness across the chest, a few chains and bolted dark-bronze iron plates",
    "bully": "a smaller, younger, scrappier vat-grown forge-gang brute with grey skin, a bald head with a short topknot, a patched rust-red studded leather harness, one chain and a single small bolted dark-bronze iron plate",
    "forgeborn": "a lean, wiry, young vat-grown forge-gang runner with grey skin, a shaved head with a short topknot, a thin rust-red leather harness with small bronze studs, a few chains and one bolted dark-bronze plate",
}
ESC = {
    "queen": "a lithe, commanding young woman, queen of an all-female punk gang, a tall wild hot-magenta mohawk crest with long acid-green feathers, a sharp confident face, an ornate tall collar, a fitted hot-magenta synth-leather coat-bodice with acid yellow-green trim, shoulder pieces with small chem vials, tight mesh sleeves, gold chains",
    "matriarch": "a lithe, confident young woman, a veteran of an all-female punk gang, a wild hot-magenta mohawk with a few acid-green feathers, a sharp face, a hot-magenta synth-leather jacket with acid yellow-green trim, tight mesh sleeves, a belt of small chem vials",
    "deathmaiden": "a lithe, agile young woman, a deadly duellist of an all-female punk gang, a wild acid-green mohawk swept to one side, a sharp face with face paint, light acid yellow-green and hot-magenta plates over a corset vest, mesh sleeves, fingerless gloves, a sash belt with small chem vials",
    "sister": "a lithe, agile young woman from an all-female punk gang, a wild hot-magenta mohawk with a few feathers, a sharp confident face, a dark synth-leather jacket with hot-magenta and acid yellow-green panels, tight mesh sleeves, small chem vials on a belt",
    "littlesister": "a smaller, younger, cheeky girl from an all-female punk gang, a short acid-green mohawk ponytail, a cropped hot-magenta synth-leather jacket, a mesh top, one chem vial on a cord, scuffed boots with acid-green laces",
    "wyldrunner": "a lean, wild young woman runner of an all-female punk gang, a ragged hot-magenta mohawk with feathers in it, face paint, a short acid yellow-green synth-leather vest, mesh sleeves, bare strapped thighs, beaded cords and small chem vials",
}

# (slug, house, type, bodykey, fighterType, loadout, height_in, hold-text, pose)
F = []
def add(slug, house, ftype, body, loadout, h, hold, pose):
    F.append(dict(slug=slug, house=house, fighterType=ftype, body=body, loadout=loadout, height_in=h, hold=hold, pose=pose))

# ---- Goliath ------------------------------------------------------------
add("goliath-forge-tyrant-chainaxe", "goliath", "Forge Tyrant", "tyrant", ["Chainaxe", "Stub gun"], 1.45,
    "a chunky chainaxe with a broad axe blade edged with a chain of teeth in the right hand and a small chunky stub pistol in the left hand",
    "charging forward, chainaxe raised high overhead, stub pistol aimed ahead")
add("goliath-forge-tyrant-renderizer", "goliath", "Forge Tyrant", "tyrant", ["'Renderizer' serrated axe", "Stub gun"], 1.45,
    "an enormous two-handed serrated axe with a long thick haft and a broad saw-toothed blade, gripped in both hands, and a small stub pistol holstered on the right hip",
    "mid-swing, the huge serrated axe raised back over the right shoulder ready to chop down, leaning into the strike")
add("goliath-stimmer-pulveriser-paired", "goliath", "Stimmer", "stimmer", ["Paired 'Pulveriser' serrated axe", "Stub gun"], 1.40,
    "a heavy serrated saw-toothed axe in each hand, one in the right hand and one in the left hand, and a small stub pistol holstered on the hip",
    "leaping forward in a frenzy, both axes swung out wide to the sides, mouth open in a roar")
add("goliath-forge-boss-combat-shotgun", "goliath", "Forge Boss", "boss", ["Combat shotgun (salvo & shredder)", "Axe"], 1.40,
    "a chunky combat shotgun with a short thick barrel and a drum magazine in the right hand and a single-bladed hand axe in the left hand",
    "advancing, the shotgun held out one-handed and aimed ahead, the axe held low in the left hand")
add("goliath-forge-boss-boltgun", "goliath", "Forge Boss", "boss", ["Boltgun", "Chainaxe"], 1.40,
    "a chunky boltgun with a box magazine in the right hand and a chainaxe with a chain-toothed blade in the left hand",
    "striding forward, the boltgun fired one-handed ahead, the chainaxe raised in the left hand")
add("goliath-bruiser-boltgun", "goliath", "Bruiser", "bruiser", ["Boltgun", "Knife"], 1.35,
    "a chunky boltgun with a box magazine held in both hands at the shoulder, and a big knife sheathed on the belt",
    "braced firing stance, boltgun shouldered and aimed ahead")
add("goliath-bruiser-stub-cannon", "goliath", "Bruiser", "bruiser", ["Stub cannon", "Axe"], 1.35,
    "a huge chunky revolver-style stub cannon with a thick barrel and a big rotating cylinder in the right hand and a single-bladed hand axe in the left hand",
    "advancing, the stub cannon fired one-handed ahead with a small muzzle flash, the axe held low")
add("goliath-bruiser-combat-shotgun", "goliath", "Bruiser", "bruiser", ["Combat shotgun (salvo & shredder)"], 1.35,
    "a chunky combat shotgun with a thick short barrel and a drum magazine held in both hands",
    "braced firing stance, shotgun at the shoulder and aimed ahead")
add("goliath-bruiser-specialist-grenade-launcher", "goliath", "Bruiser (Specialist)", "bruiser", ["Grenade launcher (frag & krak)", "Stub gun"], 1.35,
    "a bulky grenade launcher with a wide barrel and a rotating drum held in both hands, and a small stub pistol holstered on the hip",
    "kneeling on one knee, the grenade launcher shouldered and aimed ahead")
add("goliath-bully-brute-cleaver", "goliath", "Bully", "bully", ["Brute cleaver", "Stub gun"], 0.95,
    "a big broad single-edged cleaver in the right hand and a small chunky stub pistol in the left hand",
    "charging forward, the cleaver raised back, the pistol aimed ahead")
add("goliath-bully-brute-cleaver-b", "goliath", "Bully", "bully", ["Brute cleaver", "Stub gun"], 0.95,
    "a big broad single-edged cleaver in the right hand and a small chunky stub pistol in the left hand",
    "leaping through the air, the cleaver swung down in a chopping arc, the pistol held out to the side")
add("goliath-bully-axe", "goliath", "Bully", "bully", ["Axe", "Stub gun"], 0.95,
    "a single-bladed hand axe in the right hand and a small chunky stub pistol in the left hand",
    "running forward, the axe raised, the pistol aimed ahead")
add("goliath-forge-born-knife", "goliath", "Forge-born", "forgeborn", ["Knife", "Stub gun"], 0.95,
    "a big straight knife in the right hand and a small chunky stub pistol in the left hand",
    "crouched low in a sprint, the knife held back, the pistol aimed ahead")
add("goliath-forge-born-knife-b", "goliath", "Forge-born", "forgeborn", ["Knife", "Stub gun"], 0.95,
    "a big straight knife in the right hand and a small chunky stub pistol in the left hand",
    "mid-leap with the knife stabbing down and the pistol firing sideways")

# ---- Escher -------------------------------------------------------------
add("escher-queen-plasma-pistol", "escher", "Queen", "queen", ["Plasma pistol", "Power sword"], 1.25,
    "a chunky plasma pistol with a glowing blue coil raised in the right hand and a slender glowing energy-edged sword in the left hand",
    "striking a commanding stance, the sword pointed ahead and the plasma pistol aimed at the same target")
add("escher-queen-lasgun-shock-whip", "escher", "Queen", "queen", ["Lasgun", "Shock whip"], 1.25,
    "a sleek lasgun with a long barrel held in the left hand against the hip and a long coiled whip crackling with electric sparks in the right hand",
    "mid-motion, the whip lashing out in a curling arc, the lasgun aimed ahead")
add("escher-matriarch-lasgun", "escher", "Matriarch", "matriarch", ["Lasgun", "Shock whip"], 1.20,
    "a sleek lasgun with a long barrel held in the right hand and a coiled whip crackling with electric sparks in the left hand",
    "advancing, the lasgun aimed ahead, the whip trailing and curling to the side")
add("escher-matriarch-boltgun", "escher", "Matriarch", "matriarch", ["Boltgun", "Stiletto sword"], 1.20,
    "a chunky boltgun with a box magazine in the right hand and a long thin stiletto sword in the left hand",
    "striding forward, the boltgun fired one-handed ahead, the thin sword held ready at the side")
add("escher-death-maiden-needle-pistol", "escher", "Death-Maiden", "deathmaiden", ["Needle pistol", "Stiletto sword"], 1.20,
    "a slim needle pistol with a long thin barrel in the right hand and a long thin stiletto sword in the left hand",
    "lunging forward, the sword thrust ahead, the needle pistol aimed over it")
add("escher-sister-specialist-grenade-launcher", "escher", "Sister (Specialist)", "sister", ["Grenade launcher (frag & krak)", "Stub gun"], 1.15,
    "a bulky grenade launcher with a wide barrel and a rotating drum held in both hands, and a small stub pistol holstered on the hip",
    "kneeling on one knee, the grenade launcher shouldered and aimed ahead")
add("escher-sister-specialist-needle-rifle", "escher", "Sister (Specialist)", "sister", ["Needle rifle", "Stub gun"], 1.15,
    "a long slim needle rifle with a thin long barrel and a scope held in both hands, and a small stub pistol holstered on the hip",
    "crouched low, the long rifle at the shoulder, aiming carefully ahead")
add("escher-sister-lasgun", "escher", "Sister", "sister", ["Lasgun", "Flak armour"], 1.15,
    "a sleek lasgun with a long barrel and a short stock held in both hands",
    "running forward, the lasgun aimed ahead")
add("escher-sister-lasgun-b", "escher", "Sister", "sister", ["Lasgun", "Flak armour"], 1.15,
    "a sleek lasgun with a long barrel and a short stock held in both hands",
    "kneeling on one knee, the lasgun shouldered and firing ahead")
add("escher-wyld-runner-wyld-bow", "escher", "Wyld Runner", "wyldrunner", ["Wyld bow", "Chainsword"], 0.95,
    "a short recurve bow with a drawn string and a nocked arrow in the left hand and a chainsword with a chain-toothed blade in the right hand",
    "running, the bow held out ahead, the chainsword raised back")
add("escher-wyld-runner-wyld-bow-b", "escher", "Wyld Runner", "wyldrunner", ["Wyld bow", "Chainsword"], 0.95,
    "a short recurve bow with a drawn string and a nocked arrow in the left hand and a chainsword with a chain-toothed blade in the right hand",
    "leaping, the chainsword swung down in an arc, the bow held out to the side")
add("escher-little-sister-stub-gun-knife", "escher", "Little Sister", "littlesister", ["Stub gun", "Knife"], 0.95,
    "a small chunky stub pistol in the right hand and a big straight knife in the left hand",
    "crouched low, the pistol aimed ahead, the knife held back")
add("escher-little-sister-stub-gun-knife-b", "escher", "Little Sister", "littlesister", ["Stub gun", "Knife"], 0.95,
    "a small chunky stub pistol in the right hand and a big straight knife in the left hand",
    "running forward, the knife raised, the pistol aimed ahead")

def prompt(f):
    bodies = GOL if f["house"] == "goliath" else ESC
    return ("Generate an image: A painted miniature figure of " + bodies[f["body"]] + ". The figure is holding "
            + f["hold"] + ". Pose: " + f["pose"] + ". " + STYLE + " " + FRAME)

def main():
    os.makedirs(OUT, exist_ok=True)
    prompts = [{"slug": f["slug"], "house": f["house"], "prompt": prompt(f)} for f in F]
    with open(os.path.join(OUT, "prompts-gemini.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump(prompts, fh, indent=1, ensure_ascii=False)
    figs = [{"slug": f["slug"], "house": f["house"], "fighterType": f["fighterType"], "loadout": f["loadout"],
             "height_in": f["height_in"], "base_mm": 25} for f in F]
    with open(os.path.join(OUT, "figures.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump(figs, fh, indent=1, ensure_ascii=False)
    banned = ["mecha", "mgsd", "master grade", "chibi", "gundam", "bandai", "warhammer", "necromunda", "goliath", "escher"]
    for p in prompts:
        low = p["prompt"].lower()
        for b in banned:
            if b in low:
                sys.exit("banned word %r in %s" % (b, p["slug"]))
    print(len(prompts), "prompts,", sum(1 for f in F if f["house"] == "goliath"), "goliath,",
          sum(1 for f in F if f["house"] == "escher"), "escher")

if __name__ == "__main__":
    main()
