# 13 - Gangs: House Goliath and House Escher (Necromunda, 2023 rulebook edition)

Status: research draft for the Mancermundo skirmish port (v1 = skirmish only, Goliath vs Escher).
Every rule below is restated in our own words; names of fighters, weapons and skills match the tabletop game. Numbers (characteristics, credit costs, weapon profiles) are game facts and are reproduced as data.

Edition baseline: Necromunda Core Rulebook (2023, July revision) plus the House of Chains (Goliath) and House of Blades (Escher) fighter lists, with the Games Workshop FAQ and Errata PDF applied (file metadata: last modified 21 Nov 2025). The August to September 2026 "Necromunda Skirmish" relaunch and the 2026 Underhive Journals use a different profile format and different fighter lists; they are NOT ported here (see ruling 'Edition baseline' in `docs/needs-rules-check.md`).

Raw material behind this file lives in `docs/sources/gangs/` (gitignored, never published).

## 0. How to read this file

### 0.1 Source key and quality

No official book text could be fetched (the books are paid products and there is no free official gang-list PDF). Every table therefore cites community sources that agree with each other. Quality grades: A = official Games Workshop document, B = fan database or compilation that mirrors the books and was cross-checked by at least two other sources, C = single-source or reasoning from guides.

| Key | Source | Grade | Notes |
|---|---|---|---|
| FAQ | Games Workshop "Frequently Asked Questions and Errata" PDF for Necromunda (warhammer-community.com assets, (c) GW 2025) | A | Official errata for House of Chains, House of Blades and the core rulebook. Saved as extracted text. |
| GY | Gyrinx (gyrinx.app) public N23 lists: about 900 Goliath (HoC) and Escher (HoB) lists parsed, modal values taken; also its open seed data (github gyrinx-app/gyrinx, N18 YAML) | B | Mirrors the books including page references (Core p.xx, Chains p.xx, Blades p.xx). Real fighter cards, so it already includes errata. |
| ND | "Necrodamus (N23 Rules)" fan compilation PDF (update 2023-10-11), tables read directly from its pages | B | Complete equipment-by-fighter matrices, trait text and skill text. It contains boxes marked "HOUSE RULE" that are the compiler's own inventions; those boxes are ignored everywhere. |
| GH-CH | Goonhammer, "Necromunday: House of Chains Review" (Feb 2020) | B | Fighter-by-fighter changes, restrictions, gene-smithing. |
| GH-GOL | Goonhammer, "Houses of the Underhive: Goliath" (updated Sept 2023, reflects the July 2023 rulebook) and the Dec 2023 "Gang Guide: Goliaths" | B | Costs and rulings per weapon. |
| GH-HOB | Goonhammer, "House of Blades Review" (Aug 2020) | B | Fighter changes, chem-alchemy overview. |
| GH-ESC | Goonhammer, "Houses of the Underhive: Escher" (Sep 2020) | B | Per-weapon fighter access, chem-alchemy details. |
| YT | Yaktribe gang pages (Forge Tyrant, Wyld Runner) | B | Independent confirmation of base profile and base cost for two types. |
| BC | Bolter and Chainsword forum thread "House of Chains (spoiler/review type thing)" (Feb 2020) | C | Equipment-access summary, Gang Hierarchy ranges. |
| WC | Warhammer Community articles on the 2026 Goliath and Escher Underhive Journals | A (scope only) | Used only to confirm the variant-gang names that exist; not ported. |

### 0.2 Notation

- Characteristics are written in the order M WS BS S T W I A Ld Cl Wil Int. M is inches. WS, BS and I are D6 target numbers (roll equal or higher). S, T, W and A are plain numbers. Ld, Cl, Wil and Int are 2D6 target numbers (roll equal or higher; a natural 2 always fails; a natural 1 always fails on a D6 test).
- Weapon profile columns: Rng S and Rng L are short and long range in inches, `E` means close combat only, `T` means the flame template, `Sx2` means twice the wielder's Strength in inches. Acc S and Acc L are hit modifiers at short and long range. Str is Strength (`S+1` means wielder's Strength plus one). AP is the save modifier. D is Damage. Am is the Ammo target number. `-` means no value (AP `-` means 0).
- A `*` after a weapon name means it takes two of the fighter's three weapon slots. Unwieldy weapons also take two slots (the FAQ confirms the two marks are independent: some weapons are Unwieldy without a `*` and vice versa).
- Credit costs are credits as bought in a starting gang from that fighter's own equipment list. A cost in brackets in the matrices means Trading Post only (campaign; not available to a skirmish starting gang). A `-` means the fighter cannot have it.
- Source tags in each table caption use the keys above.

## 1. Rules shared by all gangs

Source: ND (Founding a Gang, p.97 to 99), GH-CH, GH-HOB, GY rule tags, FAQ.

### 1.1 Founding a gang

- Starting budget 1000 credits (skirmish quick-start). Unspent credits are simply left over; there is no upper limit on the number of fighters.
- Exactly one Leader. If the Leader is lost, a replacement is chosen in this order: Champions first, then Specialists, then any other fighter; ties go to the higher Leadership, then to more advancements.
- At least half of the gang must be Gang Fighters (Gangers, Specialist Gangers, Juves, Prospects). Hangers-on and Hired Guns do not count either way. Exotic beasts bought as wargear (Sumpkroc, Phelynx, Phyrr cat) are not counted at all (FAQ).
- At most one Ganger may be upgraded to a Specialist Ganger when the gang is founded.
- No per-type cap on Champions is stated for the base Goliath and Escher lists (the 0-1 and 0-2 caps seen in 2026 articles belong to variant gangs). In practice the half-Gang-Fighters rule is the limit. See ruling 'Champion caps' in `docs/needs-rules-check.md`.
- A fighter carries at most three weapons (slots). Unwieldy weapons, and weapons marked `*`, take two slots. Wargear (armour, grenades, equipment) does not use slots. A fighter may wear one standard armour plus one combined armour (for example Furnace plates or Mesh plus an Armoured undersuit).
- Armour is not included in any fighter cost; it is bought separately. Leaders and Champions start with one free skill chosen from one of their Primary skill sets (included in the cost). Prospects, Juves and Gangers start with no skills.
- Weapon restrictions per type are given in each fighter's stat block as a list of allowed weapon classes (Pistol, Basic, Special, Heavy, Close Combat). A fighter may only start with items that appear on its own equipment list. The House of... books have no shared gang list (FAQ).

### 1.2 Fighter special rules that appear on the Goliath and Escher lists

| Rule | Effect (our words) | Source |
|---|---|---|
| Gang Hierarchy (Leader) / (Champion) | The fighter belongs to the gang's command structure. It may take post-battle actions (campaign only) and has Leading By Example, range 12" for a Leader and 6" for a Champion. | ND p.98, BC, GY tag |
| Leading By Example (X") | After the gang has bottled out, while models are testing Cool to avoid fleeing the battlefield in the End phase: if this fighter passes its own Cool test, every friendly model within X" passes automatically and stays. A Champion only helps fighters that do not themselves have Leading By Example. It is not stopped by Broken, Seriously Injured or Blaze. | ND p.49 and p.98 |
| Group Activation (X) | When this fighter is activated, up to X additional Ready friendly Faction fighters within 3" may be activated at the same time. Nominate all of them first, then resolve each fighter's activation fully, one after the other. A Leader or Champion that is activated this way cannot start its own group. A pet owner may bring all of its pets for free. Leader 2, Champion 1. | ND p.34 |
| Gang Leader | The one fighter the gang must always have. Carried by the Leader type. | ND p.97, GY tag Core p.85 |
| Tools of the Trade | Campaign rule: the fighter may keep several equipment sets and one is used per battle. No effect when a gang has one set (always true for the v1 skirmish). | BC, GY tag Core p.85 |
| Gang Fighter (Ganger / Juve / Prospect) | Counts towards the "at least half the gang" rule. | GH-CH, ND |
| Fast Learner | Campaign rule that makes Juves and Prospects advance more cheaply. No skirmish effect. Text not seen in any source (ruling 'Campaign rule texts' in `docs/needs-rules-check.md`). | GY, YT |
| Hot-headed | When this fighter becomes Seriously Injured or goes Out of Action, friendly fighters do NOT take a Nerve test because of it (fighters of the same Hot-headed type still do). | ND p.48 and p.98, GH-CH |
| Promotion (...) | Campaign rule naming what the fighter becomes after enough advancements. No skirmish effect. | GY |

### 1.3 Bottle and nerve basics used by these rules

- Nerve test: when a friendly fighter within range becomes Seriously Injured or goes Out of Action, a fighter tests Cool, with +1 for each other friendly non-Broken, non-Seriously-Injured fighter within 3". A failed test makes it Broken. Source: ND p.48.
- Bottle test (End phase): roll a D6 and add the number of the gang's models that are Seriously Injured or Out of Action; if the total is higher than the number of models in the starting crew, the gang has bottled out. Source: ND p.49.

### 1.4 Combat Chems Stash, Poison Blood and other fighter-specific rules

They are listed with the fighter that owns them in sections 2 and 3.


## 2. House Goliath (House of Chains list, "Goliath (HoC)")

### 2.1 Fighter types

Source: GY (modal base profile over the 328 unadvanced Goliath fighter cards found), ND p.115, GH-CH, GH-GOL; independently YT for the Forge Tyrant (M4 WS3 BS3 S4 T4 W2 I3 A3 Ld5 Cl4 Wil8 Int7, base 135) and the Goonhammer review for the changes versus the old list. All 14 base profiles agree across GY, ND and the GY seed data.

| Type (rank) | Cost | M | WS | BS | S | T | W | I | A | Ld | Cl | Wil | Int | Weapon classes | Rules |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Forge Tyrant (Leader) | 135 | 4" | 3+ | 3+ | 4 | 4 | 2 | 3+ | 3 | 5+ | 4+ | 8+ | 7+ | all | Gang Hierarchy (Leader), Gang Leader, Group Activation (2), Tools of the Trade |
| Stimmer (Champion) | 125 | 4" | 2+ | 4+ | 4 | 4 | 2 | 3+ | 3 | 8+ | 4+ | 7+ | 8+ | Pistol, Heavy, Close Combat | Combat Chems Stash, Gang Hierarchy (Champion), Tools of the Trade (no Group Activation) |
| Forge Boss (Champion) | 100 | 4" | 3+ | 4+ | 4 | 4 | 2 | 4+ | 2 | 6+ | 5+ | 8+ | 8+ | all | Gang Hierarchy (Champion), Group Activation (1), Tools of the Trade |
| Bruiser (Ganger) | 55 | 4" | 4+ | 4+ | 4 | 4 | 1 | 4+ | 1 | 8+ | 5+ | 9+ | 8+ | Pistol, Basic, Close Combat | Gang Fighter (Ganger), Promotion (Goliath Specialist) |
| Bruiser (Specialist) (Ganger) | 55 | 4" | 4+ | 4+ | 4 | 4 | 1 | 4+ | 1 | 8+ | 5+ | 9+ | 8+ | Pistol, Basic, Special, Close Combat | Gang Fighter (Ganger), Promotion (Goliath Specialist), Tools of the Trade |
| Bully (Juve) | 35 | 4" | 4+ | 5+ | 4 | 4 | 1 | 4+ | 1 | 9+ | 7+ | 9+ | 9+ | Pistol, Close Combat | Fast Learner, Gang Fighter (Juve), Promotion (Goliath Specialist) |
| Forge-born (Prospect) | 35 | 5" | 4+ | 5+ | 3 | 4 | 1 | 4+ | 1 | 9+ | 7+ | 9+ | 9+ | Pistol, Special, Close Combat | Fast Learner, Gang Fighter (Prospect), Hot-headed, Promotion (Goliath Forge Boss or Stimmer), Tools of the Trade |

Notes on the table:
- The Bruiser (Specialist) has the same profile and cost as a Bruiser; the difference is access to Special weapons, Tools of the Trade, and the ability to take advancements. Only one may be in a starting gang.
- Forge-born restrictions read "Special" because their signature weapon, the storm-welder, is a Special weapon; they otherwise only get pistols and melee weapons (also GH-GOL, BC).
- A Stimmer has no Group Activation (ND p.115, GH-GOL).
- Goliaths have +1 S and +1 T and -1 M compared with an ordinary human. A Bully has the Bruiser's S4 T4 but Cool 7+ against the Bruiser's 5+; a Forge-born trades a point of Strength (S3) for 5" Movement (GH-CH, GH-GOL).
- Gene-smithing may modify these base profiles at recruitment (section 2.5).

### 2.2 Gang composition for a starting Goliath gang

Source: ND p.97 and p.114 to p.116, GH-CH, GH-GOL. See ruling 'Champion caps' in `docs/needs-rules-check.md` for the missing Champion cap.

| Slot | Limit in a new gang |
|---|---|
| Forge Tyrant | exactly 1 |
| Forge Boss, Stimmer | no cap printed in the sources; limited only by the half-Gang-Fighters rule |
| Bruiser (Specialist) | 0 or 1 |
| Bruiser, Bully, Forge-born | unlimited; each counts as a Gang Fighter |
| Sumpkroc (pet) | 0 or 1 per Forge Tyrant, Forge Boss or Stimmer; does not count as a fighter |
| Weapon slots | 3 per fighter; `*` and Unwieldy items take 2 |

### 2.3 Skill sets

Source: ND p.118 (access table), GH-GOL, GH-CH. P = Primary, S = Secondary, - = no access. Leaders and Champions pick their free starting skill from a Primary set. Gangers without the Specialist tag have no skill access at all.

| Type | Agility | Brawn | Combat | Cunning | Ferocity | Leadership | Savant | Shooting | Muscle |
|---|---|---|---|---|---|---|---|---|---|
| Forge Tyrant | - | P | S | - | P | P | - | S | S |
| Stimmer | - | S | S | - | P | - | - | - | P |
| Forge Boss | - | P | S | - | P | S | - | S | S |
| Bruiser (Specialist) | - | P | S | - | P | - | - | S | - |
| Bully | S | S | - | - | P | - | - | - | - |
| Forge-born | S | - | P | - | - | - | - | S | - |

Skill descriptions for every skill a Goliath can take as a starting skill are in section 7.

### 2.4 Special rules owned by single types

- **Combat Chems Stash (Stimmer and 'Zerker):** when activated, roll a D6 for the round. 1 sets the fighter's Attacks to 1; 2 gives +1 Attack; 3 or 4 gives +2; 5 or 6 gives +3. The bonus lasts until the end of the round and stacks with Paired weapons because it raises the Attacks characteristic. Source: ND p.115 and GH-GOL (which describes the same thing as a D3 roll with a natural 1 being the failure).
- **Furnace plates, Stimm-slug stash and the other Goliath wargear:** see section 6.
- **Sumpkroc (pet):** profile and rules in section 2.6.

### 2.5 House rule: Gene-smithing

Source: ND p.116 and p.118; spot-checked against GH-CH and GH-GOL (Natborn +20, Unborn +10, Dermal Hardening +1 T for 10, Iron Flesh Natborn total 30, The Tyrant's Own +20, Reduced Bone Density -10 all match). It only changes a fighter's profile and cost when the fighter is recruited, so it is optional for the quick-start gangs below (they use none).

How it works:
- When a fighter is added to the gang it may be given one origin: Vatborn (default, +0), Natborn (+20), or Unborn (+10).
- Leaders and Champions may then take 0 to 2 upgrades from the chosen origin; Gangers, Juves and Specialist Juves 0 or 1. Upgrades may carry a negative cost, which is subtracted from the fighter's cost.
- Changed characteristics become the fighter's base profile for advancement caps.
- Natborn: +2 Int, +1 Wil, -1 Cool. Unborn: gain one extra Primary skill set from Agility, Brawn, Combat, Cunning, Ferocity, Shooting or Savant (never Muscle). The campaign effect of Natborn on Strength and Toughness advancement cost is not used in skirmish.

| Origin | Upgrade | Effect | Cost |
|---|---|---|---|
| Vatborn | Reduced Bone Density | -1 T or -1 S | -10 |
| Vatborn | Terminal Biology | campaign: risk of dying on a Lasting Injury | -10 |
| Vatborn | Corrupt Slug | -1 Ld, -1 Wil, -1 Int | -5 |
| Vatborn | Nerve Burnout | -1 Cl | -5 |
| Vatborn | Fearless But Foolish | +1 Cl, -1 Int | +5 |
| Vatborn | Hardened Immune System | Gas and Toxin attacks only work on a 6 against this fighter | +5 |
| Vatborn | Overdeveloped Musculature | +1 S, -1 I | +5 |
| Vatborn | Dermal Hardening | +1 T | +10 |
| Vatborn | Genetic Ancient | +1 Ld, +1 Wil, +1 Int | +10 |
| Vatborn | Hyper Healing | extra Injury die on Recovery tests, choose which to use; campaign healing | +15 |
| Natborn | Tyrant's Pride | Leader only; the gang may not include Champions | -20 |
| Natborn | Over-Engineered | campaign: roll twice on Lasting Injury and take the higher | -10 |
| Natborn | Adaptive Mind | campaign: Secondary skill sets count as Primary when advancing | +5 |
| Natborn | Rapid Muscle Growth | campaign: up to +3 S from advancement | +5 |
| Natborn | Adaptive Biology | re-roll Strength and Toughness tests; Gas and Toxin hits must re-roll successes | +10 |
| Natborn | Iron Flesh | +1 W | +10 |
| Natborn | Prime Specimen | +1 to any one characteristic | +10 |
| Natborn | Redundant Organs | campaign: roll twice on Lasting Injury, take the lower | +15 |
| Natborn | Alpha's Lineage | Leadership skills count as Primary; Group Activation +1 | +20 |
| Natborn | The Tyrant's Own | Leader only; +1 to any two characteristics | +20 |
| Unborn | Data-Slug Overlay | first activation of the battle: pass Int or gain Insanity | -10 |
| Unborn | Doc's Failure | -1 to two of M, S, T, W | -10 |
| Unborn | Proto-Goliath | +1" M, -1 S, -1 T, -2 Cl, +2 Int, +1 Wil | -10 |
| Unborn | Genetic Outsider | Leader or Champion only (not a Specialist); cannot use Group Activation | -5 |
| Unborn | Doc's Experiment | choose two of M, S, T, W: +1 to one, -1 to the other | +5 |
| Unborn | Malformed | +1 S, -1 I | +5 |
| Unborn | Stimm Implant | when activated: +2 S for the round; in the End phase roll 4+ or take a Flesh Wound | +5 |
| Unborn | Two Lives | campaign: extra random skill when gaining a skill | +5 |
| Unborn | Scar Tissue | -1 Damage from every incoming hit (minimum 1) | +10 |
| Unborn | Survivor | re-roll one Injury die when making a Recovery test | +10 |

Three further entries in the compilation (Thermal Resistance, Enhanced Stamina, Unique Organ Transplant) are tagged for the Irontree Reavers variant and are skipped.

### 2.6 Goliath pets and brutes (not part of the 1000-credit quick-start gangs)

Source: GY (modal profiles), ND p.115, BC, GH-GOL.

| Entry | Cost | M | WS | BS | S | T | W | I | A | Ld | Cl | Wil | Int | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Sumpkroc (pet, 0-1 per Tyrant/Boss/Stimmer) | 130 | 4" | 3+ | - | 4 | 4 | 2 | 6+ | 2 | 8+ | 6+ | 7+ | 11+ | Weapon: ferocious jaws (E, S, AP -1, D1, Melee, Rending). Scaly hide: 5+ save. Counter-charge: once per round, while Active, when an enemy charges its owner, interrupt with a Charge (Double) against that enemy (including the free Fight), then the enemy continues its charge. |
| 'Zerker (Brute, 0-1; recruited as a Hanger-on style brute) | 210 | 4" | 3+ | 6+ | 6 | 5 | 3 | 5+ | 3 | 7+ | 6+ | 8+ | 10+ | Combat Chems Stash. Weapons: two open fists or the mutated fists and bone spurs upgrade (+70: E/2" Versatile, S+1, AP -2, D2, Knockback, Pulverise). Impetuous (consolidate 4"). Not a Gang Fighter. |

### 2.7 Goliath equipment lists

Source: ND p.116 and p.117 (matrix read cell by cell from the page), cross-checked against GY (costs observed on the same fighter types), GH-GOL (many individual costs and who can take what) and BC (Trading Post access). Where ND shows a cost in brackets the item is Trading Post only and is shown that way here.

#### Forge Tyrant (base 135 credits; weapon classes: any weapon class)

| Category | Item | Credits | Note |
|---|---|---|---|
| Pistols | Bolt pistol | 45 |  |
| Pistols | Hand flamer | 75 |  |
| Pistols | Stub gun | 5 |  |
| Pistols | - Dumdum rounds | 5 | ammo or upgrade for the item above, bought in addition |
| Pistols | Bolt pistol / hand flamer (combi) | 110 |  |
| Pistols | Bolt pistol / plasma pistol (combi) | 80 |  |
| Pistols | Stub gun / plasma pistol (combi) | 40 |  |
| Basic weapons | Boltgun | 55 |  |
| Basic weapons | Combat shotgun (salvo & shredder) | 60 |  |
| Basic weapons | Shotgun (solid & scatter) | 30 |  |
| Basic weapons | - Execution | 20 | ammo or upgrade for the item above, bought in addition |
| Basic weapons | - Inferno | 15 | ammo or upgrade for the item above, bought in addition |
| Basic weapons | Stub cannon | 20 |  |
| Special weapons | Flamer | 140 |  |
| Special weapons | Grenade launcher (frag & krak) | 55 |  |
| Special weapons | - Smoke | 15 | ammo or upgrade for the item above, bought in addition |
| Special weapons | - Stun rounds | 15 | ammo or upgrade for the item above, bought in addition |
| Special weapons | Melta gun | 135 |  |
| Special weapons | Bolter / flamer (combi) | 175 |  |
| Special weapons | Bolter / grenade launcher (frag) (combi) | 80 |  |
| Special weapons | Bolter / melta (combi) | 165 |  |
| Special weapons | Bolter / plasma (combi) | 115 |  |
| Heavy weapons | Heavy bolter * | 160 | 2 weapon slots |
| Heavy weapons | Heavy flamer * | 195 | 2 weapon slots |
| Heavy weapons | Heavy stubber * | 130 | 2 weapon slots |
| Heavy weapons | 'Krumper' rivet cannon * | 70 | 2 weapon slots |
| Heavy weapons | Missile launcher (frag & krak) * | 165 | 2 weapon slots |
| Heavy weapons | Multi-melta * | 180 | 2 weapon slots |
| Close combat weapons | Axe | 10 |  |
| Close combat weapons | Brute cleaver | 20 |  |
| Close combat weapons | Chainaxe | 25 |  |
| Close combat weapons | Chainsword | 25 |  |
| Close combat weapons | Knife | 10 |  |
| Close combat weapons | Maul (club) | 10 |  |
| Close combat weapons | Power axe | 35 |  |
| Close combat weapons | Power hammer | 45 |  |
| Close combat weapons | 'Renderizer' serrated axe * | 40 | 2 weapon slots |
| Close combat weapons | - Master-crafted | 10 | ammo or upgrade for the item above, bought in addition |
| Close combat weapons | Servo-claw | 35 |  |
| Close combat weapons | Spud-jacker | 15 |  |
| Close combat weapons | - Master-crafted | 5 | ammo or upgrade for the item above, bought in addition |
| Close combat weapons | Two-handed axe * | 25 | 2 weapon slots |
| Close combat weapons | Two-handed hammer * | 35 | 2 weapon slots |
| Grenades | Blasting charges | 35 |  |
| Grenades | Frag | 30 |  |
| Grenades | Krak | 45 |  |
| Grenades | Smoke | 15 |  |
| Grenades | Stun | 25 | cost printed in red (unreliable) in ND; not used in starter gangs |
| Armour | Armoured undersuit | 25 |  |
| Armour | Carapace - light | 80 |  |
| Armour | + Heavy | 100 | variant or upgrade of the item above |
| Armour | Furnace plates | 5 |  |
| Equipment | Bio-booster | 35 |  |
| Equipment | Drop-rig | 10 |  |
| Equipment | Filter plugs | 10 |  |
| Equipment | Photo-goggles | 35 |  |
| Equipment | Respirator | 15 |  |
| Equipment | Skinblade | 10 |  |
| Equipment | Stimm-slug stash | 25 |  |
| Pets (status items) | Sumpkroc (0-1) | 130 |  |
| Weapon accessories | Gunshroud (Pistol, Basic) | 20 |  |
| Weapon accessories | Suspensor (Unwieldy) | 60 |  |
| Weapon accessories | Telescopic sight (Pistol, Basic, Special) ** | 25 | maximum one gunsight per weapon |

#### Stimmer (base 125 credits; weapon classes: Pistol, Heavy, Close Combat)

| Category | Item | Credits | Note |
|---|---|---|---|
| Pistols | Stub gun | 5 |  |
| Pistols | - Dumdum rounds | 5 | ammo or upgrade for the item above, bought in addition |
| Heavy weapons | Twin-linked assault grenade launcher (frag & stun) * | 65 | 2 weapon slots |
| Heavy weapons | - Krak | 30 | ammo or upgrade for the item above, bought in addition |
| Heavy weapons | - Smoke | 20 | ammo or upgrade for the item above, bought in addition |
| Close combat weapons | Knife | 10 |  |
| Close combat weapons | 'Pulveriser' serrated axe | 30 |  |
| Close combat weapons | - Master-crafted | 10 | ammo or upgrade for the item above, bought in addition |
| Close combat weapons | Paired 'Pulveriser' serrated axe * | 50 | 2 weapon slots |
| Close combat weapons | - Master-crafted | 10 | ammo or upgrade for the item above, bought in addition |
| Close combat weapons | 'Renderizer' serrated axe * | 40 | 2 weapon slots |
| Close combat weapons | - Master-crafted | 10 | ammo or upgrade for the item above, bought in addition |
| Close combat weapons | Spud-jacker | 15 |  |
| Close combat weapons | - Master-crafted | 5 | ammo or upgrade for the item above, bought in addition |
| Close combat weapons | Paired Spud-jacker * | 25 | 2 weapon slots |
| Close combat weapons | - Master-crafted | 10 | ammo or upgrade for the item above, bought in addition |
| Grenades | Frag | 30 |  |
| Grenades | Incendiary | 40 |  |
| Grenades | Krak | 45 |  |
| Grenades | Melta bombs | 60 |  |
| Grenades | Smoke | 15 |  |
| Grenades | Stun | 25 | cost printed in red (unreliable) in ND; not used in starter gangs |
| Armour | Armoured undersuit | 25 |  |
| Armour | Furnace plates | 5 |  |
| Equipment | Bio-booster | 35 |  |
| Equipment | Drop-rig | 10 |  |
| Equipment | Respirator | 15 |  |
| Equipment | Skinblade | 10 |  |
| Equipment | Stimm-slug stash | 25 |  |
| Pets (status items) | Sumpkroc (0-1) | 130 |  |

Trading Post only (campaign, not for a starting gang): Axe (10); Maul (club) (10); Two-handed axe * (25); Two-handed hammer * (35); Filter plugs (10); Telescopic sight (Pistol, Basic, Special) ** (25).

#### Forge Boss (base 100 credits; weapon classes: any weapon class)

| Category | Item | Credits | Note |
|---|---|---|---|
| Pistols | Bolt pistol | 45 |  |
| Pistols | Hand flamer | 75 |  |
| Pistols | Stub gun | 5 |  |
| Pistols | - Dumdum rounds | 5 | ammo or upgrade for the item above, bought in addition |
| Pistols | Bolt pistol / hand flamer (combi) | 110 |  |
| Pistols | Bolt pistol / plasma pistol (combi) | 80 |  |
| Pistols | Stub gun / plasma pistol (combi) | 40 |  |
| Basic weapons | Boltgun | 55 |  |
| Basic weapons | Combat shotgun (salvo & shredder) | 60 |  |
| Basic weapons | Shotgun (solid & scatter) | 30 |  |
| Basic weapons | Stub cannon | 20 |  |
| Special weapons | Flamer | 140 |  |
| Special weapons | Grenade launcher (frag & krak) | 55 |  |
| Special weapons | - Smoke | 15 | ammo or upgrade for the item above, bought in addition |
| Special weapons | - Stun rounds | 15 | ammo or upgrade for the item above, bought in addition |
| Special weapons | Melta gun | 135 |  |
| Special weapons | Bolter / flamer (combi) | 175 |  |
| Special weapons | Bolter / grenade launcher (frag) (combi) | 80 |  |
| Special weapons | Bolter / melta (combi) | 165 |  |
| Special weapons | Bolter / plasma (combi) | 115 |  |
| Heavy weapons | Heavy bolter * | 160 | 2 weapon slots |
| Heavy weapons | Heavy flamer * | 195 | 2 weapon slots |
| Heavy weapons | Heavy stubber * | 130 | 2 weapon slots |
| Heavy weapons | 'Krumper' rivet cannon * | 70 | 2 weapon slots |
| Heavy weapons | Missile launcher (frag & krak) * | 165 | 2 weapon slots |
| Heavy weapons | Multi-melta * | 180 | 2 weapon slots |
| Close combat weapons | Axe | 10 |  |
| Close combat weapons | Brute cleaver | 20 |  |
| Close combat weapons | Chainaxe | 25 |  |
| Close combat weapons | Chainsword | 25 |  |
| Close combat weapons | Knife | 10 |  |
| Close combat weapons | Maul (club) | 10 |  |
| Close combat weapons | Power axe | 35 |  |
| Close combat weapons | Power hammer | 45 |  |
| Close combat weapons | 'Renderizer' serrated axe * | 40 | 2 weapon slots |
| Close combat weapons | - Master-crafted | 10 | ammo or upgrade for the item above, bought in addition |
| Close combat weapons | Servo-claw | 35 |  |
| Close combat weapons | Spud-jacker | 15 |  |
| Close combat weapons | - Master-crafted | 5 | ammo or upgrade for the item above, bought in addition |
| Close combat weapons | Two-handed axe * | 25 | 2 weapon slots |
| Close combat weapons | Two-handed hammer * | 35 | 2 weapon slots |
| Grenades | Blasting charges | 35 |  |
| Grenades | Frag | 30 |  |
| Grenades | Krak | 45 |  |
| Grenades | Smoke | 15 |  |
| Grenades | Stun | 15 | cost printed in red (unreliable) in ND; not used in starter gangs |
| Armour | Armoured undersuit | 25 |  |
| Armour | Carapace - light | 80 |  |
| Armour | Furnace plates | 5 |  |
| Equipment | Bio-booster | 35 |  |
| Equipment | Drop-rig | 10 |  |
| Equipment | Filter plugs | 10 |  |
| Equipment | Photo-goggles | 35 |  |
| Equipment | Respirator | 15 |  |
| Equipment | Skinblade | 10 |  |
| Equipment | Stimm-slug stash | 25 |  |
| Pets (status items) | Sumpkroc (0-1) | 130 |  |
| Weapon accessories | Gunshroud (Pistol, Basic) | 20 |  |
| Weapon accessories | Suspensor (Unwieldy) | 60 |  |
| Weapon accessories | Telescopic sight (Pistol, Basic, Special) ** | 25 | maximum one gunsight per weapon |

#### Bruiser (base 55 credits; weapon classes: Pistol, Basic, Close Combat)

| Category | Item | Credits | Note |
|---|---|---|---|
| Pistols | Bolt pistol | 45 |  |
| Pistols | Hand flamer | 75 |  |
| Pistols | Stub gun | 5 |  |
| Pistols | - Dumdum rounds | 5 | ammo or upgrade for the item above, bought in addition |
| Basic weapons | Boltgun | 55 |  |
| Basic weapons | Combat shotgun (salvo & shredder) | 60 |  |
| Basic weapons | Shotgun (solid & scatter) | 30 |  |
| Basic weapons | Stub cannon | 20 |  |
| Close combat weapons | Axe | 10 |  |
| Close combat weapons | Brute cleaver | 20 |  |
| Close combat weapons | Knife | 10 |  |
| Close combat weapons | Maul (club) | 10 |  |
| Close combat weapons | Spud-jacker | 15 |  |
| Close combat weapons | Two-handed axe * | 25 | 2 weapon slots |
| Close combat weapons | Two-handed hammer * | 35 | 2 weapon slots |
| Grenades | Frag | 30 |  |
| Grenades | Incendiary | 40 |  |
| Grenades | Krak | 45 |  |
| Grenades | Smoke | 15 |  |
| Armour | Armoured undersuit | 25 |  |
| Armour | Furnace plates | 5 |  |
| Equipment | Drop-rig | 10 |  |
| Equipment | Filter plugs | 10 |  |
| Equipment | Photo-goggles | 35 |  |
| Equipment | Respirator | 15 |  |
| Equipment | Stimm-slug stash | 25 |  |
| Weapon accessories | Telescopic sight (Pistol, Basic, Special) ** | 25 | maximum one gunsight per weapon |

Trading Post only (campaign, not for a starting gang): Skinblade (10).

#### Bruiser (Specialist) (base 55 credits; weapon classes: Pistol, Basic, Special, Close Combat)

| Category | Item | Credits | Note |
|---|---|---|---|
| Pistols | Bolt pistol | 45 |  |
| Pistols | Hand flamer | 75 |  |
| Pistols | Stub gun | 5 |  |
| Pistols | - Dumdum rounds | 5 | ammo or upgrade for the item above, bought in addition |
| Basic weapons | Boltgun | 55 |  |
| Basic weapons | Combat shotgun (salvo & shredder) | 60 |  |
| Basic weapons | Shotgun (solid & scatter) | 30 |  |
| Basic weapons | Stub cannon | 20 |  |
| Special weapons | Flamer | 140 |  |
| Special weapons | Grenade launcher (frag & krak) | 55 |  |
| Special weapons | - Smoke | 15 | ammo or upgrade for the item above, bought in addition |
| Special weapons | - Stun rounds | 15 | ammo or upgrade for the item above, bought in addition |
| Special weapons | Melta gun | 135 |  |
| Close combat weapons | Axe | 10 |  |
| Close combat weapons | Brute cleaver | 20 |  |
| Close combat weapons | Knife | 10 |  |
| Close combat weapons | Maul (club) | 10 |  |
| Close combat weapons | Spud-jacker | 15 |  |
| Close combat weapons | Two-handed axe * | 25 | 2 weapon slots |
| Close combat weapons | Two-handed hammer * | 35 | 2 weapon slots |
| Grenades | Frag | 30 |  |
| Grenades | Incendiary | 40 |  |
| Grenades | Krak | 45 |  |
| Grenades | Smoke | 15 |  |
| Armour | Armoured undersuit | 25 |  |
| Armour | Furnace plates | 5 |  |
| Equipment | Drop-rig | 10 |  |
| Equipment | Filter plugs | 10 |  |
| Equipment | Photo-goggles | 35 |  |
| Equipment | Respirator | 15 |  |
| Equipment | Stimm-slug stash | 25 |  |
| Weapon accessories | Telescopic sight (Pistol, Basic, Special) ** | 25 | maximum one gunsight per weapon |

Trading Post only (campaign, not for a starting gang): Skinblade (10).

#### Bully (base 35 credits; weapon classes: Pistol, Close Combat)

| Category | Item | Credits | Note |
|---|---|---|---|
| Pistols | Stub gun | 5 |  |
| Pistols | - Dumdum rounds | 5 | ammo or upgrade for the item above, bought in addition |
| Close combat weapons | Axe | 10 |  |
| Close combat weapons | Brute cleaver | 20 |  |
| Close combat weapons | Knife | 10 |  |
| Close combat weapons | Maul (club) | 10 |  |
| Close combat weapons | Spud-jacker | 15 |  |
| Grenades | Frag | 30 |  |
| Grenades | Incendiary | 40 |  |
| Grenades | Krak | 45 |  |
| Grenades | Smoke | 15 |  |
| Armour | Armoured undersuit | 25 |  |
| Armour | Furnace plates | 5 |  |
| Equipment | Drop-rig | 10 |  |
| Equipment | Filter plugs | 10 |  |
| Equipment | Stimm-slug stash | 25 |  |

Trading Post only (campaign, not for a starting gang): Respirator (15); Skinblade (10); Telescopic sight (Pistol, Basic, Special) ** (25).

#### Forge-born (base 35 credits; weapon classes: Pistol, Special, Close Combat)

| Category | Item | Credits | Note |
|---|---|---|---|
| Pistols | Stub gun | 5 |  |
| Pistols | - Dumdum rounds | 5 | ammo or upgrade for the item above, bought in addition |
| Special weapons | Storm-welder * | 75 | 2 weapon slots |
| Close combat weapons | Heavy rock saw * | 120 | 2 weapon slots |
| Close combat weapons | Knife | 10 |  |
| Grenades | Frag | 30 |  |
| Grenades | Incendiary | 40 |  |
| Grenades | Krak | 45 |  |
| Grenades | Smoke | 15 |  |
| Armour | Armoured undersuit | 25 |  |
| Armour | Furnace plates | 5 |  |
| Equipment | Bio-booster | 35 |  |
| Equipment | Filter plugs | 10 |  |

Trading Post only (campaign, not for a starting gang): Axe (10); Maul (club) (10); Two-handed axe * (25); Two-handed hammer * (35); Drop-rig (10); Respirator (15); Skinblade (10); Telescopic sight (Pistol, Basic, Special) ** (25).


Reading note: the compilation's Special-weapon rows for the Ganger column are Specialist-only (marked G(S) on the page), so the plain Bruiser has none of them. ND shows the Stimmer's Trading Post access as including Special weapons although the Stimmer's own restriction line says Pistol, Heavy and Close Combat; BC and GH-CH agree with the restriction line, so Stimmers are treated as unable to carry Special weapons (see ruling 'Stimmer special weapons').


## 3. House Escher (House of Blades list, "Escher (HoB)")

### 3.1 Fighter types

Source: GY (modal base profile over the 986 unadvanced Escher fighter cards found), ND p.112, GH-HOB, GH-ESC; independently YT for the Wyld Runner (M6 WS4 BS4 S2 T3 W1 I3 A1 Ld9 Cl7 Wil9 Int9, base 45) and GH-ESC for the Sister (a Sister with flak and a lasgun comes to 65, so 50 + 10 + 5). All 14 base profiles agree across GY, ND and the GY seed data. GH-HOB: every Escher fighter has +1 Cool compared with the old list, and costs went up 5 credits for Queen and Matriarch (armour is no longer included).

| Type (rank) | Cost | M | WS | BS | S | T | W | I | A | Ld | Cl | Wil | Int | Weapon classes | Rules |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Queen (Leader) | 125 | 5" | 3+ | 3+ | 3 | 3 | 2 | 2+ | 3 | 5+ | 5+ | 6+ | 7+ | all | Gang Hierarchy (Leader), Gang Leader, Group Activation (2), Tools of the Trade |
| Death-Maiden (Champion, Specialist) | 115 | 6" | 2+ | 3+ | 3 | 4 | 2 | 2+ | 3 | 8+ | 4+ | 7+ | 7+ | Pistol, Close Combat | Gang Hierarchy (Champion), Poison Blood, Tools of the Trade (no Group Activation) |
| Matriarch (Champion) | 100 | 5" | 3+ | 3+ | 3 | 3 | 2 | 2+ | 2 | 6+ | 6+ | 6+ | 6+ | all | Gang Hierarchy (Champion), Group Activation (1), Tools of the Trade |
| Sister (Ganger) | 50 | 5" | 4+ | 4+ | 3 | 3 | 1 | 3+ | 1 | 7+ | 7+ | 7+ | 7+ | Pistol, Basic, Close Combat | Gang Fighter (Ganger), Promotion (Escher Specialist) |
| Sister (Specialist) (Ganger) | 50 | 5" | 4+ | 4+ | 3 | 3 | 1 | 3+ | 1 | 7+ | 7+ | 7+ | 7+ | Pistol, Basic, Special, Close Combat | Gang Fighter (Ganger), Promotion (Escher Specialist), Tools of the Trade |
| Little Sister (Juve) | 20 | 5" | 4+ | 5+ | 3 | 3 | 1 | 3+ | 1 | 8+ | 8+ | 8+ | 8+ | Pistol, Basic, Close Combat | Fast Learner, Gang Fighter (Juve), Promotion (Escher Specialist) |
| Wyld Runner (Prospect) | 45 | 6" | 4+ | 4+ | 2 | 3 | 1 | 3+ | 1 | 9+ | 7+ | 9+ | 9+ | Pistol, Basic, Close Combat | Fast Learner, Gang Fighter (Prospect), Hot-headed, Promotion (Escher Gang Matriarch only), Tools of the Trade |

Notes on the table:
- The Sister (Specialist) has the same profile and cost as a Sister; the difference is access to Special weapons, Tools of the Trade and advancements. At most one in a starting gang.
- The Death-Maiden is a Champion (Specialist): it has no Group Activation, and only she has Finesse as a Primary skill set.
- The Queen's cost in the GY seed file is filed under the wrong rank (Champion); ND, GY cards and GH-HOB all treat her as the Leader.
- FAQ: the Wyld Runner, when promoted to Matriarch, also loses Gang Fighter (Prospect) (campaign only).

### 3.2 Gang composition for a starting Escher gang

Source: ND p.97 and p.112 to p.114, GH-HOB, GH-ESC, FAQ.

| Slot | Limit in a new gang |
|---|---|
| Queen | exactly 1 |
| Matriarch, Death-Maiden | no cap printed in the sources; limited only by the half-Gang-Fighters rule |
| Sister (Specialist) | 0 or 1 |
| Sister, Little Sister, Wyld Runner | unlimited; each counts as a Gang Fighter |
| Phelynx (pet) | 0 to 3 per Wyld Runner; does not count as a fighter |
| Phyrr cat (pet) | 0 to 2 per Queen, Matriarch or Death-Maiden; does not count as a fighter |
| Weapon slots | 3 per fighter; `*` and Unwieldy items take 2 |

### 3.3 Skill sets

Source: ND p.112 (access table), GH-ESC. P = Primary, S = Secondary, - = no access. Finesse is the Escher-only skill set. Sisters and Little Sisters without a Specialist tag have no skill access.

| Type | Agility | Brawn | Combat | Cunning | Ferocity | Leadership | Savant | Shooting | Finesse |
|---|---|---|---|---|---|---|---|---|---|
| Queen | P | - | P | S | S | P | - | - | S |
| Death-Maiden | P | - | S | - | S | - | - | - | P |
| Matriarch | P | - | P | S | S | S | - | - | S |
| Sister (Specialist) | P | - | P | S | S | - | - | - | - |
| Wyld Runner | P | - | S | S | - | - | - | - | - |
| Little Sister | P | - | S | S | - | - | - | - | - |

Skill descriptions for every skill an Escher can take as a starting skill are in section 7.

### 3.4 Special rules owned by single types

- **Poison Blood (Death-Maiden):** a Death-Maiden may re-roll natural 1s on the Toughness roll of any Toxin weapon she uses (the die is rolled before modifiers). Source: ND p.112 and GY tag (Blades p.36). One fan source for the text; see ruling 'Poison Blood'.
- **Pets:** the Wyld Runner's Phelynx and the Phyrr cat are bought as wargear (section 3.6).
- **Chem-alchemy:** the Escher house rule, section 3.5.

### 3.5 House rule: Chem-alchemy

Source: ND p.78 and p.79 (effect lists, costs), GH-HOB, GH-ESC, FAQ.

Chem-alchemy lets an Escher gang assemble its own doses. It is a Trading Post facility (bought between games, with no rarity roll), so it is not available to a starting gang (GH-ESC states this outright; ND calls the doses "Common" at the Trading Post). It is therefore out of the 1000-credit quick-start gangs and optional for v1. If added later:

- A dose has 1 to 3 effects of one kind. The price is the sum of its effects. A dose lasts one battle and is declared before the battle after crews are chosen.
- Kinds: Stimm (a wargear dose for the user, or for a friendly fighter in base contact via a Simple action), Gaseous Ammo (changes one weapon that has the Gas trait), Toxic Ammo (changes one weapon that has the Toxin trait). FAQ: Gaseous or Toxic Ammo may be applied to only one of the fighter's weapons.
- The Apprentice Clan Chymist (a Hanger-on, not in the starting gang) discounts doses by 10 to 60 credits to a minimum of 10 (GH-ESC).

| Kind | Effect | Cost | What it does (our words) |
|---|---|---|---|
| Stimm | Bad Blood | 10 | when this fighter loses Wounds or Flesh Wounds, every fighter in base contact must pass an Initiative test or take a Toxin hit |
| Stimm | Blood Rush | 15 | on application, remove a Flesh Wound or recover from Seriously Injured |
| Stimm | Brain Lock | 15 | counts as a Psyker only for disrupting enemy psychic powers |
| Stimm | Dreamland | 10 | ignores Insanity |
| Stimm | Hyper | 20 | +2" M, charge bonus rolled on a D6 instead of a D3, -1 to hit |
| Stimm | Ice Cold | 15 | +2 to Cool tests |
| Stimm | Jolt | 30 | Serious Injuries count as Flesh Wounds until the end of the round applied |
| Stimm | Night Night | 25 | when going Out of Action, apply Out Cold automatically (no Lasting Injury roll); capture still possible |
| Stimm | Predator's Kiss | 45 | needs an Apprentice Clan Chymist; +1 S in close combat, melee weapons Reckless, includes Blood Rush and Hyper; cannot be combined |
| Stimm | Puke | 15 | Toughness counts double against Toxin and Gas |
| Stimm | Wide-eye | 10 | ignores Pitch Black effects |
| Gas ammo | Acidic | 20 | no armour or wargear bonus may raise Toughness vs the gas; Out of Action becomes Seriously Injured |
| Gas ammo | Bane | 15 | use Toughness 3 vs the gas (equipment modifiers still apply) |
| Gas ammo | Blackout | 30 | Serious Injuries count as Out of Action and the Lasting Injury is Out Cold |
| Gas ammo | Blinding | 10 | inflicting a Flesh Wound also blinds until the End phase |
| Gas ammo | Expansive | 20 | an extra Blast marker (needs Blast) |
| Gas ammo | Hallucinogen | 15 | also pass a Willpower test or gain Insanity |
| Gas ammo | Leaden | 30 | after the attack a 3" Blast stays until the End phase; fighters moving through count as hit |
| Gas ammo | Liftin' | 25 | template can start up to 6" from the user (needs Template) |
| Gas ammo | Pathogenic | 15 | hit fighter rolls 3+ at its next activation or suffers the gas again |
| Gas ammo | Pyrophoric | 20 | gains Blaze |
| Toxic ammo | Bleeding | 10 | an injured target takes a Flesh Wound at the start of the End phase (cumulative) |
| Toxic ammo | Blood Boil | 30 | needs an Apprentice Clan Chymist; +1 to the Toxin roll, explodes into a Gas blast and makes the target Reckless; cannot be combined |
| Toxic ammo | Concentrated | 15 | +2 to the Toxin roll, first hit only |
| Toxic ammo | Debilitating | 10 | -1 to all characteristic tests per injury, until the end of the battle |
| Toxic ammo | Decaying | 5 | -1 to saves per injury, until the end of the battle |
| Toxic ammo | Exploding | 20 | a victim taken Out of Action detonates in a 3" Gas blast |
| Toxic ammo | Maddening | 5 | an injured target becomes Reckless |
| Toxic ammo | Maiming | 10 | a victim taken Out of Action suffers two Lasting Injury rolls, attacker chooses |
| Toxic ammo | Panicking | 10 | an injured target is immediately Broken |
| Toxic ammo | Paralysing | 5 | an injured target passes a Strength test or is Webbed |
| Toxic ammo | Silencing | 5 | an injured target cannot give or take part in Group Activations |
| Toxic ammo | Skin Fire | 25 | needs an Apprentice Clan Chymist; Blaze on 4+, plus Debilitating and Decaying; cannot be combined |

### 3.6 Escher pets (not part of the 1000-credit quick-start gangs)

Source: GY (modal profiles), ND p.112, FAQ (Phyrr cat price corrected to 120), GH-ESC.

| Entry | Cost | M | WS | BS | S | T | W | I | A | Ld | Cl | Wil | Int | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Phelynx (0-3 per Wyld Runner) | 50 | 6" | 4+ | - | 3 | 3 | 1 | 3+ | 2 | 10+ | 7+ | 9+ | 11+ | Unarmed attacks only. Venomous Bite: a to-hit roll of 6 (before modifiers) also applies Toxin. Untamed: all its attacks are Reckless. |
| Phyrr cat (0-2) | 120 | 7" | 3+ | - | 3 | 3 | 1 | 2+ | 2 | 7+ | 8+ | 7+ | 8+ | Talons: E, S, AP -1, D2, Melee, Pulverise. Independent: must stay within 9" of its owner instead of 3". Lands On Their Feet: -2 S to falling damage. |

The Khimerix (Brute, 220) and the Apprentice Clan Chymist and Shivver (Hangers-on) belong to campaign recruitment and are not ported. The Cutter flying mount (85) and its twin-linked weapons are mounted-fighter rules and are excluded from v1.

### 3.7 Escher equipment lists

Source: ND p.113 and p.114 (matrix read cell by cell from the page), cross-checked against GY (costs seen on the same types), GH-ESC (which types may take each weapon), FAQ (Phyrr cat 120). Where ND shows a cost in brackets the item is Trading Post only.

#### Queen (base 125 credits; weapon classes: any weapon class)

| Category | Item | Credits | Note |
|---|---|---|---|
| Pistols | Autopistol | 10 |  |
| Pistols | Hand flamer | 75 |  |
| Pistols | Laspistol | 10 |  |
| Pistols | + With Hotshot las pack | 30 | variant or upgrade of the item above |
| Pistols | Needle pistol | 25 |  |
| Pistols | Plasma pistol | 50 |  |
| Pistols | Stub gun | 5 |  |
| Pistols | - Dumdum rounds | 5 | ammo or upgrade for the item above, bought in addition |
| Pistols | Bolt pistol / needle pistol (combi) | 60 |  |
| Basic weapons | Autogun | 15 |  |
| Basic weapons | Boltgun | 55 |  |
| Basic weapons | Lasgun | 5 |  |
| Basic weapons | + With Hotshot las pack | 25 | variant or upgrade of the item above |
| Basic weapons | Sawn-off shotgun (scatter) | 15 |  |
| Basic weapons | Shotgun (solid & scatter) | 30 |  |
| Basic weapons | - Acid rounds | 15 | ammo or upgrade for the item above, bought in addition |
| Basic weapons | Throwing knives | 5 |  |
| Special weapons | Chem-thrower 'Nightshade' | 135 |  |
| Special weapons | Flamer | 140 |  |
| Special weapons | Grenade launcher (frag & krak) | 55 |  |
| Special weapons | - Smoke | 15 | ammo or upgrade for the item above, bought in addition |
| Special weapons | Meltagun | 135 |  |
| Special weapons | Needle rifle | 35 |  |
| Special weapons | Plasma gun | 100 |  |
| Special weapons | Bolter / flamer (combi) | 180 |  |
| Special weapons | Bolter / melta (combi) | 170 |  |
| Special weapons | Bolter / needler (combi) | 80 |  |
| Special weapons | Bolter / plasma (combi) | 115 |  |
| Heavy weapons | Heavy stubber * | 130 | 2 weapon slots |
| Heavy weapons | Plasma cannon * | 130 | 2 weapon slots |
| Close combat weapons | Chainaxe | 30 |  |
| Close combat weapons | Chainsword | 25 |  |
| Close combat weapons | Knife | 15 |  |
| Close combat weapons | Power hammer | 45 |  |
| Close combat weapons | Power knife | 25 |  |
| Close combat weapons | Power sword | 45 |  |
| Close combat weapons | Servo claw | 35 |  |
| Close combat weapons | Shock whip | 25 |  |
| Close combat weapons | - Master-crafted | 10 | ammo or upgrade for the item above, bought in addition |
| Close combat weapons | Stiletto knife | 20 |  |
| Close combat weapons | Stiletto sword | 30 |  |
| Close combat weapons | - Master-crafted | 10 | ammo or upgrade for the item above, bought in addition |
| Grenades | Choke gas | 45 |  |
| Grenades | Frag | 30 |  |
| Grenades | Krak | 45 |  |
| Grenades | Photon flash flares | 15 |  |
| Grenades | Scare gas | 40 |  |
| Grenades | Smoke | 15 |  |
| Grenades | Stun | 25 |  |
| Armour | Armoured undersuit | 25 |  |
| Armour | Carapace (light) | 80 |  |
| Armour | Flak | 10 |  |
| Armour | Mesh | 15 |  |
| Equipment | Chem-synth | 15 |  |
| Equipment | Drop-rig | 10 |  |
| Equipment | Filter-plugs | 10 |  |
| Equipment | Photo-goggles | 35 |  |
| Equipment | Respirator | 15 |  |
| Equipment | Skinblade | 10 |  |
| Pets (status items) | Phyrr cat (0-2) | 120 |  |
| Weapon accessories | Gunshroud (Pistol, Basic) | 20 |  |
| Weapon accessories | Las-projector (Pistol, Basic, Special) | 35 |  |
| Weapon accessories | Suspensor (Unwieldy) | 60 |  |

Trading Post only (campaign, not for a starting gang): Whip (15).

#### Matriarch (base 100 credits; weapon classes: any weapon class)

| Category | Item | Credits | Note |
|---|---|---|---|
| Pistols | Autopistol | 10 |  |
| Pistols | Hand flamer | 75 |  |
| Pistols | Laspistol | 10 |  |
| Pistols | + With Hotshot las pack | 30 | variant or upgrade of the item above |
| Pistols | Needle pistol | 25 |  |
| Pistols | Plasma pistol | 50 |  |
| Pistols | Stub gun | 5 |  |
| Pistols | - Dumdum rounds | 5 | ammo or upgrade for the item above, bought in addition |
| Pistols | Bolt pistol / needle pistol (combi) | 60 |  |
| Basic weapons | Autogun | 15 |  |
| Basic weapons | Boltgun | 55 |  |
| Basic weapons | Lasgun | 5 |  |
| Basic weapons | + With Hotshot las pack | 25 | variant or upgrade of the item above |
| Basic weapons | Sawn-off shotgun (scatter) | 15 |  |
| Basic weapons | Shotgun (solid & scatter) | 30 |  |
| Basic weapons | - Acid rounds | 15 | ammo or upgrade for the item above, bought in addition |
| Basic weapons | Throwing knives | 5 |  |
| Special weapons | Chem-thrower 'Nightshade' | 135 |  |
| Special weapons | Flamer | 140 |  |
| Special weapons | Grenade launcher (frag & krak) | 55 |  |
| Special weapons | - Smoke | 15 | ammo or upgrade for the item above, bought in addition |
| Special weapons | Meltagun | 135 |  |
| Special weapons | Needle rifle | 35 |  |
| Special weapons | Plasma gun | 100 |  |
| Special weapons | Bolter / flamer (combi) | 180 |  |
| Special weapons | Bolter / melta (combi) | 170 |  |
| Special weapons | Bolter / needler (combi) | 80 |  |
| Special weapons | Bolter / plasma (combi) | 115 |  |
| Heavy weapons | Heavy stubber * | 130 | 2 weapon slots |
| Heavy weapons | Plasma cannon * | 130 | 2 weapon slots |
| Close combat weapons | Chainsword | 25 |  |
| Close combat weapons | Knife | 15 |  |
| Close combat weapons | Power hammer | 45 |  |
| Close combat weapons | Power knife | 25 |  |
| Close combat weapons | Power sword | 45 |  |
| Close combat weapons | Servo claw | 35 |  |
| Close combat weapons | Shock whip | 25 |  |
| Close combat weapons | - Master-crafted | 10 | ammo or upgrade for the item above, bought in addition |
| Close combat weapons | Stiletto knife | 20 |  |
| Close combat weapons | Stiletto sword | 30 |  |
| Close combat weapons | - Master-crafted | 10 | ammo or upgrade for the item above, bought in addition |
| Grenades | Choke gas | 45 |  |
| Grenades | Frag | 30 |  |
| Grenades | Krak | 45 |  |
| Grenades | Photon flash flares | 15 |  |
| Grenades | Scare gas | 40 |  |
| Grenades | Smoke | 15 |  |
| Grenades | Stun | 25 |  |
| Armour | Armoured undersuit | 25 |  |
| Armour | Flak | 10 |  |
| Armour | Mesh | 15 |  |
| Equipment | Chem-synth | 15 |  |
| Equipment | Drop-rig | 10 |  |
| Equipment | Filter-plugs | 10 |  |
| Equipment | Photo-goggles | 35 |  |
| Equipment | Respirator | 15 |  |
| Equipment | Skinblade | 10 |  |
| Pets (status items) | Phyrr cat (0-2) | 120 |  |
| Weapon accessories | Gunshroud (Pistol, Basic) | 20 |  |
| Weapon accessories | Las-projector (Pistol, Basic, Special) | 35 |  |
| Weapon accessories | Suspensor (Unwieldy) | 60 |  |

Trading Post only (campaign, not for a starting gang): Whip (15).

#### Death-Maiden (base 115 credits; weapon classes: Pistol, Close Combat)

| Category | Item | Credits | Note |
|---|---|---|---|
| Pistols | Hand flamer | 75 |  |
| Pistols | Laspistol | 10 |  |
| Pistols | Needle pistol | 25 |  |
| Pistols | Plasma pistol | 50 |  |
| Basic weapons | Throwing knives | 5 |  |
| Close combat weapons | Chainsword | 25 |  |
| Close combat weapons | Knife | 15 |  |
| Close combat weapons | Power knife | 25 |  |
| Close combat weapons | Power sword | 45 |  |
| Close combat weapons | Shock whip | 25 |  |
| Close combat weapons | Stiletto knife | 20 |  |
| Close combat weapons | Stiletto sword | 30 |  |
| Close combat weapons | Venom Claw | 30 |  |
| Grenades | Choke gas | 45 |  |
| Grenades | Photon flash flares | 15 |  |
| Grenades | Scare gas | 40 |  |
| Grenades | Smoke | 15 |  |
| Armour | Armoured undersuit | 25 |  |
| Armour | Flak | 10 |  |
| Armour | Mesh | 15 |  |
| Equipment | Chem-synth | 15 |  |
| Equipment | Drop-rig | 10 |  |
| Equipment | Filter-plugs | 10 |  |
| Equipment | Photo-goggles | 35 |  |
| Equipment | Respirator | 15 |  |
| Equipment | Skinblade | 10 |  |
| Pets (status items) | Phyrr cat (0-2) | 120 |  |

Trading Post only (campaign, not for a starting gang): Autopistol (10); + With Hotshot las pack (30); Stub gun (5); Whip (15); Frag (30).

#### Sister (base 50 credits; weapon classes: Pistol, Basic, Close Combat)

| Category | Item | Credits | Note |
|---|---|---|---|
| Pistols | Autopistol | 10 |  |
| Pistols | Hand flamer | 75 |  |
| Pistols | Laspistol | 10 |  |
| Pistols | + With Hotshot las pack | 30 | variant or upgrade of the item above |
| Pistols | Stub gun | 5 |  |
| Pistols | - Dumdum rounds | 5 | ammo or upgrade for the item above, bought in addition |
| Basic weapons | Autogun | 15 |  |
| Basic weapons | Lasgun | 5 |  |
| Basic weapons | + With Hotshot las pack | 25 | variant or upgrade of the item above |
| Basic weapons | Shotgun (solid & scatter) | 30 |  |
| Basic weapons | - Acid rounds | 15 | ammo or upgrade for the item above, bought in addition |
| Basic weapons | Throwing knives | 5 |  |
| Close combat weapons | Chainsword | 25 |  |
| Close combat weapons | Knife | 15 |  |
| Close combat weapons | Shock whip | 25 |  |
| Close combat weapons | Stiletto knife | 20 |  |
| Close combat weapons | Stiletto sword | 30 |  |
| Grenades | Choke gas | 45 |  |
| Grenades | Frag | 30 |  |
| Grenades | Krak | 45 |  |
| Grenades | Photon flash flares | 15 |  |
| Grenades | Scare gas | 40 |  |
| Grenades | Smoke | 15 |  |
| Grenades | Stun | 25 |  |
| Armour | Armoured undersuit | 25 |  |
| Armour | Flak | 10 |  |
| Armour | Mesh | 15 |  |
| Equipment | Chem-synth | 15 |  |
| Equipment | Drop-rig | 10 |  |
| Equipment | Filter-plugs | 10 |  |
| Equipment | Photo-goggles | 35 |  |
| Equipment | Respirator | 15 |  |
| Equipment | Skinblade | 10 |  |
| Weapon accessories | Gunshroud (Pistol, Basic) | 20 |  |
| Weapon accessories | Las-projector (Pistol, Basic, Special) | 35 |  |

#### Sister (Specialist) (base 50 credits; weapon classes: Pistol, Basic, Special, Close Combat)

| Category | Item | Credits | Note |
|---|---|---|---|
| Pistols | Autopistol | 10 |  |
| Pistols | Hand flamer | 75 |  |
| Pistols | Laspistol | 10 |  |
| Pistols | + With Hotshot las pack | 30 | variant or upgrade of the item above |
| Pistols | Stub gun | 5 |  |
| Pistols | - Dumdum rounds | 5 | ammo or upgrade for the item above, bought in addition |
| Basic weapons | Autogun | 15 |  |
| Basic weapons | Lasgun | 5 |  |
| Basic weapons | + With Hotshot las pack | 25 | variant or upgrade of the item above |
| Basic weapons | Shotgun (solid & scatter) | 30 |  |
| Basic weapons | - Acid rounds | 15 | ammo or upgrade for the item above, bought in addition |
| Basic weapons | Throwing knives | 5 |  |
| Special weapons | Chem-thrower 'Nightshade' | 135 |  |
| Special weapons | Flamer | 140 |  |
| Special weapons | Grenade launcher (frag & krak) | 55 |  |
| Special weapons | - Smoke | 15 | ammo or upgrade for the item above, bought in addition |
| Special weapons | Meltagun | 135 |  |
| Special weapons | Needle rifle | 35 |  |
| Special weapons | Plasma gun | 100 |  |
| Special weapons | Bolter / flamer (combi) | 180 |  |
| Special weapons | Bolter / melta (combi) | 170 |  |
| Special weapons | Bolter / needler (combi) | 80 |  |
| Special weapons | Bolter / plasma (combi) | 115 |  |
| Close combat weapons | Chainsword | 25 |  |
| Close combat weapons | Knife | 15 |  |
| Close combat weapons | Shock whip | 25 |  |
| Close combat weapons | Stiletto knife | 20 |  |
| Close combat weapons | Stiletto sword | 30 |  |
| Grenades | Choke gas | 45 |  |
| Grenades | Frag | 30 |  |
| Grenades | Krak | 45 |  |
| Grenades | Photon flash flares | 15 |  |
| Grenades | Scare gas | 40 |  |
| Grenades | Smoke | 15 |  |
| Grenades | Stun | 25 |  |
| Armour | Armoured undersuit | 25 |  |
| Armour | Flak | 10 |  |
| Armour | Mesh | 15 |  |
| Equipment | Chem-synth | 15 |  |
| Equipment | Drop-rig | 10 |  |
| Equipment | Filter-plugs | 10 |  |
| Equipment | Photo-goggles | 35 |  |
| Equipment | Respirator | 15 |  |
| Equipment | Skinblade | 10 |  |
| Weapon accessories | Gunshroud (Pistol, Basic) | 20 |  |
| Weapon accessories | Las-projector (Pistol, Basic, Special) | 35 |  |

#### Wyld Runner (base 45 credits; weapon classes: Pistol, Basic, Close Combat)

| Category | Item | Credits | Note |
|---|---|---|---|
| Pistols | Laspistol | 10 |  |
| Pistols | Stub gun | 5 |  |
| Pistols | - Dumdum rounds | 5 | ammo or upgrade for the item above, bought in addition |
| Basic weapons | Throwing knives | 5 |  |
| Basic weapons | Wyld bow | 10 |  |
| Basic weapons | - Acid | 20 | ammo or upgrade for the item above, bought in addition |
| Basic weapons | - Explosive | 20 | ammo or upgrade for the item above, bought in addition |
| Basic weapons | - Poison | 25 | ammo or upgrade for the item above, bought in addition |
| Close combat weapons | Chainsword | 25 |  |
| Close combat weapons | Knife | 15 |  |
| Close combat weapons | Power knife | 25 |  |
| Close combat weapons | Stiletto knife | 20 |  |
| Close combat weapons | Whip | 15 |  |
| Grenades | Choke gas | 45 |  |
| Grenades | Frag | 30 |  |
| Grenades | Krak | 45 |  |
| Grenades | Photon flash flares | 15 |  |
| Grenades | Scare gas | 40 |  |
| Grenades | Smoke | 15 |  |
| Grenades | Stun | 25 |  |
| Armour | Flak | 10 |  |
| Equipment | Chem-synth | 15 |  |
| Equipment | Drop-rig | 10 |  |
| Equipment | Filter-plugs | 10 |  |
| Equipment | Photo-goggles | 35 |  |
| Equipment | Respirator | 15 |  |
| Equipment | Skinblade | 10 |  |
| Pets (status items) | Phelynx cat (0-3) | 50 |  |

Trading Post only (campaign, not for a starting gang): Autopistol (10); + With Hotshot las pack (30); Mesh (15).

#### Little Sister (base 20 credits; weapon classes: Pistol, Basic, Close Combat)

| Category | Item | Credits | Note |
|---|---|---|---|
| Pistols | Autopistol | 10 |  |
| Pistols | Laspistol | 10 |  |
| Pistols | Needle pistol | 25 |  |
| Pistols | Stub gun | 5 |  |
| Pistols | - Dumdum rounds | 5 | ammo or upgrade for the item above, bought in addition |
| Basic weapons | Throwing knives | 5 |  |
| Close combat weapons | Knife | 15 |  |
| Close combat weapons | Stiletto knife | 20 |  |
| Grenades | Choke gas | 45 |  |
| Grenades | Frag | 30 |  |
| Grenades | Krak | 45 |  |
| Grenades | Photon flash flares | 15 |  |
| Grenades | Scare gas | 40 |  |
| Grenades | Smoke | 15 |  |
| Grenades | Stun | 25 |  |
| Armour | Flak | 10 |  |
| Equipment | Chem-synth | 15 |  |
| Equipment | Drop-rig | 10 |  |
| Equipment | Filter-plugs | 10 |  |
| Equipment | Photo-goggles | 35 |  |
| Equipment | Respirator | 15 |  |
| Equipment | Skinblade | 10 |  |

Trading Post only (campaign, not for a starting gang): Mesh (15).


Reading note: as with Goliaths, Special weapons are only for the Queen, Matriarch and the Specialist Sister. ND's Escher matrix prints Bio-booster only under the vehicle-crew column (in red, meaning unreliable) while GY shows Escher fighters carrying it at 35; it is treated as a Trading Post item here (ruling 'Escher bio-booster').


## 4. Weapon profiles (every weapon on either list)

Source for all tables in this section: ND p.52 to p.60 (weapon tables, read cell by cell), GY (modal profile of each weapon across 900+ fighter cards), FAQ (errata applied). The two agree line for line except where listed in section 9. "House" shows which list carries the weapon: G = Goliath, E = Escher. Costs are in the equipment lists (sections 2.7 and 3.7).

Conventions specific to these tables:
- Pistols (except flame/template pistols) carry the Sidearm trait; it is shown explicitly. All close combat weapons carry the Melee trait.
- Close combat weapons: the single hit modifier is printed in the Acc S column as in ND (GY prints it one column to the right; same value). Rng S `E` means "engaged".
- Rows starting with `-` are ammunition or upgrade profiles that the fighter can choose instead of the base row. Combi rows are the two halves of one weapon.
- Combi weapons (Combi trait): the fighter picks one half per attack, rolls two Ammo dice and applies the worse result; if one half runs out the other can still fire. Plasma halves are low power only, flamer halves become Unstable, a needler half is slightly worse than the stand-alone weapon (the Acc and AP in the rows below already include that).
- Master-crafted variants (Trading Post or list upgrade, +5 to +10): once per battle re-roll one failed hit roll. Not tabulated separately.

### 4.1 Pistols

| Weapon | House | Rng S | Rng L | Acc S | Acc L | Str | AP | D | Am | Traits |
|---|---|---|---|---|---|---|---|---|---|---|
| Autopistol | E | 4" | 12" | +1 | - | 3 | - | 1 | 4+ | Rapid Fire (1), Sidearm |
| Bolt pistol | G | 6" | 12" | +1 | - | 4 | -1 | 2 | 6+ | Sidearm |
| Hand flamer | G, E | T | - | - | - | 3 | - | 1 | 5+ | Blaze, Template |
| Laspistol | E | 8" | 12" | +1 | - | 3 | - | 1 | 2+ | Plentiful, Sidearm |
| - with hotshot las pack (replaces profile) |  | 8" | 12" | +1 | - | 4 | -1 | 1 | 4+ | Sidearm |
| Needle pistol | E | 4" | 9" | +2 | - | - | -1 | - | 6+ | Scarce, Sidearm, Silent, Toxin |
| Plasma pistol, low power | E | 6" | 12" | +2 | - | 5 | -1 | 2 | 5+ | Scarce, Sidearm |
| Plasma pistol, maximal power | E | 6" | 12" | +1 | - | 7 | -2 | 3 | 5+ | Scarce, Sidearm, Unstable |
| Stub gun | G, E | 6" | 12" | +2 | - | 3 | - | 1 | 4+ | Plentiful, Sidearm |
| - dumdum rounds (replaces profile) |  | 5" | 10" | +1 | - | 4 | - | 1 | 4+ | Limited, Sidearm |
| Stub gun / plasma pistol: stub gun half | G, E | 6" | 12" | +2 | - | 3 | - | 1 | 4+ | Combi, Plentiful, Sidearm |
| Stub gun / plasma pistol: plasma half (low power only) | G, E | 6" | 12" | +2 | - | 5 | -1 | 2 | 5+ | Combi, Scarce, Sidearm |
| Bolt pistol / plasma pistol: bolt half | G | 6" | 12" | +1 | - | 4 | -1 | 2 | 6+ | Combi, Sidearm |
| Bolt pistol / plasma pistol: plasma half (low power only) | G | 6" | 12" | +2 | - | 5 | -1 | 2 | 5+ | Combi, Scarce, Sidearm |
| Bolt pistol / hand flamer: bolt half | G | 6" | 12" | +1 | - | 4 | -1 | 2 | 6+ | Combi, Sidearm |
| Bolt pistol / hand flamer: flamer half | G | T | - | - | - | 3 | - | 1 | 5+ | Blaze, Combi, Template, Unstable |
| Bolt pistol / needle pistol: bolt half | G | 6" | 12" | +1 | - | 4 | -1 | 2 | 6+ | Combi, Sidearm |
| Bolt pistol / needle pistol: needle half | G | 4" | 9" | +2 | - | - | -1 | - | 6+ | Combi, Scarce, Sidearm, Silent, Toxin |

### 4.2 Basic weapons

| Weapon | House | Rng S | Rng L | Acc S | Acc L | Str | AP | D | Am | Traits |
|---|---|---|---|---|---|---|---|---|---|---|
| Autogun | E | 8" | 24" | +1 | - | 3 | - | 1 | 4+ | Rapid Fire (1) |
| Boltgun | G, E | 12" | 24" | +1 | - | 4 | -1 | 2 | 6+ | Rapid Fire (1) |
| Combat shotgun, salvo | G | 4" | 12" | +1 | - | 4 | - | 2 | 4+ | Knockback, Rapid Fire (1) |
| - shredder |  | T | - | - | - | 2 | - | 1 | 4+ | Scattershot, Template |
| - firestorm |  | T | - | - | - | 5 | -1 | 1 | 6+ | Blaze, Limited, Template |
| Lasgun | E | 18" | 24" | +1 | - | 3 | - | 1 | 2+ | Plentiful |
| - with hotshot las pack (replaces profile) |  | 18" | 24" | +1 | - | 4 | -1 | 1 | 4+ | - |
| Sawn-off shotgun, scatter | E | 4" | 8" | +2 | - | 3 | - | 1 | 6+ | Plentiful, Scattershot |
| - solid |  | 4" | 8" | - | -2 | 4 | - | 2 | 6+ | Knockback, Plentiful |
| Shotgun, solid | G, E | 8" | 16" | +1 | - | 4 | - | 2 | 4+ | Knockback |
| - scatter |  | 4" | 8" | +2 | - | 2 | - | 1 | 4+ | Scattershot |
| - acid rounds |  | 4" | 8" | +1 | - | 3 | -1 | 1 | 5+ | Blaze, Scattershot |
| - executioner |  | 4" | 16" | -1 | +1 | 4 | -2 | 2 | 6+ | Knockback, Limited |
| - inferno |  | 4" | 16" | +1 | - | 4 | - | 2 | 5+ | Blaze, Limited |
| Stub cannon | G | 9" | 18" | - | - | 5 | - | 1 | 3+ | Knockback |
| Throwing knives | E | Sx2 | Sx4 | - | -1 | - | -1 | - | 5+ | Scarce, Silent, Toxin |
| Wyld bow | E | 9" | 18" | - | -1 | 3 | - | 1 | 4+ | Silent |
| - poison arrows |  | 9" | 18" | - | -1 | - | - | - | 6+ | Scarce, Silent, Toxin |
| - explosive arrows |  | 9" | 18" | - | -1 | 2 | - | 1 | 6+ | Blast (3"), Scarce, Unstable |
| - acid arrows |  | 9" | 18" | - | -1 | 3 | - | 1 | 6+ | Blaze, Scarce |

### 4.3 Special weapons (and Special combi weapons)

| Weapon | House | Rng S | Rng L | Acc S | Acc L | Str | AP | D | Am | Traits |
|---|---|---|---|---|---|---|---|---|---|---|
| 'Nightshade' chem-thrower | E | T | - | - | - | - | - | - | 5+ | Gas, Silent, Template |
| Flamer | G, E | T | - | - | - | 4 | -1 | 1 | 5+ | Blaze, Template |
| Grenade launcher, frag | G, E | 6" | 24" | -1 | - | 3 | - | 1 | 6+ | Blast (3"), Knockback |
| - krak |  | 6" | 24" | -1 | - | 6 | -2 | 2 | 6+ | - |
| - smoke |  | 6" | 24" | -1 | - | - | - | - | 4+ | Blast (5"), Smoke |
| - stun rounds (Goliath list) |  | 6" | 24" | - | - | 2 | -1 | 1 | 4+ | Concussion, Rapid Fire (1) |
| Meltagun | G, E (Goliath: melta gun) | 6" | 12" | +1 | - | 8 | -4 | 3 | 4+ | Melta, Scarce |
| Needle rifle | E | 9" | 18" | +2 | - | - | -2 | - | 6+ | Scarce, Silent, Toxin |
| Plasma gun, low power | E | 12" | 24" | +2 | - | 5 | -1 | 2 | 5+ | Rapid Fire (1), Scarce |
| Plasma gun, maximal power | E | 12" | 24" | +1 | - | 7 | -2 | 3 | 5+ | Scarce, Unstable |
| Storm-welder * | G | 8" | 16" | +1 | - | 5 | - | 1 | 3+ | Rapid Fire (3), Reckless, Shock, Unstable |
| Bolter / flamer: bolter half | G, E | 12" | 24" | +1 | - | 4 | -1 | 2 | 6+ | Combi, Rapid Fire (1) |
| Bolter / flamer: flamer half | G, E | T | - | - | - | 4 | -1 | 1 | 5+ | Blaze, Combi, Template, Unstable |
| Bolter / melta: bolter half | G, E | 12" | 24" | +1 | - | 4 | -1 | 2 | 6+ | Combi, Rapid Fire (1) |
| Bolter / melta: melta half | G, E | 6" | 12" | +1 | - | 8 | -4 | 3 | 4+ | Combi, Melta, Scarce |
| Bolter / plasma: bolter half | G, E | 12" | 24" | +1 | - | 4 | -1 | 2 | 6+ | Combi, Rapid Fire (1) |
| Bolter / plasma: plasma half (low power only) | G, E | 12" | 24" | +2 | - | 5 | -1 | 2 | 5+ | Combi, Rapid Fire (1), Scarce |
| Bolter / grenade launcher: bolter half | G | 12" | 24" | +1 | - | 4 | -1 | 2 | 6+ | Combi, Rapid Fire (1) |
| Bolter / grenade launcher: frag half (frag only) | G | 6" | 24" | -1 | - | 3 | - | 1 | 6+ | Blast (3"), Combi, Knockback |
| Bolter / needler: bolter half | E | 12" | 24" | +1 | - | 4 | -1 | 2 | 6+ | Combi, Rapid Fire (1) |
| Bolter / needler: needler half | E | 9" | 18" | +1 | - | - | -1 | - | 6+ | Combi, Scarce, Silent, Toxin |

### 4.4 Heavy weapons

| Weapon | House | Rng S | Rng L | Acc S | Acc L | Str | AP | D | Am | Traits |
|---|---|---|---|---|---|---|---|---|---|---|
| Heavy bolter * | G | 18" | 36" | +1 | - | 5 | -2 | 2 | 6+ | Rapid Fire (2), Unwieldy |
| Heavy flamer * | G | T | - | - | - | 5 | -2 | 1 | 5+ | Blaze, Template, Unwieldy |
| Heavy stubber * | G, E | 20" | 40" | - | -1 | 4 | -1 | 1 | 4+ | Rapid Fire (2), Unwieldy |
| 'Krumper' rivet cannon *, rapid-fire | G | 3" | 9" | +2 | - | 4 | -1 | 2 | 3+ | Rapid Fire (1), Rending |
| - super-heated |  | 3" | 9" | +2 | - | 6 | -2 | 2 | 3+ | Blaze, Rending |
| Missile launcher *, frag | G | 24" | 48" | +1 | - | 4 | -1 | 1 | 6+ | Blast (5"), Knockback, Unwieldy |
| - krak |  | 24" | 48" | +1 | - | 6 | -2 | 3 | 6+ | Unwieldy |
| Multi-melta * | G | 12" | 24" | +1 | - | 8 | -4 | 3 | 4+ | Blast (3"), Melta, Scarce, Unwieldy |
| Plasma cannon *, low power | E | 18" | 36" | +1 | - | 6 | -1 | 2 | 5+ | Rapid Fire (1), Scarce, Unwieldy |
| - maximal power |  | 18" | 36" | +1 | - | 8 | -2 | 3 | 5+ | Blast (3"), Scarce, Unstable, Unwieldy |
| Assault grenade launchers (twin-linked) *, frag | G | 6" | 24" | -1 | - | 3 | - | 1 | 6+ | Blast (3"), Knockback, Rapid Fire (1), Unstable |
| - stun rounds |  | 6" | 18" | - | - | 2 | -1 | 1 | 4+ | Concussion, Rapid Fire (1) |
| - krak |  | 6" | 24" | -1 | - | 6 | -2 | 2 | 6+ | - |
| - smoke |  | 6" | 24" | -1 | - | - | - | - | 4+ | Blast (5"), Smoke |

### 4.5 Close combat weapons

| Weapon | House | Rng S | Rng L | Acc S | Acc L | Str | AP | D | Am | Traits |
|---|---|---|---|---|---|---|---|---|---|---|
| Axe | G | E | - | - | - | S+1 | - | 1 | - | Disarm, Melee |
| Brute cleaver | G | E | - | +1 | - | S | -1 | 1 | - | Disarm, Melee |
| Chainaxe | G, E | E | - | +1 | - | S+1 | -1 | 1 | - | Disarm, Melee, Parry, Rending |
| Chainsword | G, E | E | - | +1 | - | S | -1 | 1 | - | Melee, Parry, Rending |
| Heavy rock saw * | G | E | - | +1 | - | S+3 | -3 | 2 | - | Melee, Rending, Unwieldy |
| Knife (fighting knife) | G, E | E | - | - | - | S | -1 | 1 | - | Backstab, Melee |
| Maul (club) | G | E | - | - | - | S | +1 | 2 | - | Melee |
| Power axe | G | E | - | - | - | S+2 | -2 | 1 | - | Disarm, Melee, Power |
| Power hammer | G, E | E | - | - | - | S+1 | -1 | 2 | - | Melee, Power |
| Power knife | E | E | - | - | - | S+1 | -2 | 1 | - | Backstab, Melee, Power |
| Power sword | E | E | - | - | - | S+1 | -2 | 1 | - | Melee, Parry, Power |
| 'Pulveriser' serrated axe | G | E | - | - | - | S+1 | -1 | 1 | - | Melee, Pulverise |
| 'Renderizer' serrated axe * | G | E | - | - | - | S+2 | -1 | 2 | - | Melee, Pulverise, Unwieldy |
| Servo-claw | G, E | E | - | - | - | S+2 | - | 2 | - | Melee |
| Spud-jacker | G | E | - | - | - | S+1 | - | 1 | - | Knockback, Melee |
| Stiletto knife | E | E | - | - | - | - | - | - | - | Melee, Toxin |
| Stiletto sword | E | E | - | - | - | - | -1 | - | - | Melee, Parry, Toxin |
| Two-handed axe * | G | E | - | -1 | - | S+2 | - | 2 | - | Melee, Unwieldy |
| Two-handed hammer * | G | E | - | -1 | - | S+1 | - | 3 | - | Knockback, Melee, Unwieldy |
| Venom claw | E | E | - | - | - | - | -2 | - | - | Entangle, Melee, Toxin |
| Whip | E | E | 3" | -1 | - | S | - | 1 | - | Entangle, Melee, Versatile |
| Shock whip | E | E | 3" | -1 | - | S+1 | - | 1 | - | Melee, Shock, Versatile |
| Paired 'pulverisers' * | G | E | - | - | - | S+1 | -1 | 1 | - | Melee, Paired, Pulverise |
| Paired spud-jackers * | G | E | - | - | - | S+1 | - | 1 | - | Knockback, Melee, Paired |

### 4.6 Grenades

| Weapon | House | Rng S | Rng L | Acc S | Acc L | Str | AP | D | Am | Traits |
|---|---|---|---|---|---|---|---|---|---|---|
| Blasting charges | G | - | Sx2 | - | - | 5 | -1 | 2 | 5+ | Blast (5"), Grenade, Knockback |
| Choke gas grenades | E | - | Sx3 | - | - | - | - | - | 5+ | Blast (3"), Gas, Grenade |
| Frag grenades | G, E | - | Sx3 | - | - | 3 | - | 1 | 4+ | Blast (3"), Grenade, Knockback |
| Incendiary charges | G | - | Sx3 | - | - | 3 | - | 1 | 5+ | Blast (5"), Blaze, Grenade |
| Krak grenades | G, E | - | Sx3 | - | -1 | 6 | -2 | 2 | 4+ | Demolition, Grenade |
| Melta bombs | G | - | Sx3 | - | -1 | 8 | -4 | 3 | 6+ | Demolition, Grenade, Melta |
| Photon flash flares | E | - | Sx3 | - | - | - | - | - | 5+ | Blast (5"), Flash, Grenade |
| Scare gas grenades | E | - | Sx3 | - | - | - | - | - | 6+ | Blast (3"), Fear, Gas, Grenade |
| Smoke grenades | G, E | - | Sx3 | - | - | - | - | - | 4+ | Blast (5"), Grenade, Smoke |
| Stun grenades | G, E | - | Sx3 | - | - | 2 | -1 | 1 | 4+ | Blast (3"), Concussion, Grenade |


## 5. Weapon trait glossary

Source: ND p.61 to p.65 (read and restated), FAQ (Unstable on grenades, Rapid Fire with Blast, Versatile and charge, Unwieldy versus `*`), GH-GOL (July 2023 Blast changes), BC. Written in our words. Combat resolution itself (hit, wound, save, injury, nerve) lives in the core rules spec, not here.

| Trait | Effect |
|---|---|
| Backstab | +1 Strength when the attacker is outside the target's vision arc. |
| Blast (3" / 5") | The attack places a Blast marker of that diameter. Every fighter touched is hit. Since the July 2023 rulebook the marker must be centred on an enemy fighter or the attack takes -2 to hit (GH-GOL); smoke ignores that penalty (ND, GH-GOL). If the centre ever leaves the battlefield the marker is removed (FAQ). |
| Blaze | A fighter hit but not put Out of Action catches fire on a D6 roll of 4+. A burning fighter, when activated, takes a Strength 3, AP -1 hit, moves (still Engaged: no move; Pinned: becomes Active; Active: 2D6" in a random direction), may then choose to go Pinned, and tries to extinguish on a 6+ (+2 if Pinned, +1 per friendly Active fighter within 1"); the activation then ends. Burning fighters cannot make reaction attacks. |
| Combi | See the conventions above. |
| Concussion | The hit fighter loses 2 Initiative (to a minimum of 6+) until the end of the round. |
| Demolition | A grenade with this trait can be used in close combat against scenery (doors, objectives) as one automatic hit. |
| Disarm | If the to-hit roll is a natural 6, the target cannot use weapons for the rest of the round (reaction attacks are unarmed). |
| Entangle | Hits cannot be negated by Parry; on a natural 6 to hit, the target's reaction attacks take -2. |
| Fear | Instead of an Injury roll, the target takes a Nerve test at -2 or becomes Broken. |
| Flash | Instead of a wound roll, the target passes an Initiative test or is Blinded (also loses Ready status; reaction attacks only hit on a 6; no attacks until its next activation). |
| Gas | Instead of a wound roll, roll a D6 and score the target's Toughness or more (a natural 6 always works) to cause an Injury roll regardless of Wounds. No armour save; the target is not Pinned. |
| Grenade | Thrown wargear, used by Shoot (Basic). No short range; long range is the stated multiple of the thrower's Strength. No Firepower dice: an automatic Ammo test is made each time, and a grenade cannot be reloaded. |
| Knockback | If the hit roll is equal to or higher than the target's Strength, the target is moved 1" straight away. Blocked movement adds 1 Damage; being knocked over an edge needs an Initiative test or a fall; the attacker may follow up in melee. |
| Limited | When this ammunition runs out it is lost until bought again; the weapon can still reload its other profiles. |
| Melee | Close combat weapon (range E). |
| Melta | At short range, a target reduced to 0 Wounds takes automatic Out of Action results on its Injury dice (no roll). |
| Paired | The fighter counts as having two melee weapons, and doubles its base Attacks characteristic when charging. |
| Parry | In close combat the defender may force the attacker to re-roll one successful hit (two with two Parry weapons). |
| Plentiful | Ammo tests to reload are passed automatically. |
| Power | Cannot be parried except by other Power weapons. A hit roll of 6 ignores armour saves (not field armour) and adds 1 Damage (the extra Damage does not combine with Toxin). |
| Pulverise | After an Injury roll, roll a D6; on a result equal to or higher than the target's Toughness (or a 6) one Flesh Wound die becomes Seriously Injured. |
| Rapid Fire (X) | A successful hit scores one hit per bullet hole on the Firepower dice. Up to X Firepower dice may be rolled; each Ammo symbol forces an Ammo test; one failure empties the gun, two failures jam it for the rest of the battle. Extra hits can be placed on other targets within 3" of the first that are in range, in sight and no harder to hit. With Blast, extra markers land within 3" of the first (FAQ). |
| Reckless | Ignores target priority: the target is chosen at random from everything in line of sight (friends included). Extra Rapid Fire hits spread across as many targets as possible. |
| Rending | A wound roll of 6 adds 1 Damage. |
| Scarce | Once Out of Ammo the weapon cannot be reloaded for the rest of the battle. |
| Scattershot | A hit inflicts D6 wound rolls instead of one. |
| Shock | A to-hit roll of 6 automatically wounds. |
| Sidearm | Pistol that can be used at range and in close combat. A fighter with two Sidearms can fire both in one Shoot (Basic) action at the same target at -1 to hit ("twin guns blazing"). In close combat accuracy modifiers do not apply and each Sidearm gives at most one attack. |
| Silent | Does not raise the alarm in Sneak Attack scenarios and does not reveal a Hidden fighter in Pitch Black. |
| Smoke | Causes no hits or wounds. Marks the target point; the cloud extends 2.5" from the marker, blocks line of sight into, out of and through it, and is rolled for in the End phase (removed on 1 to 4, stays on 5 or 6). Photo-goggles see through it. Fighters can walk through it. |
| Template | Weapon uses the flame template; no hit roll. |
| Toxin | Instead of a wound roll, roll a D6 and score the target's Toughness or more (natural 6 always works) to cause an Injury roll regardless of Wounds. Armour saves are allowed. |
| Twin-linked | Re-roll any number of Ammo dice. (The "assault grenade launchers (twin-linked)" are a matched pair, not a Twin-linked weapon: FAQ.) |
| Unstable | When the Ammo symbol is rolled, roll a D6; on 1 to 3 the attacker is Out of Action (the attack is still resolved). Grenades always make the Unstable roll because their Ammo test is automatic (FAQ). |
| Unwieldy | Two weapon slots. Ranged: Shoot is a Double action. Melee: needs two hands, so no second melee weapon (no Paired bonus). Suspensors or the Bulging Biceps skill relax this. |
| Versatile | The long range printed for a melee weapon is its reach: a fighter may stop within that reach of an enemy and fight without base contact, and reaction attacks may use it. The target must be in the vision arc. |

## 6. Wargear relevant to skirmish

### 6.1 Armour

Source: ND p.66 and p.67 (read from the page; the compilation's HOUSE RULE box on armour ignored), GH-GOL and GH-ESC (flak, mesh, carapace, undersuit costs and uses), NecroCom 2023 summary (search result: flak 6+/5+ against Blast and flame, heavy carapace 4+/3+ front with -1 Initiative and -1" charge). Three sources agree on every save value.

| Item | Save | Cost (Goliath / Escher lists) | Notes |
|---|---|---|---|
| Furnace plates | 6+, improved to 5+ against attacks from the front arc | 5 / not on the Escher list | Goliath only. A Prone fighter has no front arc. Brutes pay 10. |
| Flak armour | 6+, 5+ against Blast and flame templates | Goliath: Trading Post / Escher: 10 | |
| Mesh armour | 5+ | Goliath: Trading Post (15) / Escher: 15 for Queen, Matriarch, Death-Maiden, Sister; Trading Post for Juves and Prospects | |
| Light carapace | 4+ | 80 for Tyrant and Forge Boss / 80 for the Queen only | |
| Heavy carapace | 4+, 3+ from the front arc; -1 Initiative; -1" movement when charging | 100, Forge Tyrant only / not on the Escher list | |
| Armoured undersuit | +1 to the wearer's armour save (a fighter with no armour counts as 7+) | 25 for every type except Escher Prospects and Juves / 25 for Queen, Death-Maiden, Matriarch, Sister | Combined armour: stacks with one standard armour. GH-ESC: Mesh plus undersuit (40) equals 4+, the same as light carapace (80). |
| Ablative overlay | +2 on the first save, +1 on the second, nothing after; refreshes between battles | Trading Post (20) | Not on any starting list. |

Saves are modified by weapon AP. A fighter may use only one of several alternative saves for an attack.

### 6.2 Other wargear that appears on the starting lists

Source: ND p.68 to p.74 (restated), GH-GOL (stimm-slug stash, bio-booster), GH-ESC (chem-synth), costs from the matrices in sections 2.7 and 3.7.

| Item | Effect (our words) | Cost on lists |
|---|---|---|
| Stimm-slug stash (Goliath) | Usable once per battle at the start of the wearer's activation, until the end of the round: +2 M, +2 S, +2 T, and one Flesh Wound is discarded. At the start of the End phase roll a D6; on a 1 the wearer takes an Injury roll. (The Flesh Wound removal comes from ND only; GH-GOL does not mention it.) | 25 (Brute 20) |
| Bio-booster | The first time in a battle that the wearer must roll Injury dice, roll one die fewer (if it would have been one die, roll two and discard one). | Goliath: Tyrant, Boss, Stimmer, Forge-born 35 / Escher: Trading Post |
| Chem-synth (Escher) | If Standing at the start of an activation, pass an Intelligence test to reduce the Toughness of targets by 1 against Gas and Toxin attacks made that activation. The test is free. | 15 (Escher list) |
| Respirator | +2 Toughness against Gas weapons. | 15 |
| Filter plugs | +1 Toughness against Gas; single use, lost after the battle. | 10 |
| Photo-goggles | Can shoot through smoke clouds; ignores low-light; +1 on Initiative tests against Flash. | 35 |
| Drop-rig | Basic action (Descend): within 1" of an edge, move 0 to 3" horizontally and 0 to 12" down. | 10 |
| Skinblade | +2 to an escape roll if captured; single use. Campaign only. | 10 |
| Suspensors (weapon upgrade, Unwieldy weapons) | Ranged: firing becomes a Basic action instead of a Double. Melee: can be held in one hand. | 60 (Forge Tyrant, Forge Boss, Queen, Matriarch) |
| Gunshroud (Pistol, Basic) | The weapon gains Silent. | 20 |
| Las-projector (Pistol, Basic, Special) | +1 to hit at the weapon's short range. | 35 (Escher) |
| Telescopic sight (Pistol, Basic, Special) | When aiming, use the short-range accuracy modifier even at long range. Maximum one gunsight per weapon. | 25 (Goliath) |
| Hotshot las pack (Laspistol, Lasgun) | Strength 4, AP -1, Ammo 4+, loses Plentiful. Cannot be fitted to a combi weapon. | +20 over the base (lasgun 5 to 25, laspistol 10 to 30) |
| Sumpkroc, Phelynx, Phyrr cat | See sections 2.6 and 3.6. | 130, 50, 120 |

### 6.3 Grenades

Grenade profiles are in the weapon tables above (section 4). Costs: Goliath list: blasting charges 35 (Tyrant, Boss), frag 30, incendiary 40 (Stimmer, Bruiser, Bully, Forge-born), krak 45, melta bombs 60 (Stimmer), smoke 15. Escher list: choke gas 45, frag 30, krak 45, photon flash flares 15, scare gas 40, smoke 15, stun 25. ND prints stun grenade costs for Goliaths in red (unreliable); they are left out of the Goliath starter gangs.


## 7. Skills reachable as starting skills

Source: ND p.80 to p.86 (non-HOUSE-RULE text restated; the compiler's boxed variants are ignored), page numbers from GY rule tags (Core p.254 to p.261, Chains p.102, Blades p.92), FAQ (Mighty Leap and Somersault errata), GH-GOL and GH-ESC (behavioural confirmation and July 2023 changes: Overseer needs a Leadership test, Hurl may be used on the charge, Headbutt is a free action, some Brawn skills were improved).

In the quick-start skirmish a Leader or Champion starts with one skill from a Primary set listed in sections 2.3 and 3.3. The other skills in each set are listed so the engine can offer the full choice. Skills in Secondary-only sets are campaign advancement and are not described.

### 7.1 Skill lists (D6 order as printed)

| Set | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| Agility | Catfall | Clamber | Dodge | Mighty Leap | Spring Up | Sprint |
| Brawn | Bull Charge | Bulging Biceps | Crushing Blow | Headbutt | Hurl | Iron Jaw |
| Combat | Combat Master | Counter-attack | Disarm | Parry | Rain of Blows | Step Aside |
| Ferocity | Berserker | Fearsome | Impetuous | Nerves of Steel | True Grit | Unstoppable |
| Leadership | Commanding Presence | Inspirational | Iron Will | Mentor | Overseer | Regroup |
| Muscle (Goliath) | Fists of Steel | Iron Man | Immovable Stance | Naaargah! | Unleash the Beast | Walk It Off |
| Finesse (Escher) | Acrobatic | Combat Focus | Combat Virtuoso | Hit and Run | Lightning Reflexes | Somersault |
| Cunning, Shooting (Secondary only for these houses) | see core rulebook | | | | | |

### 7.2 Agility

| Skill | Effect |
|---|---|
| Catfall | Halves (rounded up) the vertical distance counted when falling or jumping down. If the fighter is not Seriously Injured or Out of Action, it may pass an Initiative test to stay standing instead of becoming Pinned. |
| Clamber | Climbing vertical distances is not halved. |
| Dodge | A 6+ save that cannot be modified, works against ranged and close combat attacks, and is taken in addition to the normal armour save. Against Blast or Template weapons a successful save lets the fighter step up to 2" before it is decided whether it is hit. |
| Mighty Leap | (Errata) When leaping a gap the first 2" of its width is ignored, so gaps of 2" plus the fighter's base size or less need no Initiative test. |
| Spring Up | When activated while Pinned, pass an Initiative test to make a free Stand Up action. |
| Sprint | When making two or more Move actions in an activation, the last Move uses double the Movement characteristic. |

### 7.3 Brawn

| Skill | Effect |
|---|---|
| Bull Charge | When charging, melee weapons gain Knockback and +1 Strength. |
| Bulging Biceps | An Unwieldy close combat weapon needs only one hand, so a second melee weapon can be used alongside it. It still takes two weapon slots; it gives no help firing Unwieldy ranged weapons. |
| Crushing Blow | Pick one non-Sidearm attack before rolling to hit; if it hits it gets +1 Strength and +1 Damage. |
| Headbutt | Free action against an Engaged enemy in base contact. Roll 2D6; if at least one die equals or beats the target's Toughness the attack hits with the fighter's Strength +2 and Damage 2. If both dice are lower, the fighter fumbles and takes a hit at its own Strength, Damage 1. |
| Hurl | Replaces the free Fight action after a charge, or can be taken as a Basic action later. Target an Engaged enemy in base contact, or a Seriously Injured enemy within 1". The target passes an Initiative test or is moved D3" in any direction (stopping on touching another standing fighter or terrain). It and anything it touches suffer a Strength 3 hit and are Pinned. |
| Iron Jaw | +2 Toughness against close combat attacks that have AP `-`. |

### 7.4 Combat

| Skill | Effect |
|---|---|
| Combat Master | Ignores interference and always grants an assist in melee. |
| Counter-attack | When making reaction attacks, +1 Attack for each of the attacker's attacks that failed to hit. |
| Disarm | The fighter's melee weapons gain Disarm (on 6+ to hit); weapons that already have Disarm trigger on 5+. |
| Parry | Counts as carrying one extra Parry weapon (one more attack can be parried). |
| Rain of Blows | The Fight (Basic) action becomes Fight (Simple). |
| Step Aside | When hit in close combat, pass an Initiative test to avoid that hit; once per enemy per round of combat. |

### 7.5 Ferocity

| Skill | Effect |
|---|---|
| Berserker | +1 Attack when charging. |
| Fearsome | An enemy that charges this fighter must first pass a Willpower test or its action ends. |
| Impetuous | Consolidates up to 4" instead of 2". |
| Nerves of Steel | When hit by a ranged attack, pass a Cool test to avoid being Pinned. |
| True Grit | Roll one fewer Injury die; if only one die would be rolled, roll two and discard one. |
| Unstoppable | Before a Recovery test, roll a D6; on 4+ remove a Flesh Wound, or if there is none roll one extra die for the Recovery test and discard one. |

### 7.6 Leadership

| Skill | Effect |
|---|---|
| Commanding Presence | Group Activation +1. |
| Inspirational | If a friendly fighter within 6" fails a Cool test, this fighter may pass a Leadership test to treat the original test as passed. |
| Iron Will | -1 to the gang's Bottle roll while this fighter is on the battlefield and not Seriously Injured or Wrecked. |
| Mentor | Whenever another friendly fighter within 6" gains XP, pass a Leadership test to give that fighter one extra XP. Campaign. |
| Overseer | Double action (Order) while Active: pass a Leadership test to make a friendly fighter within 6" activate immediately and take two actions, even if it was not Ready (its Ready status is unchanged). |
| Regroup | If Active at the end of its activation, pass a Leadership test to recover every Broken friendly fighter within 6". |

### 7.7 Muscle (Goliath)

| Skill | Effect |
|---|---|
| Fists of Steel | Unarmed attacks get +2 Strength and Damage 2. |
| Iron Man | Flesh Wounds do not reduce Toughness. The fighter still goes Out of Action when its Flesh Wounds reach its Toughness. |
| Immovable Stance | Double action (Tank): until the start of its next activation, +2 to saves (best 2+), cannot be moved by any skill or weapon (Hurl, Overseer, Knockback, Drag) and cannot be Pinned. |
| Naaargah! | After its two actions the fighter may try a third by passing a Toughness test. Whether or not the test is passed, the fighter ends the activation Pinned automatically (not preventable by Nerves of Steel). GH-GOL: roughly 2 in 3 for T4, 5 in 6 for T5. |
| Unleash the Beast | Simple action (Flex) while Engaged: every fighter in base contact (friend or foe) passes a Strength test or is pushed D3" straight away. |
| Walk It Off | After making two or more Move (Simple) actions in one activation, pass a Toughness test at the end of the activation to recover a lost Wound or discard a Flesh Wound. |

### 7.8 Finesse (Escher)

| Skill | Effect |
|---|---|
| Acrobatic | While Active, may move through enemy fighters during a Move (Simple) or Charge (Double); the 1" rule still applies at the end. Cross barricades and linear features up to 2" high without penalty. |
| Combat Focus | +1 Willpower and +1 Cool for each enemy fighter Out of Action or Seriously Injured (a natural 2 still fails). |
| Combat Virtuoso | The fighter's knives, stiletto knives and swords, power knives and swords and chainswords gain Versatile with a reach equal to its Strength. |
| Hit and Run | After a Charge (Double) action and before the enemy's reaction attacks, make a free Retreat (Basic); if that fails the opponent may only make its reaction attacks once. |
| Lightning Reflexes | Once per round, when Engaged and before an enemy attacks, make a free Retreat (Basic). It does not stop the fighter activating later if Ready. |
| Somersault | Basic action: place the fighter anywhere within 6" in line of sight and more than 1" from enemies. It does not count as moving for movement-triggered effects. (Errata: the original clause about firing Unwieldy weapons was removed.) |


## 8. Quick-start gangs (1000 credits, skirmish)

Source: all costs are summed from the matrices in sections 2.7 and 3.7 and the base costs in sections 2.1 and 3.1 (the sums were computed by script, not by hand, and every item was checked against the fighter's own list). Legality checks applied to every gang below: exactly one Leader; at least half the gang are Gang Fighters; at most one Specialist Ganger; at most three weapon slots per fighter; every item on that fighter's own equipment list (no Trading Post items); total at or under 1000. Gene-smithing, chem-alchemy and pets other than the one Phelynx in Escher gang 2 are not used. Skills are chosen from the fighter's Primary sets at recruitment (free).

### 8.1 Goliath quick-start gang 1: "Furnace Crew" (balanced melee push with fire support, 8 fighters)

A Tyrant and a Stimmer carry the melee; a Forge Boss with a combat shotgun and a grenade-launcher Specialist give fire support while the Bruisers and Bullies fill the roster. Uses the full 1000.

| # | Type | Free skill | Equipment (credits) | Slots | Cost |
|---|---|---|---|---|---|
| 1 | Forge Tyrant (base 135) | Nerves of Steel | Chainaxe 25, Stub gun 5, Furnace plates 5 | 2 | 170 |
| 2 | Stimmer (base 125) | Nerves of Steel | Paired 'Pulveriser' serrated axe * 50, Stub gun 5, Furnace plates 5 | 3 | 185 |
| 3 | Forge Boss (base 100) | True Grit | Combat shotgun (salvo & shredder) 60, Axe 10, Furnace plates 5 | 2 | 175 |
| 4 | Bruiser (Specialist) (base 55) | - | Grenade launcher (frag & krak) 55, Smoke 15, Stub gun 5, Furnace plates 5 | 2 | 135 |
| 5 | Bruiser (base 55) | - | Boltgun 55, Knife 10, Furnace plates 5 | 2 | 125 |
| 6 | Bruiser (base 55) | - | Stub cannon 20, Axe 10, Furnace plates 5 | 2 | 90 |
| 7 | Bully (base 35) | - | Brute cleaver 20, Stub gun 5, Furnace plates 5 | 2 | 65 |
| 8 | Bully (base 35) | - | Axe 10, Stub gun 5, Furnace plates 5 | 2 | 55 |

Total: 1000 credits (0 left over). Fighters: 8 (3 Gang Hierarchy, 5 Gang Fighters, 1 Specialist). Check: one Leader, Gang Fighters 5 of 8 (needs at least 4), Specialists 1 (max 1), no fighter over 3 weapon slots, all items on own list.

### 8.2 Goliath quick-start gang 2: "Cheap Muscle" (10 fighters, wide and cheap)

Ten bodies for 995 credits: a Renderizer Tyrant, a boltgun-and-chainaxe Boss, one Specialist, one shotgun Bruiser, and four Bullies and two Forge-born as cheap melee screens. 5 credits left over.

| # | Type | Free skill | Equipment (credits) | Slots | Cost |
|---|---|---|---|---|---|
| 1 | Forge Tyrant (base 135) | Nerves of Steel | 'Renderizer' serrated axe * 40, Stub gun 5, Furnace plates 5, Armoured undersuit 25 | 3 | 210 |
| 2 | Forge Boss (base 100) | Unstoppable | Boltgun 55, Chainaxe 25, Furnace plates 5 | 2 | 185 |
| 3 | Bruiser (Specialist) (base 55) | - | Grenade launcher (frag & krak) 55, Stub gun 5, Furnace plates 5 | 2 | 120 |
| 4 | Bruiser (base 55) | - | Combat shotgun (salvo & shredder) 60, Furnace plates 5 | 1 | 120 |
| 5 | Bully (base 35) | - | Brute cleaver 20, Stub gun 5, Furnace plates 5 | 2 | 65 |
| 6 | Bully (base 35) | - | Brute cleaver 20, Stub gun 5, Furnace plates 5 | 2 | 65 |
| 7 | Bully (base 35) | - | Brute cleaver 20, Stub gun 5, Furnace plates 5 | 2 | 65 |
| 8 | Bully (base 35) | - | Axe 10, Stub gun 5, Furnace plates 5 | 2 | 55 |
| 9 | Forge-born (base 35) | - | Knife 10, Stub gun 5, Furnace plates 5 | 2 | 55 |
| 10 | Forge-born (base 35) | - | Knife 10, Stub gun 5, Furnace plates 5 | 2 | 55 |

Total: 995 credits (5 left over). Fighters: 10 (2 Gang Hierarchy, 8 Gang Fighters, 1 Specialist). Check: one Leader, Gang Fighters 8 of 10 (needs at least 5), Specialists 1 (max 1), no fighter over 3 weapon slots, all items on own list.

### 8.3 Escher quick-start gang 1: "Lasgun Line" (9 fighters)

Queen, Matriarch and Death-Maiden lead four lasgun Sisters, a grenade-launcher Specialist and a Little Sister. The Death-Maiden brings Toxin melee and a Toxin pistol. 5 credits left over.

| # | Type | Free skill | Equipment (credits) | Slots | Cost |
|---|---|---|---|---|---|
| 1 | Queen (base 125) | Spring Up | Plasma pistol 50, Power sword 45, Mesh 15 | 2 | 235 |
| 2 | Matriarch (base 100) | Dodge | Lasgun 5, Shock whip 25, Mesh 15 | 2 | 145 |
| 3 | Death-Maiden (base 115) | Spring Up | Needle pistol 25, Stiletto sword 30, Mesh 15 | 2 | 185 |
| 4 | Sister (Specialist) (base 50) | - | Grenade launcher (frag & krak) 55, Stub gun 5, Flak 10 | 2 | 120 |
| 5 | Sister (base 50) | - | Lasgun 5, Flak 10 | 1 | 65 |
| 6 | Sister (base 50) | - | Lasgun 5, Flak 10 | 1 | 65 |
| 7 | Sister (base 50) | - | Lasgun 5, Flak 10 | 1 | 65 |
| 8 | Sister (base 50) | - | Lasgun 5, Flak 10 | 1 | 65 |
| 9 | Little Sister (base 20) | - | Stub gun 5, Knife 15, Flak 10 | 2 | 50 |

Total: 995 credits (5 left over). Fighters: 9 (3 Gang Hierarchy, 6 Gang Fighters, 1 Specialist). Check: one Leader, Gang Fighters 6 of 9 (needs at least 5), Specialists 1 (max 1), no fighter over 3 weapon slots, all items on own list.

### 8.4 Escher quick-start gang 2: "Wyld Skirmishers" (10 fighters, one Phelynx pet)

A Queen with a shock whip, a boltgun Matriarch, a needle-rifle Specialist, three lasgun Sisters, two bow-and-chainsword Wyld Runners (one with a Phelynx) and two Little Sisters. 5 credits left over.

| # | Type | Free skill | Equipment (credits) | Slots | Cost |
|---|---|---|---|---|---|
| 1 | Queen (base 125) | Spring Up | Lasgun 5, Shock whip 25, Mesh 15 | 2 | 170 |
| 2 | Matriarch (base 100) | Dodge | Boltgun 55, Stiletto sword 30, Mesh 15 | 2 | 200 |
| 3 | Sister (Specialist) (base 50) | - | Needle rifle 35, Stub gun 5, Flak 10 | 2 | 100 |
| 4 | Sister (base 50) | - | Lasgun 5, Flak 10 | 1 | 65 |
| 5 | Sister (base 50) | - | Lasgun 5, Flak 10 | 1 | 65 |
| 6 | Sister (base 50) | - | Lasgun 5, Flak 10 | 1 | 65 |
| 7 | Wyld Runner (base 45) | - | Wyld bow 10, Chainsword 25, Flak 10, Phelynx cat (0-3) 50 | 2 | 140 |
| 8 | Wyld Runner (base 45) | - | Wyld bow 10, Chainsword 25, Flak 10 | 2 | 90 |
| 9 | Little Sister (base 20) | - | Stub gun 5, Knife 15, Flak 10 | 2 | 50 |
| 10 | Little Sister (base 20) | - | Stub gun 5, Knife 15, Flak 10 | 2 | 50 |

Total: 995 credits (5 left over). Fighters: 10 (2 Gang Hierarchy, 8 Gang Fighters, 1 Specialist). Check: one Leader, Gang Fighters 8 of 10 (needs at least 5), Specialists 1 (max 1), no fighter over 3 weapon slots, all items on own list. The Phelynx (50, included in Wyld Runner 1) is a pet and is not counted as a fighter.


## 9. Differences, errata and conflicts between sources

| Item | What the sources say | What this file uses |
|---|---|---|
| Frag grenade Knockback | ND, GH-GOL and the grenade launcher's frag round list Knockback; the GY frag grenade card omits it. | Knockback kept (Blast (3"), Knockback). |
| Power knife | FAQ (House of Blades): Strength S+2 to S+1 and delete Disarm. GH-ESC notes the Backstab trait is missing from the printed profile; ND and GY both print Backstab. | S+1, AP -2, D1, Backstab, Power. |
| Boltgun ammo | FAQ (House of Blades weapon page): Ammo 4+ becomes 6+. | 6+. |
| Wyld bow | FAQ: Damage `-` becomes 1. | D1. |
| Throwing knives | FAQ: Strength S becomes `-`. | Str `-`, AP -1, Silent, Toxin, Scarce. |
| Venom claw | FAQ: add the Melee trait. | Entangle, Melee, Toxin. |
| Two-handed axe, two-handed hammer | FAQ: long-range accuracy `-` becomes -1. | -1 hit. |
| Phyrr cat | FAQ: cost 130 becomes 120. | 120. |
| Wyld Runner promotion | FAQ: also loses Gang Fighter (Prospect). | Noted (campaign only). |
| Somersault | FAQ: delete the Unwieldy clause. | Deleted. |
| Assault grenade launchers (twin-linked) | FAQ: the "(twin-linked)" in the name does not give the Twin-linked trait. | No Twin-linked trait. |
| Exotic beasts and gang composition | FAQ: wargear, not counted. | Not counted. |
| Unwieldy versus `*` | FAQ: independent marks; some weapons have only one. | Slots follow the `*`/Unwieldy marks as printed. |
| Unstable on grenades | FAQ: Ammo test is automatic, so the 4+ Unstable roll always happens. | As FAQ. |
| Blast and Rapid Fire together | FAQ: extra markers land within 3" of the original on a hit, scatter separately on a miss. | As FAQ. |
| Gaseous and Toxic ammo | FAQ: one weapon per dose. | As FAQ. |
| Stimm-slug stash | ND adds "discard one Flesh Wound"; GH-GOL describes only +2 M, S, T and the 1-in-6 injury risk. | ND version, flagged (ruling 'Stimm-slug flesh wound'). |
| Smoke size | ND and GH-GOL: 5" diameter (extends 2.5" from the marker). GY shows "Blast (*)" after the FAQ added `Blast (*)` to smoke profiles. | 5" diameter cloud, no -2 Blast penalty. |
| Bio-booster, Escher | Only in a red (unreliable) cell in ND; GY shows Escher fighters with it at 35. | Trading Post only. |
| Stun grenade costs, Goliath | ND prints red (unreliable) values 25 / 25 / 15. | Not offered in the Goliath quick-start gangs. |
| Champion and Death-Maiden caps | ND prints none for the base lists. | None; half-Gang-Fighters rule only. |

## 10. Items sourced from a single community source or reasoning (Unsourced)

Every item is also recorded in `docs/needs-rules-check.md`.

- Per-type caps on Champions and Death-Maidens in a starting gang (none printed).
- The text of Fast Learner, Tools of the Trade and the Promotion rules (campaign rules; behaviour inferred from GH-CH, BC and Yaktribe usage).
- Whether the frag half of a Bolter / grenade launcher combi counts as Single Shot (the ND combi rule says yes for frag, the ND weapon table does not).
- The stub gun half of the Stub gun / plasma pistol combi: its Plentiful trait and Combi marker follow the stand-alone stub gun; no profile row was printed for it.
- Escher bio-booster availability and Goliath stun grenade costs (red cells in ND).
- Poison Blood wording (one fan source plus a Blades p.36 page tag).
- Hot-headed wording (ND and the GH-CH description agree in effect; no text of the book itself was seen).
- Whether the Stimmer can carry Special weapons (ND's Trading Post tick says yes; every other source says no).

## 11. 2026 edition note for the owner

A new edition (Necromunda Skirmish, August 2026) and new Underhive Journals (Furnace Brutes, Unborn, Wyld Hunts, Chymist Cults and others) were published after the 2023 book. Their fighter lists use different stat formats (a Sv column, numeric Ld/Cl/Wil/Int, starting XP values) and, per Tabletop Battles (28 Sept 2026), allow weapon choice by specialisation rather than by fighter type. This file follows the instruction to port the 2023 rulebook with the House of Chains and House of Blades lists. If the owner decides to follow the 2026 edition instead, sections 2, 3, 4 and 8 would need re-sourcing; the weapon profiles in section 4 should still be correct for the weapons that carried over.

## 12. Source files (relative paths, gitignored)

- `docs/sources/gangs/gw-faq-errata.txt` (official FAQ and errata, text extracted)
- `docs/sources/gangs/necrodamus-n23.txt` (full text of the fan compilation)
- `docs/sources/gangs/gyrinx-n23/` (parsed fighter and weapon data, tooltip page references, 900 public list texts)
- `docs/sources/gangs/gyrinx-seed/` (seed YAML from the Gyrinx repository)
- `docs/sources/gangs/necrodamus-extract/` (text extraction, page images of the gang pages, equipment matrices as JSON)
- `docs/sources/gangs/tb-*.txt`, `gh-*.txt`, `bc-hoc-review.txt` (Goonhammer and forum material)
- `docs/sources/gangs/wc-*.txt`, `yt-*.txt` (Warhammer Community 2026 articles, Yaktribe pages)
