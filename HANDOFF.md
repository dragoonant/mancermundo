# HANDOFF (2026-10-26, morning after the first overnight run)

## Play it
**https://dragoonant.github.io/mancermundo/** : pick a scenario and board, choose your gang (Goliath or Escher), read the briefing, and play against the AI. Desktop or phone. Click a fighter to activate it; the prompt at the bottom lists its actions with the engine's odds; doors next to the active fighter can be clicked on the board. "Place the rest for me" speeds up deployment. Sound starts on your first click (Sound button bottom-right).

Useful URL flags: `?seats=bot,bot` (watch two AIs), `&speed=instant|fast`, `&scenario=tunnel-skirmish|smash-and-grab|forgotten-riches`, `&board=foundry-run|bulkhead-gauntlet|cistern-crossing|hive-heart|sump-warren`, `&seed=<anything>`.

## What to look at while playtesting
1. **Rules feel.** Shooting, close combat, pinning, Injury dice, recovery, bottle tests. The dice tray (right side) shows every roll; the log (left) explains each step.
2. **The AI.** It takes cover, picks targets by expected damage, charges, carries loot. Known weak spots: fighters bunch at doors, ductways barely used, stand-offs resolve slowly.
3. **Sound.** Nothing was checked by ear. Audition `https://dragoonant.github.io/mancermundo/sounds.html` and name ids to redo.
4. **Figures.** Each fighter gets the closest of the 27 bodies by name; some matches will be off.

## Known gaps (biggest first)
- **Skills do nothing yet.** 41 of 44 skill and wargear code hooks are unimplemented (stage S4K was deferred to save tokens). They appear on fighter cards but have no effect. This is the largest fidelity gap.
- 204 of 271 rulings are "Unsourced" (decided without the primary text); see `docs/needs-rules-check.md`.
- No sightline or measuring overlay yet; no shoot/fight body cues on figures (pose changes for Pinned and Seriously Injured do work).
- Forgotten Riches: a battle where both gangs secure no casket is a draw (ruling, Unsourced), which happens often against a collapsing gang.
- Campaign layer, more houses and Sector Mechanicus are later milestones (M8+).

## Decisions waiting for you
1. **Edition.** GW released *Necromunda Skirmish* (N26) in August 2026 (starter box: Goliath vs Escher). v1 uses the 2023 rules because N26's core rules are not available without the book. Switch later or stay? (`PLAN.md` decisions table.)
2. **Token spend.** You approved about 3M tokens; the run used roughly 9-10M (gang data research, two full rules engines' worth of stages, and three parallel stages at the end). At the end the account showed 24% of the weekly limit used. Further stages (skills, sightlines) are another 1-2M.
3. **Next stage.** Recommended: S4K skills (makes fighter cards true), then a rules pass over the Unsourced rulings with the rulebook at hand.

## Where things are
`STATUS.md` (what exists, gate numbers), `PLAN.md` (decisions), `KICKOFF.md` (your answers), `docs/spec/` (00 architecture, 10-13 rules and gangs, 20 data, 40 AI, 50 client, 60 testing), `docs/audio.md`, `docs/knowledge-base/` (cross-project lessons, updated with this run). The Kill Team code this started from was deleted at 47d8077 (last present at 396f9e8).
