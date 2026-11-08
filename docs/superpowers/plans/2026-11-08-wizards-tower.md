# The Wizard's Tower Implementation Plan

**Status: plan for the parent to review (2026-11-08). Built AFTER Grumps and Friendly Weapons (`2026-11-08-grumps-and-friendly-weapons.md`, gems come from there) has merged, and BEFORE Village step 3 (shops and coins), unless the parent says otherwise. Build in chunks, each reviewed (Claude builds, Codex reviews; Claude is the fallback builder and reviewer if Codex is out of allowance). Docs only: this PR contains no product code.**

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a hilltop at the far south edge of the world stands a tall tower with a gently glowing light at the top. A path leads to it from the village, and Pip walks him there once, after he has his first gem. Inside lives **Orlo the wizard**, an original character with his own voice, a floating glowing orb (Glim) and a long beard tucked in his belt. Tapping Orlo opens a picture-only screen. He can **trade gems** for the wizard's eight **mythical blocks** (the first visit gives one free block of his choice), or solve a **picture puzzle** (counting with dots, "what comes next?" patterns, matching shapes and colours) for another. He can never fail: a wrong answer gets "try again", hints come after a short time and in the end the wizard helps him through. Puzzles start very easy and get slightly harder as he solves more. The eight blocks (Starlight crystal, Rainbow, Cloud, Moon, Sun, Dragon-scale, Star, Magic mirror) are bright, friendly decorations and light sources with no special powers yet.

**Architecture:** Same layering as the earlier steps. Pure, DOM-free logic in `src/core/` (block registry, tower stamp, puzzle generators, trade rules, save fields) and `src/game/` (puzzle session, wizard visit, lead) is unit-tested with Vitest, including the real generated world. **The wizard is an entity, not a block**, like villagers, animals and grumps: non-solid, one merged mesh plus one orb mesh, standing at a fixed spot in the tower, never trapped, placing a block into his cell is refused. The tower is real blocks stamped by a new `stampTower` beside `stampHouse`, so digging, building, the smart camera, path-finding and saving all reuse what exists. The mythical blocks are ordinary new block ids (36 to 43) with atlas art; their shimmer is a slow repaint of four 16×16 atlas tiles (no shader, no UVs changed, no chunk rebuilt). The far light is one fog-free `Sprite`; a small star marker on the screen edge points to it until he has visited. `main.ts` only wires.

**Tech Stack:** TypeScript 5 (strict), Vite 8, Three.js 0.187, Vitest 5, Playwright 1.65, Web Audio API, Kokoro (offline, generation only). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-05-block-pals-design.md` (§4 anti-goals, §5 constraints, §7a gestures, §7c camera, §7d Village and houses, §7f grumps and gems, §7g this feature). Builds on Village step 1 (merged) and **depends on** `2026-11-08-village-step2-eating-and-farm.md` (item model `ItemId`/`StackId`, hotbar bag tray, entity pick, voice machinery, additive save fields, block ids 16 to 35, `GEN_VERSION` 2) **and** `2026-11-08-grumps-and-friendly-weapons.md` (`ItemId.Gem = 123`, the unified entity pick). Interfaces below are written against those plans as planned; if either differs when this is built, the first act of Task 1 is to reconcile (use the next free block ids and `GEN_VERSION`, and say so in the commit).

## Global Constraints

**Decisions confirmed by the parent (2026-11-08), binding, recorded verbatim:**
- A WIZARD, an original character with a strong personality and his own voice, lives alone in a TALL TOWER on a HILLTOP at the FAR EDGE of the 96×96 world, away from the village. The tower has a gently glowing light at the top visible from the meadow so he is curious. A path leads there from the village; Pip walks him there the first time (once per save, like the village lead), once he has his first gem. Never dark inside (lamps), camera comfortable in the tower (reuse the camera-in-houses rules and tests: drag to turn works, never inside walls).
- The wizard gives 8 MYTHICAL BLOCKS, all bright/lit, never dark or scary, original: Starlight crystal (glowing blue-white, gives light like a lamp), Rainbow block (colour bands slowly shimmering), Cloud block (soft white fluffy), Moon block (silver, gentle glow, light), Sun block (warm gold, light), Dragon-scale block (green-gold scales), Star block (deep blue with twinkling stars), Magic mirror glass (sparkly see-through, works like glass with a glimmer). They are DECORATIONS AND LIGHT SOURCES with NO special powers in this step (powers like a bouncy cloud are a later idea). Add them as new block ids with atlas art (animated shimmer must be cheap: shader-free, e.g. UV/tile swap on a slow timer or per-vertex tint, no per-frame chunk rebuilds), placeable and collectable like normal blocks, lights integrated with how lamps work today.
- How he gets them: BOTH (a) trading GEMS (earned from cheering up grumps; one free mythical block as a welcome gift the first time) and (b) PICTURE PUZZLES set by the wizard: counting (digits up to 20, shown with dots: "bring me 3 apples and 2 carrots"), patterns ("what comes next?": colours/shapes e.g. red, blue, red, blue, ?) and matching shapes/colours; ALWAYS pictures and numbers, never reading; he can NEVER FAIL: a wrong answer gets a gentle "try again" and Pip helps if he is stuck (give hints after a short time); a new puzzle each visit, starting very easy and getting slightly harder as he solves more (difficulty persisted); solving gives a mythical block. (Beat-copy puzzles join later with the music step.)
- Voice: the wizard is a new speaker 'wizard' in tools/voice/voices.json (three candidate blends proposed below; the parent chooses by listening to three sample clips).

**Standing rules (from the spec and the earlier steps; unchanged):**
- British English in every string and voice line. Lines: **at most 12 words, four variants per key, no cheer or sound words** (`ooh|hmm|ta-da|hup|whee|yay|hooray|yum|mmm|aww` and the like: tablet speech and Kokoro read them out as words; excitement comes from separate synthesised sfx and animation), no "tap/click/touch" in any line, each line true whenever it can fire, no promises of later steps. Nothing scary, nothing hurt, nothing lost, nothing dark, nothing that needs reading.
- Always daytime. Bright colours only: the darkest tile pixel average stays above the floors pinned in Task 2.
- No network calls at runtime, no analytics, no links out, no new dependencies. Works offline.
- Target device: Galaxy Tab A8 (1920×1200, Unisoc T618), landscape, Chrome. A steady 30 fps or better with the tower, its light and the village in view. Pixel ratio capped at 1.5. No real-time shadows and no real-time point lights.
- Touch targets at least 88 CSS px. **Quick tap with the hand walks, press and hold (about ½ s) digs, drag turns the view (§7a, §7c). This plan does not change the timings, thresholds or meaning of any of them.** It adds one more thing a quick tap can land on (the wizard), nothing that a tap destroys.
- Never write a child's real name anywhere (code, tests, lines, commits, PR text). "Our player", "he".
- Save: `blockpals.save.v2` stays the key and `version` stays 2; all new fields are **additive and optional**. The v1 key `blockpals.save.v1` is never written, changed or deleted, and the backup, bad-copy, conflict and "never lower `gen`" rules are unchanged. Existing block ids and item ids never change; new block ids are appended (36 to 43; 44 to 47 reserved for later mythical blocks).
- Everything he builds is real. He may dig or build on the tower and the path like anywhere else. Only bedrock and water cannot be dug.

## Review Focus

- **Scary, dark, read (the main review):** read the wizard, his voice, his lines, the star room and every block tile as a nervous 5-year-old would. Pinned guards: tile brightness floors, light-in-shade test, no near-black pixels, source-scan for scary words in the new files, lines policy, voice-clip test (Tasks 2, 10, 11, 20).
- **Failing, losing, getting stuck:** no timer, lives, score or fail state exists in the puzzle code (source scan); a random clicker and a patient waiter both always finish every puzzle at every level; a trade or gift that would overflow a stack (99) is refused whole and nothing is spent; the level never goes down; save fields are validated and a bad value never costs him the rest (Tasks 6 to 9, 20).
- **Walkability and the camera:** a real-world A* test from the village gate and from the spawn to the tower door, up the stairs to the star room and back; the camera test over both floors of the tower, all yaws and pitches, close mode and drag-to-turn (Tasks 5 and 17).
- **Worldgen safety:** deterministic, nothing written outside the array, his edits always win, the v1 meadow fixture still matches, the old stamps unchanged, old saves load, the v1 key never written (Task 5).
- **Gestures (§7a):** the four tap/hold/drag rules re-tested unchanged. Hold on the wizard does nothing and cannot dig the floor behind him; a tap on him in reach opens his screen, further away walks beside him (Task 13).
- **Overlay and speech rules:** the screen pauses the game like the craft screen; the break bubble has priority over every wizard and Pip line; held lines never use the tablet voice while audio is locked; the wizard never talks over Pip (Tasks 14, 16, 18).
- **Shimmer cost:** no chunk is rebuilt by the shimmer (counter test); the repaint only runs while a shimmer block is in view (Tasks 3, 19).
- **Tablet performance:** the tower adds about 1,500 triangles, the wizard 2 draw calls, the light 1 (Task 19).

## Decisions made in this plan

Marked **(my call)** where the spec or the parent left room. The parent can overrule any; the four most important are asked at the end.

| Topic | Decision |
|---|---|
| Name and personality | **Orlo the wizard**, orb **Glim**. Slow, gentle, dry; loves stars and riddles; talks to Glim; says "young friend"; never rushes, never scolds. Funny features: a hat so tall the tower roof was built round it, a beard tucked in his belt. Original, no copied wizard. His lines never use "hmm", "ooh" or any sound word; his slowness comes from the voice's tempo and short sentences. (my call) |
| Where | **South edge, middle-west: hilltop pad `x 29..43, z 74..88` pinned at ground height 9, tower footprint `x 33..39, z 78..84`, door on the north side.** Why: the village (`x 58..92, z 6..44`), the step 2 plot and pasture (`x 62..84, z 35..55`, skirt to `z 61`), the pond (`x 4..24, z 22..42`) and the spawn (24, 24) all lie north of `z 62`, so nothing collides and there is a 12-cell margin; the site is 58 blocks south of the spawn and about 65 south-west of the village square, far from both and away from the village as asked; the natural terrain there already has a bump (height 9 at `x 36, z 82` and 86), so the hill grows naturally; and a south-edge tower can be seen from the meadow (north-west of it) and the village (north-east) alike. The NE and NW edges are taken by the village, quarry and the spawn corridor. Numbers may be nudged by a cell or two at build time; the tests assert the properties, not the digits. (my call) |
| Generator | New `stampTower` and `carveTowerRoute` in `src/core/tower.ts`, called from `generateWorld` after `buildVillage` and before tree scatter; `TOWER_PLAN` is added to `VILLAGE_PLAN`'s neighbour file, the reserved rects join `stampedRects` so scatter trees keep out (3-cell margin like houses). Same `reshape`/`pave` helpers as the village (exported from `village.ts`; moved code is untouched). `GEN_VERSION` goes to the next integer after the step 2 value (3 if step 2 is 2). Old saves regenerate the tower fresh and replay his edits on top (**edits always win**); the tower is on a pad nobody has built on, and if he has, his blocks stand. `gen` in the save is never lowered. (my call) |
| The path | A 3-wide PathStone path (`carveRoute`, same as the village route) from the village square's south-west corner, west past the farmhouse's west side, south along `x = 44`, then to the tower door: waypoints `[[69,29],[58,29],[44,32],[44,66],[36,72],[35,77]]`, about 80 cells (27 s at Pip's lead speed). It keeps 12 cells from the pasture skirt and clear of the pond. It ends at the door front. Every step differs by at most 1 in height, trees touching it go whole. (my call) |
| World height | The world is 20 blocks high and stays so. With the pad at 9 the tower is 11 blocks tall: floor y9, ground-floor room y10..12 (3 high, like the cottages' camera comfort), slab y13, star room y14..16, ceiling y17, then a stepped roof y18 (5×5) and y19 (3×3) with a Lamp as the very top block (the top of the world). (my call) |
| Inside | 7×7 footprint, 5×5 interior, walls Stone with Glass windows (2×2 on the east and west walls of the ground room; 2×2 on all four walls of the star room), roof RoofTile, door gap 2 wide and 3 high with DoorFrame jambs like the houses. **Two Lamps in the ceiling of each room** (the slab for the ground room). Stair: along the east interior column `x 38`, three steps of height one at `z 79, 80, 81` leading up to the slab edge, so the ordinary one-block step-up walks him to the star room (no ladder, no new gesture). The wizard stands at `x 36, z 82` on the ground floor, facing the door. (my call) |
| Wizard model | Box model, one merged vertex-coloured mesh (about 240 triangles): a periwinkle robe (`#5b6fe0`, three boxes widening to the floor) with small gold star spots, a gold belt with the beard tucked in it, a tall pointed hat in three tilted tiers with a gold star on the tip, a kind face (rosy nose, white bushy eyebrows, round gold glasses), sleeves, and a staff with a pale ball. Plus **Glim**, a separate 20-triangle icosahedron orb with an unlit material (`MeshBasicMaterial`), slowly orbiting his shoulder and shifting pastel hue. 2 draw calls in all. Never dark: no colour below the lightness floor pinned in Task 11. (my call) |
| Wizard idle | Render-rate transforms only, no skeleton: breathing bob (scale y ±1%), the body turns to face him within 6 blocks (at most 90°/s, never spins), Glim bobs and orbits (radius 0.5, 6 s), Glim glows brighter while a wizard line plays, a small hop when a puzzle is solved. Nothing sudden, nothing large. |
| Interaction | A **quick tap on the wizard** (screen disc, radius 72 px around his centre, tried before the voxel ray, in the same entity list as animals and grumps) within reach 4 opens his screen; farther away walks him to the standable cell nearest the wizard that is at least 1.5 from him. Press and hold on him does nothing (no ring, no dig); the block under his feet cannot be dug; placing into his two cells is refused (he is in `occupied()`). He also greets on his own: a hello once per visit when he enters the tower or its doorstep (`greetRect`), at most once a minute, never over Pip or the break line. (my call) |
| The screen | `WizardScreen` (`src/ui/wizard.ts`), a full-screen overlay like the craft screen: pauses the game, swallows pointer events, has a big ✖ (96 px) and works with the pad (left/right, select). Orlo's picture top left with a 🔊 button that repeats the line; two big tabs (💎 trade, 🧩 puzzle, 120 px each); it opens on **trade** (so the free gift is the first thing he sees), and on **puzzle** if he arrived with no gem and has already had his gift. All targets at least 88 px, computed from CSS constants in the tests. Tapping any picture repeats its spoken line (§6). |
| Trade | 8 cards in a 4×2 grid, each a big block picture (the atlas icon on a soft sparkle), its price as a 💎 picture, a digit and dots (1 or 2 gems), and "×4" as a digit with 4 dots. **One gem buys 4 blocks of that kind** (a bundle of four, so a gem is worth building with). **Prices:** 1 gem for Cloud, Rainbow, Sun, Moon; 2 gems for Starlight crystal, Star, Dragon-scale, Magic mirror. One table, tuned on the tablet. A card he can afford glows gently; one he cannot gives a soft nudge and the wizard says (kindly) that he needs a gem, with the puzzle tab pulsing: nothing red, no buzzer, nothing lost. A purchase that would take a stack past 99 is refused whole (nothing spent) with the bag-full line. (my call) |
| Welcome gift | The first time the trade screen opens (`gift` flag false) every card shows a 🎁 instead of a price and the first one he picks is **free: one block** (literally the parent's "one free mythical block", of his choice). The flag is saved at once. After that the prices show. (my call) |
| Puzzles: shape of the screen | One puzzle at a time in a big card; the wizard speaks the instruction as soon as it shows, and tapping the 🔊 repeats it. **A new puzzle every time the puzzle tab opens or one is solved.** Nothing is saved mid-puzzle (closing the screen just drops it; nothing is lost because nothing was at stake). Unlimited: blocks are decoration and the learning is the point. |
| Puzzles: counting | The wizard asks for a basket: **"bring me 3 apples and 2 carrots"** shown as pictures with the digit and that many dots per kind. A row of big pictures (apple, carrot, potato, wheat, egg: the item emoji) are the "shelf"; each tap puts one into the basket on the screen, a tap on a basket picture takes one back out. When the basket matches, the puzzle is solved (no "check" button to find). **It is a game on the screen: nothing is taken from his bag**, so it works with an empty bag and can never cost him a thing (my call; the parent may prefer real hand-over, see the questions). Counts shown only as digits 1 to 20 with dots. |
| Puzzles: pattern | Five pictures in a row then a "?" (for example red, blue, red, blue, ?) and three or four big answer cards. Symbols are four colours (red, blue, yellow, green) times four shapes (circle, square, triangle, star), drawn in CSS so no emoji font is needed; colour is never the only clue where it matters (a shape differs too in the higher levels' distractors). |
| Puzzles: matching | One big shape on top and three or four cards below: "find the one that is the same". Early levels differ in colour only, then shape only, then both with look-alike distractors, then **a grey outline matched to the coloured shape** (silhouettes). |
| The ladder | Levels 0 to 9 (`MAX_LEVEL = 9`). The level is `min(9, floor(clean / 3))` where `clean` counts puzzles solved with at most two wrong answers and no help. So three clean solves per step; helped solves still give the block and count in `solved` but not in `clean`. The level **never goes down** (it comes from a counter that only rises). Per level: **counting** L0 one kind 1 to 3; L1 one kind 1 to 5; L2 one kind 1 to 8; L3 two kinds 1 to 3 each; L4 two kinds 1 to 5; L5 two kinds 1 to 8; L6 one kind 5 to 12; L7 two kinds each 3 to 10 with total at most 12; L8 one kind 8 to 20; L9 two kinds each 5 to 14 with total at most 20. **Patterns** L0 and L1 ABAB (colour, then shape) with 3 answers; L2 AAB; L3 ABC; L4 ABB; L5 AABB; L6 ABCABC; L7 growing (1, 2, 3 of a shape) ; L8 colour and shape cycling together; L9 ABCD. **Matching** L0 colour; L1 shape; L2 both with one look-alike; L3 both with two look-alikes (4 answers); L4 and up silhouette to coloured shape (3 then 4 answers). Kind mix: L0 and L1 count 50%, match 30%, pattern 20%; from L2 equal thirds; never the same kind three times in a row; never exactly the same puzzle twice in a row. (my call) |
| Hints and never failing | **No timer, no score, no lives, no "wrong" sound.** A wrong card gives a soft wobble and one of the wizard's "try again" lines (never the same twice in a row). Hints are driven by time since his last useful move and by wrong answers: after **12 s** quiet or **2** wrong answers, hint 1 (the wizard says one hint line and the right card or the needed shelf picture pulses); after **24 s** or **4** wrong answers, hint 2 (Pip's puzzle nudge, one wrong card fades out per 6 s for answer puzzles, ghost dotted slots show the missing items in the basket); after **45 s** or **6** wrong answers the wizard **helps him through** (Glim lights the right card and the puzzle completes itself with a gentle sparkle and the reward). A helped solve gives the block as usual. A random clicker and a patient waiter both always finish (tested over every level). (my call) |
| Rewards | Puzzle: **1 mythical block**, the wizard's choice, the kind he has fewest of (ties in the fixed order below) so he collects all eight over time; if every stack is at 99 there is no block and the wizard still cheers. Trade: 4 of the chosen kind. Gift: 1 of the chosen kind. Block order: Starlight crystal, Rainbow, Cloud, Moon, Sun, Dragon-scale, Star, Magic mirror. A reward that would pass 99 is skipped (never refused with a bad sound). |
| Block ids | Appended after step 2's 35: `StarlightCrystal` 36, `RainbowBlock` 37, `CloudBlock` 38, `MoonBlock` 39, `SunBlock` 40, `DragonScaleBlock` 41, `StarBlock` 42, `MagicMirror` 43; 44 to 47 reserved. **Existing ids never change.** The blocks sit in the ordinary `inventory`, `order` and `edits`. They are never recipes (only the wizard gives them). `BlockDef` gains `light?: boolean` and `shimmer?: boolean`; a `MYTHICAL` list in `src/core/mythical.ts` holds the order, prices and bundle sizes. |
| Lights | Today a Lamp is a solid cube whose tile is so bright that side shading cannot dim it; there is no dynamic light. Mythical lights are the same: `light: true` for Starlight crystal, Moon block and Sun block, with tiles painted so that even at the worst Lambert face factor they stay bright (test). They are always-bright cubes with a visible glow pattern, not point lights (no cost on the tablet, no night anyway). Rainbow and Star blocks are bright and shimmer but are not marked as light. Magic mirror glass is `transparent: true, solid: true` exactly like Glass (the camera, the voxel ray and the mesher treat it as glass), with a diagonal glimmer. |
| Shimmer | Four tiles animate: Rainbow (bands slide one pixel per frame), Star block (the stars take turns to twinkle), Starlight crystal (a facet glint moves), Magic mirror (a diagonal glimmer sweeps). **A frame is 0.4 s, four frames, a 1.6 s cycle** (slow, never flashing). `Atlas.shimmer(timeSeconds)` repaints those four 16×16 tiles into the atlas canvas and sets `texture.needsUpdate` only when the frame changes; the static icons used by the HUD are always frame 0. Nothing in any chunk mesh changes, so **no chunk is rebuilt**. The mesher marks `hasShimmer` on a chunk that contains one of these ids, and the scene only calls `shimmer` while a visible chunk has one (otherwise the texture is left alone). One 64×192 upload (about 48 KB) 2.5 times a second. |
| The far light | A **tower beacon**: one `THREE.Sprite` (a soft pale-blue and cream star made once on a 64×64 canvas) with `fog: false`, `depthWrite: false`, placed at the tower top (above the world, `y 21.5`). It reads at any distance without touching the camera's far plane: each frame, if the beacon is farther than 55 blocks, the sprite is moved along the same line of sight to 55 blocks away and scaled by 55/distance, so it keeps its apparent size and never reaches the fog or the far plane. Gentle pulse: opacity 0.8 to 1.0 on a 4 s sine, size ±4%. Hidden within 10 blocks (the real lamp on the roof is there to see). 1 draw call. (my call) |
| Being curious | At the default camera the sky is off-screen (the view's top edge sits only 1° above the horizon), so a light in the sky would go unseen. Therefore: (1) he can tilt the view up (already allowed to 9° above the horizon) and see it; (2) a **star marker** (a 64 px glowing ⭐ with a small pointing triangle) rides the screen edge in the direction of the beacon whenever the beacon is off-screen, more than 20 blocks away, and he has never been inside the tower; it is picture-only and not tappable (`pointer-events: none`), and it disappears for good after his first visit; (3) Pip says `seeTowerLight` once (and his head turns that way) the first time the marker shows. (my call) |
| Pip's lead | `LeadToVillage` gains an optional offer filter and is reused for the tower (class name kept; `leadToTower = new LeadToVillage(towerRoute, towerDoorstep, flags.wizard.led, towerPad, canOffer)`); the old constructor calls still work and every existing lead test stays green. **Offered only when:** he has at least one Gem, the village lead is finished (`ledToVillage`), the tower lead has not finished, he is inside the village pad or within 10 of the tower route, and (as before) 8.5 s after an action or 25 s after load. Pip's lines: start `letsVisitWizard`, `comeOn`/`thisWay` (existing), arrival `meetWizard`. Arrival = he stands on the hilltop pad or the doorstep. The flag `wizard.led` is saved; after that Pip never leads there again. He can walk there any time without a gem, and the puzzle tab works with no gems. |
| Speech | Wizard speaker `wizard`; every wizard line has a clip. Dynamic counting sentences are **stitched from pre-recorded fragments** (no tablet voice): `wizardParts`: a lead-in ("bring me"), the numbers one to twenty, the plural item names (apples, carrots, potatoes, bundles of wheat, eggs), "and". `Voice.sayParts(keys[])` plays them back to back with a 120 ms gap and counts as one line for the speaking and break-priority rules. All wizard speech goes through `wizardSpeech(breakOpen, speak)` (like `craftSpeech`): with the break bubble open it says nothing and never cuts the reminder; the screen itself keeps working. Hellos are held (not spoken) while audio is locked, as villagers' are. |
| Save | Additive, optional `wizard` object: `{ gift: boolean, met: boolean, led: boolean, solved: number, clean: number, bought: number, hints?: string[] }`; the mythical blocks are plain block ids in `inventory`/`order`/`edits`. Details and validation in Task 9. |
| Voice candidates | Three blends of Kokoro British (and one American) voices in the style of `tools/voice/README.md`, mild lift at most 1.06, lower tempo for an old, slow speaker. **A** `bm_george*0.6+bm_fable*0.4`, tempo 0.90, lift 1.00: a warm, grandfatherly storyteller. **B** `bm_fable*0.7+am_puck*0.3`, tempo 0.92, lift 1.04: lighter and twinkly, with a mischievous lift (the same trick as Pip's blend). **C** `bm_lewis*0.6+bf_emma*0.4`, tempo 0.93, lift 1.02: kindly and airy. The parent chooses by listening (see the sample folder in the questions); the winner goes into `voices.json` in Task 10. |

## Who builds what

Claude builds, Codex reviews. Codex also builds the small pure-logic tasks (it often hangs on long writing, so it gets only these; if it hangs twice, Claude takes the task). Every task is reviewed by the other agent before merging. Codex is invoked with `codex exec --full-auto "<task text from this plan + spec path>"`.

| Task | Builder | Reviewer |
|---|---|---|
| 1 Mythical block ids, registry and lights | Claude | Codex |
| 2 Atlas art for the eight blocks | Claude | Codex |
| 3 Shimmer clock, mesher flag, scene hook | Claude | Codex |
| 4 Tower stamp (pure) | Claude | Codex |
| 5 Worldgen: hill, tower, path, walkability | Claude | Codex |
| 6 Puzzle generators and ladder (pure) | Codex | Claude |
| 7 Puzzle session: hints, never failing (pure) | Codex | Claude |
| 8 Trade, gift and reward rules (pure) | Codex | Claude |
| 9 Save fields | Codex | Claude |
| 10 Lines, fragments, voice speaker and clips | Claude | Codex |
| 11 Wizard model and idle | Claude | Codex |
| 12 Beacon sprite and star marker | Claude | Codex |
| 13 Tap, hold and entity pick for the wizard | Claude | Codex |
| 14 The wizard screen | Claude | Codex |
| 15 Pip leads him to the tower | Claude | Codex |
| 16 Wizard visit and speech policy (pure) | Codex | Claude |
| 17 Camera and walkability tests in the tower | Claude | Codex |
| 18 Wire it together | Claude | Codex |
| 19 Budget and performance | Claude | Codex |
| 20 Invariant tests (never fails, never lost, never dark) | Codex | Claude |
| 21 Browser story (e2e) | Claude | Codex |
| 22 README and spec status | Claude | Codex |

## File Structure

New or changed. Everything else stays as in the earlier steps.

```
src/core/blocks.ts          CHG  append ids 36..43; BlockDef.light / .shimmer
src/core/mythical.ts        NEW  MYTHICAL (order, price, bundle), isMythical, rewardKind(), PRICE, BUNDLE
src/core/tower.ts           NEW  TOWER_PLAN, stampTower(), carveTowerRoute(), TowerInfo
src/core/village.ts         CHG  export reshape/pave/levelPad helpers (no behaviour change); stampedRects gains the tower rects
src/core/worldgen.ts        CHG  GEN_VERSION +1; call tower build; trees keep out
src/core/puzzles.ts         NEW  Sym, Puzzle types, makePuzzle(level, rng, last), levelFor(clean), ladder constants
src/game/puzzleSession.ts   NEW  PuzzleSession: pick/add/remove, hint levels, helped finish, counters
src/game/wizardTrade.ts     NEW  canBuy/buy, claimGift, puzzleReward (all-or-nothing against 99)
src/game/wizardVisit.ts     NEW  WizardVisit: hello once per visit, cooldown, held while locked
src/game/lead.ts            CHG  optional canOffer filter (old calls unchanged)
src/game/speechPolicy.ts    CHG  wizardSpeech(); mayWizardGreet = mayGreet
src/game/game.ts            CHG  intent 'talk'; wizard cells in occupied(); selected unchanged
src/input/tap.ts            CHG  wizard hit first: 'talk' in reach, else walk beside; hold on wizard: none
src/input/entityPick.ts     CHG  the wizard joins the entity list (type 'wizard')
src/content/wizard.ts       NEW  WIZARD, WIZARD_LINES, WIZARD_PARTS, ICONS, pickWizardLine()
src/content/lines.ts        CHG  5 new Pip keys
src/content/spoken.ts       CHG  speaker 'wizard' lines and parts
src/audio/voice.ts          CHG  sayParts()
src/audio/sfx.ts            CHG  soft sparkle, 'gift' reused, 'wrongNudge', 'solved'
src/core/save.ts            CHG  wizard object, validation
src/render/atlas.ts         CHG  ROWS +2; eight new tiles; shimmer painters; Atlas.shimmer(t)
src/render/mesher.ts        CHG  ChunkGeometry.hasShimmer
src/render/scene.ts         CHG  calls atlas.shimmer when a visible chunk has one; beacon; wizard view
src/render/wizard.ts        NEW  makeWizardModel(), WizardView (idle, face player, Glim)
src/render/beacon.ts        NEW  Beacon (sprite, distance clamp, pulse), beaconScreenState()
src/ui/wizard.ts            NEW  WizardScreen overlay (trade, puzzles, pad)
src/ui/marker.ts            NEW  EdgeMarker (star pointing to the beacon)
src/ui/styles.css           CHG  wizard screen and marker
src/main.ts                 CHG  wiring, debug hooks
tools/voice/voices.json     CHG  speaker 'wizard' (the parent's choice)
tools/voice/pronunciations.json CHG  Orlo, Glim if needed
tools/voice/lines.json, public/voice/** CHG  regenerated (pip, wizard)
tests/core/{mythical,tower,towerRoute,puzzles,save,world}.test.ts
tests/game/{puzzleSession,wizardTrade,wizardVisit,wizardInvariants,lead,leadTower,speechPolicy}.test.ts
tests/input/{tap,entityPick}.test.ts, tests/content/{lines,wizard,voice-clips,spoken}.test.ts
tests/render/{atlasMythical,shimmer,mesher,cameraTower,wizardModel,beacon,towerBudget}.test.ts
tests/ui/{wizard,marker}.test.ts
e2e/wizard.spec.ts
```

---

### Task 1: Mythical block ids, registry and lights

**Files:** Modify `src/core/blocks.ts`. Create `src/core/mythical.ts`, `tests/core/mythical.test.ts`. Modify `tests/core/world.test.ts` (id snapshot).

**Interfaces:**
```ts
// appended after the last step 2 id (35). Existing ids MUST NOT change.
StarlightCrystal = 36, RainbowBlock, CloudBlock, MoonBlock, SunBlock, DragonScaleBlock, StarBlock, MagicMirror   // 36..43
export interface BlockDef { /* + */ light?: boolean; shimmer?: boolean }
// src/core/mythical.ts
export const MYTHICAL: readonly BlockId[];            // the fixed order: Starlight, Rainbow, Cloud, Moon, Sun, Dragon-scale, Star, Magic mirror
export const BUNDLE = 4;                              // blocks per gem
export const PRICE: Record<MythicalId, 1 | 2>;        // 1: Cloud, Rainbow, Sun, Moon; 2: the other four
export const isMythical = (id: number): id is MythicalId;
export function rewardKind(held: (id: BlockId) => number, cap = 99): BlockId | null;   // fewest held, ties in MYTHICAL order, skips full stacks; null if all full
```
Flags: `StarlightCrystal`, `MoonBlock`, `SunBlock` have `light: true`; `RainbowBlock`, `StarlightCrystal`, `StarBlock`, `MagicMirror` have `shimmer: true`. All are `solid: true, collectable: true`; `MagicMirror` is `transparent: true` like Glass, the rest are not. `dropFor` returns each block itself.

- [ ] **Step 1:** Tests in `tests/core/mythical.test.ts`: `ids 36..43 are pinned and 0..35 are unchanged` (the existing snapshot plus the new ones); `ids 44..47 are unused`; `all eight are solid, collectable and placeable like Planks` (use the placement helpers); `only Magic mirror is transparent`; `light flag is exactly Starlight, Moon, Sun`; `shimmer flag is exactly Rainbow, Starlight, Star, Magic mirror`; `prices are 1 or 2 and every price and the bundle are 20 or fewer`; `every mythical block has a registered name that is a simple word` (no spoken name is longer than 3 words); `rewardKind picks the fewest held, ties in order, skips full stacks, null when all are full`; `isMythical rejects 35 and 44 and non-integers`. Existing block, inventory and crafting tests pass unchanged. A `no recipe produces a mythical block` test over `RECIPES`.
- [ ] **Step 2:** Run `npx vitest run tests/core`. Expected: FAIL. Implement. Expected: PASS.
- [ ] **Step 3:** `npm run typecheck`. Commit `feat(blocks): the eight mythical blocks (ids 36 to 43)`.

### Task 2: Atlas art for the eight blocks

**Files:** Modify `src/render/atlas.ts`. Create `tests/render/atlasMythical.test.ts`.

**Interfaces:**
```ts
// atlas grows by two rows (ROWS +2 over step 2's value; 64×192 if step 2 left it at 10) ; eight new TileNames
export type Paint = { fillRect(x: number, y: number, w: number, h: number): void; fillStyle: string };   // the only drawing surface painters use
export function paintMythical(name: MythicalTile, ctx: Paint, frame: 0 | 1 | 2 | 3): void;   // 16×16 tile, frame 0 for static icons
export const SHIMMER_TILES: readonly MythicalTile[];   // rainbow, starlight, star, mirror
```
Original 16×16 procedural art, all bright and friendly: **Starlight crystal** blue-white faceted crystal on pale sky blue with white glints (frame moves a glint); **Rainbow** six soft colour bands (red, orange, yellow, green, blue, violet) running diagonally, sliding one pixel per frame; **Cloud** soft white with pale-blue shading puffs; **Moon** silver-white with a few soft craters and a gentle cream glow border; **Sun** warm gold with lighter rays and a cream centre; **Dragon-scale** overlapping scales alternating green and gold with pale edge highlights; **Star block** a clear blue (`#3a56c8`, not near-black) with white and pale-yellow stars, three of them take turns to twinkle; **Magic mirror** pale cyan glass with a white border (transparent pixels in the middle for the see-through) and a diagonal glimmer that sweeps with the frame. Painters only call `fillRect` through `Paint`, so tests can render them to a pixel array without a browser canvas.

- [ ] **Step 1:** Tests (a small test helper renders a painter to a 16×16 RGBA array): `all eight tiles are 16×16 and every pixel is set (Magic mirror may be partly transparent)`; `no tile is dark: mean luminance at least 0.45 for every tile and at least 0.30 for Star block, the darkest pixel luminance at least 0.15 (Star block included)`; `light tiles stay bright in shade: multiplying Starlight, Moon and Sun by the worst face factor 0.5 still gives a mean luminance of at least 0.55` (the lamp trick); `shimmer frames differ: frames 0..3 of each shimmer tile are pairwise different, and frame 0 equals frame 4 mod 4`; `non-shimmer tiles ignore the frame`; `Star block twinkle changes at most 6 pixels per frame` (gentle, no flashing: no frame-to-frame change of more than 25% of the tile's pixels for any shimmer tile); `no pure red or near-black pixel in any tile` (red-ish hue with saturation above 0.8 and lightness below 0.5, or lightness below 0.1); `tiles are deterministic`; `tileFor maps each new block id and no two blocks share a tile`; `iconDataUrl for each new block returns a data URL` (jsdom canvas stub as in the existing atlas use).
- [ ] **Step 2:** Run `npx vitest run tests/render`. Expected: FAIL. Implement. Expected: PASS.
- [ ] **Step 3:** Look at it once with the Playwright MCP tool (all eight placed in a row in daylight and under a roof, close up and from far). Commit `feat(atlas): art for the mythical blocks`.

### Task 3: Shimmer clock, mesher flag, scene hook

**Files:** Modify `src/render/atlas.ts` (the `shimmer` method), `src/render/mesher.ts`, `src/render/scene.ts`. Create `tests/render/shimmer.test.ts`. Extend `tests/render/mesher.test.ts`.

**Interfaces:**
```ts
export const SHIMMER_FRAME_SECONDS = 0.4;
export const shimmerFrame = (timeSeconds: number): 0 | 1 | 2 | 3;       // floor(t / 0.4) mod 4, never NaN
// createAtlas() returns { texture, uvFor, iconDataUrl, shimmer(timeSeconds: number): boolean }   // true when it repainted
export interface ChunkGeometry { /* + */ hasShimmer: boolean }
// Scene: anyVisibleShimmer(); counters { shimmerRepaints, chunkBuilds } exposed through stats() in debug
```
`shimmer(t)` computes the frame, returns false (and draws nothing) when it equals the last painted frame, otherwise repaints the four `SHIMMER_TILES` into the atlas canvas at their cells and sets `texture.needsUpdate = true`. The scene calls it once per frame only while a visible chunk's `hasShimmer` is true; chunk visibility is already computed by the culler.

- [ ] **Step 1:** Tests: `shimmerFrame cycles 0,1,2,3 every 0.4 s and survives NaN, negatives and huge values`; `shimmer repaints once per frame change and not between` (fake canvas counts `fillRect` batches); `a repaint touches only the four shimmer tiles` (pixels of every other tile are unchanged); `the mesher sets hasShimmer only for chunks containing a shimmer block` and the geometry arrays are byte-identical with and without the flag (UVs do not change with the frame); `shimmer never rebuilds a chunk: running 10 simulated seconds with a Rainbow block in view leaves chunkBuilds unchanged`; `no repaint when no visible chunk has a shimmer block`; `upload size is 64×(16×rows) pixels` (documented number for the budget).
- [ ] **Step 2:** Run `npx vitest run tests/render`. Expected: FAIL. Implement. Expected: PASS.
- [ ] **Step 3:** Commit `feat(render): slow tile shimmer without chunk rebuilds`.

### Task 4: Tower stamp (pure)

**Files:** Create `src/core/tower.ts`, `tests/core/tower.test.ts`. Modify `src/core/village.ts` (export `reshape`, `pave`, `levelPad`, `carveRoute` helpers only; code moved or exported, not changed).

**Interfaces:**
```ts
export const TOWER_GROUND_Y = 9;
export const TOWER_PLAN: {
  pad: Rect;            // { x0: 29, z0: 74, x1: 43, z1: 88 }, pinned at TOWER_GROUND_Y
  footprint: Rect;      // { x0: 33, z0: 78, x1: 39, z1: 84 }
  facing: 'north';
  waypoints: Array<[number, number]>;   // [[69,29],[58,29],[44,32],[44,66],[36,72],[35,77]]
};
export interface TowerInfo {
  groundY: number; rect: Rect; interior: Rect;
  doorCells: Cell[]; doorFront: Cell; doorInside: Cell;
  floors: Array<{ y: number; cells: Cell[]; ceilingY: number }>;   // [ground room, star room], feet cells and the first solid y above them
  stairCells: Cell[];            // the three step cells then the slab edge cell
  wizardSpot: Cell; greetRect: Rect;    // footprint + 3 cells in front of the door
  lampCells: Cell[]; windowCells: Cell[]; beacon: { x: number; y: number; z: number };   // beacon.y = 21.5, above the world
}
export function stampTower(world: World): TowerInfo;
```
Writes only inside the footprint columns (floor Planks over Dirt fill, walls Stone, door gap and DoorFrame jambs as `stampHouse`, windows Glass, slab Planks at y13 except over the three stair cells, ceiling RoofTile at y17, roof RoofTile 5×5 at y18 and 3×3 at y19 with the centre block a Lamp, two Lamps in the slab and two in the ceiling over the middle row, three step columns at `x 38, z 79..81` filled from y10 up to heights y10, y11, y12). Clears every cell above the footprint first.

- [ ] **Step 1:** Tests on a flat test world: `writes only inside the footprint` (diff of the world before and after, nothing outside `rect`); `the top block is a Lamp and the tower is 11 blocks tall from the floor` (y19 is the highest non-air y, floor at y9); `the world is 20 high and nothing is written at or above sizeY`; `both rooms are at least 3 blocks high and have feet cells with 2 air above`; `door gap is 2 wide and 3 high with frame jambs`; `windows are Glass: 2×2 on the east and west walls of the ground room, on all four walls of the star room`; `at least 2 Lamps per room`; `the stair is a chain of single-block steps: from the doorInside cell A* (findPath) reaches every cell of the star room and back`; `no standable cell inside is below a block that leaves less than 2 air`; `the wizard spot is a floor cell off the door line and off the stair`; `deterministic: stamping twice gives byte-identical worlds`; `greetRect covers the footprint plus 3 cells in front of the door`; `no Water, no dark block (nothing is written that is not in the allowed set)`.
- [ ] **Step 2:** Run `npx vitest run tests/core/tower.test.ts`. Expected: FAIL. Implement. Expected: PASS.
- [ ] **Step 3:** Commit `feat(tower): stamp the wizard's tower`.

### Task 5: Worldgen: hill, tower, path, walkability

**Files:** Modify `src/core/tower.ts` (`buildTower`), `src/core/worldgen.ts`, `src/core/village.ts` (`stampedRects`), `tests/core/worldgen.test.ts`, `tests/core/village.test.ts`. Create `tests/core/towerRoute.test.ts`.

**Interfaces:**
```ts
export function buildTower(world: World): { info: TowerInfo; route: Cell[]; routeCells: Set<number>; stampedRects: Rect[] };
// GeneratedWorld gains { tower: TowerInfo; towerRoute: Cell[] }
export const GEN_VERSION = /* next integer after step 2's value */;
```
`buildTower`: `reshape` with the pad pinned at 9 (region = pad grown by 6 and the path legs grown by 3), trees touching it go whole, then `stampTower`, then `carveRoute`-style paving for the path (3 wide PathStone, 2 blocks headroom, neighbouring cells differ by at most 1). `generateWorld` calls it after `buildVillage` and adds its `stampedRects` to the scatter-tree `blocked` test. `emptyVillage()` is unchanged; a `emptyTower()` exists for tests that build tiny worlds.

- [ ] **Step 1:** Tests (real `generateWorld(2026)`): `the tower pad is the highest point within 6 blocks and at least 2 above the ground 10 cells to the north` (a real hilltop); `the pad is level at 9 and the skirt is gentle (neighbouring columns differ by at most 1 inside the region)`; `no overlap and a 6-cell gap` between the tower pad and the pasture skirt, the farm plot, every house, the pond and the spawn; `the path is 3 wide PathStone with two blocks of headroom, a chain of single-block steps, and ends at the door front`; `leaves no half trees on the path and the pad`; **`A* from the village gate to the tower door, up the stairs to the star room, and back to the spawn: findPath succeeds at every leg and smoothPath keeps every smoothed step standable`**; `A* from the spawn to the door works too` (he can walk there without Pip); `route length is between 60 and 100 cells`; `nothing is written outside the world array and the result is deterministic (same seed, same blocks)`; `his edits still win: an edit in a tower wall and one on the path replay on top and the rest of the tower stands`; `the v1 meadow fixture (legacy-meadow-2026.json) still matches on x 0..47`; `step 1 and step 2 stamps are byte-identical to before on their rectangles` (houses, route, plot, pasture, fence); `no Water in any tower stamp`; `old saves load`: an old-`gen` save regenerates and replays (the save test in Task 9 also covers this); `generateWorld stays under the existing build-time guard` (print the measured time).
- [ ] **Step 2:** Run `npx vitest run tests/core`. Expected: FAIL. Implement. Expected: PASS. If the natural ground at the pad is already at 9 or higher at some columns, the reshape cuts it to 9; if a test shows the hill is not clearly a hill, nudge the pad by whole cells, never the tests' properties.
- [ ] **Step 3:** Commit `feat(tower): hill, tower and path in the generated world`.

### Task 6: Puzzle generators and ladder (pure)

**Files:** Create `src/core/puzzles.ts`, `tests/core/puzzles.test.ts`.

**Interfaces:**
```ts
export type Shape = 'circle' | 'square' | 'triangle' | 'star';
export type Colour = 'red' | 'blue' | 'yellow' | 'green';
export interface Sym { shape: Shape; colour: Colour }
export type Thing = 'apple' | 'carrot' | 'potato' | 'wheat' | 'egg';
export type Puzzle =
  | { kind: 'count'; level: number; wants: Array<{ thing: Thing; n: number }>; shelf: Thing[] }
  | { kind: 'pattern'; level: number; seq: Sym[]; options: Sym[]; answer: number }
  | { kind: 'match'; level: number; mode: 'colour' | 'shape' | 'both' | 'outline'; target: Sym; options: Sym[]; answer: number };
export const MAX_LEVEL = 9;
export const CLEAN_PER_LEVEL = 3;
export const levelFor = (clean: number): number;                       // min(9, floor(clean / 3)); safe for NaN and negatives
export function makePuzzle(level: number, rng: () => number, last?: Puzzle): Puzzle;   // never the same kind 3 times in a row, never equal to `last`
export function describe(p: Puzzle): { digits: number[]; things: Thing[] };   // what the wizard must say (for the voice parts)
```
Rules in the decisions table (ladder). `shelf` always contains every wanted thing plus one or two others, at most 5. Counting digits are 1 to 20 and totals at most 20. Pattern `seq` is 5 symbols (growing patterns show 1, 2, 3, 4 repeated symbols), `options` has 3 (levels 0 to 5) or 4 (levels 6 to 9) distinct symbols, exactly one continues the rule. Match `options` has 3 or 4 distinct symbols, exactly one equals the target (for `outline` the target is drawn as a grey outline and the answer is the coloured symbol with the same shape).

- [ ] **Step 1:** Tests with a seeded `mulberry32`: `levelFor: 0,1,2 -> 0; 3 -> 1; 27 and above -> 9; NaN, negative and huge are safe`; for **every level 0 to 9, 500 seeded puzzles**: `counts are 1..20, totals at most 20, each want at least 1, the shelf holds every wanted thing`, `exactly one pattern option continues the rule and no other option does` (a checker re-derives the next symbol from the level's rule), `exactly one match option is the answer and options are distinct`, `answer index is in range`, `level bounds from the ladder table hold` (for example level 2 counting is one kind with 1 to 8; level 5 patterns are AABB); `kinds follow the mix (a loose statistical test at L0 and at L5)`; `never the same kind three times in a row` and `never equal to last` over 2,000 consecutive puzzles; `makePuzzle is deterministic for a seed`; `makePuzzle clamps an out-of-range level` (-5, 99, NaN); `describe returns only digits 1..20`; `no puzzle contains text` (the objects hold symbols, numbers and thing names only: a test asserts no string field other than the enums).
- [ ] **Step 2:** Run `npx vitest run tests/core/puzzles.test.ts`. Expected: FAIL. Implement. Expected: PASS.
- [ ] **Step 3:** Commit `feat(puzzles): counting, pattern and matching generators with a ladder`.

### Task 7: Puzzle session: hints, never failing (pure)

**Files:** Create `src/game/puzzleSession.ts`, `tests/game/puzzleSession.test.ts`.

**Interfaces:**
```ts
export const HINT1_SECONDS = 12, HINT2_SECONDS = 24, HELP_SECONDS = 45;
export const HINT1_WRONG = 2, HINT2_WRONG = 4, HELP_WRONG = 6;
export type HintLevel = 0 | 1 | 2 | 3;     // 3 = the wizard is helping him through
export type PickResult = 'right' | 'wrong' | 'already';
export class PuzzleSession {
  constructor(puzzle: Puzzle);
  readonly puzzle: Puzzle;
  readonly basket: Record<Thing, number>;       // counting
  readonly faded: Set<number>;                  // wrong options hidden by hint 2 (answer puzzles)
  wrong: number;
  solved: boolean;
  helped: boolean;                              // finished by hint level 3
  update(dt: number): void;                     // dt = 0 while the game is paused or the break bubble is up; time since the last useful move
  pick(option: number): PickResult;             // pattern and match; a right pick solves
  add(thing: Thing): void;                      // counting: solves when the basket equals the wants
  take(thing: Thing): void;
  hint(): HintLevel;                            // from time and wrong answers, whichever is higher; never decreases
  ghost(): Array<{ thing: Thing; missing: number }>;   // the dotted slots hint 2 shows
  clean(): boolean;                             // solved with wrong <= 2 and not helped
}
```
Rules: no wrong answer changes anything but `wrong` and `hint()`; **there is no state in which the puzzle cannot be finished**. Hint 1: the right card (or the next needed shelf picture) pulses. Hint 2: ghost slots, and one wrong card fades per 6 s of further quiet or per further wrong answer, never the right one, never below two cards left. Hint 3: `update` completes the puzzle itself (`helped = true`, `solved = true`). A useful move (a right add, a take that removes an excess, a first wrong pick) resets the quiet timer; repeated taps on the same wrong card do not keep resetting it (they would otherwise stall the hints forever).

- [ ] **Step 1:** Tests: `a right pick solves; a wrong pick returns wrong and changes only wrong`; `counting: the basket solves exactly when it equals the wants, overshoot is allowed and take removes`; `overshoot never blocks: taking items back always works`; `hint levels come at 12 s, 24 s and 45 s of quiet and at 2, 4 and 6 wrong answers, whichever first`; `the hint level never decreases`; `hint 2 fades wrong cards one at a time and never the right one nor below 2 cards`; `a patient waiter always finishes: for every level 0..9 and 200 seeded puzzles, updating 45 s with no input solves it, helped true`; `a random clicker always finishes: random picks and adds (including endless taps on the same wrong card) solve every puzzle within 200 actions or by hint 3`; `spamming one wrong card still reaches hint 3 within 45 s`; `dt = 0 changes nothing (paused)`; `clean is true only for at most two wrongs and no help`; `after solved nothing changes any more (pick returns already)`; `no timer, lives, score or fail identifier exists in src/game/puzzleSession.ts and src/core/puzzles.ts` (source scan for `fail|lose|lost|lives|score|gameover|timeout|penalt`).
- [ ] **Step 2:** Run `npx vitest run tests/game/puzzleSession.test.ts`. Expected: FAIL. Implement. Expected: PASS.
- [ ] **Step 3:** Commit `feat(puzzles): a session that can never fail`.

### Task 8: Trade, gift and reward rules (pure)

**Files:** Create `src/game/wizardTrade.ts`, `tests/game/wizardTrade.test.ts`.

**Interfaces:**
```ts
export type TradeResult = { ok: true; got: number; spent: number } | { ok: false; why: 'needGem' | 'bagFull' | 'unknown' };
export function canBuy(inv: Inventory, kind: BlockId): TradeResult;
export function buy(inv: Inventory, kind: BlockId): TradeResult;          // PRICE gems -> BUNDLE blocks, all or nothing
export function claimGift(inv: Inventory, kind: BlockId, wizard: WizardState): TradeResult;   // once; sets wizard.gift only on success
export function puzzleReward(inv: Inventory): { kind: BlockId; n: 1 } | null;               // rewardKind(), adds 1, skips full stacks
export interface WizardState { gift: boolean; met: boolean; led: boolean; solved: number; clean: number; bought: number; hints: string[] }
export function recordSolve(w: WizardState, session: { clean(): boolean }): void;          // solved += 1; clean += 1 only if clean; level comes from clean
```
Gems are `ItemId.Gem` in the item part of the inventory (grumps plan).

- [ ] **Step 1:** Tests: `buy takes PRICE gems and gives BUNDLE blocks`; `not enough gems changes nothing`; `a stack that would pass 99 changes nothing (no gem spent)` and gives `bagFull`; `an unknown or non-mythical id changes nothing`; `claimGift gives exactly 1 block, once, and sets the flag only on success`; `a second claim changes nothing`; `puzzleReward gives 1 of the kind he has fewest of, in order, and skips full stacks; all full gives null`; `recordSolve counts solved always and clean only for clean solves, and never lowers anything`; `no trade path can reduce a block stack or touch any other item than gems`; `the sum of everything is conserved over 1,000 random trades (property test)`.
- [ ] **Step 2:** Run `npx vitest run tests/game/wizardTrade.test.ts`. Expected: FAIL. Implement. Expected: PASS.
- [ ] **Step 3:** Commit `feat(wizard): gem trades, the welcome gift and puzzle rewards`.

### Task 9: Save fields

**Files:** Modify `src/core/save.ts`, `tests/core/save.test.ts`.

**Interfaces (additive, optional on read):**
```ts
interface SaveData { /* existing */
  wizard?: { gift?: boolean; met?: boolean; led?: boolean; solved?: number; clean?: number; bought?: number; hints?: string[] };
}
export interface Applied { /* existing */ wizard: WizardState }
```
`serialise(...)` writes the `wizard` object when anything in it differs from the defaults. Validation: booleans must be booleans; `solved`, `clean` and `bought` must be integers from 0 to 100000 (clamped; `clean` is also clamped to `solved`); `hints` keeps only known names (`seeLight`, `towerHint`); a wrong type for the whole object or any field drops that field only, never the save. A stored `gift`, `met` or `led` of true can never be written back as false, and a stored higher `clean` is never lowered by a write (so the level never goes down even through a stale tab).

- [ ] **Step 1:** Tests mirroring the earlier save tests: `a save without any wizard field loads (defaults)`; `a v1 save still migrates and the v1 key is never written` (existing, unchanged); `new fields round-trip`; `the mythical blocks round-trip in inventory, order and edits (ids 36..43)`; `bad types drop only that field and the blocks survive`; `solved and clean are clamped, clean never exceeds solved`; `unknown hints dropped`; `a stored true flag is never written back as false`; `a stored higher clean is not lowered`; `a save from a newer build (version above 2) is never overwritten`; `a damaged v2 is copied to .bad before replacement` (existing rules with the new fields present); `an old-gen save regenerates the tower and replays edits on top, and gen is written as the new GEN_VERSION and never lowered`; `inventory contains no key of 100 or more` (step 2's shape check still holds).
- [ ] **Step 2:** Run `npx vitest run tests/core/save.test.ts`. Expected: FAIL. Implement. Expected: PASS, with all existing save tests untouched.
- [ ] **Step 3:** Commit `feat(save): additive wizard fields`.

### Task 10: Lines, fragments, voice speaker and clips

**Files:** Create `src/content/wizard.ts`, `tests/content/wizard.test.ts`. Modify `src/content/lines.ts`, `src/content/spoken.ts`, `src/audio/voice.ts` (`sayParts`), `src/content/villagers.ts` (`Speaker` gains `'wizard'`), `tools/voice/voices.json`, `tools/voice/pronunciations.json`, `tools/voice/README.md`, `tests/content/lines.test.ts`, `tests/content/voice-clips.test.ts`, `tests/audio/voice.test.ts`; regenerate `tools/voice/lines.json`, `public/voice/pip/**`, `public/voice/wizard/**`, `public/voice/manifest.json`.

**Wizard keys (`WIZARD_LINES`, four variants each, each with a picture in `WIZARD_ICONS`; every line true whenever it can fire, 12 words or fewer, no cheer words, never "tap"):** `hello` 🧙 ("Welcome to my tower, young friend." / "The stars told me you were coming." / "Glim and I were counting stars." / "Come in, come in. Mind the stairs."), `welcomeGift` 🎁 ("Every new friend gets one gift. Choose a magic block." / "A gift for you, young friend. Choose a block." / "Choose one magic block. It is my gift to you." / "Glim says you should pick a gift."), `tradeAsk` 💎 ("Magic blocks for shiny gems. Choose one." / "One gem buys a set of magic blocks." / "Gems turn into magic blocks in my tower." / "Choose a block. Gems are what I like best."), `bought` ✨ ("Four magic blocks for you, young friend." / "There you are. Build something wonderful." / "A fine choice. Glim approves." / "Those will look lovely in your house."), `needGem` 💎 ("That one needs more gems. A puzzle might help." / "Not enough gems yet. Would you like a puzzle?" / "Bring me a gem, or try a puzzle." / "Grumps leave gems behind. Or try a puzzle."), `bagFull` 🎒 ("Your bag is full of those. Build with some!" / "You have plenty of those. Let's wait a little." / "That is a lot of blocks already." / "Use some first, then come back."), `puzzleAsk` 🧩 ("Here is a puzzle for you." / "Let us see how clever you are." / "Can you solve my puzzle, young friend?" / "A little puzzle, just for you."), `countAsk` 🧺 (the lead-in, spoken before the stitched numbers: "Bring me..." / "Please put in my basket..." / "I would like..." / "Fill my basket with..."), `patternAsk` 🔴🔵 ("What comes next?" / "Which picture comes next?" / "Look at the row. What comes next?" / "Can you finish the row?"), `matchAsk` 🔷 ("Find the one that is the same." / "Which one matches?" / "Look carefully. Which is the same?" / "Find the matching picture."), `tryAgain` 🔁 ("Not that one. Try again." / "Have another look." / "Nearly. Try once more." / "That is not it. Try another."), `hint1` 💡 ("Look at the glowing picture." / "Glim thinks it is this one." / "Look closely. Something is shining." / "Take your time. Look at the glow."), `hint2` 🔎 ("Count the dots with me." / "Some are fading away. Look at what is left." / "Look at the dotted spaces." / "Glim has hidden the wrong ones."), `solved` 🌟 ("That is right! You are very clever." / "Splendid. Here is a block for you." / "You solved it, young friend." / "Quite right. Glim is pleased."), `helped` 🌟 ("We solved it together. Here is a block." / "Glim and I finished it. A block for you." / "That was a tricky one. Take a block." / "Together we did it. Here is a block."), `bye` 👋 ("Come back whenever you like." / "The stars will be here, young friend." / "Take care of those blocks." / "Glim and I will be here.").
**Fragments (`WIZARD_PARTS`, one text each, own clips, tested for at most 3 words):** the numbers `one` to `twenty`, the things `apples`, `carrots`, `potatoes`, `bundles of wheat`, `eggs`, and `and`. `Voice.sayParts(speaker, texts[], gapMs = 120)` plays their clips back to back as one line (the same speaking flag, interruption and break rules as `say`; a missing clip falls back to nothing, never to the tablet voice for a wizard part). The counting sentence is `countAsk` variant + parts, for example "Please put in my basket", "three", "apples", "and", "two", "carrots".
**New Pip keys (five, four variants each, each with a picture, same policy):** `seeTowerLight` ✨ ("What is that glowing light far away?" / "Look, a light is shining in the distance." / "Something is glowing over there." / "Someone has a light on a hill."), `letsVisitWizard` 🧙 ("Let's go and visit the wizard in his tower." / "You have a gem. The wizard likes gems." / "Shall we visit the wizard? Follow me." / "There is a wizard in the tower. Follow me."), `meetWizard` 🧙 ("Here we are at the wizard's tower." / "This is the wizard's tower. Let's go in." / "Look how tall it is. Shall we go in?" / "We are at the tower. Let's say hello."), `puzzleStuck` 🧩 ("Shall we look at it together?" / "Let's count them slowly together." / "Take your time. I will help." / "Look closely. What do you notice?"), `gotMagicBlock` ✨ ("A magic block! Where will you put it?" / "That looks lovely. Let's build something." / "What a shiny new block!" / "Your bag has a new magic block.").
**Voice speaker:** `voices.json` gains `"wizard": { "id": "wizard", ...the parent's choice of A, B or C... }`:
- A `{ "id": "wizard", "blend": "bm_george*0.6+bm_fable*0.4", "tempo": 0.90, "lift": 1.00 }`
- B `{ "id": "wizard", "blend": "bm_fable*0.7+am_puck*0.3", "tempo": 0.92, "lift": 1.04 }`
- C `{ "id": "wizard", "blend": "bm_lewis*0.6+bf_emma*0.4", "tempo": 0.93, "lift": 1.02 }`

- [ ] **Step 1:** Tests. `lines.test.ts`: Pip key count updated (step 2's 34 plus grumps' 9 plus 5); every new key has four distinct variants of 12 words or fewer, a picture, none match the cheer list `yum|mmm|aww|ooh|hmm|ta-?da|hup|whee|yay|hooray`, none match `tap|click|touch`, none contain `scary|scared|dark|afraid|hurt|lost|wrong|fail`, British spellings. `wizard.test.ts`: the same policy for `WIZARD_LINES`; parts are at most 3 words and cover `one`..`twenty`; `pickWizardLine` never repeats the same variant twice in a row; `countSentence(puzzle)` returns a parts list whose numbers match `describe(puzzle)`; every wizard line is true without context (no "you have a gem" claims); lines never mention reading. `spoken.test.ts`: `spokenLines includes the wizard lines and parts`; `tools/voice/lines.json equals spokenLines()`. `voice-clips.test.ts`: covers speaker `wizard` (clip exists for every line and part, no stale clip, no cheer words). `voice.test.ts`: `sayParts plays in order with one gap each and counts as one line`; `a break line interrupts it and nothing replaces the break`; `a missing wizard clip never uses the tablet voice`; `sayParts while audio is locked is held and dropped quietly after the hold limit`.
- [ ] **Step 2:** Run `npx vitest run tests/content tests/audio`. Expected: FAIL (also the clip test: the reminder to generate audio). Implement the content and `sayParts`.
- [ ] **Step 3:** Generate the clips. First time on a machine: `python -m venv tools/voice/.venv && tools/voice/.venv/bin/pip install -r tools/voice/requirements.txt`. Then, after the parent has chosen the wizard blend and it is in `voices.json`:
  ```
  npm run voice:lines
  for s in pip wizard; do
    tools/voice/.venv/bin/python tools/voice/generate.py --speaker $s --lines tools/voice/lines.json --out public/voice --prune
  done
  ```
  (Only missing clips are made: about 20 for Pip and about 85 for the wizard: 15 keys × 4 variants plus 26 parts.) Listen to every new wizard clip once (watch "Orlo", "Glim", "bundles of wheat", "splendid"); add respellings to `tools/voice/pronunciations.json` if a word sounds odd and regenerate.
- [ ] **Step 4:** Run `npx vitest run tests/content tests/audio`. Expected: PASS. Commit `feat(voice): the wizard's voice, lines and clips`.

### Task 11: Wizard model and idle

**Files:** Create `src/render/wizard.ts`, `tests/render/wizardModel.test.ts`. Modify `src/render/scene.ts` (add the view).

**Interfaces:**
```ts
export function makeWizardModel(): { body: THREE.Mesh; orb: THREE.Mesh; group: THREE.Group };   // body: ONE merged mesh with vertex colours, feet at y = 0, faces +z
export class WizardView {
  constructor(scene: THREE.Scene, spot: { x: number; y: number; z: number });
  update(dt: number, timeSeconds: number, playerPos: { x: number; z: number } | null, speaking: boolean): void;
  celebrate(): void;                 // a small hop
  cells(): Cell[];                   // feet cell and the cell above (for occupied())
  screenCentre(camera: THREE.Camera): { sx: number; sy: number; sz: number };   // for entity picking
  dispose(): void;
}
export const WIZARD_PALETTE: readonly string[];
```
Look: see the decisions table. Idle: breathing bob, faces him within 6 blocks at most 90°/s, Glim bobs and orbits (radius 0.5, period 6 s) and shifts pastel hue slowly, brightens while speaking, a small hop on `celebrate`. Hidden beyond the fog (44 blocks).

- [ ] **Step 1:** Tests: `the wizard body is one mesh with at most 280 triangles and the orb at most 24` (2 draw calls in all); `builds and disposes without leaking geometry or materials`; `every palette colour has HSL lightness at least 0.40 and no colour is near-black (the darkest is the eyes' plum at lightness 0.28, and eyes are under 4% of the surface)` (nothing dark); `no red-ish hue above saturation 0.8`; `faces +z at rest and turning toward the player is capped at 90 degrees per second and never spins past the player`; `breathing scale stays within ±1.5%`; `Glim stays within 1 block of him and his hue stays pastel (lightness at least 0.7)`; `celebrate hops at most 0.4 blocks and returns to rest`; `cells returns two cells at his spot`; `hidden beyond 44 blocks`.
- [ ] **Step 2:** Run `npx vitest run tests/render`. Expected: FAIL. Implement. Expected: PASS.
- [ ] **Step 3:** Look at it once with the Playwright MCP tool (front, side, close, far; confirm it is friendly and not eerie). Commit `feat(render): Orlo the wizard and Glim`.

### Task 12: Beacon sprite and star marker

**Files:** Create `src/render/beacon.ts`, `src/ui/marker.ts`, `tests/render/beacon.test.ts`, `tests/ui/marker.test.ts`. Modify `src/render/scene.ts`, `src/ui/styles.css`.

**Interfaces:**
```ts
export const BEACON_NEAR_HIDE = 10;      // hidden closer than this
export const BEACON_CLAMP = 55;          // farther than this the sprite rides the line of sight at this distance
export class Beacon {
  constructor(scene: THREE.Scene, at: { x: number; y: number; z: number });
  update(camera: THREE.Camera, timeSeconds: number): void;
  readonly sprite: THREE.Sprite;
}
export function beaconScreen(camera: THREE.Camera, at: Vec3, w: number, h: number): { onScreen: boolean; x: number; y: number; angle: number; distance: number };  // x,y clamped to the edge when off screen
export class EdgeMarker {
  constructor(root: HTMLElement);
  update(s: ReturnType<typeof beaconScreen>, shown: boolean): void;   // pointer-events none, 64 px
  readonly visible: boolean;
}
export function markerShown(s: { onScreen: boolean; distance: number }, visited: boolean, overlayOpen: boolean): boolean;
```

- [ ] **Step 1:** Tests: `the sprite is fog-free, depth-write off, one draw call`; `beyond 55 blocks it sits on the line of sight at 55 with scale proportional to 55/distance (apparent size constant)`; `within 55 it sits at the real place`; `hidden within 10 blocks`; `pulse stays inside opacity 0.8..1.0 and size ±4% and is slow (period 4 s, never a flash)`; `beaconScreen: on screen, off to the left/right/top, behind the camera (clamped to the nearest edge with the right angle)`; `markerShown: only when off screen, more than 20 away, never visited and no overlay`; `the marker is pointer-events none and 64 px and never over the hotbar corner area` (it keeps 100 px from the bottom edge); `the marker disappears for good once visited`; `nothing here reads or writes the world`.
- [ ] **Step 2:** Run `npx vitest run tests/render tests/ui`. Expected: FAIL. Implement. Expected: PASS.
- [ ] **Step 3:** Look at it once with the Playwright MCP tool: from the spawn, tilted up and at the default view (the marker). Commit `feat(render): the tower's far light and a pointing star`.

### Task 13: Tap, hold and entity pick for the wizard

**Files:** Modify `src/input/tap.ts`, `src/input/entityPick.ts`, `src/game/game.ts`; tests `tests/input/tap.test.ts`, `tests/input/entityPick.test.ts`, `tests/game/game.test.ts`; `tests/input/gesture.test.ts` must stay untouched and green. (Pointer wiring in `main.ts` is Task 18.)

**Interfaces:**
```ts
export type TapIntent = /* existing */ | { kind: 'talk' };
// entity list entries gain type 'wizard'; pickEntity(point, entities, radius per entity: animals 56, wizard 72)
export const WIZARD_REACH = 4;
```
Resolution for a quick tap: the entity under the finger is tried first. The wizard within `WIZARD_REACH` gives `talk`; farther gives `walk` to the standable cell nearest him that is at least 1.5 from him (never inside him). Press and hold: an entity under the finger gives `none`; the block under his feet gives `none` (`holdsSomeoneUp` includes him). `occupied()` includes his two cells so placing into him is refused. Nothing else changes: not the timings, not the thresholds, not drag.

- [ ] **Step 1:** Tests. Unchanged-rules block copied from the current tests and kept green (`quick tap with the hand walks`, `with a block builds in reach`, `a tap never digs`, `hold digs within reach / walks beside when far`, `hold on the block under his feet or Pip's feet does nothing`). New: `tap on the wizard in reach talks, whatever is selected (hand, block, seed, food, weapon)`; `tap on the wizard out of reach walks beside him, never closer than 1.5`; `a talk never places a block and never fires a weapon`; `hold on the wizard gives none and never digs the floor behind him`; `hold on the block under his feet gives none`; `placing into his cell is refused`; `pickEntity: nearest within the radius wins, the wizard's 72 px, ties go to the one nearer the camera, empty list gives null`; `the wizard behind an animal disc loses to the nearer one`. Game tests: `applyIntent talk emits one 'talk' event and costs nothing`; `a paused game ignores talk`; `selection is unchanged by talk`.
- [ ] **Step 2:** Run `npx vitest run tests/input tests/game`. Expected: new tests FAIL. Implement. Expected: PASS, with `tests/input/gesture.test.ts` untouched.
- [ ] **Step 3:** Commit `feat(wizard): talk to the wizard by tapping him`.

### Task 14: The wizard screen

**Files:** Create `src/ui/wizard.ts`, `tests/ui/wizard.test.ts`. Modify `src/ui/styles.css`, `src/ui/hud.ts` (overlay flag only).

**Interfaces:**
```ts
export interface WizardDeps {
  inventory: Inventory;                         // gems and blocks
  state(): WizardState; save(): void;
  iconFor(id: BlockId): string;                 // atlas icon data URL (frame 0)
  speak: { line(key: WizardKey): void; countSentence(p: Puzzle): void; again(): void };   // already behind wizardSpeech(): silent while the break bubble is up
  pipNudge(): void;                             // Pip's puzzleStuck line, once per puzzle
  rng: () => number; now?: () => number;
  celebrate(): void;                            // the wizard hops
  onOpenChange(open: boolean): void;            // pauses the game
}
export const TARGET_MIN_PX = 88;
export class WizardScreen {
  constructor(root: HTMLElement, deps: WizardDeps);
  open(): void; close(): void; readonly isOpen: boolean;
  tab(t: 'trade' | 'puzzle'): void;
  update(dt: number): void;                     // drives the session and hints; dt is 0 while the break bubble is up
  padMove(dx: number, dy: number): void; padSelect(): void;
}
```
Rules in the decisions table (tabs, cards, price pictures with digit and dots, the free gift on first open, counting shelf and basket, pattern and match cards, hint pulses and ghost slots, helped finish). A purchase or a solve shows the block's picture flying to the hotbar corner with the existing `gift` sound; Pip reacts (`gotMagicBlock`) at most once per 20 s. Every picture repeats its line when pressed. The screen opens on trade (or on puzzle when he has no gem and has had his gift), pauses the game, swallows pointer events and never leaves a half-finished state when closed.

- [ ] **Step 1:** Tests (jsdom): `all targets are at least 88 px (computed from the CSS constants), the tabs and ✖ at least 96`; `trade shows eight cards with the block picture, a gem picture, a digit and that many dots (1 or 2) and ×4 as a digit with 4 dots; no text is needed to use it`; `first open shows 🎁 on every card, picking one gives exactly 1 block and flips the gift flag, then prices show`; `buy with enough gems takes the price and gives 4`; `buy without enough gems changes nothing and the wizard says needGem and the puzzle tab pulses`; `a purchase that would pass 99 is refused whole`; `puzzle tab makes a new puzzle each open and each solve at the persisted level`; `counting: the shelf adds, the basket takes back, the match solves`; `a wrong card wobbles and says tryAgain, nothing is lost, the same card can be pressed forever`; `hint 1 at 12 s pulses the right thing, hint 2 at 24 s shows ghost slots or fades wrong cards, hint 3 at 45 s finishes with a sparkle and still gives the block`; `a solve gives exactly one mythical block via rewardKind and records solved and clean`; `three clean solves raise the level and it is saved`; `closing mid-puzzle drops it with no state change`; `the game is paused while open (onOpenChange) and dt 0 stops the hint clock`; `with the break bubble up the screen says nothing and keeps working`; `pad can move over cards and select`; `every picture repeats its line`; `no text node longer than a digit or a one-word label appears in the screen`.
- [ ] **Step 2:** Run `npx vitest run tests/ui`. Expected: FAIL. Implement. Expected: PASS.
- [ ] **Step 3:** Look at it once with the Playwright MCP tool (trade with and without gems, one puzzle of each kind, the hints, at 1920×1200 and at a smaller window). Commit `feat(ui): the wizard's trade and puzzle screen`.

### Task 15: Pip leads him to the tower

**Files:** Modify `src/game/lead.ts`; create `tests/game/leadTower.test.ts`; `tests/game/lead.test.ts` stays untouched and green.

**Interface:** `new LeadToVillage(route, square, flagSet, pad = VILLAGE_PLAN.pad, canOffer: (playerCell: Cell) => boolean = () => true)`. The offer in `updateWaiting` additionally requires `canOffer(playerCell)`. Everything else (gap, come-on, this-way, give-up, arrival by `pad` or `square`, `takeFlagSet`) is unchanged.

- [ ] **Step 1:** Tests in `leadTower.test.ts` on the real tower route from `generateWorld`: `no offer without a gem, without the village flag, or far from the village and the route`; `offered 8.5 s after an action and 25 s after load once all hold`; `Pip leads along the real tower route and he arrives on the hilltop pad or doorstep`; `the flag is set once and never again`; `pause (overlay or break bubble) freezes it`; `gave up after 90 s with no progress and never loops`; `a different route index search cannot jump across the double-back of the route near x 44` (the route turns twice); `the village lead and the tower lead never run together`; `old lead tests all pass unchanged`.
- [ ] **Step 2:** Run `npx vitest run tests/game/lead.test.ts tests/game/leadTower.test.ts`. Expected: new tests FAIL. Implement. Expected: PASS.
- [ ] **Step 3:** Commit `feat(lead): Pip walks him to the wizard's tower once`.

### Task 16: Wizard visit and speech policy (pure)

**Files:** Create `src/game/wizardVisit.ts`, `tests/game/wizardVisit.test.ts`. Modify `src/game/speechPolicy.ts`, `tests/game/speechPolicy.test.ts`.

**Interfaces:**
```ts
export class WizardVisit {
  constructor(now?: () => number);
  update(playerCell: Cell, tower: { greetRect: Rect; groundY: number }, busy: boolean): 'hello' | null;   // once per visit, at most once a minute, never while busy
  skipCurrent(): void;           // held too long: no hello until he leaves and returns, cooldown not used
  takeCancel(): boolean;         // he walked away from a hello still being spoken
  firstEnter(): boolean;         // true once, the first time he stands in greetRect ever this session (the caller saves wizard.met)
}
export function wizardSpeech(breakOpen: () => boolean, speak: { line(k: string): void; countSentence(p: unknown): void; again(): void }): typeof speak;   // like craftSpeech: silent while the break bubble is open
export const mayWizardGreet: typeof mayGreet;
```

- [ ] **Step 1:** Tests mirroring `GreetTracker`'s: `hello once when he enters, not again until he leaves and returns`; `at most once a minute`; `never while busy (a gesture, an overlay, a voice line)`; `skipCurrent does not use the cooldown`; `walking away cancels a hello still being spoken`; `never while Pip has a line pending`; `never while the break bubble is open (it keeps the priority)`; `wizardSpeech is silent with the break bubble open and passes through otherwise`; `held while audio is locked and dropped quietly after HOLD_LIMIT_SECONDS` (uses `LockedHold`); `all existing speech policy tests pass unchanged`.
- [ ] **Step 2:** Run `npx vitest run tests/game`. Expected: FAIL. Implement. Expected: PASS.
- [ ] **Step 3:** Commit `feat(wizard): a hello once per visit and the break-bubble guard`.

### Task 17: Camera and walkability tests in the tower

**Files:** Create `tests/render/cameraTower.test.ts` (reuses the helpers of `tests/render/cameraVillage.test.ts`). Change product code only if a test fails (then the fix goes in `cameraRig.ts` with its own test).

- [ ] **Step 1:** Tests over the real generated world (the same sweeps as the houses: 8 yaws × pitch min, default and max): for **every floor cell of both rooms** `drag-to-turn works in close mode` (the yaw changes by `200 × DRAG_RADIANS_PER_WIDTH / 1000` and the forward vector changes); `the camera is never inside a solid block` (`blocksRay` false at its position); `the camera has a clear line to the eye`; `inside the room the camera stays below the ceiling and above the floor block` (parametrised by `floors[i].ceilingY`); `going up the stairs in single steps never puts the camera in a wall` (walk the stair cells with the rig settling at each step); `at the top of the stairs and at the slab edge the camera stays in air`; `on the hilltop outside, a wall between the camera and the eye pulls it in and it glides back out`; `Pip hides in close mode in the tower as in houses`; `the star room windows (glass) do not block the eye but keep the camera inside (glass counts as a wall for the camera)`; `Magic mirror blocks placed in the tower count as glass for the camera`. Sweeps are heavy: `vi.setConfig({ testTimeout: 60_000 })` as in the village test.
- [ ] **Step 2:** Run `npx vitest run tests/render/cameraTower.test.ts`. Expected: PASS (or fix the camera). Commit `test(camera): comfortable camera on both floors of the tower`.

### Task 18: Wire it together

**Files:** Modify `src/main.ts`, `src/render/scene.ts`, `src/game/pal.ts` (a `lookAt(point)` for `seeTowerLight`, only if absent), `src/ui/hud.ts` (connections), `src/core/save.ts` call sites.

- [ ] **Step 1:** `generateWorld` returns the tower and its route; `applySave` returns `wizard`. Build `WizardView` at `tower.wizardSpot`, `Beacon` at `tower.beacon`, `EdgeMarker`, `WizardVisit`, the second lead (`new LeadToVillage(towerRoute, doorstepRect, wizard.led, hilltopPad, canOffer)` with `canOffer` = has a Gem, `flags.ledToVillage`, in the village pad or within 10 of the route), `WizardScreen`. `game.setOccupied` adds `wizardView.cells()`. The pointer handler asks `pickEntity` first (the wizard joins the animals and grumps in one list); a `talk` intent opens the screen and sets `game.paused` through `onOpenChange` like the craft screen; no new pointer listener outside the HUD.
- [ ] **Step 2:** Speech: every wizard line goes through `wizardSpeech(() => hud.breakOpen, ...)` and the `Voice` with speaker `wizard`; hellos are held while audio is locked (`HELD_KEYS` rule) and the held hello is dropped quietly after the limit; Pip's `meetWizard` arrival is queued first and the wizard's hello waits for it (`pipPending`). `seeTowerLight` fires once, the first time the marker shows, and Pip turns his head that way (`flags.wizard.hints`).
- [ ] **Step 3:** The first visit sets `wizard.met` and saves at once; the lead sets `wizard.led`; a solve calls `recordSolve` and saves; every purchase saves. The marker uses `markerShown(beaconScreen(...), wizard.met, overlayOpen)`. The scene calls `atlas.shimmer` only while a visible chunk has a shimmer block.
- [ ] **Step 4:** Debug hooks (dev and `?debug` only): `tower()` (layout, route, wizard spot), `wizard()` (state, `puzzle()` with the answer, `hint()`, `open()`), `giveGem(n)`, `beacon()` (`onScreen`, `distance`, `markerVisible`), `leadTowerState()`, `stats()` extended with `shimmerRepaints`, `chunkBuilds`, `depthBits`.
- [ ] **Step 5:** Review checks: an open overlay pauses the lead and the wizard's hello; the break bubble blocks every wizard and Pip line; the screen opens only when the game is not paused by another overlay. `npm test && npm run build`. Commit `feat: the wizard's tower wired in`.

### Task 19: Budget and performance

**Files:** Modify `tests/render/budget.test.ts`; create `tests/render/towerBudget.test.ts`.

- [ ] **Step 1:** Tests: `world triangle budget: at most 118,000 in all (step 2's cap plus 3,000: the tower, its roof and the path add about 1,500) and 12,000 per chunk`; `the chunks of the tower add at most 2,500 triangles`; `the wizard is 2 draw calls and at most 300 triangles`; `the beacon is 1 draw call`; `draw calls with the village, farm and tower in view stay within the chunk count plus 17`; `generateWorld with the tower stays under the existing build-time guard` (the measured value is printed); `shimmer repaint costs under 0.5 ms per repaint on the CI runner and runs at most 2.5 times a second` (frames counted over 10 simulated seconds); `a repaint never runs without a visible shimmer chunk`; `WizardView.update under 0.05 ms per frame`; `Beacon.update under 0.02 ms per frame`; `the atlas texture stays at most 64×192 (about 48 KB per upload)`; `a depth-precision note: the camera far plane is unchanged (64) because the beacon rides the line of sight` (asserted, so nobody raises it by accident).
- [ ] **Step 2:** Run `npx vitest run tests/render`. Expected: PASS. Commit `perf: tower, wizard, shimmer and beacon budgets`.

### Task 20: Invariant tests (never fails, never lost, never dark)

**Files:** Create `tests/game/wizardInvariants.test.ts`. Tests only; if one fails, the bug goes back to the task that owns it.

- [ ] **Step 1 (Codex):** Property tests with seeded random action streams of 2,000 steps over the real generated world (actions: walk anywhere, talk to the wizard, switch tabs, buy any block with random gems, pick any card, spam one wrong card, add and take basket items, wait random times (including 0 and 60 s), close the screen mid-puzzle, place and dig mythical blocks, save and reload through `serialise` and `applySave`, tick the clock backwards and by a week):
  - `he can never fail`: every opened puzzle is solved by the end of its stream segment when the stream keeps playing, and no action throws.
  - `nothing is ever lost`: no action lowers any stack except placing a block (one) and a purchase (gems only); a gem count only drops by exactly the price when 4 blocks arrive in the same step; every stack is between 0 and 99; the gift can be taken once only; total blocks in the world plus bag only change by his own place, dig, buy, gift and solve.
  - `the level never goes down`: the saved `clean` and the derived level are monotonic across reloads and stale saves.
  - `nothing in the wizard code can scare`: a source scan of the new files for `scary|monster|dark|night|blood|kill|die|dead|hurt|fight|enemy|attack|explode|scream|growl|chase`, and a palette scan of the wizard, tower stamp and tile art for near-black.
  - `save and reload at any point keeps the gift flag, level counters and every mythical block` (equality of `serialise` before and after).
- [ ] **Step 2:** Run `npx vitest run tests/game`. Expected: PASS once the earlier tasks are right. Commit `test: the wizard never fails, loses or scares`.

### Task 21: Browser story (e2e)

**Files:** Create `e2e/wizard.spec.ts`. Reuse `e2e/helpers.ts`. Tests start at `/block-pals/?debug` with a fresh `localStorage` unless they inject one. They use real touch for the gestures that matter (tap on the wizard, tap on cards, drag) and `applyIntent`, `teleport` or the debug hooks for long walks.

- [ ] **Step 1:** Tests:
  - `the tower stands and its path is walkable`: `tower()` exists; teleport to the village gate; walk the route to the door by `applyIntent` legs; he stands on the hilltop; the star room is reached by walking to its floor cell.
  - `the light is there`: from the spawn tilt up (`setCamera`): `beacon().onScreen`; at the default view `beacon().markerVisible` is true and the marker element is `pointer-events: none`; after entering the tower the marker is gone for good (reload: still gone).
  - `Pip leads him once`: no gem: no lead; `giveGem(1)` in the village with `ledToVillage` set and idle 25 s (debug clock): `leadTowerState() === 'leading'`, he follows, arrives, the flag is saved, reload: no second lead.
  - `hello and welcome gift`: entering the tower plays a wizard clip (`voiceLast().key` starts with `wizard/`) once; a real tap on the wizard opens the screen; every card shows 🎁; a real tap on one gives exactly 1 block; reopen: prices show and no second gift.
  - `trade`: with 1 gem, a 1-gem card gives +4 blocks and −1 gem; with 0 gems a tap changes nothing and the wizard says `needGem`; a 99-stack purchase is refused with nothing spent.
  - `puzzles`: for each kind, `wizard().puzzle()` gives the answer; a real tap on a wrong card changes no counts and `tryAgain` plays; the right card gives +1 mythical block; three clean solves raise the level and reload keeps it; counting works by tapping the shelf with an empty bag; closing mid-puzzle changes nothing.
  - `hints`: with the debug clock advanced, `wizard().hint()` goes 1 at 12 s, 2 at 24 s and the puzzle finishes itself at 45 s with the block given.
  - `overlay and break bubble`: the world is paused while the screen is open (the player does not move); with the break bubble open the wizard says nothing and the screen still works.
  - `the blocks`: give all eight; place each, dig each (hold) and get it back; Magic mirror lets the camera see through but not enter; a Rainbow block in view makes `shimmerRepaints` rise and leaves `chunkBuilds` unchanged; with none in view `shimmerRepaints` stays still.
  - `camera in the tower`: on both floors drag to turn: the camera is never inside a solid block.
  - `gestures unchanged`: a quick tap with the hand elsewhere walks; a tap never digs; a hold on the wizard shows no ring and digs nothing; placing a block into the wizard's cell is refused.
  - `old saves load`: inject a version 2 save without the new fields and a version 1 save: the page loads, the tower exists, the bag and position are kept, the v1 key is byte-identical.
  - `fps`: with the tower, the beacon, the village and the wizard in view `stats().fps` is reported (a loose floor in CI), no console errors, and `stats().depthBits` is logged.
- [ ] **Step 2:** Run `npm run e2e`. Expected: all pass including `smoke`, `village` and `farm`. Run `npm test && npm run build && npm run e2e`. Commit `test: browser story for the wizard's tower`.

### Task 22: README and spec status

**Files:** Modify `README.md` (how to find the wizard in one paragraph; the new voice-clip speaker `wizard` and the generation commands) and the status line of this plan. The link under §7g in the spec is added by the plan PR itself.

- [ ] **Step 1:** Update the README and `tools/voice/README.md`. Commit `docs: describe the wizard's tower`.

---

## Self-review against the spec

§7g "Done when": *a path leads from the village to the tower on its hilltop and its light can be seen from the meadow; after his first gem, Pip walks him there once; the wizard greets him in his own voice and gives a free block the first time; he can trade a gem for blocks and solve counting, pattern and matching puzzles that start easy and get harder, with hints, never failing and never losing anything; all eight blocks can be placed, dug up and built with, and the glowing ones light up his builds; the tower is bright inside with a comfortable camera on both floors; old saves load; nothing is scary, dark, lost or read; and the tablet holds 30 fps with the tower and its light in view.*
- **Path and hilltop:** Tasks 4 and 5 (real-world A* from the gate and the spawn, up to the star room, a real hill test). **Light seen from the meadow:** Task 12 (the beacon rides the line of sight, the marker covers the default camera whose sky is off-screen, Pip's line); checked on the tablet in the checklist.
- **Pip leads once after the first gem:** Task 15 (offer filter, gem needed, once, saved) and Task 18.
- **Greets in his own voice, free gift once:** Tasks 10 (voice and clips), 16 (visit), 8 and 14 (gift once, tested), 21.
- **Trade and puzzles, easy to harder, hints, never failing:** Tasks 6, 7, 8, 14; the ladder and persisted level in Tasks 6 and 9; the property tests in Tasks 7 and 20. **Nothing lost:** all-or-nothing trades (Task 8), the counting game never touches his bag (Task 14), invariants (Task 20).
- **Eight blocks placeable, diggable, buildable, glowing ones bright:** Tasks 1 to 3 and 21; lights are always-bright like the lamp (Task 2 shade test). **Comfortable camera:** Task 17. **Bright inside:** lamps and windows (Task 4 tests), no dark pixel (Task 2, 11). **Old saves:** Tasks 5, 9, 21. **30 fps:** Task 19 and the checklist.

Anti-goals (§4): **nothing scary** (a gentle old wizard in periwinkle and gold, a pastel orb, soft sparkles; no sound is louder than the existing sfx, the wizard has a slow warm voice, no flashing: shimmer is 0.4 s frames with at most a quarter of a tile changing and the beacon pulses on a 4 s sine); **nothing dark** (daytime tower, lamps, windows, tile and model brightness floors tested); **nothing lost** (trades all-or-nothing, the gift once, the level only rises, no fail state exists, source-scan test); **no reading** (every screen is pictures, digits, dots and shapes, plus a voice line for everything and tap-to-repeat; the only text is digits and one-word labels, tested); **no frustration** (88 px targets, the same wrong card can be pressed forever, hints at 12 and 24 s, the wizard helps him through at 45 s, a random clicker and a waiter both always finish, Pip leads him there, the star marker points the way, stairs are ordinary one-block steps); no ads, links or data (none added); **original** (Orlo, Glim, all tiles and models are ours); British English (policy tests).
§5: the 30 fps budget is in Task 19 and the checklist; offline (nothing networked, all clips shipped); local save (Task 9). §7a: tap, hold and drag meanings, timings and thresholds are unchanged; the only new behaviour is that a quick tap on the wizard talks (or walks him over), and hold on him does nothing. §7c: the camera reuses the house rules (Task 17).

Out of scope on purpose: special powers for the blocks (a bouncy cloud and the like), crafting or selling mythical blocks, wizard quests and hearts, beat-copy puzzles (the music step), puzzles that take items from the bag, more wizard rooms, anything about night.

## Performance numbers

| | After step 2 and grumps | This step |
|---|---|---|
| Triangles in the world (budget) | about 47,000 (115,000) | about 48,500 (118,000) |
| The tower, roof and path | 0 | about 1,500 (budget 2,500) |
| The wizard | 0 | 1 body mesh up to 280 triangles + Glim 20 triangles = 2 draw calls |
| The far light | 0 | 1 `Sprite` = 1 draw call, fog-free, no change to the camera's far plane |
| Draw calls, village + farm + tower in view | chunks + 14 | chunks + 17 |
| Atlas | 64×160 | 64×192 (about 48 KB per upload) |
| Shimmer | none | 4 tiles repainted 2.5 times a second, only while a shimmer chunk is visible, under 0.5 ms each, no chunk rebuilt |
| Per-frame CPU | | `WizardView.update` under 0.05 ms, `Beacon.update` under 0.02 ms |
| Generator | step 2 | one more pad, one stamp and one 80-cell path (a few ms; guarded by the existing build-time test) |
| Chunk rebuilds caused by this step | n/a | none (shimmer is a texture repaint) |

Fallbacks if the tablet misses a number (decide from the checklist, do not build ahead): turn the shimmer off (static frame 0); repaint at 1.25 Hz; drop the beacon pulse; drop Glim's orbit; reduce the wizard to one mesh by merging Glim into the body.

## Parent playtest checklist (Galaxy Tab A8, after deploying to GitHub Pages)

Use `?debug` once for the fps counter, then play without it. The first question, as with the grumps: *is anything the slightest bit scary or dark?*

1. **Old save.** Open the new version on the tablet that has his world. Everything he built and his position are there; the tower and its path are new.
2. **The light.** From the meadow, tilt the view up: a soft glowing star is far away. At the normal view, a small star on the screen edge points toward it. Does he get curious? Does it ever flash or look sharp?
3. **Pip leads.** Get a gem (cheer up a grump), then wait in the village: Pip offers to take him to the wizard and walks the path. Does he follow? Does it feel too long (about 27 seconds)? After the first time, Pip does not offer again.
4. **The tower.** Walk in: it is bright, with lamps and windows. Turn the view by dragging in the ground room, up the stairs and in the star room: the camera never goes inside a wall. Walk up and down the stairs.
5. **Orlo.** His voice (the one the parent chose), his look, Glim. Is he friendly and not even a little eerie? Does he talk too slowly or too much?
6. **Free gift.** The first time: tap him, pictures with gift boxes; choose one block; it is in the bag. Second time: prices with gems and dots, readable without help.
7. **Trade.** One gem buys four blocks. With no gems a gentle nudge and the puzzle tab glows. Nothing red, nothing lost.
8. **Puzzles.** Counting (does the basket make sense?), pattern, matching. Does he understand "what comes next" without help? Are the first ones very easy? After a few, do they get slightly harder? Do the hints come soon enough, and does he ever feel stuck or told off?
9. **The eight blocks.** Place each. The Rainbow, Star, Starlight and Magic mirror shimmer slowly. Moon, Sun and Starlight look like lamps. Cloud, Dragon-scale and Star look right. Build a wall of Magic mirror and look through it.
10. **Gestures.** A quick tap elsewhere still walks; hold on Orlo does nothing; a block cannot be put into him.
11. **Speed.** The tower, the light and the village in view, turning the view: the fps counter stays at 30 or more (write down the lowest), with a field of Rainbow blocks in view too. After 10 minutes the tablet is not hot.
12. **Break reminder.** While the wizard screen is open the break reminder still appears, nothing talks over it, and he can dismiss it and carry on.
13. **Voice.** All new lines are British, clear and not too long; listen for "Orlo", "Glim", "bundles of wheat" and the number words in the counting sentence.
14. **Controller.** Open the screen, move between cards and choose with the pad.

## Questions for the parent (most important first)

1. **Which wizard voice?** Three samples of the same line ("Welcome to my tower. The stars told me you were coming.") are in `/home/jackw/block-pals-voice-samples-wizard/` (Windows: `\\wsl.localhost\Ubuntu\home\jackw\block-pals-voice-samples-wizard`): A `wizard_A_george_fable` (warm grandfatherly storyteller), B `wizard_B_fable_puck` (lighter, twinkly), C `wizard_C_lewis_emma` (kindly, airy). *Recommendation: B, because you liked Pip's blended, lifted voice and disliked plain ones, and B has the most sparkle; A if you want him to sound much older and calmer than Pip. Tell me A, B or C and the blend goes into `voices.json`.*
2. **How many blocks for a gem, a puzzle and the gift?** I chose: **1 gem buys 4 blocks of his choice** (2 gems for the four rarer kinds), a **puzzle gives 1 block** (the wizard picks, so he collects all eight), the **welcome gift is 1 block of his choice**. *Recommendation: keep it, it is one table in `src/core/mythical.ts` and easy to retune after the tablet playtest; if he finds gems rare, make every price 1.*
3. **Counting puzzles: a game on the screen, or real items from his bag?** I made them a game on the screen (tap pictures into a basket), so they work with an empty bag and nothing can ever be taken from him. Your example said "bring me 3 apples and 2 carrots", which could also mean handing over real apples and carrots he grew. *Recommendation: the screen game for now; real hand-over could be added later as a second kind, because it would use up food he may want for the animals.*
4. **A star room upstairs?** The tower has a ground-floor room where Orlo lives and a stair up to a bright round star room with windows all round (more to see, a nice place to build). It costs one extra task of testing but no risk to the rest. *Recommendation: yes; it is what makes the tower feel tall from inside. If you would rather keep it simple, say so and the plan becomes one room with the same outside.*

## Decisions confirmed by the parent (2026-11-08)

The parent confirmed the design below before this plan was written (recorded verbatim in Global Constraints). The answers to the four questions above, once given, are recorded here and in the tasks.

- A wizard, original, strong personality, his own voice, alone in a tall tower on a hilltop at the far edge of the 96×96 world, away from the village; a gently glowing light at the top visible from the meadow; a path from the village; Pip walks him there once (per save) after his first gem; never dark inside; comfortable camera (the houses' rules and tests).
- Eight mythical blocks (Starlight crystal, Rainbow, Cloud, Moon, Sun, Dragon-scale, Star, Magic mirror), bright, original, decorations and light sources with no special powers, new block ids with atlas art, cheap shader-free shimmer, placeable and collectable, lights like lamps.
- Both ways to get them: gems (from grumps; one free block as a welcome gift the first time) and picture puzzles (counting up to 20 with dots, patterns, matching; pictures and numbers only; never fail; gentle try-again and Pip's help after a short time; a new puzzle each visit, easier first, harder with progress, the difficulty saved; solving gives a block). Beat-copy puzzles later with the music step.
- A new speaker `wizard` in `tools/voice/voices.json`, chosen from three candidate blends by listening.

## Build chunks and review gates

Four sequential chunks, like the earlier steps. Each chunk is built by Claude (Codex builds the small pure tasks), reviewed by the other, fixed, and merged to `main` only after its gate passes. The parent playtests on the tablet after the final chunk (and may peek after chunk 2).

| Chunk | Tasks | Gate before the next chunk |
|---|---|---|
| A. The blocks | 1, 2, 3 | `npm test` and `npm run build` green; old block, atlas and mesher tests untouched and passing; all eight blocks placeable and diggable; brightness and shade tests green; shimmer rebuilds no chunk; Codex review of id ranges and save-compat of `inventory`. |
| B. The tower in the world | 4, 5, 17 | Tower, route and camera tests green over the real world; A* from the gate and the spawn reaches the door and the star room; edits win; v1 fixture and old stamps unchanged; old saves load and the v1 key is never written; Codex review of the generator changes. |
| C. The rules | 6, 7, 8, 9, 16, 20 | Puzzle, session, trade, save, visit and invariant tests green; every level solvable by a clicker and by a waiter; nothing can be lost; the level never goes down; Codex review of the never-fail rules. |
| D. The wizard himself | 10, 11, 12, 13, 14, 15, 18, 19, 21, 22 | Full `npm test && npm run build && npm run e2e`; voice clips generated (with the parent's chosen blend) and the clip tests green; budgets pass; Codex review of every line against the policy and a "is anything scary or dark" read of the model, tiles and screen. |

**Final gate:** all four chunks merged, the e2e story passes (the path, the light, the lead once, hello and gift once, trade, all three puzzle kinds with hints and the helped finish, the eight blocks, the camera in the tower, old saves), the performance budgets in Task 19 pass, the plan's self-review above is re-checked against the built code, and the parent has done the tablet checklist. Nothing is deployed to GitHub Pages for the parent until the final gate except the chunk the parent asks to peek at.
