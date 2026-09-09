# Game Design

## Core loop

The player already knows which category a word belongs to — the challenge is never
"what category is this?". The challenge is *reaching* the right card: it may be
face-down, buried under mismatched cards, or blocked because its Category Slot isn't
active yet. The game is spatial and sequential, not trivia.

Target feeling (spec section 73):

```
see a messy table → sort a little → space opens up → finish one category
→ clear another → the whole table is empty
```

This should read as "tidying up a pile of knowledge cards," not "being quizzed." The
categories in the shipped dataset are deliberately easy (水果, 動物, 顏色 — fruit,
animals, colors), so the cognitive load stays on *planning moves*, not *recalling
facts*.

## The three structural pieces

1. **Word Cards** — the things being sorted.
2. **Category Cards** — a scarce, special card type with an inverted stacking rule
   (see `docs/game-rules.md`) that creates the game's core tension: you can organize
   words into stacks freely, but you cannot *finish* a category until its Category
   Card has a free Slot to activate into. With more categories in a level than
   Category Slots, the player must actively juggle which categories to finish first
   to free up slots for the rest — this is the primary source of difficulty, not
   vocabulary difficulty.
3. **Category Slots** — a hard cap on how many categories can be "in progress" at
   once (spec section 12/14).

## No failure states

No move limit, no timer-driven loss, no energy system (spec sections 25/26/38). Moves
and time only ever affect *scoring* (stars, coins), never whether the player can keep
playing. The deck recycles infinitely so a bad draw order can never hard-lock a level.
This keeps the tone closer to a "tidy a bookshelf" activity than a competitive puzzle.

## Visual direction

Warm library / stationery aesthetic: cream paper, wood tones, soft shadows, rounded
cards — see the `--paper`/`--wood`/`--accent` tokens in `src/index.css`. Deliberately
avoids saturated "candy" colors, casino gold, or heavy pop-up chrome (spec section 50).
