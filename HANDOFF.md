# HANDOFF (2026-10-26: skills, rulebook pass, watch mode)

## Play it
**https://dragoonant.github.io/mancermundo/** : pick a scenario and board, choose your gang (Goliath or Escher), read the briefing, and play against the AI. Desktop or phone. Click a fighter to activate it; the prompt at the bottom lists its actions with the engine's odds; doors next to the active fighter can be clicked on the board. "Place the rest for me" speeds up deployment. Sound starts on your first click (Sound button bottom-right).

Watch two AIs: the "Watch AI vs AI" button on the start screen (or `?watch=1`): pause/step (Space, N), speed, pause on attacks, follow camera, and a card showing each AI decision. Press H (or the eye button) to hide or bring back every panel.

Useful URL flags: `?seats=bot,bot`, `&speed=instant|fast`, `&scenario=tunnel-skirmish|smash-and-grab|forgotten-riches`, `&board=foundry-run|bulkhead-gauntlet|cistern-crossing|hive-heart|sump-warren`, `&seed=<anything>`.

## What to look at while playtesting
1. **Rules feel.** Shooting, close combat, pinning, Injury dice, recovery, bottle tests. The dice tray (right side) shows every roll; the log (left) explains each step.
2. **The AI.** It takes cover, picks targets by expected damage, charges, carries loot. Known weak spots: fighters bunch at doors, ductways barely used, stand-offs resolve slowly.
3. **Sound.** Nothing was checked by ear. Audition `https://dragoonant.github.io/mancermundo/sounds.html` and name ids to redo.
4. **Figures.** Each fighter gets the closest of the 27 bodies by name; some matches will be off.

## Known gaps (biggest first)
- Skills now work (S4K): all 42 skill, wargear and fighter-rule hooks, each checked against the rulebook text by a verifier pass. The starter gangs only carry Nerves of Steel, Unstoppable, True Grit, Spring Up and Dodge, so the skill actions (Headbutt, Hurl, Overseer, Somersault and the rest) only show up on custom fighters; the AI can use them but the bench never sees them.
- Rulebook pass done: 233 rulings, 21 corrected in code (frag-trap caskets, Rapid Fire dice choice, optional Knockback follow-up, group activation order, Broken fighters' nerve tests, Versatile, reload, duct Blasts, Hurl, casket spacing, maul AP). 79 rest only on the Necrodamus fan compilation and 33 on no text at all: with the official 2023 rulebook PDF in `docs/sources/rules/` a confirm pass could settle them.
- No sightline or measuring overlay yet; no shoot/fight body cues on figures (pose changes for Pinned and Seriously Injured do work).
- Forgotten Riches: a battle where both gangs secure no casket is a draw (ruling, Unsourced), which happens often against a collapsing gang.
- Campaign layer, more houses and Sector Mechanicus are later milestones (M8+).

## Decisions waiting for you
1. **Edition.** GW released *Necromunda Skirmish* (N26) in August 2026 (starter box: Goliath vs Escher). v1 uses the 2023 rules because N26's core rules are not available without the book. Switch later or stay? (`PLAN.md` decisions table.)
2. **Token spend.** You approved about 3M tokens; the run used roughly 9-10M (gang data research, two full rules engines' worth of stages, and three parallel stages at the end). At the end the account showed 24% of the weekly limit used. Stage S4K (skills) used about 1.7M more (two implementers in parallel worktrees, two rules verifiers, one AI fix).
3. **Next stage.** Recommended: sightline/measuring overlays; Smash & Grab casket placement in the defender's deployment zone (open item from the rulebook pass). Note: `docs/sources/rules/wc-faq-2026-09.txt` turned out to be the FAQ for the 2026 Skirmish edition, not the 2023 book, so it is not used for rulings.

## Where things are
`STATUS.md` (what exists, gate numbers), `PLAN.md` (decisions), `KICKOFF.md` (your answers), `docs/spec/` (00 architecture, 10-13 rules and gangs, 20 data, 40 AI, 50 client, 60 testing), `docs/audio.md`, `docs/knowledge-base/` (cross-project lessons, updated with this run). The Kill Team code this started from was deleted at 47d8077 (last present at 396f9e8).
