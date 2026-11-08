# Grumps and Friendly Weapons Implementation Plan

**Status: plan for the parent to review (2026-11-08). Built AFTER Village step 2 (eating and the farm) has merged, and BEFORE the Wizard's tower (§7g) and Village step 3 (shops and coins), unless the parent says otherwise. Build in chunks, each reviewed (Claude builds, Codex reviews; Claude is the fallback builder and reviewer if Codex is out of allowance). Docs only: this PR contains no product code.**

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The "bad guys and defensive weapons" of the roadmap, made safe for a 5-year-old who is scared of Minecraft mobs. Small, slow, wobbly **grumps** (jelly blobs and sulky clouds with big eyes and soft colours) wobble onto the farm now and then and sit near the plants, which then **pause** growing (never wilt). He crafts one of three **friendly weapons** (bubble blaster, magic wand, water squirter), selects it, and **taps the grump twice** (no aiming, cannot miss). A soft bubble, sparkle or water squirt flies over, the grump cheers up and bursts into confetti, leaves a small reward in his bag, and the plants grow again. Every fifth cheered-up grump becomes a lasting **friend**, a happy little blob that stays on the farm and helps a plant now and then (at most five friends). Nothing is ever hurt, lost, scary or dark, and nothing needs reading.

**Architecture:** Same layering as steps 1 and 2. Pure, DOM-free logic in `src/core/` (item ids, recipes, farm zone, rewards, save fields) and `src/game/` (`GrumpSystem`, spawner, friends, weapons) is unit-tested with Vitest, including the real generated world. **Grumps and friends are entities, not blocks**, exactly like villagers and the step 2 animals: non-solid, one merged mesh each, kept inside a bounded zone, never in a doorway, placing a block into one is refused, never trapped. They reuse step 2's wander core (extracted in Task 3 without changing animal behaviour). The plant pause is one predicate passed into step 2's `Farm.advance`, so the growth timers (already persisted) are the only state; no new block ids, no new world edits. Weapons are plain **items** in the step 2 item model. Rendering reuses the pooled `Sparkles` object (more particle kinds) and one projectile mesh. `main.ts` only wires.

**Tech Stack:** TypeScript 5 (strict), Vite 8, Three.js 0.187, Vitest 5, Playwright 1.65, Web Audio API. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-05-block-pals-design.md` (§4 anti-goals, §5 constraints, §6 the grump idea, §7a gestures, §7c camera, §7d Village, §7f this feature). Builds on step 1 (merged) and **depends on `docs/superpowers/plans/2026-11-08-village-step2-eating-and-farm.md` (must be merged first)**: it uses step 2's `ItemId`/`StackId` model, `Farm` and its growth clock, the `Herd` wander code, the hotbar and bag tray, `pickAnimal`, the lines/hints/voice-clip machinery, `Sparkles` and the additive save fields. Interfaces below are written against step 2 as planned; if step 2 differs when this is built, the first act of Task 1 is to reconcile (and say so in the commit).

## Global Constraints

**Decisions confirmed by the parent (2026-11-08), binding, recorded verbatim:**
- The bad guys are harmless GRUMPS: small, slow, wobbly jelly blobs and sulky clouds with big eyes and soft colours; never exploding, teleporting or chasing; never strong; they cannot hurt him, Pip, villagers or animals, and cannot be hurt; daytime only (no dark, no night); they look sulky/grumpy-cute, never angry or scary (no teeth, no red eyes); synthesised soft sounds only.
- They SETTLE ON THE FARM and make nearby plants PAUSE growing (plants never wilt, die or get harmed: growth just pauses and the plant looks a little sad; the step-2 growth clock must treat a paused plant deterministically and persist it); cheering one up makes growth resume. LATER (step 4 friendship) they may also sulk at a villager's door: design the hooks but don't build it.
- Frequency: at most THREE at a time on the farm; a new one wobbles in from the edge of the farm area about every two minutes WHILE HE IS NEAR the farm; they never appear next to him or inside a house; never a crowd or a wave; none appear while an overlay is open or the game is paused; none if the farm has no planted crops? (decided in this plan, see the table).
- Weapons: THREE friendly weapons that all work the same way but look and sound different: the bubble blaster, the magic wand and the water squirter. He crafts them (simple picture recipes with existing materials, at most 20 of each; each is a crafting goal). With a weapon selected in the hotbar, a QUICK TAP on a grump within reach fires (soft bubble / sparkle / water squirt with a short synthesised sfx and a travelling particle). NO aiming, cannot miss. A tap anywhere else still just walks (§7a unchanged: a tap never digs; hold still digs; drag still turns the view). The interaction with the existing rules (selected block builds, selected food gives the munch button, selected weapon fires) and what a weapon does when tapped on empty ground (walk) are defined below.
- Outcomes: MOST cheered-up grumps burst into confetti (sparkle particles and a soft sfx) and drop a small reward (a seed or a shiny gem item; coins arrive in step 3); EVERY FEW (every 5th) one turns into a lasting FRIEND (a happy little blob) that stays on the farm and does a small helpful job, with the number of friends CAPPED (5) so the farm never crowds; friends are collectible and persisted, never lost, never hurt.
- Everything works without reading; British English lines per the lines policy (at most 12 words, no cheer or interjection words like ooh|hmm|ta-da|hup|whee|yay|hooray|yum; Pip reacts with plain words; voice clips via `tools/voice` for speaker pip; excitement comes from separate sfx and animation).

**Standing rules (spec and steps 1 and 2; unchanged):**
- British English everywhere. Lines: at most 12 words, four variants per key, no cheer or sound words (`ooh|hmm|ta-da|hup|whee|yay|hooray|yum|mmm|aww`), no "tap/click/touch" in Pip's lines, each line true whenever it can fire, no promises of later steps.
- Nothing scary, nothing dark, nothing hurt, nothing lost. **Scary is a failure even if the code works** (see Review Focus and the checklist).
- No network calls at runtime, no analytics, no links out, no new dependencies. Works offline.
- Target device: Galaxy Tab A8 (1920x1200, Unisoc T618), landscape, Chrome. A steady 30 fps or better with village, farm, animals, grumps and friends in view. Pixel ratio capped at 1.5. No real-time shadows.
- Touch targets at least 88 CSS px. **Quick tap with the hand walks, press and hold (about half a second) digs, drag turns the view (§7a, §7c). This plan does not change the timings, thresholds or meaning of any of them.** It adds new things a quick tap can land on, and nothing a tap destroys.
- Never write a child's real name anywhere (code, tests, lines, commits, PR text). "Our player", "he".
- Save: `blockpals.save.v2` stays the key and `version` stays 2; all new fields are **additive and optional**. The v1 key `blockpals.save.v1` is never written, changed or deleted. Existing block ids and item ids never change; new item ids are appended (120 to 123).
- Everything he builds is real. Only bedrock and water cannot be dug.

## Review Focus

- **Is anything scary (the main review):** read every model, colour, sound and line as a nervous 5-year-old would. No teeth, no red or dark colours, no angry eyebrows, no loud or low sounds, no sudden movement, nothing that approaches him, nothing that appears next to him, nothing that grows large. Mechanical guards: palette test, sound-range test, personal-space test, spawn-distance test, source-scan test (Tasks 4, 5, 11, 13, 14).
- **Hurt or lost:** no hurt, health, damage, kill, die, chase, flee, explode or teleport identifier exists in the new files (source scan). Weapons are never consumed. A reward that cannot fit is skipped whole and nothing else changes. A friend is never removed. Save fields are validated and a bad value never costs him the rest (Tasks 7, 9, 10, 11).
- **Plants never die:** the pause only stops a timer. Stages never decrease, plant blocks never disappear, the pause is deterministic (same inputs, same result), a long sleep is never counted as paused (Tasks 6, 11).
- **Gestures (§7a):** the four tap/hold/drag rules re-tested unchanged. A weapon never digs, builds or fires at empty ground; the weapon item is never placed as a block; a tap on a plant still helps (Task 8).
- **Frustration:** he is never left with a dead end: help taps still grow a paused plant, at most one grump exists until he owns a weapon, the weapon recipes are always reachable, tapping a far grump walks him into range (Tasks 6, 8, 12).
- **Spawn rules:** the injectable clock/rng spawner is deterministic and unit-tested for each rule (cap, interval, nearness, planted crops, overlay, distance, door exclusion) (Task 5).
- **Entities and doors:** grumps and friends cannot block a doorway, cannot be trapped, and refuse a placed block (Tasks 4, 9, 11).
- **Voice policy:** every new line passes the policy tests and has a Pip clip; `tools/voice/lines.json` is regenerated (Task 12).
- **Tablet performance:** 8 merged-mesh entities, one shared particle pool, one projectile mesh, one marker pool (Tasks 13, 16).

## Decisions made in this plan

Marked **(my call)** where the spec or the parent left room. The parent can overrule any; the most important are repeated as questions at the end.

| Topic | Decision |
|---|---|
| Names | Species: **Wibble** (jelly blob) and **Mizzle** (sulky cloud). Code uses `GrumpKind = 'jelly' \| 'cloud'`. A friend keeps its kind. (my call) |
| Entity model | `GrumpSystem` (`src/game/grumps.ts`) holds `Grump[]` and `Friend[]`. Same shape as step 2's `Herd`: `{ id, kind, x, y, z, heading, state, stateT, stuckFor }`, `occupiedCells()` (feet cell and the cell above), wander through the **shared wander core** extracted in Task 3 (`stepWander`: greedy step to a random target 1 to 3 cells away, `isStandable` + `canStep`, never into an occupied cell, rescue after 6 s stuck). Not solid; they appear in `occupied()` so placing into one is refused; the block under a grump's feet cannot be dug; press and hold on a grump or friend does nothing. Clouds are drawn hovering 0.6 block above the ground but occupy the same two cells as a blob (simple and conservative). Ids come from a counter separate from animal ids; picking returns `{ type, id }`. (my call) |
| Zone | `farmZone(layout)` (new pure `src/core/farmZone.ts`) = bounding rect of the step 2 plot (beds, pool, irrigation aisle) grown by 3 cells west, north and east, and cut off 2 cells before the pasture fence (so about `x 69..86, z 32..44`; exact numbers come from the layout). Cells within 2 of any door, of a house rectangle, or on the village path or plot-to-gate path are **excluded** (`avoidCells`). Grumps and friends never leave the zone and never stand on an avoided cell. No world generation change, `GEN_VERSION` unchanged. (my call) |
| Looks | Grump: 9 boxes, about 108 triangles, one merged mesh with vertex colours. Jelly: rounded stacked body, two big white eyes with dark-plum pupils, a tiny flat mouth, blush cheeks. Cloud: four puffs, same face, a tiny blue drop under it. **Sulky = droopy lids (a pastel box over the upper half of each eye), pupils looking down, a small flat-down mouth, slow droopy wobble.** Mood 1 (unsure) lifts the lids and brightens the colour. Mood 2 is never shown: it bursts. Friend: pupils up, big smile, blush, bright palette variant 0 to 4, bouncy wobble. Sizes: a grump is 0.8 to 1.0 block wide and 0.9 tall (smaller than a cow; never bigger than he is). Geometry for each (kind, mood, variant) is built once and shared; swapping mood swaps the geometry reference. |
| Palette | Soft, light, never red or dark. Grumps: lilac `#c9b8ec`, mint `#b7e4cf`, peach `#f5cfa8`, sky `#b8d8f2`. Friends (variants 0 to 4): sunny yellow `#ffe27a`, rose-pink `#ffb6c9`, aqua `#8fe3e0`, lime `#c6ec8a`, orange-gold `#ffc27a`. Shared: eye white `#ffffff`, pupil/mouth ink `#4a3f63` (dark plum, never black, never red), cheek blush `#ffb3b3`. A test pins lightness at least 0.62 and saturation at most 0.8 for every body colour and rejects red-ish hues in eyes. |
| Wobble | Render-rate transform only, no skeleton: jelly squashes and stretches (scale y 0.92 to 1.06, sulky slower and flatter), cloud bobs and drifts slowly (sway of 0.05 block). Spawn-in grows from scale 0.2 to 1 over 1 s (a small friendly "plip", never a pop or a flash). |
| Speed | Wander 0.5 to 0.8 blocks/s; wobbling in from the edge 0.8; friends 0.6. (His walk is 3.5.) |
| Personal space | `PERSONAL_SPACE = 4` blocks. A grump's own movement may never reduce its distance to him below 4, and never reduces it at all when already inside 4: if he walks up to it, it stands still (no fleeing, no chasing). Friends are exempt (they are friends) but still never walk towards him. Tested over 10,000 simulated seconds. (my call) |
| Where they go | After wobbling in, a grump picks a **settle cell** (a standable zone cell within 2 of a random planted crop, else any zone cell), hops around it within 1 to 3 cells, and picks a new settle cell only if its crop is gone. They settle near plants because that is what makes the story clear to him (sad plants next to a sulky cloud). |
| Spawn rules (all must hold) | Every second the spawner is given: dt (zero while an overlay is open or the game is paused, via the existing `helperDt`), `nearFarm` (he is within 16 blocks of the zone rectangle), `plantedCrops` (crop and tree records in the zone, any stage), `count`, `hasWeapon`, `overlayOpen`, the player position. A timer accumulates dt **only while** `nearFarm`, `plantedCrops >= 1`, `count < cap`, not paused and no overlay. It fires at `SPAWN_SECONDS = 120` with jitter from the injected rng (next interval 100 to 140 s). `cap = hasWeapon ? 3 : 1`. A spawn cell is a standable cell on the **zone border**, not avoided, not occupied, at least `SPAWN_MIN_PLAYER = 8` blocks from him, chosen by the rng; if none exists the spawn waits (timer stays full) and retries next second. The very first grump ever uses `FIRST_SPAWN_SECONDS = 45` of near-farm time with a crop planted (so he meets one early), later ones 120. After a spawn the timer restarts at a fresh interval, so two grumps never arrive less than 100 s apart: no wave. The cheered-up grump's replacement is never instant (the timer is not advanced while at cap). (my call) |
| No planted crops | **No spawn while the zone holds no planted crop or tree.** Why: grumps exist to sit near plants; with nothing planted a grump would have nothing to sulk about, and a player who has not met the farm yet would meet an unexplained grump. It also keeps the first meeting tied to what he just did (he planted something), and it means the farm can be left empty with no grumps at all. Existing grumps whose crops are all gone stay (they are harmless) until cheered. (my call) |
| Until he has a weapon | At most one grump exists while he owns no weapon, Pip says `craftWeapon` once (20 s after the grump arrives), and **help taps on paused plants still grow them** (below), so there is no dead end. (my call) |
| Pause rule | `PAUSE_RADIUS = 3`: a crop or tree record whose cell is within 3 blocks (Euclid, horizontal and vertical) of the centre of a **sulky** grump (mood 0) does not accumulate natural growth. Mood 1 (after the first hit) no longer pauses, so growth resumes at the first hit and the sad markers go at once. Friends never pause anything. (my call) |
| Growth clock integration | `Farm.advance(ms, paused?: (x, y, z) => boolean)`: for every record, if `paused` is given and true for it, skip adding `ms` to its `p` (progress) and change nothing else. `p` is already persisted in step 2's `crops`/`trees`, so **a paused plant needs no new save field** and resumes from exactly where it stopped. `GrowthClock` is untouched. A clock step bigger than `PAUSE_STEP_MAX_MS = 5000` (a sleeping tab, or the offline catch-up on load) is applied with `paused` omitted, so time away is never penalised and grumps (which are frozen while away) never freeze a field overnight. Deterministic: the result depends only on the sequence of (step, paused-set) inputs. A **help tap** (step 2) still advances a paused plant by one stage (my call: the pause stops the slow clock only, so it can never be a dead end; it also tells the child "I can help the plants myself"). Natural stage changes still go one per frame. |
| Sad plants | No new block ids and nothing written to the world (a "sad" block would be saved into `edits` and outlive the grump). A pooled `SadMarks` object (one `THREE.Points`, 24 points, a 32x32 canvas sprite: a pale blue bubble with two dots and a small down-turned mouth) floats and bobs slowly above each paused plant top. Markers vanish into a few sun sparkles when the grump reaches mood 1. A source-scan test asserts the marker code never calls `world.set`. |
| Weapons (items) | Appended to step 2's `ItemId`: `BubbleBlaster = 120`, `MagicWand = 121`, `WaterSquirter = 122`, `Gem = 123` (124 to 129 reserved for later grump items). Icons (emoji pictures, as step 2 items): 🫧, 🪄, 💦, 💎. `ItemDef` gains `kind: 'tool'` and `weapon?: 'bubble' \| 'wand' \| 'water'`. A weapon has a count of 1, shows no digit, is never consumed, can never be eaten, fed to animals, placed or lost. |
| Recipes | All picture-only, counts well under 20, existing materials (my call): **Bubble blaster** = 3 Glass + 2 Planks. **Magic wand** = 2 Planks + 2 Yellow Wool (step 2 wool block). **Water squirter** = 2 Glass + 3 Stone + 1 Blue Wool. Each makes 1 and has `once: true`: once owned, the craft screen shows a big tick on it and it cannot be made again (so a spare can never be wasted). Each is a goal on the craft screen like any recipe; `craftNeedMore` and `crafted` lines work unchanged. |
| Selecting | Weapons appear in the hotbar and bag tray like any item. Selecting one does nothing else: no munch button (not edible), animals do not come over (not food), no seed planting. |
| Tap precedence (quick tap) | 1. **Entity under the finger** (screen disc, 56 px radius, nearest wins, ties to the one nearer the camera; animals, grumps and friends in one list). Grump + weapon selected + within `WEAPON_REACH = 8` blocks: **fire**. Grump + weapon selected + farther: **walk** to the standable cell nearest it that is at least 6 away (he arrives in range; a second tap then fires). Grump + anything else selected (hand, block, food, seed): **walk** the same way (never place, never feed). Friend (any selection): **pet** (hop + hearts + soft sound, no cost, no gift). Animal: step 2 rules. 2. A plant: step 2 (help in reach, else walk beside). 3. Seed: plant. 4. Block selected: place or walk. **A weapon (or any item that is not a block) tapped on empty ground, a block face, water or a path: walk.** It never places and never fires at nothing. Press and hold with any selection: unchanged (digs; on a grump, friend or the block under one: nothing). |
| Fire | `Game.fireWeapon(grumpId)` is **logic-immediate and deterministic**: if cooldown (`FIRE_COOLDOWN = 0.5` s, set by a clock tick, so a fast double tap fires once) is zero and the grump is sulky or unsure and within reach, add one hit; mood 0 to 1 on the first, cheered up on the second. The projectile and the grump's visual reaction are delayed by `FLIGHT_SECONDS = 0.3` through a pure dt-based `Delayed` queue (it freezes with the game, so a menu opening mid-flight loses nothing). A tap during cooldown is ignored silently (no walk, no sound). The pad's Place button fires at the nearest grump in reach, else does nothing. No ammunition, no charge. (my call) |
| Hits to cheer | **Two** (`HITS_TO_CHEER = 2`): the first gives a visible half-way change (lids up, brighter, a hop, plants resume) so he sees the cause and effect at once, the second bursts. One hit felt like no story; three felt like a chore. Tunable constant. (my call) |
| Rewards | On a cheer-up, one roll from the injected rng, all picked from items that **fit under 99**: 60% two seeds (wheat, carrot or potato, equal chance), 30% one **Gem**, 10% one apple sapling. Anything that does not fit is skipped and the next fitting one is used; if nothing fits there is simply no reward (the confetti still happens, nothing is lost or refused). The reward goes straight into the bag (a 🎁 bubble and Pip's line), never onto the ground. Why seeds and gems: seeds are useful now and keep the farm going; the **Gem** is a shiny collectable that does nothing yet and is sold to Captain Pebble ("loves shiny stones") in step 3 and traded to the wizard for mythical blocks (§7g). A friend-turn always gives one Gem. (my call) |
| Friends | `cheered` is a lifetime counter (saved). When a cheer-up makes `cheered % FRIEND_EVERY === 0` (`FRIEND_EVERY = 5`) **and** friends are fewer than `FRIEND_CAP = 5`, the grump becomes a friend where it stands instead of bursting (hearts and stars, a gentle chime, Pip's line, a Gem). At the cap the grump just bursts as usual and also leaves one extra Gem, so cheering is never pointless. Friends are listed in the order made and each has a colour variant 0 to 4 (the first friend is variant 0, and so on, wrapping if he ever somehow has more), so they are a small collection. |
| Friend job | Every `FRIEND_JOB_SECONDS = 240` of play time (timer `jobIn`, saved) a friend walks nothing and simply sparkles: it picks the growing (not ripe) plant in the zone nearest to it and calls `Farm.help(cell)` (the same call as his own help tap, one stage up with the same cue effect and sound, a heart over the friend). If there is none, it keeps the timer waiting at 0 (no wasted turns, no pile-up) and retries every second. Jobs ignore the pause. No jobs while away (time away only counts for the plants' own clock). 5 friends give about one extra stage per 50 s: gentle help, not a replacement for his own playing. (my call) |
| Offline | Grumps and friends do nothing while he is away. On load, `Farm.advance(offlineMs)` runs with **no pause** (time away never freezes a field), grump positions and moods are restored as saved, friends' `jobIn` and the spawn timer are restored as saved (not counted down). |
| Sounds | Synthesised, soft, short (at most 1.0 s), sine/triangle only (no sawtooth, no square, no noise-heavy rumbles), lowest oscillator frequency at least 200 Hz, peak gain at most 0.3: `blub` (bubble blaster: rising sine glide), `twinkle` (wand: three high pentatonic notes), `squirt` (water: a short filtered noise burst, band 800 to 2400 Hz), `grumpHop` (first hit: a soft rising boing), `confetti` (four rising notes plus a quiet tick), `friendChime` (a gentle major triad), `plip` (a grump wobbling in, very quiet), `sulk` (a soft two-note falling blip, once per 12 s at most, only within 10 blocks). No growls, ever. |
| Pip's lines | Nine new keys (table in Task 12), four variants each, plain words, no cheers, no "tap". Pip never calls a grump bad or scary and never says it will "get" or "beat" it: it is "sulky", "cheered up" and "a new friend". Reactions are rate-limited by the existing Pal gap (4 s) and one per kind per 20 s. Once-only hints saved in `flags.hints`: `grumpArrives`, `plantsWaiting`, `craftWeapon`, `pickWeapon`, `friendMade`. |
| Villager-door hook | `GrumpSystem.addSpot(spot: { id: string; cell: Cell; kind: 'farm' \| 'door' })` and `pauseTargets()` exist from day one: the farm zone is the only registered spot now (`kind: 'farm'`). Step 4 can register a villager's door as a `door` spot (the grump sits 3 cells from it, in a cell that is not within 1 of the door itself) and let the villager's friendship timer pause the same way. Tested with a fake door spot; nothing registers one in this plan. |
| Save | Additive, optional: `grumps`, `friends`, `grumpStats`, weapon and gem entries inside step 2's `items`, and new names in `flags.hints`. Details in Task 10. |

## Who builds what

Claude builds, Codex reviews. Codex also builds the small pure-logic tasks (it often hangs on long writing, so it gets only these; if it hangs twice, Claude takes the task). Every task is reviewed by the other agent before merging. Codex is invoked with `codex exec --full-auto "<task text from this plan + spec path>"`.

| Task | Builder | Reviewer |
|---|---|---|
| 1 Weapon and gem items | Claude | Codex |
| 2 Recipes, `once`, craft screen entries | Codex | Claude |
| 3 Extract the shared wander core | Claude | Codex |
| 4 Grump and friend entities (`GrumpSystem`) | Claude | Codex |
| 5 Spawner and farm zone (pure) | Codex | Claude |
| 6 Plant pause in the farm | Claude | Codex |
| 7 Rewards and friend rule (pure) | Codex | Claude |
| 8 Weapons: tap, fire, cheer, pad | Claude | Codex |
| 9 Friends and jobs | Claude | Codex |
| 10 Save fields | Codex | Claude |
| 11 Invariant tests (never hurts, never scary, never lost) | Codex | Claude |
| 12 Lines, hints, voice clips | Claude | Codex |
| 13 Render: models, wobble, markers, projectile, confetti | Claude | Codex |
| 14 Sounds | Claude | Codex |
| 15 Wire it together | Claude | Codex |
| 16 Budget and performance | Claude | Codex |
| 17 Browser story (e2e) | Claude | Codex |
| 18 README and spec status | Claude | Codex |

## File Structure

New or changed. Everything else stays as in step 2.

```
src/core/items.ts            CHG  ItemId 120..123, ItemDef kind 'tool' + weapon, WEAPONS, isWeapon()
src/core/recipes.ts          CHG  3 weapon recipes, Recipe.once
src/core/crafting.ts         CHG  canCraft refuses a 'once' recipe already owned
src/core/farmZone.ts         NEW  farmZone(layout), avoidCells(layout), zoneBorder()
src/core/grumpRules.ts       NEW  constants, rewardFor(), friendRule(), hit logic
src/core/save.ts             CHG  grumps, friends, grumpStats, hints (additive)
src/game/wander.ts           NEW  stepWander() extracted from animals.ts (Herd now calls it)
src/game/animals.ts          CHG  uses wander.ts (no behaviour change)
src/game/grumps.ts           NEW  GrumpSystem, Grump, Friend, GrumpSpawner, spots/hooks
src/game/delayed.ts          NEW  Delayed queue (dt-based, freezes with the game)
src/game/farm.ts             CHG  advance(ms, paused?), pausedCells()
src/game/game.ts            CHG  fireWeapon(), petFriend(), events, occupied() includes grumps and friends
src/game/hints.ts            CHG  grump hint keys
src/input/tap.ts             CHG  fire / petFriend intents, weapon never places
src/input/entityPick.ts      CHG  pickEntity() (animals, grumps, friends in one list)
src/content/lines.ts         CHG  9 new Pip LineKeys
src/audio/sfx.ts             CHG  blub, twinkle, squirt, grumpHop, confetti, friendChime, plip, sulk
src/render/grumps.ts         NEW  makeGrumpModel(kind, mood, variant), GrumpView
src/render/effects.ts        CHG  Sparkles kinds: bubble, star, drop, confetti, heart; SadMarks; Projectile
src/ui/craft.ts              CHG  owned tick for 'once' recipes
src/main.ts                  CHG  wiring, debug hooks
tools/voice/lines.json, public/voice/pip/** CHG regenerated clips
tests/core/{items,crafting,farmZone,grumpRules,save}.test.ts
tests/game/{wander,grumps,spawner,friends,delayed,grumpsFarm,weapons,grumpInvariants,farm,animals}.test.ts
tests/input/{tap,entityPick}.test.ts, tests/content/{lines,voice-clips,spoken}.test.ts
tests/render/{grumps,effects,grumpBudget,grumpPalette}.test.ts, tests/audio/sfx-grumps.test.ts, tests/ui/craft.test.ts
e2e/grumps.spec.ts
```

---

### Task 1: Weapon and gem items

**Files:** Modify `src/core/items.ts`, `tests/core/items.test.ts`.

**Interfaces:**
```ts
// appended to step 2's ItemId (existing ids never change)
BubbleBlaster = 120, MagicWand = 121, WaterSquirter = 122, Gem = 123
export type WeaponKind = 'bubble' | 'wand' | 'water';
// ItemDef gains: kind: 'seed' | 'food' | 'gift' | 'tool'; weapon?: WeaponKind
export const WEAPONS: readonly ItemId[];            // the three, in recipe order
export const isWeapon = (id: StackId): id is ItemId;
export const weaponKind = (id: ItemId): WeaponKind | null;
```
First step: check the built step 2 against the "Spec" paragraph (ids 100 to 110 used, 111 to 119 reserved); if different, reconcile and note it.

- [ ] **Step 1:** Tests: `weapon and gem ids are stable` (120..123 pinned; no collision with blocks, step 2 items or the reserved 111..119); `every weapon has a picture, a simple name and a distinct weapon kind`; `weapons are not edible, not feed, not seeds`; `Gem is a gift item and not edible`; `isWeapon is true for exactly the three`; step 2 item tests unchanged and green; `a bag with a weapon serialises it under items only` (`inventory` stays block-only).
- [ ] **Step 2:** Run `npx vitest run tests/core`. Expected: new tests FAIL. Implement. Expected: PASS.
- [ ] **Step 3:** Commit `feat(items): friendly weapons and the gem`.

### Task 2: Recipes, `once`, craft screen entries

**Files:** Modify `src/core/recipes.ts`, `src/core/crafting.ts`, `src/ui/craft.ts`, `tests/core/crafting.test.ts`, `tests/ui/craft.test.ts`.

```ts
export interface Recipe { /* + */ once?: boolean }
// ids: 'bubble-blaster', 'magic-wand', 'water-squirter'
// bubble-blaster: 3 Glass + 2 Planks -> BubbleBlaster
// magic-wand:     2 Planks + 2 WoolYellow -> MagicWand
// water-squirter: 2 Glass + 3 Stone + 1 WoolBlue -> WaterSquirter
export function owns(inv: Inventory, r: Recipe): boolean;   // once recipes: inv.count(output) > 0
```
`canCraft` returns false for an owned `once` recipe. `craftRows` marks `owned`; the craft screen shows the weapon picture with a big tick and no "need more" dots for an owned weapon.

- [ ] **Step 1 (Codex):** Tests: `each weapon recipe crafts one weapon from exactly its inputs`; `an owned weapon cannot be crafted again and uses nothing`; `every recipe input and output count is 20 or fewer`; `every input is an existing block or step 2 wool block (reachable without grumps)`; `existing recipes behave exactly as before`; `craft screen shows three weapon rows with picture, digits and dots`; `an owned weapon shows a tick and no dots`; `selecting the result selects the weapon`; `no recipe needs reading`.
- [ ] **Step 2:** Run `npx vitest run tests/core tests/ui`. Expected: FAIL then PASS. Commit `feat(craft): the three friendly weapons`.

### Task 3: Extract the shared wander core

**Files:** Create `src/game/wander.ts`, `tests/game/wander.test.ts`. Modify `src/game/animals.ts`. `tests/game/animals.test.ts` and `animalsInvariants.test.ts` stay untouched and green (the guard that nothing changed).

```ts
export interface Walker { x: number; y: number; z: number; heading: number; stuckFor: number }
export interface WanderRules {
  roam: Rect; speed: number; hop: [number, number];       // target distance range in cells
  blocked(cell: Cell): boolean;                            // other entities, avoid cells
  allow?(from: { x: number; z: number }, to: { x: number; z: number }): boolean;   // extra veto (personal space)
}
export function stepWander(w: Walker, target: { x: number; z: number } | null, rules: WanderRules, world: World, rng: () => number, dt: number): { target: { x: number; z: number } | null; moved: boolean };
export function rescue(w: Walker, world: World, roam: Rect, blocked: (c: Cell) => boolean): boolean;   // nearest free standable cell, else false
```
Pure refactor: move the animals' greedy-step and 6 s rescue code out unchanged.

- [ ] **Step 1:** Tests on a small hand-built world: `walks to a target and stops there`; `never steps onto a blocked cell, a non-standable cell or out of the roam rect`; `speed is respected within a frame`; `allow() veto stops a step and picks another target`; `stuck for 6 s is rescued to a free standable cell, else stays`; `same seed and inputs give the same path`.
- [ ] **Step 2:** Run `npx vitest run tests/game`. Expected: wander tests FAIL, animal tests (unchanged) PASS before and after. Implement. Expected: all PASS. Commit `refactor(animals): share the wander core`.

### Task 4: Grump and friend entities

**Files:** Create `src/game/grumps.ts`, `src/core/farmZone.ts`, `tests/game/grumps.test.ts`, `tests/core/farmZone.test.ts`.

**Interfaces:**
```ts
export type GrumpKind = 'jelly' | 'cloud';
export type GrumpMood = 0 | 1;                              // 0 sulky, 1 unsure; 2 is a burst and never exists as state
export type GrumpState = 'wobbleIn' | 'settle' | 'idle' | 'hop' | 'cheered';   // no angry, chase, flee, attack, hurt, dead state exists
export const GRUMP_STATES: readonly GrumpState[];
export interface Grump { id: number; kind: GrumpKind; variant: number; x: number; y: number; z: number; heading: number; mood: GrumpMood; hits: number; state: GrumpState; stateT: number; spawnT: number; sulkNoiseIn: number; stuckFor: number; settle: Cell | null }
export interface Friend { id: number; kind: GrumpKind; variant: number; x: number; y: number; z: number; heading: number; state: 'idle' | 'walk' | 'hop' | 'help'; stateT: number; jobIn: number; stuckFor: number }
export interface PlayerPos { x: number; y: number; z: number }
export const PERSONAL_SPACE = 4;
export const PAUSE_RADIUS = 3;
export interface GrumpContext { world: World; player: PlayerPos; occupied: Cell[]; plantCells: Cell[]; dt: number }
export class GrumpSystem {
  constructor(rng: () => number, zone: Rect, avoid: Set<string>);        // avoid = "x,z" keys
  grumps: Grump[]; friends: Friend[];
  addSpot(spot: { id: string; cell: Cell; kind: 'farm' | 'door' }): void;   // hook for step 4; only the farm zone is registered now
  spawn(cell: Cell, kind: GrumpKind): Grump;
  update(ctx: GrumpContext): GrumpEvent[];                    // moves, never reduces distance to the player below PERSONAL_SPACE
  pausesCell(c: Cell): boolean;                               // within PAUSE_RADIUS of a sulky grump (mood 0)
  pausedCells(plants: Cell[]): Cell[];                        // for the sad markers
  occupiedCells(): Cell[];                                    // feet cell and the cell above, grumps and friends
  hit(id: number): { result: 'unsure' | 'cheered' | 'ignored' };   // pure data change; used by Game.fireWeapon
  toJSON(): { grumps: SavedGrump[]; friends: SavedFriend[] };
}
export type GrumpEvent = { type: 'arrived'; id: number } | { type: 'sulk'; id: number; dist: number };
```
`farmZone(layout): Rect` and `avoidCells(layout): Set<string>` as in the decisions table; `zoneBorder(zone, world, avoid): Cell[]` lists standable border cells.

- [ ] **Step 1:** Tests in `tests/game/grumps.test.ts` on a hand-built world and (for zone) the real `generateWorld(2026)`:
  - `GRUMP_STATES is exactly the five names and no angry|chase|flee|attack|hurt|dead|scared|explode|teleport|kill|damage|health identifier appears in src/game/grumps.ts, src/core/grumpRules.ts or src/render/grumps.ts` (source-scan test, like the lines policy tests).
  - `grumps stay inside the zone after 10,000 simulated seconds` (random seeds, the player walking through); `every position is standable at every step`; `a grump never moves into an occupied cell` (player, Pip, villagers, animals, another grump); `wander speed is within 0.5 to 0.8 blocks/s and wobble-in is 0.8`.
  - `personal space: a grump's own move never takes it closer than 4 blocks to the player, and never closer at all when already inside 4` (player frozen during each grump step, 10,000 seeded runs, player teleports next to a grump between steps); `a grump never moves towards the player` (distance after its move is at least the distance before, whenever the player is within 12); `a grump with the player standing right beside it stays put and is not trapped`.
  - `a grump never stands on an avoided cell (door, house, path)`; `a grump walled in by placed blocks is lifted after 6 s`; `placing a block into a grump or friend cell is refused` (via `occupied`).
  - `settle: a new grump heads for a cell within 2 of a planted crop, else a zone cell`; `settle re-picks when its crop is gone`.
  - `mood: hit 0 to 1 is unsure, hit 1 to cheered, a hit on a cheered or removed grump is ignored`; `pausesCell is true within 3 of a mood 0 grump and false for mood 1 and for friends`; `pausedCells lists exactly the plants within 3 of sulky grumps`.
  - `spots: a fake door spot is accepted and keeps grumps 3 cells from the door and never within 1 of it`.
  - Zone: `farmZone covers the plot with a margin and ends 2 cells before the pasture fence`; `zone excludes every house rect, door and the paths (2 cells)`; `the zone has at least 80 standable cells`; `the zone border has standable cells reachable by A* from the village`.
- [ ] **Step 2:** Run `npx vitest run tests/game/grumps.test.ts tests/core/farmZone.test.ts`. Expected: FAIL. Implement. Expected: PASS.
- [ ] **Step 3:** Commit `feat(grumps): harmless grumps and friends that keep their distance`.

### Task 5: Spawner and farm zone (pure)

**Files:** Add `GrumpSpawner` to `src/game/grumps.ts`, create `tests/game/spawner.test.ts`.

```ts
export const SPAWN_SECONDS = 120;
export const FIRST_SPAWN_SECONDS = 45;
export const SPAWN_JITTER = 20;                      // next interval is 100 to 140 s
export const SPAWN_MIN_PLAYER = 8;
export const NEAR_FARM = 16;
export const CAP_WITH_WEAPON = 3;
export const CAP_WITHOUT_WEAPON = 1;
export interface SpawnContext { dt: number; nearFarm: boolean; plantedCrops: number; count: number; hasWeapon: boolean; overlayOpen: boolean; paused: boolean; player: PlayerPos; borderCells: Cell[]; occupied: Cell[] }
export class GrumpSpawner {
  constructor(rng: () => number, saved?: { timer: number; interval: number; first: boolean });
  update(ctx: SpawnContext): { cell: Cell; kind: GrumpKind } | null;   // at most one decision per call; deterministic
  state(): { timer: number; interval: number; first: boolean };         // for saving
}
```
The timer advances by `dt` only when all of `nearFarm`, `plantedCrops >= 1`, `count < cap`, `!overlayOpen`, `!paused` hold. A spawn cell is chosen with the injected rng from `borderCells` that are at least `SPAWN_MIN_PLAYER` from the player and not occupied; none means "wait, timer stays full". The kind alternates by rng.

- [ ] **Step 1 (Codex):** Tests (injected rng and explicit dt, no real clock): `no spawn before 45 s near the farm the first time, then about 120 s`; `interval after a spawn is 100 to 140 s (rng extremes)`; `timer does not advance when far from the farm`; `timer does not advance with no planted crops`; `no spawn at the cap, and the timer does not advance while at the cap` (so a cheered-up grump is never replaced at once); `cap is 1 without a weapon and 3 with one`; `no spawn and no timer while an overlay is open or the game is paused`; `dt of 0 never changes anything`; `a huge dt fires at most one spawn per call` (no wave); `never spawns within 8 blocks of the player`; `never spawns on an occupied cell`; `no candidate cell waits and spawns later when one appears`; `kind comes from the rng`; `state round-trips`; `same rng seed and inputs give the same spawns`; `two spawns are never less than 100 s of near-farm time apart`.
- [ ] **Step 2:** Run `npx vitest run tests/game/spawner.test.ts`. Expected: FAIL then PASS. Commit `feat(grumps): deterministic spawn rules`.

### Task 6: Plant pause in the farm

**Files:** Modify `src/game/farm.ts`, `tests/game/farm.test.ts`; create `tests/game/grumpsFarm.test.ts`.

```ts
export const PAUSE_STEP_MAX_MS = 5000;
// Farm
advance(ms: number, paused?: (x: number, y: number, z: number) => boolean): void;   // a record for which paused() is true does not accumulate ms
plantCells(): Cell[];                                   // crop and tree-base cells, for the spawner and markers
```
`main.ts`'s 1 s tick (Task 15) calls `farm.advance(step, step <= PAUSE_STEP_MAX_MS ? (x, y, z) => grumps.pausesCell([x, y, z]) : undefined)`. Trees pause by their trunk-base cell. Step 2 tests are unchanged.

- [ ] **Step 1:** Tests: `a paused plant does not grow` (advance 3 stages of time: still stage 0, `p` unchanged); `unpausing resumes from where it stopped` (pause for 100 s, then 50 s: stage change after the remaining time, not before); `paused and unpaused plants side by side`; `paused advance equals no advance for that record` (property over random sequences); `the pause is deterministic` (two farms, same inputs, same records); `stages never decrease and no plant block is removed under any pause pattern` (200 random sequences); `help still advances a paused plant one stage`; `a step bigger than 5 s is applied without the pause` (the wiring helper function, tested directly); `the offline catch-up is never paused`; `a tree is paused by its trunk cell`; `records round-trip exactly while paused` (nothing new to save); `grumps cheered mid-way: the first hit unpauses at once`; `pausedCells matches pausesCell`.
- [ ] **Step 2:** Run `npx vitest run tests/game`. Expected: new tests FAIL, step 2 tests PASS. Implement. Expected: PASS. Commit `feat(farm): grumps pause plants, never harm them`.

### Task 7: Rewards and friend rule (pure)

**Files:** Create `src/core/grumpRules.ts`, `tests/core/grumpRules.test.ts`.

```ts
export const HITS_TO_CHEER = 2;
export const FRIEND_EVERY = 5;
export const FRIEND_CAP = 5;
export const WEAPON_REACH = 8;
export const FIRE_COOLDOWN = 0.5;
export const FLIGHT_SECONDS = 0.3;
export function rewardFor(rng: () => number, inv: Inventory, opts: { friend: boolean; atCap: boolean }): Array<{ id: ItemId; n: number }>;
export function becomesFriend(cheeredAfter: number, friendCount: number): boolean;     // cheeredAfter % 5 === 0 && friendCount < 5
```
`rewardFor` returns only entries that fit under 99 (never partial, never a stack above 99); friend: one Gem; at cap: the normal roll plus one extra Gem.

- [ ] **Step 1 (Codex):** Tests: `roll bands are 60 / 30 / 10 percent over 10,000 seeded rolls (within 3 points)`; `seeds are two of one kind and the kind is uniform`; `a reward that does not fit is skipped and the next fitting one is used`; `nothing fits gives an empty reward`; `a result never takes any stack above 99`; `friend always gives one Gem if it fits`; `at cap gives the roll plus one extra Gem`; `becomesFriend: true at 5, 10, 15 with fewer than 5 friends, false at 5 friends, false at 1 to 4, 6 to 9`; `constants: reach 8, cooldown 0.5, flight 0.3, hits 2, every 5, cap 5`; `all reward items are registered item ids`.
- [ ] **Step 2:** Run `npx vitest run tests/core/grumpRules.test.ts`. Expected: FAIL then PASS. Commit `feat(grumps): rewards and the friend rule`.

### Task 8: Weapons: tap, fire, cheer, pad

**Files:** Modify `src/input/tap.ts`, `src/input/entityPick.ts`, `src/game/game.ts`; create `src/game/delayed.ts`; tests `tests/input/tap.test.ts`, `tests/input/entityPick.test.ts`, `tests/game/weapons.test.ts`, `tests/game/delayed.test.ts`. `tests/input/gesture.test.ts` must stay untouched and green.

**Interfaces:**
```ts
export type TapIntent = /* step 2 */ | { kind: 'fire'; grump: number } | { kind: 'petFriend'; friend: number };
export type PickedEntity = { type: 'animal' | 'grump' | 'friend'; id: number; dist: number };
export function pickEntity(screen: { x: number; y: number }, list: Array<{ type: PickedEntity['type']; id: number; sx: number; sy: number; sz: number }>, radius = 56): { type: PickedEntity['type']; id: number } | null;   // pickAnimal stays as a wrapper
export function resolveTap(hit, selected: StackId | 'hand', playerFeet, world, occupied, entityHit?: PickedEntity): TapIntent;
export class Delayed { after(seconds: number, fn: () => void): void; update(dt: number): void; readonly pending: number }
// Game
fireWeapon(grumpId: number): GameEvent[];      // logic-immediate; cooldown; returns 'fired', 'unsure' or 'cheered'
petFriend(id: number): void;
fireNearest(): boolean;                         // the pad's Place button
// GameEvent += { type: 'fired'; weapon: WeaponKind; grump: number } | { type: 'unsure'; grump: number } | { type: 'cheered'; grump: number; friend: boolean; reward: Array<{ id: ItemId; n: number }> } | { type: 'friendMade'; friend: number }
```
`resolveTap` order is exactly the "Tap precedence" row of the decisions table. `Game.fireWeapon`: requires `isWeapon(selected)`, a grump that exists and is within `WEAPON_REACH` of the player's eye, cooldown zero, game not paused; sets the cooldown; calls `GrumpSystem.hit`; on cheer-up increments `cheered`, decides friend vs burst with `becomesFriend`, gets the reward with `rewardFor`, adds it to the bag, emits one event; nothing else about the game changes. Weapon is never removed.

- [ ] **Step 1:** Tests. **Unchanged-rules block** (copied and kept green): `quick tap with the hand walks`, `quick tap with a block builds in reach`, `a tap never digs`, `hold digs within reach / walks beside when far`, `hold on the block under his or Pip's feet does nothing`, all step 2 tap tests. **New:** `weapon + tap on a grump within 8 fires`; `weapon + grump beyond 8 walks to a cell at least 6 from it`; `weapon + tap on empty ground walks`; `weapon + tap on a block face walks and never places`; `weapon + tap on water or a path walks`; `weapon + tap on a plant in reach helps (step 2 unchanged)`; `weapon + tap on an animal pets (not feeds)`; `weapon + tap on a friend pets`; `hand + tap on a grump walks and never fires`; `block + tap on a grump walks and never places`; `food + tap on a grump walks and never feeds`; `seed + tap on a grump walks and never plants`; `hold on a grump or friend gives none and never digs the ground behind it`; `hold on the block under a grump gives none`; `a weapon item is never placed as a block`; `pickEntity: nearest within 56 px, ties to the nearer camera, empty list is null, grumps and animals compete in one list`. Game: `fire needs the selected item to be a weapon`; `fire is refused out of reach, during cooldown, while paused`; `a fast double tap fires once`; `first hit makes it unsure and the plants resume`; `second hit cheers it up and a reward is in the bag`; `a reward that cannot fit is skipped and nothing else changes`; `the fifth cheer-up makes a friend, the tenth too, until five friends`; `at five friends the fifth just bursts with an extra Gem`; `firing never costs or consumes anything`; `no state changes except the bag, the grump and the counters`; `pad fireNearest hits the nearest grump in reach, else returns false and does nothing`; `Delayed: runs after the time, freezes when dt is 0, runs each callback once, in order`; `menu open mid-flight: the cheer visual still happens after closing`.
- [ ] **Step 2:** Run `npx vitest run tests/input tests/game`. Expected: FAIL. Implement. Expected: PASS, including `tests/input/gesture.test.ts` untouched.
- [ ] **Step 3:** Commit `feat(weapons): a quick tap with a weapon cheers up a grump`.

### Task 9: Friends and jobs

**Files:** Modify `src/game/grumps.ts` (friend update), create `tests/game/friends.test.ts`.

```ts
export const FRIEND_JOB_SECONDS = 240;
// GrumpSystem
makeFriend(grumpId: number): Friend;                 // converts in place; keeps position and kind; variant = friends made so far (0..4)
updateFriends(ctx: GrumpContext & { farm: { growingNear(c: Cell, r: number): Cell | null; help(c: Cell): unknown } }): FriendEvent[];   // { type: 'helped'; friend: number; cell: Cell }
```
- [ ] **Step 1:** Tests: `converting keeps position and kind and gives variant 0, then 1, 2, 3, 4`; `variant wraps after 5 and nothing breaks`; `a friend never leaves the zone and never stands on an avoided cell`; `a friend never walks towards the player` (distance never decreases through its own move); `friends are not solid: placing into one is refused`; `a friend helps the nearest growing plant every 240 s of play time`; `no growing plant: it waits at zero without piling up jobs and retries`; `a ripe plant is never helped`; `jobs ignore the pause`; `dt 0 never advances a job`; `the job uses Farm.help, never sets a stage directly`; `friends are never removed by any update` (10,000 s random run); `friends cannot be hit` (`hit(friendId)` is ignored); `the friend cap is never exceeded`.
- [ ] **Step 2:** Run `npx vitest run tests/game/friends.test.ts`. Expected: FAIL then PASS. Commit `feat(grumps): friends who help a plant now and then`.

### Task 10: Save fields

**Files:** Modify `src/core/save.ts`, `tests/core/save.test.ts`.

```ts
interface SaveData { /* existing + step 2 */
  grumps?: Array<[number, number, number, number, number]>;          // kind 0|1, x, y, z (x10 fixed point), mood 0|1
  friends?: Array<[number, number, number, number, number, number]>; // kind 0|1, variant 0..4, x, y, z, jobIn s
  grumpStats?: [number, number, number, number];                     // cheered, spawn timer s, spawn interval s, firstDone 0|1
  flags: { /* + */ hints?: string[] }                                // new hint names added to the known list
}
```
Weapons and gems are ordinary entries in step 2's `items`/`itemOrder`. Validation: grumps need kind 0 or 1, finite in-bounds position inside the farm zone and mood 0 or 1 (a bad grump is dropped; they come back via the spawner, nothing is lost); at most 3 grumps kept; friends need valid kind and variant (clamped), a position that is bad is **moved to a free zone cell instead of dropped** (a friend is never lost), at most 5 friends kept in saved order, `jobIn` clamped to 0..240; `grumpStats` are clamped integers (`cheered` 0..1,000,000, timers 0..300); a wrong type for any new field drops that field only; unknown hints dropped.

- [ ] **Step 1 (Codex):** Tests: `a step 2 save without any grump field loads` (no grumps, no friends, stats zero, spawner starts fresh); `a step 1 v2 save and a v1 save still load, and the v1 key is never written`; `new fields round-trip` (grumps, friends, stats, hints, a weapon in items); `bad grump entries are dropped and the rest of the save survives`; `a friend with a bad position is re-placed, never dropped`; `more than 3 grumps keeps 3, more than 5 friends keeps 5`; `cheered is clamped`; `grumps outside the zone are dropped`; `a bad grumps field type drops that field only`; `unknown hints dropped`; `the weapon items are in items and not in inventory`; `a stored higher gen is never lowered and a newer version is never overwritten` (existing rules still hold); `savedAt in the future leaves the spawn timer untouched` (timers are not counted down offline).
- [ ] **Step 2:** Run `npx vitest run tests/core/save.test.ts`. Expected: FAIL then PASS with all earlier save tests untouched. Commit `feat(save): additive fields for grumps, friends and counters`.

### Task 11: Invariant tests (never hurts, never scary, never lost)

**Files:** Create `tests/game/grumpInvariants.test.ts`. Tests only; a failure sends the bug back to Task 4, 6, 8 or 9.

- [ ] **Step 1 (Codex):** Property tests with seeded random action streams of 2,000 steps over the real generated world (actions: walk, plant, help, hold-harvest, dig and place anywhere including the zone, fire any weapon at any entity, tap everything, open and close menus, tick time by random amounts including backwards and week-long jumps, save and reload through `serialise` and `applySave`):
  - `never hurts anyone`: no event, state or field exists that changes the player, Pip, a villager or an animal because of a grump (the herd and villager snapshots are byte-equal before and after any stream with grumps present, apart from their own wandering); `grumps cannot be hurt`: the only data change from a weapon is mood and the counters.
  - `never chases or approaches`: over every step, a grump's own move never reduces its distance to the player below 4 and never reduces it when inside 4.
  - `caps hold`: grumps never above 3 (1 without a weapon), friends never above 5, in every state including after reloads.
  - `daytime only`: there is no time-of-day state, no `night`/`dark` identifier in the new sources, and the sky and fog colours are unchanged by the presence of grumps (render test hook).
  - `plants never die`: no stage decreases; no plant block disappears unless the stream dug it; a year of simulated play with three grumps leaves every plant present.
  - `nothing lost`: weapons are never removed; no stack ever leaves 0..99; friends never decrease (except never); the only bag reductions are crafting inputs, planting and eating and feeding (as before).
  - `none appear in a house, next to him or while a menu is open or the game is paused`: assert on every spawn event the cell is in the zone, not avoided, at least 8 from him, and the spawner got `overlayOpen = false` and `paused = false`.
  - `no action throws`; `save and reload at any point keeps every grump, friend, counter and the bag` (equality of `serialise` before and after, modulo the dropped-invalid rules).
- [ ] **Step 2:** Run `npx vitest run tests/game`. Expected: PASS once Tasks 4 to 10 are right. Commit `test: grumps never hurt, never chase, never lose anything`.

### Task 12: Lines, hints, voice clips

**Files:** Modify `src/content/lines.ts`, `src/content/spoken.ts` (step 2 helper), `src/game/hints.ts`, `tests/content/lines.test.ts`, `tests/content/voice-clips.test.ts`, `tests/game/hints.test.ts`; regenerate `tools/voice/lines.json`, `public/voice/pip/**`, `public/voice/manifest.json`.

**New Pip keys (nine, four variants each, each with a picture in `LINE_ICONS`):** `grumpArrives` ☁️, `plantsWaiting` 🌱, `craftWeapon` 🫧, `pickWeapon` 🪄, `cheerHalf` 🙂, `cheeredUp` 🎊, `grumpGift` 🎁, `friendMade` 💛, `friendHelps` 💦. Sample variants (each true whenever it can fire; 12 words or fewer; no cheers; never "tap"; never "bad", "scary", "beat", "get it"):
- `grumpArrives`: "Look, someone small and sulky has wobbled onto the farm." / "A sulky little visitor is on the farm." / "Someone grumpy has come to sit by the plants." / "There's a sulky one by the plants."
- `plantsWaiting`: "The plants are waiting. They grow again when it's happy." / "Plants wait while someone is sulking nearby." (pause stated plainly, no blame)
- `craftWeapon`: "We could make a bubble blaster, a wand or a squirter." / "Something friendly might cheer it up. Let's make one." / "Try the crafting screen. A friendly helper is in there."
- `pickWeapon`: "Choose your blaster, wand or squirter from the bar." / "Pick your friendly helper, then point it at the sulky one."
- `cheerHalf`: "It's feeling a bit better." / "Look, it's less sulky now." / "One more and it'll be smiling." / "It's starting to cheer up."
- `cheeredUp`: "It's cheered up! Look at all the confetti!" / "It's all smiles now!" / "No more sulking. Look at that confetti!" / "It's happy again!"
- `grumpGift`: "It left you something nice." / "Look what it left in your bag." / "A little thank you for you." / "You've got a present."
- `friendMade`: "A new friend for the farm! It's staying." / "It wants to stay and be your friend." / "You've made a friend. It lives here now." / "Your farm has a new friend."
- `friendHelps`: "Your little friend is helping the plants." / "Look, a friend is helping a plant." / "A friend is giving a plant a hand." / "Your friend helped a plant grow."

`FarmHints` (step 2) gains the keys `grumpArrives`, `plantsWaiting`, `craftWeapon`, `pickWeapon`, `friendMade` (once-only, saved). `craftWeapon` fires 20 s after a grump arrives while he owns no weapon and the craft screen has never shown one; `pickWeapon` fires when he owns a weapon, a sulky grump is in view and no weapon is selected, once. Reactions (`cheerHalf`, `cheeredUp`, `grumpGift`, `friendHelps`) are rate-limited by the Pal gap and one per kind per 20 s.

- [ ] **Step 1:** Tests: `lines.test.ts`: key count updated (step 2's 34 plus 9 is 43); every new key has four distinct variants of 12 words or fewer, a picture, none match the cheer list `yum|mmm|aww|ooh|hmm|ta-?da|hup|whee|yay|hooray`, none match `tap|click|touch`, none contain `bad|scary|scared|angry|fight|kill|hurt|beat|attack|monster|enemy`, British spellings; `spoken.test.ts` and `voice-clips.test.ts` cover the new lines (clip exists, no stale clips); `hints.test.ts`: `each once-only grump hint fires once and is saved`; `craftWeapon only without a weapon`; `pickWeapon only with a weapon and none selected`; `reactions limited to one per kind per 20 s`; `unknown saved hints ignored`.
- [ ] **Step 2:** Run `npx vitest run tests/content tests/game/hints.test.ts`. Expected: FAIL (also the clip test: the reminder to generate audio). Implement.
- [ ] **Step 3:** Generate the clips (speaker pip only, 36 new clips):
  ```
  npm run voice:lines
  tools/voice/.venv/bin/python tools/voice/generate.py --speaker pip --lines tools/voice/lines.json --out public/voice --prune
  ```
  Listen to each new clip once (watch "sulky", "wobbled", "squirter", "confetti"); add a respelling in `tools/voice/pronunciations.json` if a word sounds odd, then regenerate. The `tools/voice` venv and model cache are needed on the machine that does this.
- [ ] **Step 4:** Run `npx vitest run tests/content tests/audio`. Expected: PASS. Commit `feat(voice): grump, weapon and friend lines and clips`.

### Task 13: Render: models, wobble, markers, projectile, confetti

**Files:** Create `src/render/grumps.ts`, `tests/render/grumps.test.ts`, `tests/render/grumpPalette.test.ts`; modify `src/render/effects.ts`, `src/render/scene.ts`, `tests/render/effects.test.ts`.

**Interfaces:**
```ts
export function makeGrumpModel(kind: GrumpKind, mood: GrumpMood | 'friend', variant: number): THREE.Group;   // ONE merged mesh, vertex colours, feet at y = 0, faces +z; geometry cached and shared
export const GRUMP_PALETTE: readonly string[]; export const FRIEND_PALETTE: readonly string[]; export const INK: string;
export class GrumpView { constructor(scene: THREE.Scene); sync(sys: GrumpSystem, visible: (x: number, z: number) => boolean, timeSeconds: number, showMood: (id: number) => GrumpMood | 'friend'): void; screenPositions(camera: THREE.Camera): Array<{ type: 'grump' | 'friend'; id: number; sx: number; sy: number; sz: number }>; dispose(): void }
// effects.ts (step 2) gains
Sparkles.burst(at, kind: 'bubble' | 'star' | 'drop' | 'confetti' | 'heart' | ..., n?): void;   // capacity 64 -> 96
export class SadMarks { constructor(scene: THREE.Scene, capacity = 24); set(cells: Cell[], timeSeconds: number): void; dispose(): void }   // one Points, never touches the world
export class Projectile { constructor(scene: THREE.Scene); launch(from: Vec3, to: Vec3, weapon: WeaponKind): void; update(dt: number): boolean /* arrived this frame */; readonly active: boolean }
```
Looks: see the decisions table (Looks, Palette, Wobble). Weapon visuals: bubble = a translucent pale-blue sphere (8 triangles) on a gentle arc with 2 small bubbles trailing; wand = a small yellow four-point star with sparkle trail; water = a short blue drop stream (3 small drops in a line). Arrival: bubble pops into 8 bubble particles, wand into 8 stars, water into 8 drops; the grump gets a hop. Confetti: 24 pastel multi-colour particles, 1.0 s life, no red-heavy mix (the confetti palette uses the grump and friend palettes only). Friend help: a heart over the friend and the stage's usual cue colour on the plant.

- [ ] **Step 1:** Tests. `grumpPalette.test.ts`: `every body colour has lightness at least 0.62 and saturation at most 0.8`; `no colour in any model is red-ish (hue within 345 to 15 degrees) except the cheek blush at lightness 0.8 or more`; `eyes are white with ink pupils only`; `every vertex colour in every model is in the palettes, white, ink or blush`; `no model has more than 2 dark (lightness under 0.3) boxes, and only pupils and the mouth are dark`. `grumps.test.ts`: `each model is one mesh with at most 130 triangles`; `a sulky model differs from an unsure one and a friend one (lids, pupils, mouth, colour)`; `no model has teeth, spikes or a part wider than 1.1 blocks or taller than 1.1`; `all kinds, moods and variants build, share geometry between instances and dispose without leaking`; `GrumpView hides entities beyond 44 blocks`; `spawn-in scales from 0.2 to 1 over 1 s and never exceeds 1.06 in any frame`; `wobble amplitude stays within the table's limits for 1,000 sampled times`. `effects.test.ts`: `Sparkles never exceeds capacity (96) and never allocates after the constructor`; `all burst kinds exist`; `SadMarks shows one point per paused plant, at most 24, one draw call, and never calls world.set (source scan)`; `Projectile reaches its target in exactly 0.3 s and reports arrival once`; `projectile is one mesh and one draw call`.
- [ ] **Step 2:** Run `npx vitest run tests/render`. Expected: FAIL. Implement. Expected: PASS.
- [ ] **Step 3:** Look at it with the Playwright MCP tool (a sulky jelly, a sulky cloud, an unsure one, a friend, sad markers, each projectile, a confetti burst) and check the screenshots against "is this the slightest bit scary?". If anything is, change it before committing. Commit `feat(render): grumps, friends, sad markers, weapon effects`.

### Task 14: Sounds

**Files:** Modify `src/audio/sfx.ts`; create `tests/audio/sfx-grumps.test.ts`.

**Interface:** `sfx.blub() twinkle() squirt() grumpHop() confetti() friendChime() plip() sulk()`, each `() => void`, silent with no `AudioContext`.

- [ ] **Step 1:** Tests with the stub `AudioContext` from the step 2 sound tests: `every grump sfx is silent and safe with no AudioContext`; `none uses more than 12 nodes`; `none lasts more than 1.0 s`; `none has a peak gain above 0.3`; `only sine and triangle oscillators are used (noise only in squirt)`; `no oscillator is below 200 Hz and the squirt band is 800 to 2400 Hz`; `no sound is a sawtooth or square`; `sulk plays at most once per 12 s and only within 10 blocks`; `no speechSynthesis call`; `a second identical sound within 80 ms is dropped`; `the three weapon sounds are distinct (different first frequencies or noise)`.
- [ ] **Step 2:** Run `npx vitest run tests/audio`. Expected: FAIL then PASS. Commit `feat(audio): soft synthesised grump and weapon sounds`.

### Task 15: Wire it together

**Files:** Modify `src/main.ts`, `src/game/game.ts`, `src/render/scene.ts`, `src/ui/hud.ts` (connections only).

- [ ] **Step 1:** Build `GrumpSystem(farmZone, avoidCells)`, `GrumpSpawner`, `Delayed`, `GrumpView`, `SadMarks`, `Projectile`. After `applySave` and farm restore: `grumps.restore(...)`, spawner state restored; build chunk meshes after (as step 2). `occupied()` adds `grumps.occupiedCells()`. `Game.holdsSomeoneUp` also protects the block under any grump or friend.
- [ ] **Step 2:** One per-frame update, with `dt = helperDt(game.paused || overlayOpen, dt)`: `grumps.update`, `spawner.update` (`nearFarm`, `plantedCrops` from `farm.plantCells()` in the zone, `hasWeapon`, `overlayOpen`, `paused`), `Delayed.update`, `Projectile.update`, friend jobs. The 1 s farm tick becomes `farm.advance(step, step <= PAUSE_STEP_MAX_MS ? pausedFn : undefined)`. Sad markers are set from `grumps.pausedCells(farm.plantCells())` once per second (and on a hit).
- [ ] **Step 3:** Pointer handler order (step 2's, extended): a press first asks `pickEntity` over animals, grumps and friends (a hit blocks the dig ring; a quick tap becomes `fire`, `petFriend`, `feed`, `pet` or a walk); `scene.pick` otherwise. No handler is added to the canvas and `gesture.ts` is untouched. The pad's Place button: weapon selected means `fireNearest()`; step 2 rules otherwise.
- [ ] **Step 4:** Event wiring: `fired` starts `Projectile.launch` and the weapon's sfx; after `FLIGHT_SECONDS` (via `Delayed`) the arrival burst, `grumpHop` and the grump's visual mood change; `unsure` also removes the sad markers around it (sparkles in the sun colour) and Pip `cheerHalf`; `cheered` after the delay gives a confetti burst (or hearts and stars for a friend), `sfx.confetti` or `friendChime`, a 🎁 bubble with the reward's picture, Pip `cheeredUp` then `grumpGift` (or `friendMade`); a friend's job gives the step 2 help effect and Pip `friendHelps`; `arrived` gives `sfx.plip` if within 12 blocks; `sulk` plays only within 10 blocks and when no voice is speaking.
- [ ] **Step 5:** Review checks: an open overlay (craft, bag, grown-ups, break bubble) pauses grumps, spawning, friend jobs and projectiles (`Delayed` and `Projectile` receive dt 0); the break bubble blocks Pip's grump lines (`allowLine`); no new `pointer` listeners outside the HUD. Debug hooks (dev and `?debug` only): `grumps()` (list, moods), `spawnGrump(kind)`, `spawnerState()`, `fire(id)`, `giveWeapon(kind)`, `makeFriend(id)`, `setCheered(n)`, `advanceSpawner(s)`, `stats()` extended with grumps, friends and particles. `npm test && npm run build`. Commit `feat: grumps and friendly weapons wired in`.

### Task 16: Budget and performance

**Files:** Create `tests/render/grumpBudget.test.ts`; modify `tests/render/budget.test.ts` only if a number legitimately moves.

- [ ] **Step 1:** Tests: `3 grumps and 5 friends are at most 8 draw calls and 1,050 triangles`; `Sparkles stay 1 draw call at capacity 96`; `SadMarks are 1 draw call, 24 points`; `Projectile is 1 draw call`; `draw calls with village, farm, animals, grumps and friends in view stay within the chunk count plus 26` (step 2's 14 plus 12 for this plan); `GrumpSystem.update with 3 grumps and 5 friends costs under 0.1 ms per frame`; `spawner update costs under 0.02 ms`; `Farm.advance with a paused predicate over 400 crops costs under 0.3 ms`; `pausedCells over 400 crops and 3 grumps costs under 0.1 ms`; `no allocation per frame in GrumpView.sync after warm-up (geometry cache hit)`; `world triangle budget unchanged` (nothing here changes the world).
- [ ] **Step 2:** Run `npx vitest run tests/render`. Commit `perf: grump and friend budgets`.

### Task 17: Browser story (e2e)

**Files:** Create `e2e/grumps.spec.ts`. Reuse `e2e/helpers.ts`. Tests start at `/block-pals/?debug` with a fresh `localStorage` unless they inject one. They use real touch for the gestures that matter (tap, press and hold, drag) and debug hooks for long waits.

- [ ] **Step 1:** Tests:
  - `a grump arrives, keeps away and pauses a plant`: plant a crop (hook), stand near the farm, `advanceSpawner(120)` after the first: one grump exists, it is 8 or more blocks from him on arrival; walk towards it: it never moves closer (sampled over 5 s); the plant near it does not grow while `advance(3 stages)` is called and a sad marker count is above 0 (`stats().particles` or a marker count in the hook).
  - `craft a weapon, cheer it up`: give the materials, craft the bubble blaster (picture in the craft screen, tick afterwards), select it, quick tap the grump twice 0.6 s apart: the first makes it unsure (markers gone, plant grows again), the second bursts (`stats().particles > 0`), the bag has a reward, the weapon is still there.
  - `a weapon tapped on empty ground just walks`; `a tap with the hand on a grump walks and does not fire`; `hold on a grump never digs`.
  - `three weapons look and sound different`: for each weapon hook `fire`, assert distinct `lastSfx()` names and distinct projectile kinds.
  - `every fifth cheer-up makes a friend`: `setCheered(4)`, cheer one: a friend exists, it keeps still beside the plants, `advanceFriendJobs(240)` helps a growing plant by one stage; at 5 friends the next fifth makes none.
  - `caps`: spawn many with the hook and by waiting: never above 3 grumps (1 without a weapon).
  - `no spawns with a menu open`: open the craft screen, advance the spawner a long time, close it: no grump arrived during it.
  - `no spawn with no planted crop`.
  - `placing a block into a grump is refused`.
  - `save and reload keeps grumps, friends, counters and the weapon`; `an old step 2 save loads` (no grump fields): page loads, no errors, no grumps until the rules allow; the v1 key is byte-identical.
  - `fps`: with village, farm, 10 animals, 3 grumps, 5 friends and a confetti burst in view, `stats().fps` is reported (a loose floor in CI; the tablet number is on the checklist) and no console errors.
- [ ] **Step 2:** Run `npm run e2e`. Expected: all pass including `smoke`, `village` and `farm`. Run `npm test && npm run build && npm run e2e`. Commit `test: browser story for grumps and friendly weapons`.

### Task 18: README and spec status

**Files:** Modify `README.md` (a short paragraph: the grumps, the weapons, the friends) and the status line of this plan.

- [ ] **Step 1:** Update README and the plan status. Commit `docs: describe grumps and friendly weapons`.

---

## Self-review against the spec

§7f "Done when": *a grump wobbles onto the farm, stays well away, pauses the plants (sad marker); he crafts a weapon, selects it, taps twice, confetti and a reward, plants grow again; every fifth makes a friend who helps; caps; nothing hurt, lost or killed, nothing wilts; none at night, in houses, next to him or with a menu open; works without reading; old saves load; 30 fps.*
- **Wobbles in, stays away, pauses:** Tasks 4, 5, 6, 13 (spawn rules and the personal-space test; the pause is a timer skip; sad markers).
- **Craft, select, tap twice, confetti, reward, resume:** Tasks 1, 2, 7, 8, 13, 15, 17.
- **Friends and caps:** Tasks 7, 9, 10, 11.
- **Nothing hurt, lost, wilted; daytime:** the source scan, the invariants suite, `stages never decrease`, `weapons are never removed` (Tasks 4, 6, 9, 11).
- **Not in houses, not next to him, not with a menu open:** Tasks 4 and 5 and the Task 11 property test.
- **No reading:** pictures on every recipe, tick, bubble and the confetti; Pip's voice for every line; weapon icons in the bar (Tasks 2, 12, 13, 15).
- **Old saves, fps:** Tasks 10, 16, 17 and the checklist.

Anti-goals (§4): **nothing scary** (soft pastel palette with a test, no red or dark colours, no teeth, sulky means droopy lids, slow wobble, small size, no approach, no spawn near him, no sudden or loud sounds, sounds above 200 Hz and gentle with a test, spawn-in is a gentle grow, no jump-scares because nothing appears within 8 blocks of him); **nobody hurt, nothing lost** (no such state exists; scans and properties; weapons never consumed; rewards skipped rather than refused; friends never removed); **no reading** (above); **no frustration** (a tap never fails silently except during the 0.5 s cooldown; a far grump walks him into range; help taps still grow paused plants; at most one grump until he has a weapon; two hits not ten; the cap; no wave); no ads, links or data (none); original assets only (our own models, palette and sounds); British English (policy tests).
§5: 30 fps budget in Task 16 and the checklist; offline; local save. §7a: tap, hold and drag meanings, timings and thresholds unchanged; the only new behaviour is what a tap on a grump or friend does, and weapons are items that never place, dig or fire at nothing. §7c: nothing here touches the camera (grumps are non-solid and ignored by the camera ray like animals; add the same `blocksRay` exemption if the camera test shows a need).

Out of scope on purpose: sulking at villagers' doors (hooks only), coins and selling gems (step 3), friend names and a friends gallery screen, upgrading weapons, grumps in the village or the meadow, anything underground, any night, any combat of any kind.

## Performance numbers

| | Step 2 | With grumps and weapons |
|---|---|---|
| World triangles | about 47,000 (budget 115,000) | unchanged (no blocks added) |
| Grumps and friends | 0 | up to 3 + 5 models, at most 130 triangles each (about 1,050), 8 draw calls |
| Geometry | | 2 kinds x (3 moods + 5 friend variants) built once and shared |
| Sparkles | 1 `Points` of 64 | same object, capacity 96, still 1 draw call |
| Sad markers | 0 | 1 `Points`, at most 24 points, 1 draw call |
| Projectile | 0 | 1 small mesh, 1 draw call (idle: not drawn) |
| Draw calls, everything in view | chunks + 14 | chunks + 26 (budget) |
| Per-frame CPU | `Farm.update` under 0.2 ms, `Herd` under 0.3 ms | `GrumpSystem` under 0.1 ms, pause check under 0.3 ms over 400 crops |
| Save | | about 8 grump/friend records and 4 numbers: well under 1 KB |

Fallbacks if the tablet misses a number (decide from the checklist, do not build ahead): drop the wobble to every other frame; confetti 24 to 14 particles; sad markers become plain tinted points; cap grumps at 2; friends beyond 3 hidden when 30+ blocks away.

## Parent playtest checklist (Galaxy Tab A8, after deploying to GitHub Pages)

Use `?debug` once for the fps counter and the grump hooks, then play without it. **The first question comes before everything else.**

1. **Is anything the slightest bit scary?** Watch a grump arrive, sit and sulk, from across the farm and from close up. Colours, eyes, faces, size, movement, sound, how it appears. Does it ever feel like it is coming for him? Would a nervous 5-year-old be happy to walk up to it? If the answer to any of these is no, that is a bug: write down exactly what, and it gets changed before anything else.
2. **Old save.** Open the new version on the tablet with his world. Everything is there; no grumps until he has planted something near the farm.
3. **Arrival.** Plant something, stay near the farm: after about a minute a first grump wobbles in from the edge (never next to him). Later ones come about every two minutes, never more than three.
4. **Personal space.** Walk towards one: it stands still and never follows. Walk away: it stays where it is.
5. **Sad plants.** The plants near a sulky grump show a small sad marker and stop growing (note one plant's stage for two minutes). Pip says what is happening in plain words. Nothing wilts.
6. **No dead end.** Before he has a weapon: only one grump comes; Pip points at the craft screen; a tap on a sad plant still helps it.
7. **Craft.** The three weapons are in the craft screen with pictures and dots, and a tick once made. The bubble blaster, wand and squirter look and sound different.
8. **Fire.** Select a weapon, tap a grump: a soft projectile flies over, the grump hops and looks happier (markers gone, plants grow again). Tap again: confetti and a present in the bag. Does he understand it without being told? Tap empty ground with a weapon: he just walks. Tap a grump with the hand: he walks towards it and nothing else happens.
9. **Friends.** After every fifth cheer-up a happy friend stays on the farm and helps a plant now and then. At five friends the farm still feels uncrowded.
10. **Nothing hurt or lost.** No grump, friend, animal or Pip is ever hurt; nothing disappears from the bag except what crafting used.
11. **Menus.** Open the craft screen or bag for a few minutes: no grump arrives, nothing moves, nothing is missed.
12. **Reload.** Close and reopen: grumps, friends, the weapon and the plants are as he left them.
13. **Controller.** Select a weapon and fire with the Place button.
14. **Speed.** Village, farm, animals, grumps, friends and a confetti burst in view, turning the view: the fps counter stays at 30 or more (write down the lowest). After 10 minutes the tablet is not hot.
15. **Voice.** All nine new lines are British, clear, short and calm. Listen for "sulky", "wobbled", "squirter".

## Build chunks and review gates

Four sequential chunks, each built by Claude, reviewed by Codex (Claude builds and reviews if Codex is out of allowance), fixed, and merged to `main` only after its gate passes. **None starts before Village step 2 has merged.** The parent playtests on the tablet after the final chunk (and may peek after chunk C).

| Chunk | Tasks | Gate before the next chunk |
|---|---|---|
| A. Items, recipes, wander core | 1, 2, 3 | `npm test` and `npm run build` green; step 2 animal and item tests untouched and passing; three weapons craftable once each; Codex review of the id ranges and the refactor. |
| B. The rules (no graphics) | 4, 5, 6, 7, 9, 10, 11 | Grump, spawner, pause, friend, reward, save and invariant tests green; personal space and caps hold; stages never decrease; v1 and step 2 saves load and the v1 key is never written; Codex review of the spawn rules and the pause. |
| C. Look, sound, voice | 12, 13, 14 | Palette, size, sound-range and line-policy tests green; clips generated; the Playwright look at every model and effect; **the parent may peek here and answer "is it scary?" before any more is built on it**; Codex review of lines and palette. |
| D. Weapons, wiring, e2e, docs | 8, 15, 16, 17, 18 | Full `npm test && npm run build && npm run e2e`; gestures re-tested unchanged (§7a); budgets pass; Codex review of the tap precedence and the event wiring. |

(Task 8 is built last because it needs the visuals to be worth looking at, but its pure parts are tested from chunk B onwards through `Game.fireWeapon`; if the order feels wrong in practice the implementer may build Task 8's logic half in chunk B and its wiring in D.)

**Final gate:** all four chunks merged, the e2e story passes, the performance budgets pass, the self-review above is re-checked against the built code, and the parent has done the tablet checklist above, starting with question 1.

## Decisions confirmed/assumed by the parent (2026-11-08)

The parent answered every design question before this plan was written (recorded verbatim under Global Constraints) and did not object to the recommendations on the four open questions, so they are recorded as defaults. The tasks above already follow them.

1. **Help on sad plants:** a help tap still grows a sad (paused) plant, so grumps are never a dead end. (default — change if the parent wishes)
2. **The first grump:** may arrive before he owns a weapon; only one exists until then, and Pip points at the craft screen. The cap is 3 once he owns a weapon. (default — change if the parent wishes)
3. **Rewards:** seeds and gems (60% two seeds, 30% a shiny gem, 10% an apple sapling). The gem (item 123) is sold to Captain Pebble (step 3) and traded to the wizard for mythical blocks (§7g). (default — change if the parent wishes)
4. **Friend help:** a friend gives one stage to one growing plant every 240 s. (default — change if the parent wishes)
