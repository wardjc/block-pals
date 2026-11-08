# Village Step 2: Eating and the Farm Implementation Plan

**Status: plan approved by the parent (2026-11-08); build in chunks, each reviewed (Claude builds, Codex reviews; Claude is the fallback builder and reviewer if Codex is out of allowance). Docs only: this PR contains no product code.**

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Our player gets food and a farm. Fern gives him starter seeds (once, with a picture and her voice). He plants seeds anywhere on grass or soil, taps a plant to give it water or sunshine (each tap grows it one stage, with a sparkle and a soft sound), and the plants also grow slowly by themselves in real time, so they are bigger when he comes back. He picks ripe plants by pressing and holding, and eats apples, carrots and potatoes and drinks milk with a munch animation, a synthesised munch sound and a plain-word reaction from Pip. Friendly chickens, cows, sheep and a pig wander in a fenced pasture beside the farm, make happy noises, walk over when he holds out food, and give eggs, milk, wool (which he crafts into coloured blocks) and, from the pig, a potato. Nothing wilts, nothing dies, no animal is ever hurt, nothing is lost, nothing needs reading, and there is no hunger.

**Architecture:** Same layering as step 1. Pure, DOM-free logic in `src/core/` (item registry, growth clock, crop rules, farm layout, save fields) and `src/game/` (farm system, herd AI, eating, hints) is unit-tested with Vitest, including real generated worlds. **Crops are real non-solid blocks in the world** (a "cross" shape, one block id per crop and stage), so picking, chunk meshing, culling, saving, "no placing into it" and the camera all reuse what already exists; a small `Farm` system keeps only the growth timers. Apple trees are real `Wood`/`Leaves` blocks stamped by stage. Animals are entities (not blocks), like villagers and Pip, drawn as one merged mesh each. Rendering gains the cross-plane mesher shape, new atlas tiles, animal models and one pooled sparkle `Points` object. `main.ts` only wires.

**Tech Stack:** TypeScript 5 (strict), Vite 8, Three.js 0.187, Vitest 5, Playwright 1.65, Web Audio API. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-05-block-pals-design.md` (§4 anti-goals, §5 constraints, §7a gestures, §7b requests, §7c camera, §7d Village design and the step 2 "Done when"). Builds on `docs/superpowers/plans/2026-11-07-village-step1-bigger-world.md` (merged). Water (`2026-11-07-water-step1-flow-and-swimming.md`) is later and is **not built here**; this plan only keeps the farm compatible with it.

**Dependencies:** Village step 1 merged to `main` (it is: 96×20×96 world, village, `blockpals.save.v2`). Voice clips (PR #12) merged (it is). Task 11 needs the `tools/voice` venv and model cache on the machine that regenerates clips.

## Global Constraints

Decisions already made with the parent, **binding** (recorded verbatim), then the standing rules.

**Decisions made with the parent (binding):**
- **Eating:** food items; eating = a munch animation + a short synthesised munch sfx + Pip reacts with a plain-word line (NO "Yum"-type interjections); NO hunger bar and nothing bad ever happens if he doesn't eat; each villager will have a favourite food (used for friendship in step 4: only store the data now).
- **Farm:** wheat, carrots, potatoes and apple trees. He plants seeds, then TAPS to water or give sunshine: each tap advances a plant one stage with a sparkle (instant feedback; gentle science link). Plants ALSO grow slowly by themselves in real time (so they are bigger when he returns). NOTHING EVER WILTS OR DIES. Harvest by the existing press-and-hold dig rule or a tap (this plan decides which fits §7a). He can dig his own farm patch.
- **Friendly animals:** chickens (eggs), cows (milk), sheep (wool for coloured blocks), a pig. They wander gently, make happy noises (synthesised sfx, not speech), come over when he holds out food, and give things (eggs/milk/wool). NO ANIMAL IS EVER HURT OR EATEN: they cannot be dug/damaged, and are never chased or scary. Not solid (like villagers), never block doors, can't be trapped (placing a block into an animal's cell is refused, like villagers).
- **Fern the Farmer** gives seeds and picture jobs; jobs, quests and hearts are step 4. In step 2 only: Fern gives starter seeds once (picture + voice); animals and fields exist.
- **Everything works without reading;** counts of 20 or fewer are shown as digit + dots (the bag holds up to 99 per kind; recipes and prices stay at 20 or fewer).
- **Not in this step:** coins and shops (step 3), hearts, quests, favourites in use (step 4), flowing water, ditches and the bucket (water step), bread/cake/biscuits (Bramble bakes them in step 3).

**Standing rules (from the spec and step 1; unchanged):**
- British English in every string and voice line. Lines: **at most 12 words, four variants per key, no cheer or sound words** (`ooh|hmm|ta-da|hup|whee|yay|hooray|yum|mmm|aww` and the like: tablet speech and Kokoro read them out as words; excitement comes from separate synthesised sfx and animation), **no "tap/click/touch" in Pip's lines** (existing test), true wherever and however often they can fire, no promises of later steps.
- Always daytime, nothing dark, nothing scary, nothing hurt, nothing lost. Nothing in this step can fail, expire, wilt, be eaten by an animal, or be taken away.
- No network calls at runtime, no analytics, no links out, no new dependencies. Works offline.
- Target device: Galaxy Tab A8 (1920×1200, Unisoc T618), landscape, Chrome. A steady 30 fps or better with the village **and** the farm in view. Pixel ratio capped at 1.5. No real-time shadows.
- Touch targets at least 88 CSS px. **Quick tap with the hand walks, press and hold (about ½ s) digs, drag turns the view (§7a, §7c). This step does not change the timings, thresholds or meaning of any of them.** It adds new things a quick tap can land on (a plant, an animal), nothing that a tap destroys.
- Never write a child's real name anywhere (code, tests, lines, commits, PR text). "Our player", "he".
- Save: `blockpals.save.v2` stays the key and `version` stays 2; all new fields are **additive and optional**. The v1 key `blockpals.save.v1` is never written, changed or deleted by this build, and the backup, bad-copy, conflict and "never lower `gen`" rules from step 1 are unchanged.
- Block ids are saved as numbers in `edits`: **existing ids never change; new blocks are appended** (ids 16 to 35 in Task 2). Item ids live in their own range from 100 (Task 1).
- Everything he builds is real. He may dig or build on the farm, the pasture and the fence like anywhere else. Only bedrock and water cannot be dug.

## Review Focus

- **Losing anything:** seeds can never run out for good (every harvest returns seeds, an early pull returns the seed, Fern tops up an empty bag); a harvest or gift that would overflow a stack (99) is refused whole and the plant or animal is left as it was; save fields are validated, bad entries skipped, and a bad value never costs him the rest (Tasks 1, 4, 8, 10).
- **Anything dying or wilting:** stages only ever go up. A test drives random sequences of ticks, clock jumps, taps and saves and asserts no stage ever decreases and no plant block ever disappears except by his own hold (Tasks 3, 4, 9).
- **Animals hurt or trapped:** animals are not blocks, so no dig path can reach them; hold on an animal does nothing (and cannot dig the ground behind it); the block under an animal's feet cannot be dug; placing into an animal cell is refused; an animal with no free neighbour for 6 s is lifted to a free spot; animals never leave the pasture; no state or event named hurt, scared, eaten or dead exists (Tasks 6, 8, 9).
- **Gestures (§7a):** the four tap/hold/drag rules are re-tested unchanged. A tap on a plant helps it only when in reach (otherwise it walks beside it as before). A tap never digs or harvests; harvest is press and hold (Task 6).
- **The camera in a field:** crops are non-solid plants. The smart camera must pass through them (tall wheat must not shove the camera), while taps must still pick them (Task 2).
- **Clock:** the wall clock can go backwards, jump forward, or the tab can sleep. Growth uses one rule that never goes negative, never exceeds a cap, and never punishes (Task 3).
- **Hotbar overflow (existing latent bug):** the bar shows at most 9 kinds, but step 1 already added blocks beyond that; farm items make it worse. Task 14 fixes it with a bag slot.
- **Voice policy:** every new line passes the policy tests, has a clip for the right speaker (Pip or Fern), and `tools/voice/lines.json` is regenerated (Task 11).
- **Tablet performance:** many crops (merged into chunk meshes), 10 animals (10 draw calls), one sparkle pool (1 draw call), chunk rebuild cost per stage change (Tasks 4, 12, 17).

## Decisions made in this plan

Marked **(my call)** where the spec or the parent left room. The parent can overrule any; the six open questions were answered by the parent and are recorded at the end as "Decisions confirmed by the parent".

| Topic | Decision |
|---|---|
| Item model | `StackId = BlockId \| ItemId`. `ItemId` is a new enum starting at **100** (`WheatSeed` 100, `CarrotSeed` 101, `PotatoSeed` 102, `AppleSapling` 103, `Apple` 104, `Carrot` 105, `Potato` 106, `Wheat` 107, `Egg` 108, `Milk` 109, `Wool` 110; 111 to 119 reserved for step 3's bread, cake, biscuit). Block ids stay below 100, so one number identifies anything and **no existing id changes**. A registry `ITEMS: Record<ItemId, ItemDef>` (`name`, `icon` emoji, optional `badge` emoji, `edible`, `kind: 'seed'\|'food'\|'gift'`) is validated like `BLOCKS`. Items use emoji pictures (as bubbles and door signs already do); blocks keep atlas tiles. (my call) |
| Inventory | `Inventory` is generalised to `StackId` with the same 99 cap and the same API. `toJSON()` keeps returning **block kinds only** (so the saved `inventory` field is byte-compatible with step 1). New `itemsToJSON()`. `slots()` returns blocks then items in first-obtained order. `hotbar()` keeps meaning blocks only so old tests stand. |
| Saving items | New optional `items: Record<number, number>` and `itemOrder: number[]` beside the untouched `inventory` and `order`. (my call: separate fields, so a step 1 build that re-saves cannot mistake an item id for a bad block id and blank his bag; it simply does not see the items.) |
| What "using" means | Selection is `StackId \| 'hand'`. Seed or sapling selected: a quick tap on soil plants. Edible selected: the big **munch button** appears and eats one. Any food selected: animals walk over, a quick tap on a close animal feeds it. Wool, egg, wheat: ingredients; wool is crafted into coloured blocks in the existing craft screen (picture recipes). Blocks: unchanged (tap builds). |
| Edible | Apple, carrot, potato, milk (drunk). Wheat, egg, wool, seeds are not edible (the munch button never shows for them). Raw potato is a crunchy little new potato (my call). Bramble's cooked foods come in step 3. |
| Eat trigger | **Select the food (a tap on its slot), then tap the big munch button** (96 px, picture only, shown only while an edible is selected, pulses gently the first time). Not "tap the selected slot again" (an accidental second tap would eat his carrots) and not hold (§7a: hold means dig). The pad's Place button eats when an edible is selected and nothing is in front to feed. (my call) |
| No "full" rule | No hunger and no fullness: each tap eats one, the button is debounced for the 1.3 s animation so a double tap cannot eat two. Nothing is tracked. |
| Munch animation | The player's arms raise, the head dips three times, and a small picture of the food (its emoji sprite) in front of his face shrinks over three bites, then three crumb sparkles. 1.3 s. He can still walk during it (nothing locks). Pip reacts once the animation ends, at most once per 20 s. |
| Crops are blocks | Non-solid, collectable, transparent "cross" blocks (two crossed quads), one id per crop per stage: `Wheat0..3` 24 to 27, `Carrot0..3` 28 to 31, `Potato0..3` 32 to 35 (stage 0 sprout, 1 growing, 2 big, 3 ripe). Also `Farmland` 16, `Fence` 17, `WoolWhite/Red/Blue/Yellow` 18 to 21, `Sapling` 22, `AppleLeaves` 23. They are saved in `edits` for free. Walking through plants is harmless (nothing is trampled). (my call) |
| Where he can plant | **No hoe and no tool.** With a seed selected, a quick tap on the top of any **Grass, Dirt or Farmland** block in reach (with a free cell above) plants there and turns Grass or Dirt into `Farmland` (dark tilled soil). So his own patch can be anywhere. Not on sand, path, planks or stone. Digging a Farmland block gives Dirt. (my call: simplest possible for a 5-year-old) |
| Growth | 4 stages for crops. **Natural: 150 s per stage** (ripe about 7.5 minutes after planting, so a return after lunch finds a field of ripe plants). **Tap: advances one stage at once** (3 taps seed to ripe), resets that stage's timer, never past ripe. Cue by stage: 0 to 1 water drops (blue), 1 to 2 sunshine (yellow), 2 to 3 both. Constants live in one place and are tuned on the tablet. |
| Clock | One pure `GrowthClock`: each second it adds `min(max(0, now - last), 8 h)` and sets `last = now`. If the clock went backwards the step is 0 (no growth, no penalty, `last` moves on). Load uses `last = savedAt`, so offline growth is capped at 8 hours. A sleeping tab simply sees one big step on its next tick, with the same cap. Nothing is ever subtracted. |
| Harvest | **Press and hold (the existing ring), not a tap** (§7a: a tap never digs; picking is taking a block). Ripe: 2 of the food and 2 of its seed (apple tree fruit: 2 apples + 1 sapling). Pulled early (stages 0 to 2): just the seed back (nothing lost, a way to move a plant). The plant block goes, soil stays. If any yield would pass 99 the whole harvest is refused with the existing "bag full" line and the plant stays. |
| Replanting | Soil stays `Farmland`; plant again right away. |
| Apple trees | `AppleSapling` planted like a seed on Grass, Dirt or Farmland. Stage 0 sapling (cross block), 1 young tree (trunk 2, small leaves), 2 full tree (trunk 4, 3×3 canopy like the world's trees), 3 ripe (four canopy cells become `AppleLeaves`, red-dotted). Tap-help works the same on any block of the tree. Stamping only fills **Air** cells (never replaces anything he built; if blocked it keeps what fits and tries again next stage). Holding on `AppleLeaves` picks fruit: the block becomes ordinary `Leaves`, and the tree re-ripens 180 s later. The tree itself is never harmed by picking. |
| Fields | Reserved plot `x 72..83, z 35..43`: three 2-wide `Farmland` beds (`z 35..36`, `38..39`, `41..42`, `x 72..79`) with 1-wide aisles of Dirt between, so every bed cell is within reach 3 of an aisle. A **small pool** at `x 81..83, z 35..36` (6 `Water` source blocks, top flush with the ground, ringed on all sides by solid ground) and a **reserved empty irrigation aisle** along `z 37` from the pool west to the beds (plain Dirt, nothing stamped). The water step turns that aisle into a ditch; this step only keeps it empty and tests that. No fence round the plot (it is his space). (my call) |
| Pasture | Fenced pasture `x 62..84, z 46..55` south of the plot (needs its own level pad: `GEN_VERSION` goes 1 to 2). Fence: one block high (so it can be stepped over, never a trap), with a 2-wide gate gap on the north side at `x 74..75` joined to the plot by a 3-wide path. Tests assert no overlaps and 2-cell gaps, so the implementer may nudge a cell or two. |
| Stamps and old saves | The generator is deterministic from the seed, so an old save regenerates the farm, pool, pasture and fence fresh and then replays his edits on top (edits always win), exactly as step 1 did. `gen` in the save becomes 2 on the next write. |
| Animals | 10 animals: 4 chickens, 2 cows, 3 sheep, 1 pig. Entities with `{ id, kind, x, y, z, heading, state, giftIn }`; states `idle`, `walk`, `graze`, `come`, `happy` (no hurt/scared/eaten state exists). **They stay inside the pasture interior** (a rule, not collision), so nobody wanders off or gets lost. Not solid, never in a doorway (the pasture has no house), cannot be trapped. They give way: within 1 block of him an animal steps calmly aside. Speeds 0.7 to 1.0 blocks/s wandering, 1.6 when coming over (his walk is 3.5). |
| Pathing | No global A*. Each animal steers greedily to a random target 2 to 5 cells away and picks another when a step is not standable (`isStandable` + `canStep` from `pathfind.ts`, inside the pasture, not an occupied cell). Coming over: target = the standable pasture cell nearest him, never closer than 1.2. Needs no navigation mesh and is `O(animals)` per frame. |
| Holding out food | Selecting **any food** (apple, carrot, potato or wheat; every animal accepts every food, no favourites for animals in this step) makes the animals within 10 blocks of him walk over. They crowd to within 1.2 to 3 blocks, never touching. Selecting anything else, or the hand, sends them back to wandering. |
| Feeding and gifts | A **quick tap on a close animal** (within reach 3) while holding **any food** feeds it: one food is used, a heart sparkle, its happy noise, and its gift appears in the bag at once (chicken egg, cow milk, sheep wool, pig a potato it "found"). Each animal then rests **45 s** (`giftIn`): feeding a resting animal uses **no food**, just a happy noise (never wasted). A tap with the hand or anything that is not a food **pets** (heart sparkle, noise, no gift, no cost). If the gift cannot fit (99), nothing is used and Pip says the bag-full line. Gifts are never scarce (10 animals) and never lost. (my call) |
| Hold on an animal | Does nothing: no ring, no dig. The press-and-hold target picker ignores the block behind an animal's on-screen disc, so a finger on a cow never digs the grass behind it. |
| Taps on plants (§7a) | A quick tap on a plant (any selection) **within reach 3 helps it** (sparkle and sound). Further away it **walks beside it**, exactly like tapping any block. A plant at the ripe stage ignores the help (a tiny chime and a one-time Pip hint to press and hold). So the hand can still walk anywhere; only the cell that holds a plant changes meaning. |
| Entity picking | Animals are picked in screen space: a projected disc of 56 px radius (112 px across, above the 88 px minimum) around the animal's centre, nearest wins, tried before the voxel ray. Pure function, unit-tested. |
| Animal rendering | One merged box mesh per animal with vertex colours (about 70 to 120 triangles, one draw call each, 10 in all). Idle motion moves the whole mesh (bob, a yaw sway, a chicken peck as a forward tilt), at render rate, no skeleton. Animals beyond fog distance are hidden and animals 30+ blocks away tick at 2 Hz. |
| Sparkles | One pooled `THREE.Points` of 64 particles, 12 per burst, life 0.8 s, one draw call for every effect: water drops, sun, hearts, crumbs, and a rare gentle shimmer on one ripe plant near him. |
| Sound | New synthesised sfx in `src/audio/sfx.ts` (no clips, no speech): `water`, `sun`, `plant`, `pick`, `munch` (three soft noise bites), `drink`, `gift`, `pet`, and `cluck`, `moo`, `baa`, `oink`. Each is 1.2 s at most, quiet, a few oscillators. Animal idle noises: one animal at a time, at most one per 3 s, only when it is within 12 blocks of him and no voice line is playing. |
| Fern | When Fern's existing hello fires and `flags.fernSeeds` is false, she speaks a seed line (instead of the hello that time), and he gets 5 each of wheat, carrot and potato seeds and 2 apple saplings, with a 🌱 bubble and the `gift` sound; the flag is saved at once. Later, if he has no seeds at all and nothing growing, her next hello is a "more seeds" line and gives 3 of each. No tapping Fern, no new gesture. (my call) |
| Favourites (step 4) | Data only: `favourite` on each `VillagerDef` as a name (`bramble: 'cake'`, `pebble: 'carrot'`, `fern: 'apple'`, `willow: 'biscuit'`). `cake` and `biscuit` are not items yet (step 3). Nothing reads it. (my call for Fern) |
| Hints | Once-only, saved: `plantSome` (has seeds and is near the plot), `needWaterSun` (after the first plant), `cropReady` (first ripe plant), `holdOutFood` (first time near the pasture with a food), `tryMunch` (first time an edible is selected). Reactions (ate, harvested, fed, egg and so on) are rate-limited to one per 4 s by the existing Pal gap and one per kind per 20 s. |
| Water compatibility | The pool is ordinary `Water` source blocks fully walled at pool level; growth speed goes through `growthRateAt(world, cell)` which returns `1` today (the water step may return more near water); no plant block id or timer assumes dry ground. Ditches, the bucket and watering from the pool are the water step's job. |
| Hotbar | Hotbar = hand + at most 8 stacks (first-obtained order, blocks and items together) + a **bag slot** whenever there are more than 8 stacks or the selected stack is not in the first 8. The bag slot opens the **bag tray**: a picture grid of every stack with its digit and, up to 20, dots; tapping a stack selects it and closes the tray. The tray pauses the game like the craft screen. This also fixes the existing 9-kind limit. |
| Save timing | `savedAt` (ms epoch) is written in every save beside the crop timers. Stage changes and animal gifts mark the save dirty; timers and animal positions ride along on any save (and on the hidden-tab save). |

## Who builds what

Claude builds, Codex reviews. Codex also builds the small pure-logic tasks (it often hangs on long writing, so it gets only these; if it hangs twice, Claude takes the task). Every task is reviewed by the other agent before merging. Codex is invoked with `codex exec --full-auto "<task text from this plan + spec path>"`.

| Task | Builder | Reviewer |
|---|---|---|
| 1 Item model and inventory | Claude | Codex |
| 2 New blocks, plant shape, tiles, camera passes plants | Claude (art) | Codex |
| 3 Growth clock and crop rules (pure) | Codex | Claude |
| 4 Farm system: plant, help, harvest, trees | Claude | Codex |
| 5 Farm layout in worldgen | Claude | Codex |
| 6 Tap, hold and entity picking | Claude | Codex |
| 7 Eating and edible table | Claude | Codex |
| 8 Herd: wander, come over, feed, gifts | Claude | Codex |
| 9 Invariant tests (nothing wilts, hurt or lost) | Codex | Claude |
| 10 Save fields | Codex | Claude |
| 11 Lines, Fern, favourites, voice clips | Claude | Codex |
| 12 Render: animals, sparkles, shimmer, munch | Claude | Codex |
| 13 Sounds | Claude | Codex |
| 14 HUD: hotbar, bag tray, munch button | Claude | Codex |
| 15 Recipes: wool to coloured blocks | Codex | Claude |
| 16 Wire it together | Claude | Codex |
| 17 Budget and performance | Claude | Codex |
| 18 Browser story (e2e) | Claude | Codex |
| 19 README and spec status | Claude | Codex |

## File Structure

New or changed. Everything else stays as in step 1.

```
src/core/items.ts          NEW  ItemId, ITEMS, StackId, isItemId/isStackId, EDIBLE, FEEDS, GIFT
src/core/inventory.ts      CHG  StackId, slots(), itemsToJSON(), fromJSON(o, order, items, itemOrder)
src/core/blocks.ts         CHG  append ids 16..35; BlockDef.shape ('cube'|'cross'), plant info; dropFor()
src/core/growth.ts         NEW  GrowthClock, STAGE_MS, OFFLINE_CAP_MS, advanceStage()
src/core/crops.ts          NEW  CropKind, cropBlock(kind, stage), cropOf(id), yields(), canPlant(), cue(stage)
src/core/recipes.ts        CHG  inputs/outputs become StackId; four wool recipes
src/core/crafting.ts       CHG  StackId
src/core/worldgen.ts       CHG  GEN_VERSION 2; pasture pin
src/core/village.ts        CHG  farm beds, pool, irrigation aisle, pasture, fence, gate, herdSpawns in VillageLayout
src/core/save.ts           CHG  items, itemOrder, savedAt, crops, trees, animals, flags.fernSeeds, hints
src/game/farm.ts           NEW  Farm: records, plant/help/harvest/advance, trees, ripe index, events
src/game/animals.ts        NEW  Herd, Animal, AnimalKind, feed(), update(), rescue()
src/game/eating.ts         NEW  EatState (1.3 s, debounce), reaction key per food
src/game/hints.ts          NEW  FarmHints (once-only + rate limits)
src/game/game.ts           CHG  selected: StackId|'hand'; intents plant/help/feed/pet/eat; collect() harvest branch; occupied includes animals
src/input/tap.ts           CHG  resolveTap/resolveHold: plant, help, animal-first; unchanged otherwise
src/input/entityPick.ts    NEW  pickAnimal(): screen-space discs
src/content/lines.ts       CHG  16 new Pip LineKeys
src/content/villagers.ts   CHG  favourite; FERN_LINES.seedGift/moreSeeds
src/content/spoken.ts      NEW  spokenLines(): every line per speaker (used by the exporter and the clip test)
src/audio/sfx.ts           CHG  farm and animal sounds
src/render/atlas.ts        CHG  ROWS 6 -> 10; 20 new tiles
src/render/mesher.ts       CHG  'cross' shape into the transparent builder
src/render/voxelRay.ts     CHG  blocksRay(id, forCamera): the camera ignores plants
src/render/animals.ts      NEW  makeAnimalModel(kind, variant), AnimalView
src/render/effects.ts      NEW  Sparkles (pooled Points), bursts, shimmer
src/render/characters.ts   CHG  eat pose and bite sprite on the player model
src/ui/hud.ts              CHG  hotbar with bag slot, munch button
src/ui/bag.ts              NEW  BagTray: picture grid with digit + dots
src/main.ts                CHG  wiring, debug hooks
tools/voice/export-lines.ts CHG use spokenLines()
tools/voice/lines.json, public/voice/** CHG regenerated clips (pip, fern)
tests/core/{items,inventory,growth,crops,farmLayout,save,world}.test.ts
tests/game/{farm,animals,animalsInvariants,farmInvariants,eating,hints,game}.test.ts
tests/input/{tap,entityPick}.test.ts, tests/content/{lines,voice-clips,spoken}.test.ts
tests/render/{mesher,budget,farmBudget,cameraFarm,animals,effects}.test.ts, tests/ui/{hud,bag}.test.ts, tests/audio/sfx-farm.test.ts
e2e/farm.spec.ts
```

---

### Task 1: Item model and inventory

**Files:** Create `src/core/items.ts`, `tests/core/items.test.ts`. Modify `src/core/inventory.ts`, `src/core/crafting.ts`, `src/core/recipes.ts` (types only), `tests/core/inventory.test.ts` (existing or new).

**Interfaces:**
```ts
export enum ItemId { WheatSeed = 100, CarrotSeed, PotatoSeed, AppleSapling, Apple, Carrot, Potato, Wheat, Egg, Milk, Wool }
export type StackId = BlockId | ItemId;
export interface ItemDef { id: ItemId; name: string; icon: string; badge?: string; kind: 'seed' | 'food' | 'gift'; edible: boolean }
export const ITEMS: Record<ItemId, ItemDef>;
export const isItemId = (n: number): n is ItemId;      // Object.hasOwn(ITEMS, n)
export const isStackId = (n: number): n is StackId;    // block (not Air/Bedrock) or item
export const FEEDS: readonly ItemId[];   // Apple, Carrot, Potato, Wheat: accepted by EVERY animal (parent's decision; seeds and milk are not feed)
export const GIFT: Record<'chicken' | 'cow' | 'sheep' | 'pig', ItemId>;  // Egg, Milk, Wool, Potato
// Inventory
slots(): StackId[];                       // blocks then items, first-obtained order, held only
itemsToJSON(): Record<number, number>;    // item kinds only
static fromJSON(o, order?, items?, itemOrder?): Inventory;  // invalid items are ignored, never poisoning blocks
```

- [ ] **Step 1:** Tests in `tests/core/items.test.ts`: `item ids are stable` (numbers 100..110 pinned; none below 100); `no item id collides with a block id`; `every item has a picture and a simple name`; `edible set is apple, carrot, potato, milk`; `FEEDS is exactly apple, carrot, potato, wheat` and `every animal kind gives a registered item`; `seeds have a badge`.
  `tests/core/inventory.test.ts` additions: `holds items up to 99 and refuses past it` (add returns the amount that fitted); `slots keeps first-obtained order across blocks and items`; `toJSON is blocks only (byte-identical to step 1 for a block-only bag)` (snapshot a known bag); `itemsToJSON round-trips`; `bad item entries are skipped without touching the blocks` (e.g. `{ "100": -1 }`, `{ "999": 3 }`, `{ "104": 500 }`); `Air, Bedrock and unknown ids still rejected`. All existing inventory and crafting tests pass unchanged.
- [ ] **Step 2:** Run `npx vitest run tests/core`. Expected: new tests FAIL. Implement. Expected: PASS.
- [ ] **Step 3:** `npm run typecheck`. `Game.selected` and `Recipe` become `StackId` here (type-only; behaviour in later tasks). Commit `feat(items): item registry and stack ids`.

### Task 2: New blocks, plant shape, tiles, camera passes plants

**Files:** Modify `src/core/blocks.ts`, `src/render/atlas.ts`, `src/render/mesher.ts`, `src/render/voxelRay.ts`, `src/render/cameraRig.ts` (call site), `tests/core/world.test.ts`, `tests/render/mesher.test.ts`; create `tests/render/cameraFarm.test.ts`.

**Interfaces:**
```ts
// appended after Lamp = 15. Existing ids MUST NOT change.
Farmland = 16, Fence, WoolWhite, WoolRed, WoolBlue, WoolYellow, Sapling, AppleLeaves,
Wheat0 = 24, Wheat1, Wheat2, Wheat3, Carrot0 = 28, Carrot1, Carrot2, Carrot3, Potato0 = 32, Potato1, Potato2, Potato3
export interface BlockDef { /* + */ shape?: 'cube' | 'cross'; plant?: { kind: 'wheat' | 'carrot' | 'potato' | 'apple'; stage: number } }
export function dropFor(id: BlockId): BlockId;   // Farmland -> Dirt; everything else -> itself
export function blocksRay(id: BlockId, forCamera = false): boolean;   // forCamera: false for shape 'cross'
```
Plants: `solid: false, collectable: true, transparent: true, shape: 'cross'`. `Farmland`, `Fence`, wool: solid cubes. `Sapling`: cross plant (apple, stage 0). `AppleLeaves`: solid transparent cube like Leaves.

- [ ] **Step 1:** Tests. `block ids are stable`: 0..15 unchanged (existing snapshot), new ids pinned. `plants are walkable`: `isStandable` over a Farmland cell with Wheat3 above is true (plants are non-solid). `crossed plants mesh as 4 quads`: a single Carrot2 yields 16 vertices and 8 triangles in `transparent`, none in the solid arrays (both windings are emitted, so no material change); neighbouring cube faces next to a plant are still drawn. `atlas has a tile for every new block` and `tile rows fit` (ROWS 10). `camera ignores plants`: `blocksRay(Wheat3, true) === false`, `blocksRay(Wheat3) === true` (taps still pick plants), leaves and glass still block the camera; a `CameraRig` test puts a field of ripe wheat between head and wanted position and asserts the distance is **not** shortened; the same test with Planks shortens it. `Farmland drops Dirt`.
- [ ] **Step 2:** Run `npx vitest run tests/core tests/render`. Expected: FAIL. Implement; the 20 new tiles are original 16×16 procedural art, bright and friendly: Farmland top (dark soil with furrows) and side, Fence (slatted wood), four wool colours (soft knit pattern), Sapling, AppleLeaves (leaves with red dots), and per crop four stage tiles (sprout, leafy, tall, ripe: golden wheat heads, orange carrot tops, potato flowers). Transparent pixels outside the plant so the cross reads as a plant. Expected: PASS.
- [ ] **Step 3:** Look at it once with the Playwright MCP tool (a debug-planted field, camera low in the wheat). Commit `feat(farm): plant blocks, cross mesher shape, farm tiles`.

### Task 3: Growth clock and crop rules (pure)

**Files:** Create `src/core/growth.ts`, `src/core/crops.ts`, `tests/core/growth.test.ts`, `tests/core/crops.test.ts`.

**Interfaces:**
```ts
export const STAGE_MS = 150_000;            // crops, per stage
export const TREE_STAGE_MS = [180_000, 240_000, 180_000];   // sapling->young, young->full, full->ripe
export const APPLE_REGROW_MS = 180_000;
export const OFFLINE_CAP_MS = 8 * 3600_000;
export class GrowthClock {
  constructor(last: number);                // wall ms
  /** ms to add to every timer now. Never negative, never above the cap. Always moves `last` on. */
  step(now: number): number;
}
/** Adds ms to a timer; returns the new stage (never lower) and leftover ms. Ripe keeps no leftover. */
export function advanceStage(stage: number, progress: number, add: number, stageMs: number[] | number, max: number): { stage: number; progress: number };
export type CropKind = 'wheat' | 'carrot' | 'potato';
export function cropBlock(kind: CropKind, stage: number): BlockId;
export function cropOf(id: BlockId): { kind: CropKind | 'apple'; stage: number } | null;
export function seedFor(kind: CropKind | 'apple'): ItemId;
export function yields(kind: CropKind | 'apple', stage: number): Array<{ id: ItemId; n: number }>;
export function cue(stage: number): 'water' | 'sun' | 'both';   // the stage being left: 0 water, 1 sun, 2 both
export function growthRateAt(world: World, cell: Cell): number;  // 1 today; the water step may raise it
export function canPlant(world: World, cell: Cell, occupied: Cell[]): boolean;  // Air at cell and above, Grass/Dirt/Farmland below
```
Yields: ripe crop = 2 food + 2 seeds; stages 0 to 2 = 1 seed; apple ripe = 2 `Apple` + 1 `AppleSapling`.

- [ ] **Step 1 (Codex):** Tests. Clock: `normal step`; `clock going backwards adds nothing and recovers` (step(100), step(50) = 0, step(80) = 30); `a jump of a week is capped at 8 hours`; `NaN and Infinity add nothing`; `never negative over 10,000 random steps`. Stage: `adds up across stages` (add 2.5 × STAGE_MS from stage 0 gives stage 2 with half a stage left); `stops at ripe`; `stage never decreases` (property test, 200 random sequences of adds, including zero and huge). Rules: `cropBlock/cropOf round-trip for all 12 ids`; `yields never empty and always include a seed` (so he can never run out); `an unripe pull returns exactly one seed`; `cue sequence is water, sun, both`; `canPlant` accepts Grass/Dirt/Farmland with Air above and refuses Sand, PathStone, Planks, an occupied cell, a cell with a plant already, and a cell without room above.
- [ ] **Step 2:** Run `npx vitest run tests/core/growth.test.ts tests/core/crops.test.ts`. Expected: FAIL. Implement. Expected: PASS.
- [ ] **Step 3:** Commit `feat(farm): growth clock and crop rules`.

### Task 4: Farm system: plant, help, harvest, trees

**Files:** Create `src/game/farm.ts`, `tests/game/farm.test.ts`. Modify `src/core/placement.ts` (re-export `canPlant`).

**Interfaces:**
```ts
export interface CropRec { x: number; y: number; z: number; p: number }       // progress ms toward the next stage; kind and stage come from the block
export interface TreeRec { x: number; y: number; z: number; stage: 0 | 1 | 2 | 3; p: number }   // x,y,z = trunk base cell
export type FarmEvent =
  | { type: 'planted'; cell: Cell; kind: CropKind | 'apple' }
  | { type: 'helped'; cell: Cell; cue: 'water' | 'sun' | 'both'; ripe: boolean }
  | { type: 'ripe'; cell: Cell }                      // a stage reached ripe (by help or by time)
  | { type: 'harvested'; cell: Cell; ripe: boolean; got: Array<{ id: ItemId; n: number }> }
  | { type: 'full' }                                   // a yield would pass 99: nothing changed
  | { type: 'rest' };                                  // helped a ripe plant: nothing to do
export class Farm {
  constructor(world: World, inv: Inventory);
  restore(crops: CropRec[], trees: TreeRec[]): void;     // drops records whose block is gone, adds missing records with p = 0
  records(): { crops: CropRec[]; trees: TreeRec[] };
  plant(cell: Cell, seed: ItemId, occupied: Cell[]): boolean;   // uses one seed, sets Farmland below, places stage 0
  help(cell: Cell): FarmEvent | null;                    // one stage up, instant, also for any block of a tree
  harvest(cell: Cell): FarmEvent;                        // crop block or AppleLeaves; all-or-nothing against the 99 cap
  advance(ms: number): void;                             // natural growth; queues stage changes
  update(dt: number): void;                              // applies at most ONE queued natural stage change per frame
  isPlantCell(cell: Cell): boolean;
  nearestRipe(from: Cell, radius: number): Cell | null;  // for the shimmer and the hint
  seedsAndGrowing(): { seeds: number; growing: number };  // for Fern's top-up
  onEvent(cb: (e: FarmEvent) => void): void;
  revision: number;                                      // bumps on every player-caused change, so the autosave notices
}
```
Rules: planting uses exactly one seed and fails (no seed used) when `canPlant` fails. `help` on stage 3 returns `rest` and changes nothing. Natural growth and help both go through the same `setStage` so a stage can only rise. Stage changes call `world.set` once (crops), or stamp the tree for its stage into **Air cells only** (trees). If the base block is gone (he dug it) the record is dropped silently. `harvest` of a ripe crop gives the full yield, of an unripe one the seed, with `world.set(cell, Air)`; the Farmland below stays. A harvest that does not fit is refused as `full` and changes nothing. An `AppleLeaves` pick leaves `Leaves`, gives `+2 Apple +1 AppleSapling`, and the tree record goes back to stage 2 with `APPLE_REGROW_MS` to ripen.

- [ ] **Step 1:** Tests in `tests/game/farm.test.ts` on a small hand-built world (`box(w, d, h)` helper with a Grass floor):
  - `plant uses one seed and turns grass to farmland`; `plant refuses sand and an occupied cell and keeps the seed`; `plant refuses where a plant already stands`.
  - `help advances exactly one stage and returns the cue`; `three helps ripen a crop`; `help on a ripe crop does nothing (rest)`; `help resets that stage's timer`.
  - `natural growth ripens after 3 stages of time`; `advance is order independent` (one big advance equals many small ones, same final stage and block); `at most one natural stage change per update call` (100 crops all due: 100 calls of `update`, one change each); `an 8-hour absence ripens everything planted`.
  - `stages never decrease` (random plant/help/advance/harvest sequences; every surviving crop's stage is monotonic).
  - `nothing wilts`: advance a year in capped steps with no player action: every plant block still present, all ripe, none removed.
  - `harvest ripe gives 2 food + 2 seeds`; `harvest unripe gives one seed`; `soil stays after harvest`; `replant straight away works`; `harvest refused whole when a yield would pass 99` (plant and bag unchanged, event `full`); `seeds can never run out`: simulate 500 random plant/harvest/pull actions starting from 1 seed; at every step `seeds + growing >= 1`.
  - Trees: `sapling to young tree stamps only air cells` (a block he placed in the canopy space survives); `full tree has trunk 4 and a 3×3 canopy`; `ripe tree has four AppleLeaves`; `helping any trunk or leaf block of the tree grows it`; `picking apples gives 2 apples + 1 sapling and leaves the tree whole`; `apples regrow after 180 s`; `digging the trunk base drops the record, nothing throws`.
  - `restore drops records for missing blocks and adds p = 0 for plants with no record`; `records round-trip`.
  - `revision bumps on plant, help and harvest but not on natural growth`.
- [ ] **Step 2:** Run `npx vitest run tests/game/farm.test.ts`. Expected: FAIL. Implement. Expected: PASS.
- [ ] **Step 3:** Chunk rebuild cost note (measured in Task 17): a stage change is one `world.set`, which already rebuilds one chunk (two on an edge), as digging does. Commit `feat(farm): planting, helping, harvesting and apple trees`.

### Task 5: Farm layout in worldgen

**Files:** Modify `src/core/village.ts`, `src/core/worldgen.ts`, `tests/core/village.test.ts`, `tests/core/worldgen.test.ts`; create `tests/core/farmLayout.test.ts`.

**Interfaces:**
```ts
export const GEN_VERSION = 2;
// VillageLayout gains:
farm: { beds: Rect[]; pool: Rect; irrigation: Rect; pasture: Rect; gate: Cell[]; fence: Cell[]; herdSpawns: Cell[]; path: Rect };
```
`VILLAGE_PLAN` gains `pasture: { x0: 62, z0: 46, x1: 84, z1: 55 }` and the bed, pool and irrigation rects from the decisions table. The pasture gets its own level pad (a pin at `GROUND_Y`, the same reshape the village pad uses). The fence stands on the pasture's outer ring at `GROUND_Y + 1`, with a 2-wide gap at the gate. `herdSpawns` lists at least 12 standable interior cells (10 used).

- [ ] **Step 1:** Tests in `tests/core/farmLayout.test.ts` (real `generateWorld(2026)`):
  - `beds are Farmland and every bed cell is within reach 3 of an aisle cell`.
  - `pool is six Water source blocks, flush with the ground and ringed by solid blocks at pool level` (so the water step's flow cannot escape on its own).
  - `irrigation aisle is empty plain Dirt from the pool to the beds` (nothing stamped, nothing planted).
  - `pasture is level and clear` (no trees, no gaps in the floor); `fence is one block high, solid, with a 2-wide gap`; `a path of standable cells joins the plot, the gate and the village route`; `A* from spawn reaches the plot, the gate and the pasture middle`.
  - `herd spawns are standable, inside the interior and not on the fence`.
  - `no overlap and a 2-cell gap` between pasture, plot, farmhouse, Granny's cottage and the pad (nudge numbers if needed).
  - `step 1 stamps unchanged`: the houses, route and `routeCells` equal the step 1 expectations; `v1 meadow fixture still matches` (`legacy-meadow-2026.json` hash on x 0..47).
  - `his edits still win over the farm stamps` (an edit in a bed and in the fence replays on top).
  - Existing worldgen determinism tests pass (`same seed, same world`).
- [ ] **Step 2:** Run `npx vitest run tests/core`. Expected: FAIL. Implement. Expected: PASS. The step 1 budget tests are re-run in Task 17.
- [ ] **Step 3:** Commit `feat(farm): farm beds, pool, pasture and fence`.

### Task 6: Tap, hold and entity picking

**Files:** Modify `src/input/tap.ts`, `src/game/game.ts`; create `src/input/entityPick.ts`; tests `tests/input/tap.test.ts`, `tests/input/entityPick.test.ts`, `tests/game/game.test.ts`; `tests/input/gesture.test.ts` must stay untouched and green. (Pointer wiring in `main.ts` is Task 16.)

**Interfaces:**
```ts
export type TapIntent = /* existing */ | { kind: 'plant'; cell: Cell } | { kind: 'help'; cell: Cell } | { kind: 'feed'; animal: number } | { kind: 'pet'; animal: number };
export function pickAnimal(screen: { x: number; y: number }, animals: Array<{ id: number; sx: number; sy: number; sz: number }>, radius = 56): number | null;  // nearest to the point wins; ties go to the one closer to the camera
export function resolveTap(hit, selected: StackId | 'hand', playerFeet, world, occupied, animalHit?: { id: number; dist: number }): TapIntent;
export function resolveHold(hit, playerFeet, world, occupied, onAnimal?: boolean): HoldIntent;
```
Resolution order for a quick tap: (1) an animal under the finger: within reach 3 of the player, `feed` if any food in `FEEDS` is selected, else `pet`; farther, `walk` beside it (never closer than 1.2); (2) the hit cell is a plant or part of an apple tree: within reach 3 `help`, otherwise `walk` to the front cell; (3) a seed or sapling is selected and `canPlant(front)`: within reach `plant`, otherwise `walk`; (4) the existing block building and walking, where items that are not blocks are never placed. Hold: an animal under the finger gives `none`; a plant cell is a normal diggable cell (harvest); cells under an animal's feet give `none`.

- [ ] **Step 1:** Tests. Unchanged-rules block (copied from the current tests and kept green): `quick tap with the hand walks`, `quick tap with a block builds in reach`, `a tap never digs`, `hold digs within reach / walks beside when far`, `hold on the block under his feet or Pip's feet does nothing`. New: `tap on a plant in reach helps (any selection, even a block)`; `tap on a plant out of reach walks beside it`; `seed selected: tap on grass in reach plants, out of reach walks, on sand walks`; `sapling plants like a seed`; `a seed is never placed as a block`; `a ripe plant tap is help (the farm answers rest)`; `hold on a plant harvests (dig intent)`; `hold on an animal gives none and never digs the ground behind it`; `hold on the block under an animal gives none`; `tap on a close animal with any food feeds, with the hand or a non-food pets, far away walks`; `pickAnimal: nearest within 56 px, none outside, closer to the camera wins a tie, empty list gives null`.
  Game tests: `applyIntent plant and help use the farm and cost nothing but one seed`; `place into an animal's cell is refused` (the occupied list includes animals); `a plant cell refuses a placed block` (`canPlace` needs Air); `selecting a seed does not change what pad Collect does`.
- [ ] **Step 2:** Run `npx vitest run tests/input tests/game`. Expected: new tests FAIL. Implement. Expected: PASS, including `tests/input/gesture.test.ts` untouched.
- [ ] **Step 3:** Commit `feat(farm): taps on plants and animals, holds harvest`.

### Task 7: Eating

**Files:** Create `src/game/eating.ts`, `tests/game/eating.test.ts`. Modify `src/game/game.ts` (intent `eat`, event `ate`), `src/game/pal.ts` (reaction mapping).

**Interfaces:**
```ts
export const EAT_SECONDS = 1.3;
export const BITES = 3;
export class EatState {
  start(food: ItemId): boolean;          // false while one is running (the debounce)
  update(dt: number): void;
  readonly active: boolean;
  readonly progress: number;             // 0..1
  readonly bite: number;                 // 0..BITES, for the shrinking picture
  readonly food: ItemId | null;
}
export function reactionKey(food: ItemId): LineKey;   // Apple -> ateApple, Carrot -> ateCarrot, Potato -> atePotato, Milk -> drankMilk
// Game: intent { kind: 'eat' }; event { type: 'ate'; id: ItemId }
```
`Game.eat()`: only if the selection is edible, its count is above zero and no munch is running; removes exactly one; emits `ate` once; the selection falls back to the hand when the stack empties (existing `normaliseSelection`). Eating never changes any other state: no stat exists.

- [ ] **Step 1:** Tests. `eats one and only one`; `second tap during the animation eats nothing`; `eating the last one falls back to the hand`; `non-edible selections never eat` (wheat, egg, wool, every seed, every block, the hand); `no state remains after eating` (the inventory difference is exactly -1 and nothing else in `Game` changed); `Pip reacts once, after the animation, at most once per 20 s` (fake clock); `the reaction key matches the food`; `pad Place with an edible selected eats; with any food and an animal in front it feeds instead`; `a paused game (overlay open) does not eat`. `progress` reaches 1 at `EAT_SECONDS` and `bite` goes 0 to 3.
- [ ] **Step 2:** Run `npx vitest run tests/game/eating.test.ts tests/game/game.test.ts`. Expected: FAIL. Implement. Expected: PASS.
- [ ] **Step 3:** Commit `feat(eating): eat and drink with a debounced animation`.

### Task 8: Herd: wander, come over, feed, gifts

**Files:** Create `src/game/animals.ts`, `tests/game/animals.test.ts`.

**Interfaces:**
```ts
export type AnimalKind = 'chicken' | 'cow' | 'sheep' | 'pig';
export type AnimalState = 'idle' | 'walk' | 'graze' | 'come' | 'happy';   // no hurt, scared, eaten or dead state exists
export const ANIMAL_STATES: readonly AnimalState[];
export interface Animal { id: number; kind: AnimalKind; variant: number; x: number; y: number; z: number; heading: number; state: AnimalState; stateT: number; giftIn: number; noiseIn: number; stuckFor: number }
export interface HerdContext { world: World; roam: Rect; player: { x: number; y: number; z: number }; held: StackId | 'hand'; occupied: Cell[]; dt: number }
export const DEFAULT_HERD: Record<AnimalKind, number>;     // chicken 4, cow 2, sheep 3, pig 1
export const GIFT_REST_SECONDS = 45;
export class Herd {
  constructor(rng: () => number);
  animals: Animal[];
  populate(spawns: Cell[], counts?: Record<AnimalKind, number>): void;
  restore(saved: SavedAnimal[], spawns: Cell[], world: World, roam: Rect, elapsedSeconds: number): void;   // validates, tops up missing ones, never fewer than DEFAULT_HERD
  update(ctx: HerdContext): HerdEvent[];                       // 'noise' events (which animal, which sound, how far) are rate-limited here
  feed(id: number, held: StackId | 'hand'): { result: 'gift'; gift: ItemId; usedFood: ItemId } | { result: 'resting' } | { result: 'notFood' };
  pet(id: number): void;
  occupiedCells(): Cell[];                                     // feet cell and the cell above, for every animal
  toJSON(): SavedAnimal[];
}
```
Behaviour: wander as in the decisions table; `come` when the held item is in `FEEDS` and he is within 10 blocks and inside or within 2 of the pasture; give way when he is within 1 block; `happy` for 1.2 s after feed or pet (a hop); if `stuckFor` passes 6 s the animal is lifted to the nearest free standable interior cell (else back to a spawn cell, else it simply stays); idle noise at random 12 to 30 s intervals (`noiseIn`), rate limited to one per 3 s across the herd.

- [ ] **Step 1:** Tests: `populate makes 4 chickens, 2 cows, 3 sheep, 1 pig on standable cells`; `animals stay inside the pasture after 10,000 simulated seconds` (random seeds, with the player walking through and held food changing); `every position is standable at every step` (feet cell air, head air, ground below, step at most 1); `an animal never moves into an occupied cell` (player, Pip, another animal); `wandering speeds are within 0.7 to 1.0 blocks/s and come speed is 1.6`; `coming over: with any food selected (each of apple, carrot, potato, wheat), every animal within 10 ends between 1.2 and 3 blocks from him, chickens and pig included`; `with the hand selected they go back to wandering`; `gives way within 1 block`; `feed: every animal kind accepts every food in FEEDS, gives its gift and uses exactly one food`; `feed while resting uses no food and returns resting`; `rest ends after 45 s`; `a non-food (seed, egg, wool, a block, the hand) returns notFood and uses nothing`; `pet never gives anything`; `gifts: chicken egg, cow milk, sheep wool, pig potato`; `no hurt state`: `ANIMAL_STATES` equals the five names and no `hurt|scared|eaten|dead|flee|chase` identifier appears in `src/game/animals.ts` (a source-scan test, like the lines policy tests); `trapped animal is lifted after 6 s` (walled in by blocks he placed); `fully blocked pasture leaves animals standing, none removed`; `restore tops up to the default herd and never drops below`; `restore re-spawns an animal whose saved position is not standable`; `noise events are at most one per 3 s`; `giftIn counts down by the elapsed offline seconds on restore but never below 0`.
- [ ] **Step 2:** Run `npx vitest run tests/game/animals.test.ts`. Expected: FAIL. Implement. Expected: PASS.
- [ ] **Step 3:** Commit `feat(animals): friendly herd with wander, come-over, feeding and gifts`.

### Task 9: Invariant tests (nothing wilts, nothing is hurt, nothing is lost)

**Files:** Create `tests/game/animalsInvariants.test.ts`, `tests/game/farmInvariants.test.ts`. Tests only; if one fails, the bug goes back to Task 4 or 8.

- [ ] **Step 1 (Codex):** Property tests with seeded random action streams of 2,000 steps over the real generated world (actions: walk, plant, help, hold-harvest, eat, feed, pet, place a block anywhere including on the pasture and fence, dig anything, tick time by random amounts including backwards and week-long jumps, save and reload through `serialise` and `applySave`):
  - `no animal is ever removed or hurt`: herd size never below 10; every animal always on a standable cell and inside the pasture.
  - `nothing is ever lost`: seeds plus growing plants never reach zero once he has any; every stack count is between 0 and 99; no action reduces a stack except planting (one seed), eating (one food) and feeding (one food).
  - `nothing wilts`: no stage decreases; no plant block disappears unless the stream dug it.
  - `placing into an animal is always refused`.
  - `no action throws`.
  - `save and reload at any point keeps every stage, every animal and the bag` (equality of `serialise` before and after).
- [ ] **Step 2:** Run `npx vitest run tests/game`. Expected: PASS once Tasks 4 and 8 are right. Commit `test: nothing wilts, nothing is hurt, nothing is lost`.

### Task 10: Save fields

**Files:** Modify `src/core/save.ts`, `tests/core/save.test.ts`.

**Interfaces (all additive, all optional on read):**
```ts
interface SaveData { /* existing */
  savedAt?: number;                                   // ms epoch of this write
  items?: Record<number, number>;                     // item kinds only
  itemOrder?: number[];
  crops?: Array<[number, number, number, number]>;    // x, y, z, progress ms
  trees?: Array<[number, number, number, number, number]>;  // x, y, z, stage, progress ms
  animals?: Array<[number, number, number, number, number, number]>;  // kind 0..3, x, y, z, giftIn s, variant
  flags: { ledToVillage: boolean; fernSeeds?: boolean; hints?: string[] };
}
export interface Applied { /* existing */ items: Record<number, number>; farm: { crops: CropRec[]; trees: TreeRec[] }; animals: SavedAnimal[]; offlineMs: number }
```
`serialise(game, seed, flags, farm, herd, now)` writes `gen: GEN_VERSION` (2) and `savedAt: now`. `applySave(data, now)` computes `offlineMs` with a `GrowthClock` seeded with `savedAt` (absent in older saves: 0), so the caller advances the farm and the herd by that amount **after** edits are replayed. Validation: `items` entries need a registered item id and an integer count 0 to 99, anything else skipped; `crops` and `trees` need integer in-bounds coordinates and a finite progress between 0 and the stage length (clamped), capped at 2,000 records; `animals` need a valid kind and finite in-bounds position; duplicates dropped; `hints` keeps only known names; a wrong type for any new field drops that field only, never the save. `inventory` and `order` stay block-only.

- [ ] **Step 1:** Tests mirroring the step 1 save tests: `a step 1 v2 save without any new field loads` (empty items, no crops, default herd, `fernSeeds` false); `a v1 save still migrates and the v1 key is never written` (existing test, unchanged); `backup of the v1 payload is made once and never overwritten` (unchanged); `new fields round-trip` (items, crops, trees, animals, flags); `bad item entries are skipped and the blocks survive`; `a bad crops list is dropped and the edits survive`; `crop progress is clamped`; `more than 2,000 crop records keeps the first 2,000 and the plants still exist as blocks`; `unknown hints dropped`; `animals with unknown kind or out-of-range position dropped, herd topped up on load`; `savedAt in the future gives offlineMs 0`; `savedAt a week ago gives exactly the 8-hour cap`; `savedAt missing (old save) gives 0`; `gen is written as 2 and a stored higher gen is never lowered`; `a save from a newer build (version above 2) is never overwritten`; `a damaged v2 is copied to .bad before replacement` (existing rules still hold with the new fields present); `edits containing crop blocks are valid`; `step 1 shape check`: serialise a bag with blocks and items and assert `inventory` contains no key of 100 or more.
- [ ] **Step 2:** Run `npx vitest run tests/core/save.test.ts`. Expected: FAIL. Implement. Expected: PASS, with all existing save tests untouched.
- [ ] **Step 3:** Commit `feat(save): additive fields for items, crops, trees, animals and flags`.

### Task 11: Lines, Fern, favourites and voice clips

**Files:** Modify `src/content/lines.ts`, `src/content/villagers.ts`, `tools/voice/export-lines.ts`, `tests/content/lines.test.ts`, `tests/content/voice-clips.test.ts`, `tests/game/villagers.test.ts`; create `src/content/spoken.ts`, `tests/content/spoken.test.ts`, `src/game/hints.ts`, `tests/game/hints.test.ts`; regenerate `tools/voice/lines.json`, `public/voice/pip/**`, `public/voice/fern/**` and `public/voice/manifest.json`.

**New Pip keys (16, four variants each, each with a picture in `LINE_ICONS`):** `plantSome` 🌱, `needWaterSun` 🌦️, `cropReady` 🧺, `harvested` 🥕, `tryMunch` 👄, `ateApple` 🍎, `ateCarrot` 🥕, `atePotato` 🥔, `drankMilk` 🥛, `holdOutFood` 🐔, `fedAnimal` 💛, `animalFull` 😴, `petAnimal` 🐑, `gotEgg` 🥚, `gotMilk` 🥛, `gotWool` 🧶. Sample variants (each is true whenever it can fire, 12 words or fewer, no cheers): `plantSome`: "Seeds grow into plants. Shall we plant some?"; `needWaterSun`: "Plants need water and sunshine. Give it a little help!"; `cropReady`: "It's ready! Press and hold to pick it."; `tryMunch`: "Take a big bite!"; `ateApple`: "What a crunchy apple!"; `drankMilk`: "Fresh milk, straight from the cow!" (true: milk exists only as a cow's gift); `holdOutFood`: "Hold out some food and the animals will come."; `animalFull`: "They've had enough for now. Let's give them a rest." Never "tap". `fedAnimal` and `animalFull` do not claim which animal.
**Fern keys:** `FERN_LINES.seedGift` ("Here are some seeds for your garden.", "Plant these seeds and watch them grow.", "I've brought you some seeds, neighbour.", "Some seeds for you. Have a go!") and `FERN_LINES.moreSeeds` ("You're out of seeds. Here are some more.", "Here are some more seeds for you.", "More seeds for your garden, neighbour.", "Fresh seeds for the garden. Off you go!").
**Favourites:** `VillagerDef.favourite: 'cake' | 'carrot' | 'biscuit' | 'apple'` (data only).

```ts
export function spokenLines(): Record<string, string[]>;   // pip (all LINES), and each speaker's hellos + (fern) FERN_LINES; de-duplicated
export class FarmHints { constructor(seen: string[]); shouldSay(key: HintKey, ctx: HintContext): boolean; markSeen(key: HintKey): void; seen(): string[] }
```

- [ ] **Step 1:** Tests. `lines.test.ts`: key count updates to 34; every key has four distinct variants of 12 words or fewer; the new keys have icons; none match the cheer list (add `yum|mmm|aww|ooh|hmm|ta-?da|hup|whee|yay|hooray`); no `tap|click|touch`; British spelling list. `spoken.test.ts`: `spokenLines includes every Pip key and Fern's seed lines`; `tools/voice/lines.json equals spokenLines()`. `voice-clips.test.ts` now imports `spokenLines()` so the clip test, the stale-clip test and the cheer test cover Fern's new lines. `villagers.test.ts`: `every villager has a favourite` (the hello count stays 16: `FERN_LINES` is separate). `hints.test.ts`: `each once-only hint fires once and is saved`; `plantSome needs seeds and nearness to the plot`; `reaction lines are limited to one per kind per 20 s`; `unknown saved hint names are ignored`.
- [ ] **Step 2:** Run `npx vitest run tests/content tests/game/villagers.test.ts tests/game/hints.test.ts`. Expected: FAIL (also the clip test, which is the reminder to generate audio). Implement the content and `FarmHints`.
- [ ] **Step 3:** Generate the clips. First time on a machine: `python -m venv tools/voice/.venv && tools/voice/.venv/bin/pip install -r tools/voice/requirements.txt` (the models download into the git-ignored `.voice-cache/`, about 100 MB, checksummed). Then:
  ```
  npm run voice:lines
  for s in pip fern; do
    tools/voice/.venv/bin/python tools/voice/generate.py --speaker $s --lines tools/voice/lines.json --out public/voice --prune
  done
  ```
  (Only missing clips are made: about 64 for Pip and 8 for Fern.) Listen to each new clip once (watch "Fern" and "sunshine"); if a word sounds odd add a respelling in `tools/voice/pronunciations.json` and regenerate.
- [ ] **Step 4:** Run `npx vitest run tests/content tests/audio`. Expected: PASS. Commit `feat(voice): farm and eating lines, Fern's seed lines and clips`.

### Task 12: Render: animals, sparkles, shimmer, munch

**Files:** Create `src/render/animals.ts`, `src/render/effects.ts`, `tests/render/animals.test.ts`, `tests/render/effects.test.ts`. Modify `src/render/characters.ts`, `src/render/scene.ts`, `tests/render/characters.test.ts`.

**Interfaces:**
```ts
export function makeAnimalModel(kind: AnimalKind, variant: number): THREE.Group;   // ONE merged mesh, vertex colours, feet at y = 0, faces +z
export class AnimalView { constructor(scene: THREE.Scene); sync(animals: Animal[], visible: (x: number, z: number) => boolean, timeSeconds: number): void; screenPositions(camera: THREE.Camera): Array<{ id: number; sx: number; sy: number; sz: number }>; dispose(): void }
export class Sparkles {
  constructor(scene: THREE.Scene, capacity = 64);
  burst(at: { x: number; y: number; z: number }, kind: 'water' | 'sun' | 'both' | 'heart' | 'crumb', n = 12): void;
  update(dt: number): void;
  readonly live: number;
}
export function setEatPose(model: THREE.Group, progress: number, bite: number): void;   // arms up, head dips, bite sprite scale (1, .66, .33, 0)
```
Animals (original, friendly, box style): white and brown hens with a red comb, brown-and-white cows with a pink nose, woolly white sheep (round body, dark face), a round pink pig with a curly tail. Idle: bob, sway, chicken peck, grazing head-down tilt, a happy hop. Hidden when beyond fog or outside the visible chunk set.

- [ ] **Step 1:** Tests. `each model is one mesh` (one draw call) with at most 130 triangles; `all four kinds and variants build and dispose without leaking geometry`; `AnimalView hides animals beyond 44 blocks and shows near ones`; `Sparkles never exceeds capacity (a burst when full reuses the oldest) and never allocates after the constructor`; `live returns to 0 after 1 s`; `sparkles are one Points object (one draw call)`; `setEatPose at progress 0 and 1 leaves the model back in its rest pose`; `the bite sprite shrinks over 3 bites`.
- [ ] **Step 2:** Run `npx vitest run tests/render`. Expected: FAIL. Implement. Expected: PASS.
- [ ] **Step 3:** Look at it once with the Playwright MCP tool (animals, a burst, the eat pose). Commit `feat(render): animals, sparkles and the munch pose`.

### Task 13: Sounds

**Files:** Modify `src/audio/sfx.ts`; create `tests/audio/sfx-farm.test.ts`.

**Interface:** `sfx.water() sun() plant() pick() munch() drink() gift() pet() cluck() moo() baa() oink()`, each `() => void`, silent with no `AudioContext`.

- [ ] **Step 1:** Tests with a stub `AudioContext` counting nodes: `every farm sfx is silent and safe with no AudioContext`; `none uses more than 12 nodes`; `none lasts more than 1.2 s` (the stub records scheduled stop times); `none has a peak gain above 0.4` (all gentle); `munch is three bites 0.15 to 0.25 s apart`; `animal sounds are rising or falling blips, no speech` (the test spies on `speechSynthesis` and sees no call); `a second identical sound within 80 ms is dropped` (so spamming taps does not stack sounds).
- [ ] **Step 2:** Run `npx vitest run tests/audio`. Expected: FAIL. Implement with the existing `blip` and noise helpers. Expected: PASS.
- [ ] **Step 3:** Commit `feat(audio): synthesised farm, munch and animal sounds`.

### Task 14: HUD: hotbar, bag tray, munch button

**Files:** Create `src/ui/bag.ts`, `tests/ui/bag.test.ts`. Modify `src/ui/hud.ts`, `src/ui/styles.css`, the existing hud tests, `tests/ui/craft.test.ts`.

**Interfaces:**
```ts
export interface HudState { slots: Array<{ id: StackId; count: number }>; selected: number /* 0 hand, 1..8 slot, 9 = bag slot */; overflow: boolean; edible: boolean }
export class Hud { /* + */ onMunch(cb: () => void): void; setMunchVisible(v: boolean): void }
export class BagTray { constructor(root: HTMLElement, deps: { stacks(): Array<{ id: StackId; count: number }>; iconFor(id: StackId): { src?: string; emoji?: string; badge?: string }; select(id: StackId): void; onOpenChange(open: boolean): void; now?: () => number }); open(): void; close(): void; padMove(dx: number): void; padSelect(): void }
export const MAX_DOTS = 20;
```
Rules: the hotbar shows the hand and up to 8 stacks; the bag slot (a 🎒 icon, or the selected stack's picture when it is not among the 8) appears when there are more than 8 stacks. The tray lists every stack with a big picture, the digit, and for 20 or fewer a grid of dots; above 20 only the digit. Targets at least 88 px; it closes with a big ✖ or by choosing. It swallows pointer events like the craft screen, pauses the game, and works with the pad (left/right, select). The munch button is 96 px, mouth picture (👄), hidden unless an edible is selected, debounced by the `Hud` guard and by `EatState`.

- [ ] **Step 1:** Tests: `8 or fewer stacks show no bag slot and look exactly like step 1` (existing hotbar tests untouched); `10 stacks show 8 plus a bag slot`; `selecting a stack beyond the 8 shows it in the bag slot, highlighted`; `bag tray lists every stack with its digit; dots equal the count up to 20 and none above`; `choosing in the tray selects and closes, and pointer events never reach the world`; `all targets are at least 88 px` (computed from the CSS constants); `pad can move and select in the tray`; `munch button is shown for apple, carrot, potato, milk and for nothing else`; `munch button taps are debounced`; `a seed slot shows its crop badge`.
- [ ] **Step 2:** Run `npx vitest run tests/ui`. Expected: FAIL. Implement. Expected: PASS (jsdom).
- [ ] **Step 3:** Commit `feat(hud): bag slot and tray, items in the bar, munch button`.

### Task 15: Recipes: wool to coloured blocks

**Files:** Modify `src/core/recipes.ts`, `src/core/crafting.ts`, `src/ui/craft.ts`, `tests/core/crafting.test.ts`, `tests/ui/craft.test.ts`.

Four recipes, picture only: 1 `Wool` makes 2 each of `WoolWhite`, `WoolRed`, `WoolBlue`, `WoolYellow` (ids `wool-white` and so on; `word` is the colour word, always spoken). `Recipe.inputs` and `output` use `StackId`; `craftRows`, the craft icons and the `missing` list use the item pictures.

- [ ] **Step 1 (Codex):** Tests: `wool crafts into 2 coloured blocks of the chosen colour`; `canCraft refuses when the output stack would pass 99 and uses nothing`; `existing three recipes behave exactly as before`; `every recipe input and output count is 20 or fewer`; `the craft screen shows the wool picture and the colour block picture, with digit and dots`; `selecting the result selects the coloured block, ready to place`; `no recipe needs reading`.
- [ ] **Step 2:** Run `npx vitest run tests/core tests/ui`. Expected: FAIL. Implement. Expected: PASS. Commit `feat(craft): wool makes coloured blocks`.

### Task 16: Wire it together

**Files:** Modify `src/main.ts`, `src/game/game.ts`, `src/game/pal.ts`, `src/render/scene.ts` (animal pick, sparkle update, shimmer), `src/ui/hud.ts` (connections).

- [ ] **Step 1:** `applySave` and `generateWorld` return the farm layout, items, farm records, animals and `offlineMs`. Build `Farm` and `Herd`; after edits replay: `farm.restore(...)`, `farm.advance(offlineMs)`, `herd.restore(..., offlineMs / 1000)`; **then** build the chunk meshes (so offline growth costs no rebuilds). Create one `GrowthClock(Date.now())` ticked from a 1 s `setInterval`: `farm.advance(clock.step(Date.now()))`; each animal's `giftIn` counts down on the same step. On `visibilitychange` to visible tick once at once.
- [ ] **Step 2:** `occupied()` adds `herd.occupiedCells()`. `Game.holdsSomeoneUp` also protects the block under any animal. Pointer handler order: a press first asks `pickAnimal` (a hit blocks the dig ring, and a quick tap becomes `feed`, `pet` or a walk); `scene.pick` is used otherwise. No handler is added to the canvas; the existing tap/hold/drag state machine and `gesture.ts` are untouched.
- [ ] **Step 3:** Event wiring: `planted` gives `sfx.plant` and a small burst; `helped` gives a burst of the cue's colour (`water` drops, `sun` rays, `both`), `sfx.water` or `sfx.sun`, and a quiet chime when it reaches ripe; `harvested` gives `sfx.pick` and the hint; `full` gives the existing `full` line; `ate` starts `EatState`, `setEatPose`, `sfx.munch` or `drink` on each bite, a crumb burst, then Pip's reaction; an animal `gift` gives `sfx.gift`, a heart burst, the gift's picture in the bubble and Pip's `gotEgg`, `gotMilk` or `gotWool`; animal noises play the matching sfx when within 12 blocks and no voice is speaking.
- [ ] **Step 4:** Fern: on her greeting, if `!flags.fernSeeds` use `FERN_LINES.seedGift`, add 5/5/5 seeds and 2 saplings, bubble 🌱, `sfx.gift`, set the flag and save at once; else if `farm.seedsAndGrowing()` is `{ seeds: 0, growing: 0 }` use `moreSeeds` and add 3 of each. Hints come from `FarmHints` (saved in `flags.hints`). Idle shimmer: one gentle sparkle every 0.8 s over a random ripe plant within 10 blocks, when no overlay is open.
- [ ] **Step 5:** Autosave: the snapshot also includes `itemsToJSON`, `farm.revision` and the animals' gift state; `serialise` takes `farm`, `herd` and `Date.now()`. Debug hooks (dev and `?debug` only): `farm()` (records and ripe count), `herd()` (animals), `plantAt(x, z, kind)`, `setStage(x, z, stage)`, `give(id, n)`, `advance(ms)`, `saveNow()`, `layoutFarm()`, `eating()`, and `stats()` extended with animals and particles.
- [ ] **Step 6:** Review checks: an open overlay (craft, bag, grown-ups) pauses eating, feeding and the lead; the break bubble blocks Pip's farm lines (the existing `allowLine`); no new `pointer` listeners outside the HUD. `npm test && npm run build`. Commit `feat: eating and the farm wired in`.

### Task 17: Budget and performance

**Files:** Modify `tests/render/budget.test.ts`; create `tests/render/farmBudget.test.ts`; `src/render/scene.ts` only if the resume test demands it.

- [ ] **Step 1:** Tests: `world triangle budget: at most 115,000 in all and 12,000 per chunk` (was 110,000: the farm adds the fence, pool and beds, expected about +1,500; raise the cap by at most 5,000 and say why in the commit); `150 planted crops add at most 1,300 triangles` (8 per crop plus the farmland); `a chunk rebuild after one stage change takes under 12 ms on the CI runner` (the measured value is printed so the tablet number can be projected; the check on the Tab A8 is on the checklist); `build time with the farm: under 2.5 s` (existing guard); `10 animals are 10 draw calls and under 1,300 triangles`; `Sparkles are 1 draw call`; `draw calls with village and farm in view stay within the chunk count plus 14`; `Farm.update with 400 crops costs under 0.2 ms per frame`; `Herd.update with 10 animals costs under 0.3 ms per frame`; `a catch-up of 8 hours over 400 crops sets each crop block once and rebuilds no chunk before the first mesh`; `resume from sleep with 100 crops due rebuilds each affected chunk at most once, at most 2 chunks per frame`.
- [ ] **Step 2:** If the resume test fails, `Scene` coalesces dirty chunks (a set drained at 2 per frame; dig and place still rebuild their chunk immediately so feedback stays instant). Implement only if the test shows a need. Run `npx vitest run tests/render`. Commit `perf: farm and animal budgets`.

### Task 18: Browser story (e2e)

**Files:** Create `e2e/farm.spec.ts`. Reuse `e2e/helpers.ts`. Tests start at `/block-pals/?debug` with a fresh `localStorage` unless they inject one. They use real touch for the gestures that matter (tap on a plant, press and hold, drag) and `applyIntent` or the debug hooks for long walks.

- [ ] **Step 1:** Tests:
  - `Fern gives seeds once`: walk into the farmhouse; the bubble shows 🌱 within 3 s; the bag holds 5/5/5 seeds and 2 saplings (read through the bag tray); reload and re-enter: no second gift.
  - `plant, tap-grow, harvest, eat`: select wheat seeds, quick tap on a bed in reach: a sprout appears and one seed is used; three quick taps on it (a sparkle each: `stats().particles > 0`) make it ripe; press and hold on it (the dig ring shows) picks it: 2 wheat and 2 seeds in the bag. Repeat with a carrot, select it, tap the munch button: the carrot count drops by one, `eating()` is true for about 1.3 s, no other state changes.
  - `a quick tap on a plant out of reach walks, and the hand still walks anywhere else`.
  - `tap never digs and hold on an animal never digs`: hold on a cow: no ring, the ground under it is intact.
  - `hold out food, get a gift`: select wheat; within 6 s every animal in range stands within 3 blocks; tap a close cow: wheat -1, milk +1; tap again at once: no food used (resting); a chicken fed a carrot gives an egg; craft wool into a red block in the craft screen.
  - `placing a block into an animal is refused`: with a block selected, tap on the cell where a chicken stands: the bag count is unchanged.
  - `plants keep growing while away`: plant a crop, `saveNow()`, rewrite `savedAt` in storage to 20 minutes earlier, reload: it is ripe; rewrite `savedAt` to the future: it is unchanged and nothing wilted; rewrite to a week ago: ripe (capped), no errors.
  - `save and reload keeps crops, trees, animals and the bag`: stages, animal positions and gift rests remain.
  - `an old step 1 save loads`: inject a version 2 save without the new fields (and a version 1 save): the page loads, the farm and animals exist, the bag and position are kept, the v1 key is byte-identical.
  - `camera in a wheat field`: stand in ripe wheat and drag to turn: the camera is not pushed in and never inside a solid block.
  - `bag slot`: give 10 kinds (debug `give`): the bar shows 8 + the bag slot; choose a block from the tray and place it.
  - `fps`: with the village, farm, 10 animals and 150 crops in view `stats().fps` is reported (a loose floor in CI; the tablet number is on the checklist), no console errors.
- [ ] **Step 2:** Run `npm run e2e`. Expected: all pass including `smoke` and `village`. Run `npm test && npm run build && npm run e2e`. Commit `test: browser story for eating and the farm`.

### Task 19: README and spec status

**Files:** Modify `README.md` (how to play the farm in one paragraph, the new voice-clip speakers) and the status line of this plan. The link under §7d in the spec is added by the plan PR itself.

- [ ] **Step 1:** Update README. Commit `docs: describe eating and the farm`.

---

## Self-review against the spec

§7d step 2 "Done when": *he can plant, tap to grow, harvest and eat, and nothing can wilt or be lost.*
- **Plant:** Tasks 3, 4, 6 (a seed selected, a quick tap on soil in reach; seeds from Fern, Tasks 11 and 16). Anywhere on Grass, Dirt or Farmland, so his own patch exists (Task 4 test, Task 18).
- **Tap to grow:** Tasks 4 and 6 (one stage per tap; sparkle and sound in Tasks 16, 12 and 13).
- **Harvest:** Tasks 4 and 6 (press and hold; a tap never digs).
- **Eat:** Task 7 (munch button), Task 12 (animation), Task 13 (sound), Task 11 (Pip's plain-word lines).
- **Nothing can wilt:** the stage only rises (Tasks 3 and 4 tests), a year-long advance leaves every plant (Task 4), the property suite (Task 9). **Nothing can be lost:** Task 1 caps, Task 4 all-or-nothing harvest and `seeds can never run out`, Task 8 gifts refused whole at 99, Task 9, Task 10 validation, Task 18 reload.
- Also in the step text: *food items* (Task 1), *the munch animation* (12), *animals and their gifts* (8, 16), *his own farm patch* (4, 5). Real-time growth while away: Tasks 3, 10, 16, 18. Animals come over for food: Task 8. No coins, shops, hearts or quests: none appear (only the `favourite` data in Task 11).

Anti-goals (§4): nothing scary (animals are gentle, quiet and slow; sounds are soft synthesised blips with a loudness test); nothing dark; nobody hurt or eaten (no such state or event exists; a source-scan test and a property suite); nothing lost; nothing needs reading (every new thing has a picture: item emoji, bubble pictures, the munch button, the bag tray with dots, and a voice for every line); no frustration (generous 56 px animal targets, a 96 px munch button, a fence that can be stepped over, rescue for trapped animals, seeds never run out, taps within reach help and taps out of reach just walk); no ads, links or data collection (none added); original assets only (new tiles, models and sounds are ours); British English (policy tests).
§5: the 30 fps budget is in Task 17 and the checklist; offline (nothing networked); local save (Task 10).
§7a: tap, hold and drag meanings, timings and thresholds are unchanged; the only new behaviour is that a quick tap on a plant or animal does its gentle thing in reach, and hold on an animal does nothing. §7c: the camera ignores non-solid plants but still never enters solid blocks. §7e/water: the pool and the empty irrigation aisle are tested, and growth goes through `growthRateAt`.

Out of scope on purpose: coins, prices, shops, baked foods, hearts, quests, villagers eating or being given food, flowing water, ditches, the bucket, watering from the pool, animals in houses, breeding, pets that follow him, a map.

## Performance numbers

| | Village step 1 | Step 2 |
|---|---|---|
| Triangles in the world (budget) | about 45,000 (110,000) | about 47,000 (115,000) |
| 150 planted crops | 0 | about 1,300 (8 per crop + farmland) |
| Animals | 0 | 10 models, 70 to 120 triangles each, 10 draw calls |
| Sparkles | 0 | 1 `Points` of 64, 1 draw call |
| Draw calls, village + farm in view | chunks + villagers | + 10 animals + 1 sparkles (budget 14 more) |
| Chunk rebuild per stage change | n/a | 1 chunk (2 on an edge), same as digging a block; measured in Task 17 (budget 12 ms desktop, to confirm on the Tab) |
| Natural growth | n/a | 1 `world.set` per frame at most; offline catch-up is applied before the first mesh build |
| Per-frame CPU | | `Farm.update` under 0.2 ms, `Herd.update` under 0.3 ms |
| Atlas | 64×96 | 64×160 |

Fallbacks if the tablet misses a number (decide from the checklist, do not build ahead): coalesce dirty chunks (2 per frame); animals 30+ blocks away freeze; reduce the herd to 7; drop the idle shimmer; lower the sparkle burst to 8.

## Parent playtest checklist (Galaxy Tab A8, after deploying this step to GitHub Pages)

Use `?debug` once for the fps counter, then play without it.

1. **Old save.** Open the new version on the tablet that has his world. Everything he built and his position are there; the farm, fence, pool and animals are new.
2. **Fern.** Walk into the farmhouse: Fern says her seed line in her own voice, a 🌱 picture shows, and he now has seeds. Walk out and back in: no second gift.
3. **Bag.** Open the bag slot: pictures with digits and dots, big enough to hit. Choose seeds; the bar shows them selected.
4. **Plant and grow.** Tap a bed: a sprout. Tap the sprout: sparkle and sound, it grows; three taps and it is ripe. A tap a long way off just walks. Does he understand what happened without being told?
5. **Pick.** Press and hold a ripe plant: the ring fills and it is picked, with food and seeds in the bag. Press and hold a young one: just the seed comes back. Nothing is ever lost.
6. **Waiting.** Plant three, close the game for 10 minutes, open it: they are bigger (ripe after 7.5 minutes). Leave it a day: all ripe, none gone.
7. **Eat.** Select a carrot, tap the big munch button: three bites, a soft crunch, Pip says a plain line (no "Yum"). Try apple, potato, milk. Try wheat: no munch button.
8. **Animals.** Walk into the pasture: they wander gently and make soft happy noises. Hold out any food (wheat, carrot, apple, potato): the animals wander over. Tap a close cow: milk. Tap a chicken holding a carrot: an egg. Tap a resting animal: no food used. Tap with the hand: a pet. Nothing is scary or loud.
9. **Not hurt.** Press and hold on an animal: nothing happens and the ground under it stays. Try to place a block on one: refused. Wall one in: it is lifted out after a few seconds.
10. **Wool.** Craft wool into red, blue, yellow and white blocks and build with them.
11. **Apple tree.** Plant a sapling, tap it to grow, pick apples (they come back).
12. **Camera.** Stand in tall wheat and turn the view: the camera is not shoved around.
13. **Controller.** Eat, feed, plant and choose from the bag with the pad.
14. **Speed.** Village, farm and pasture in view, turning the view: the fps counter stays at 30 or more (write down the lowest). After 10 minutes the tablet is not hot.
15. **Voice.** All new lines are British, clear and not too long. Listen for "Fern" and "sunshine".

## Decisions confirmed by the parent (2026-11-08)

The parent answered the six open questions. All are binding and the tasks above already follow them.

1. **Growth:** three taps take a plant from seed to ripe (sprout, bigger, ripe), plus the slow real-time growth as designed (150 s per stage, 8 h offline cap).
2. **Eating:** select the food, then tap a big munch button (mouth icon) that appears while a food is selected. A tap never does two things: the button only eats, selecting only selects.
3. **Animals:** a fenced pasture south of the farm with about 10 animals; they do not roam the village. The pool and the ditch lane stay reserved for the later water step.
4. **Gifts:** any food (apple, carrot, wheat, potato) works with any animal; then a 45 s rest. Favourite foods are not used for animals in this step; villager favourites and hearts come in step 4 (only the data is stored now).
5. **Seeds:** Fern gives the starter seeds automatically as her first hello, once (saved flag, no tap-to-ask). Harvesting always returns a seed, so he can never run out.
6. **Potato:** raw potato is edible now; step 3 can add baking.

## Build chunks and review gates

Four sequential chunks, like step 1. Each chunk is built by Claude, reviewed by Codex (Claude builds and reviews if Codex is out of allowance), fixed, and merged to `main` only after its gate passes. The parent playtests on the tablet after the final chunk (and may peek after chunk 3).

| Chunk | Tasks | Gate before the next chunk |
|---|---|---|
| A. Items, bag and blocks | 1, 2, 14, 15 | `npm test` and `npm run build` green; old inventory and hotbar tests untouched and passing; with 10 kinds the bar shows 8 + the bag slot; camera passes plants; Codex review of the id ranges and save-compat of `inventory`. |
| B. Crops, growth, farm and save | 3, 4, 5, 6, 9 (farm half), 10 | Growth, farm, layout and save tests green; stages never decrease; v1 and step 1 v2 saves load and the v1 key is never written; gestures re-tested unchanged (§7a); Codex review of the clock and the all-or-nothing harvest. |
| C. Animals and the pasture | 8, 9 (animal half), 12 (animals, sparkles), 13 (animal and farm sounds) | Herd invariants green over the real world; hold on an animal never digs; placing into an animal refused; budgets for animals and sparkles pass; Codex review of trapped-animal rescue and the "no hurt state" scan. |
| D. Eating, Fern, voice, wiring, e2e, docs | 7, 11, 12 (munch pose), 13 (munch), 16, 17, 18, 19 | Full `npm test && npm run build && npm run e2e`; voice clips generated and the clip tests green; Codex review of all lines against the policy. |

**Final gate:** all four chunks merged, the e2e story passes (plant, three taps, harvest, eat; feed any animal with any food for a gift; reload keeps crops growing; old saves load), the performance budgets in Task 17 pass, the plan's self-review above is re-checked against the built code, and the parent has done the tablet checklist below. Nothing is deployed to GitHub Pages for the parent until the final gate except the chunk the parent asks to peek at.
