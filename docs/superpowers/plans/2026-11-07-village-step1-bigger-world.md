# Village Step 1: The Bigger World Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The meadow grows into a bigger connected world. Over the hill sits a village with four neighbours' houses (bakery, block shop by a quarry, farmhouse with a reserved empty field, cosy cottage), joined to the meadow by a clear, always-connected path. Our player also has his own tiny empty starter cottage next to the meadow spawn. Every house is built from real blocks with a wide door gap, is bright inside, and is big enough to walk about in and turn the view. The four villagers stand at their houses as simple original blocky characters and say one spoken, pictured hello when he comes near (no trading, quests or hearts yet). The first time, Pip leads him to the village ("Let's go and meet the neighbours!"), once, and never gets in the way of his taps or drags. Old saves load into the bigger world with every edit and his position kept. Nothing in this step adds a rule he has to learn.

**Architecture:** Same layering as v1. Pure, DOM-free logic in `src/core/` (world bounds, worldgen stages, houses, village layout, save v2 and migration) and `src/game/` (villager greeting, Pip's lead) is unit-tested with Vitest, including real pathfinding over the real generated world. Rendering (`src/render/`) gains new block tiles, villager models, door emblems and a distance cull for chunks. `main.ts` only wires. The world is generated in stages so the v1 meadow stays bit-identical: stage 1 is the v1 meadow, stage 2 extends the same height formula, stage 3 stamps pads, houses and the path, stage 4 plants the new edge trees. A save stores the seed plus edits only, so his edits replay on top of the stamps and always win.

**Tech Stack:** TypeScript 5 (strict), Vite 8, Three.js 0.187, Vitest 5, vite-plugin-pwa 2, Playwright 1.65, Web Speech API, Web Audio API. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-05-block-pals-design.md` (§4 anti-goals, §5 constraints, §7a hold-to-dig, §7c smart camera, §7d Village design and the step 1 "done when").

**Dependencies (must be merged to `main` first):**
- **PR #3 (`v1.2`)**: adds `src/render/cameraRig.ts` (`CameraRig`, `clampDistance`, `CLOSE_DISTANCE`, `lookDir`), `src/render/voxelRay.ts` (`castVoxelRay`), drag-to-turn in `src/input/gesture.ts`, `scene.rig`, and the `__debug.camera()` / `__debug.dragging()` hooks. §7c is in the spec only on that branch. This plan assumes all of it exists. Tasks 10 and 13 import them. Rebase this work on `main` after PR #3 lands; if it has not landed, stop at Task 9.
- PR #4 (the Village design in the spec) is already merged.

## Global Constraints

Copied from the spec and the v1 plan, with the changes this step makes marked **changed**.

- British English in every string and voice line (colour, grey, mum, "Ooh, lovely!"). `tests/content/lines.test.ts` keeps enforcing it and now also covers villager lines.
- No reading needed: every spoken line is also shown as a picture (speech-bubble icon). Digits only up to 20. Nothing in this step needs a number.
- Always daytime. **Nothing dark**: interiors are as bright as outside (the scene is lit by hemisphere and sun light with no shadows, so roofs cannot shade rooms), every room has lamp blocks and glass windows, and fog and sky stay bright blue.
- Nothing scary, nothing hurt, nothing lost. Villagers are still, friendly and never chase.
- No network calls at runtime, no analytics, links or CDN assets. Works offline after first load.
- Target device: Galaxy Tab A8 (1920×1200, Unisoc T618), landscape, Chrome. A steady 30 fps or better. Pixel ratio capped at 1.5. No real-time shadows.
- Touch targets at least 88 CSS px. Quick tap with the hand walks, press and hold (about ½ s) digs, drag turns the view (§7a, §7c). **This step must not change any of those.**
- **World (changed):** 96 × 20 × 96 cells (was 48 × 16 × 48), 6 × 6 = 36 chunks of 16 × 16 columns, default seed `2026`. Bounded by a soft invisible wall 1 block inside every edge, with a ring of trees near the edge. The v1 meadow occupies x 0..47, z 0..47 unchanged; the world grows east and south from it.
- Inventory capped at 99 per kind (§7a). Interaction reach 3. Collecting is instant in v1, and v1.1 hold-to-dig still applies unchanged.
- Everything is a real block. Nothing is locked: he can dig or build on any house, including the neighbours'. Only bedrock and water cannot be dug.
- Original assets only: villager characters, names and emblems are our own.
- Save key stays `blockpals.save.v1` so old saves are found; the version field inside moves to 2. A save from this build is never written in a form the old build would mistake for valid.
- Block ids are saved as numbers in `edits`: **existing ids never change; new blocks are appended** (Task 2).

## Review Focus

- **Losing his builds:** an old (version 1) save must load into the 96×96 world with every edit at its coordinates, the same inventory and bag order, and the player at the same spot. His edits replay after the stamps, so a house or path never overwrites something he built. A backup copy of the v1 save is kept the first time we write v2 (Task 6 tests `keeps every edit at its coordinates`, `edits win over stamps`, `keeps a backup`).
- **Getting stuck or lost:** doors are 2 wide × 3 high so the player (stick, tap, pad) and Pip always fit. A walled-in player can still dig out (collecting is always allowed, v1 rule). Every door is reachable from spawn by A* and every path step is at most 1 block up or down (Tasks 4 and 5). The village is always reachable from the meadow along the path.
- **Pip's lead fighting him:** the lead only moves Pip. It never moves, turns or blocks the player, never changes the camera, never teleports Pip away from him, gives up politely when ignored, and pauses with overlays. Taps and drags during a lead behave exactly as outside one (Task 9 tests, Task 13 e2e).
- **Camera through walls and roofs:** with real houses, the camera is never inside a solid block for any yaw and pitch, inside or outside, and dragging to turn works in close mode inside a house (Task 10).
- **Tablet performance:** 4× the area. Triangle budget and chunk culling are unit-tested (Task 11), fps and load time are checked by hand on the Tab A8 (checklist at the end).
- **Hardcoded 46/47/48 bounds:** `player.ts`, `game.ts`, `save.ts` and `worldgen.ts` hold literal v1 sizes. Missing one silently walls him into the old meadow or rejects saved edits (Task 1).
- **Stamps clipping trees and terrain:** half a tree left floating over a path, or a house on a slope with a gap under it (Tasks 4 and 5 tests).

## Decisions made in this plan

Marked **(my call)** where the spec leaves room. The parent can overrule any of these; the open ones are at the end as "Questions for the parent".

| Topic | Decision |
|---|---|
| World size | **96 × 20 × 96 (my call).** 4× the area. Height 20 (was 16) so a roof and chimney fit on any ground height up to 9 (cottage on the spawn plateau: ground ≤ 9, top ≤ ground+9 ≤ 18 < 20). |
| Where the world grows | East and south of the v1 meadow, so every saved coordinate stays valid. |
| Terrain | One pure `heightAt(seed, x, z)` extracted from the v1 formula (absolute coordinates), so the old area is identical by construction. Beyond x or z 47 the same noise rolls on. |
| Village ground | Flat pad at y = 5 (the base meadow height) with a skirt that eases to the natural ground at most 1 block per column. |
| Layout (x east, z south) | Starter cottage x 14..20, z 15..21 (door east, towards spawn 24,24). Hill unchanged (peak 34,12). Pond unchanged (14,32). Village pad x 58..92, z 6..44 (nudged in Task 5 from z 42). Village square (paved) x 68..80, z 22..30. Bakery x 62..70, z 12..19 (door south). Block shop x 76..84, z 12..20 (door south), quarry pit x 86..92, z 8..14 next to it. Farmhouse x 62..70, z 32..39 (door north), reserved field x 72..83, z 35..43 (nudged in Task 5 so Granny's cottage does not overlap it). Granny's cottage x 85..92, z 30..37 (door west; nudged east in Task 5). Exterior footprints, inclusive. Tests assert no overlaps and a 2-cell gap, so the implementer may nudge numbers by a cell or two. |
| Houses | Exterior 9×8 (bakery, farmhouse), 9×9 (block shop), 8×8 (Granny), 7×7 (his cottage); interiors 7×6, 7×7, 7×6, 6×6, 5×5. Walls 1 thick, 4 high (interior cells at ground+1 to ground+4). **Door gap 2 wide × 3 high (my call)**, with a DoorFrame jamb and lintel. No eaves; roof is a stepped pyramid of RoofTile blocks (each layer inset by 1) so walls stay clean for the camera. Floor is Planks. Two Lamp blocks in the ceiling and two 2×2 glass windows per house. Chimney of Bricks on the bakery (and a small one on Granny's). The player can climb a roof by steps (steps of 1 are walkable). That is harmless fun. |
| New blocks | `PathStone`, `RoofTile`, `DoorFrame`, `Lamp` appended as ids 12 to 15 (Task 2). Bricks, Planks, Glass already exist. All are collectable, so nothing is locked. |
| Path | 3 wide, PathStone on top, the same height as the ground beside it. Route waypoints: spawn (24,24), (30,22), (37,17), (41,14) [the hill's shoulder, ground 6 to 7], (48,16), (56,22), then the village gate (67,26). The ground under it is cut or filled so consecutive route cells differ by at most 1 in height. 2 blocks of headroom are cleared, including whole trees touching it. A short 2-wide link joins the cottage door to the spawn. |
| Saves | Same key, `version: 2`, plus `gen: 1` (the generator version, so later steps can add stamps knowingly) and `flags: { ledToVillage: boolean }`. v1 loads through a migration (Task 6). |
| Villagers | Fixed in a house, facing the door, off the door line so nobody walks through them by accident. No collision with the player (the same as Pip today). They only greet. |
| Greeting | Once when he enters a house's greet zone (the interior plus 3 cells in front of the door), at most once per 60 s per villager, never while another voice line is playing. |
| Pip's lead | Pip walks ahead along the route at 3 blocks/s (his speed is 3.5, Pip's follow speed is 4.5). Triggers once per session while `ledToVillage` is false, about 8 s after his first action or 25 s after load, whichever comes first. Sets the flag on arrival. Ignored for 90 s means Pip gives up and tries again next session. |
| Chunks | Built all at load. Distance cull hides chunk meshes beyond fog distance. A streamed/lazy build is a **fallback only** if the playtest checklist fails load time or fps. |
| Doors have no moving door | A door is a gap (spec §7d). |

## Who builds what

Every task is reviewed by the other agent before merging. Codex is invoked with `codex exec --full-auto "<task text from this plan + spec path>"`. Ruflo tracks tasks if connected; otherwise the checkboxes are the record.

| Task | Builder | Reviewer |
|---|---|---|
| 1 World bounds and legacy fixture | Codex | Claude |
| 2 New blocks and atlas tiles | Claude (art) | Codex |
| 3 Worldgen stages: keep the meadow, extend the world | Codex | Claude |
| 4 House stamping | Codex | Claude |
| 5 Pads, route, village and starter cottage | Codex | Claude |
| 6 Save v2 and migration | Codex | Claude |
| 7 Villager data, lines and greeting logic | Codex | Claude |
| 8 Villager models and door emblems | Claude | Codex |
| 9 Pip leads him to the village | Codex (logic) + Claude (wiring) | each other |
| 10 Camera in and around houses | Codex (tests) + Claude (any rig fix) | each other |
| 11 Render budget and chunk culling | Claude | Codex |
| 12 Wire it together | Claude | Codex |
| 13 Browser story (e2e) | Claude | Codex |

## File Structure

New or changed. Everything else stays as in v1 / v1.1 / v1.2.

```
src/core/bounds.ts           NEW  WORLD, LEGACY_WORLD, insideWall(), clampToWall()
src/core/blocks.ts           CHG  append PathStone, RoofTile, DoorFrame, Lamp
src/core/worldgen.ts         CHG  stages: heightAt, generateMeadow (v1 verbatim), extend, stamp, edge ring
src/core/houses.ts           NEW  HouseSpec, HouseInfo, Rect, stampHouse()
src/core/village.ts          NEW  levelPad, carveRoute, VILLAGE_PLAN, buildVillage() -> VillageLayout
src/core/save.ts             CHG  SaveData v2, migrateV1, flags, backup
src/core/pathfind.ts         unchanged (tests pass larger maxNodes)
src/game/player.ts, game.ts  CHG  use core/bounds instead of 46/47
src/game/villagers.ts        NEW  VILLAGERS table, GreetTracker
src/game/lead.ts             NEW  LeadToVillage state machine
src/game/pal.ts              CHG  lead mode (no teleport), hush()
src/content/lines.ts         CHG  new LineKeys for Pip
src/content/villagers.ts     NEW  villager greeting lines + icons + voice style
src/audio/voice.ts           CHG  say(text, style?)
src/render/atlas.ts          CHG  rows 4 -> 6, four new tiles
src/render/characters.ts     CHG  makeVillagerModel(id), makeEmblem(emoji)
src/render/scene.ts          CHG  skip empty meshes, chunk distance cull, villager/emblem add
src/render/chunkCull.ts      NEW  visibleChunks()
src/main.ts                  CHG  wire layout, villagers, lead, flag, debug hooks
tests/core/{bounds,worldgen,houses,village,save}.test.ts, tests/fixtures/legacy-meadow-2026.json
tests/game/{villagers,lead,pal}.test.ts, tests/content/lines.test.ts
tests/render/{mesher,budget,chunkCull,cameraVillage}.test.ts
e2e/village.spec.ts
```

---

### Task 1: World bounds and the legacy fixture

**Files:** Create `src/core/bounds.ts`, `tests/core/bounds.test.ts`, `tests/fixtures/legacy-meadow-2026.json`. Modify `src/game/player.ts`, `src/game/game.ts`, `src/core/save.ts` (the edit-bounds check only; the rest of the save work is Task 6).

**Interfaces:**
```ts
export const WORLD = { x: 96, y: 20, z: 96 } as const;
export const LEGACY_WORLD = { x: 48, y: 16, z: 48 } as const;
/** Soft wall: cell x,z must be in [1, size-2]. Same as v1 (46 for a 48 world). */
export function insideWall(world: { sizeX: number; sizeZ: number }, x: number, z: number): boolean;
/** Clamp a position (world units) to [1, size-1-EPS] on both axes. Same as v1 (47-EPS). */
export function clampToWall(world: { sizeX: number; sizeZ: number }, x: number, z: number): { x: number; z: number };
```

- [ ] **Step 1 (before touching anything else):** On the current `main`, write a one-off script/test that runs the v1 `generateWorld(2026)` and writes `tests/fixtures/legacy-meadow-2026.json` containing `{ spawn, sizeX: 48, sizeY: 16, sizeZ: 48, hash, counts }` where `hash` is a 32-bit FNV-1a over the cells in the same x, z, y order as `World.index`, and `counts` is block counts per id. Commit this fixture first (`test: fixture of the v1 meadow`). It is the ground truth for Tasks 3 and 6.
- [ ] **Step 2:** Tests in `tests/core/bounds.test.ts`:
  - `insideWall matches v1 on a 48 world`: true for x,z in 1..46, false for 0 and 47.
  - `insideWall on 96 world`: true at 94, false at 95 and 0.
  - `clampToWall keeps positions inside`: for a 96 world, `clampToWall(w, 200, -3)` gives `x < 95`, `z === 1`.
  - Existing `tests/game/player.test.ts` and `game.test.ts` pass unchanged (v1 behaviour on small worlds is identical).
- [ ] **Step 3:** Run `npx vitest run tests/core/bounds.test.ts`. Expected: FAIL (module not found). Implement. Re-run: PASS.
- [ ] **Step 4:** Replace the literals `Math.min(46, …)` / `Math.min(47, …)` in `player.ts` (`insideWall`, `move`) and `game.ts` (`insideWall`) with the helpers. In `save.ts` `isSaveData` the hardcoded `[48, 16, 48]` stays for now (v1 path only).
- [ ] **Step 5:** `npm test`. Expected: all previous tests pass. Commit `refactor: world bounds in one place`.

### Task 2: New blocks and atlas tiles

**Files:** Modify `src/core/blocks.ts`, `src/render/atlas.ts`, `tests/render/mesher.test.ts` (one test), `tests/core/world.test.ts` (one test).

**Interfaces:**
```ts
// appended after Bedrock = 11. Existing ids MUST NOT change.
export enum BlockId { /* ... */ Bedrock = 11, PathStone = 12, RoofTile = 13, DoorFrame = 14, Lamp = 15 }
```
All four: `solid: true, collectable: true, transparent: false`; names are simple words `'path'`, `'roof'`, `'frame'`, `'lamp'`. Atlas: `ROWS` 4 to 6 (24 tiles, room for steps 2 and 3), `TileName` gains `'pathStone' | 'roofTile' | 'doorFrame' | 'lamp'`, and `tileFor` maps them. Tiles (original art, 16×16 procedural): PathStone is warm sandy cobbles with darker gaps; RoofTile is red-orange shingles in offset rows; DoorFrame is dark brown vertical-grain wood; Lamp is a bright warm-yellow/white square with a lighter glowing centre and four tiny sparkle pixels. **The lamp tile must stay bright under the Lambert side shading** (colour at least #ffe9a0 on every face), since "nothing dark" is a hard rule.

- [ ] **Step 1:** Tests. `tests/core/world.test.ts`: `block ids are stable` asserts `BlockId.Bedrock === 11`, `PathStone === 12`, `Lamp === 15`, and a snapshot of `Object.entries(BlockId)` for ids 0..11 matching v1. `tests/render/mesher.test.ts`: `new blocks mesh as opaque cubes` (a single Lamp has 12 triangles in `positions`, none in `transparent`).
- [ ] **Step 2:** Run `npx vitest run tests/core tests/render`. Expected: new tests FAIL. Implement. Expected: PASS.
- [ ] **Step 3:** `Inventory` and `parseSave` accept new ids because they check `Object.hasOwn(BLOCKS, id)`. Add a `tests/core/save.test.ts` case `accepts new block ids in edits and bag` later in Task 6 (note it here so it isn't forgotten).
- [ ] **Step 4:** `npm run build`. Expected: no errors. Commit `feat: path, roof, door frame and lamp blocks`.

### Task 3: Worldgen stages: keep the meadow, extend the world

**Files:** Modify `src/core/worldgen.ts`. Test `tests/core/worldgen.test.ts` (extend). Fixture from Task 1.

**Interfaces:**
```ts
export const GEN_VERSION = 1;
/** The v1 height formula, absolute coordinates, pure. spawn/plateau terms identical to v1. */
export function heightAt(seed: number, x: number, z: number): number;
/** Stage 1+2: terrain for the whole 96 world and the v1 trees only. No stamps. For tests. */
export function generateMeadowStage(seed?: number): { world: World; spawn: Cell3; heights: Uint8Array };
export interface GeneratedWorld { world: World; spawn: { x: number; y: number; z: number }; village: VillageLayout }
export function generateWorld(seed = 2026): GeneratedWorld;
```
Stages in `generateWorld`: (1) terrain columns for all 96×96 from `heightAt` (pond, hill, shore, spawn plateau are terms of the same formula so they sit where they did); (2) the v1 tree code run **verbatim** with its own `mulberry32(seed)` stream and the v1 constants (ring anchors inset from 0 and 47, candidates 8..39) so the v1 trees land on the same cells; (3) `buildVillage` stamps (Task 5); (4) a new ring of edge trees around the 96 edge (2 to 4 cells in) and a sparse scatter of extra trees on the new ground, from a **separate** stream `mulberry32(seed ^ 0x5eed)`, never inside a reserved rectangle (village pad plus skirt, route corridor, cottage pad); (5) `clearEdits()`, `markClean()`.

- [ ] **Step 1:** Tests:
  - `v1 meadow is unchanged`: `generateMeadowStage(2026)`, hash the cells with x < 48, z < 48, y < 16 in v1 order, equal to the fixture hash; `spawn` equals the fixture spawn; the cells with y >= 16 in that area are Air (a v1 tree never reached there).
  - `final world differs from the meadow only at stamps`: count cells with x < 48, z < 48 that differ between `generateMeadowStage` and `generateWorld`; assert `<= 900` and that every differing cell lies inside the union of the cottage pad, the cottage link, the route corridor and tree-clearing margins, all reported by `village` (`village.stampedRects`).
  - `is deterministic`: two calls with seed 2026 have identical cells; seed 2027 differs.
  - `size`: `world.sizeX/Y/Z` are 96/20/96. Bedrock at y = 0 everywhere; surface height in 3..12 everywhere except the pond bed (3).
  - `trees stay inside the soft wall and keep the spawn clear`: no Wood or Leaves within 4 cells of spawn; every tree trunk inside `insideWall`.
  - `edge ring`: at least 3 trees within 4 cells of each of the four new edges.
  - `no tree stands on water or sand` (v1 rule kept).
- [ ] **Step 2:** Run `npx vitest run tests/core/worldgen.test.ts`. Expected: new tests FAIL. Implement (the `village` field can return an empty layout until Task 5; `final world differs` is added in Task 5). Expected: stage tests PASS.
- [ ] **Step 3:** Print and record in the commit message: generate time in ms on the dev machine and `world` non-air cell count. `npm test`. Commit `feat: generate a 96x96 world that keeps the v1 meadow`.

### Task 4: House stamping

**Files:** Create `src/core/houses.ts`, `tests/core/houses.test.ts`.

**Interfaces:**
```ts
export interface Rect { x0: number; z0: number; x1: number; z1: number } // inclusive
export type Facing = 'north' | 'south' | 'east' | 'west'; // side the door is on; north = -z
export type HouseId = 'cottage' | 'bakery' | 'shop' | 'farmhouse' | 'granny';
export interface HouseSpec {
  id: HouseId; rect: Rect; facing: Facing;
  wall: BlockId; chimney?: { dx: number; dz: number }; // offset from the footprint corner; Bricks, 2 above the roof layer
}
export interface HouseInfo {
  id: HouseId; groundY: number; rect: Rect; interior: Rect;
  doorCells: Cell[];            // the feet cells of the 2-wide gap, at groundY + 1
  doorFront: Cell;              // outside, centred on the gap, feet cell
  doorInside: Cell;             // inside, feet cell
  floor: Cell[];                // every interior floor-standing cell (feet cells)
  npcSpot: Cell;                // back wall, centred, off the door line by 1
  greetRect: Rect;              // interior plus 3 cells in front of the door
  lampCells: Cell[]; windowCells: Cell[];
}
export const INTERIOR_HEIGHT = 4;  export const DOOR_WIDTH = 2; export const DOOR_HEIGHT = 3;
/** Writes the house (floor, walls, door gap + frame, windows, lamps, ceiling, roof, chimney). Fills Dirt under the floor down to the existing ground and clears everything above the footprint to the top of the world. */
export function stampHouse(world: World, spec: HouseSpec, groundY: number): HouseInfo;
```
Layout of one house (ground `g`): footprint floor is `Planks` at y = g with Dirt below it to the existing ground; walls y = g+1..g+4 of `spec.wall` (Planks or Bricks); door gap centred on the `facing` side, 2 wide, y g+1..g+3, jambs and lintel (y g+4 across the gap) are `DoorFrame`; two windows of 2×2 `Glass` at y g+2..g+3 on the two sides not holding the door (centred); ceiling at y = g+5 spanning the footprint (`RoofTile`) with two `Lamp` blocks replacing ceiling cells above interior cells (their lit face looks down into the room); roof layers at g+6, g+7, g+8 each inset by 1 from the one below, stopping when the layer is empty; chimney of Bricks 2 cells above the roof layer it stands on.

- [ ] **Step 1:** Tests (build each of the five specs from the plan table into a flat test world, 40×20×40 with ground at y = 5, then assert):
  - `interior is empty and big enough`: all interior cells g+1..g+4 are Air; interior sizes are exactly the plan's (5×5, 7×6, 7×7, 7×6, 6×6); every interior at least 5×5.
  - `door gap is 2 wide and 3 high with a frame`: cells at g+1..g+3 across the gap are Air; `DoorFrame` jambs on both sides and a `DoorFrame` lintel at g+4 above the gap.
  - `door fits player and Pip`: `isStandable` is true for both feet cells in `doorCells`, for `doorFront` and `doorInside`; `findPath(world, doorFront, doorInside)` is non-null and passes through a door cell (this is the cell-based walking Pip and the player share).
  - `walks in with the stick`: a `Player` standing at `doorFront` moves with `setStick` toward the interior for 4 s of 1/60 s ticks, from each of 8 headings (the 4 axes and 4 diagonals, each aimed at the `doorInside` cell); it ends inside `interior` and never inside a solid cell.
  - `whole floor is connected`: `findPath` from `doorInside` to every cell of `floor` succeeds.
  - `bright inside`: at least 2 `Lamp` cells exist with an Air cell directly below; at least 2 windows of Glass; none of the lamp cells is reachable as a standing position.
  - `roof does not overhang`: no solid cell above g+4 lies outside the footprint rect.
  - `ceiling is closed`: every interior column has a solid cell at g+5.
  - `npcSpot is standable, inside, and not on the door line`.
  - `greetRect contains the interior and doorFront`.
  - `facing`: for each of the four facings the same assertions hold (use a 7×7 test spec).
  - `max height`: highest non-air y in the stamp is `<= g + 9`.
- [ ] **Step 2:** Run `npx vitest run tests/core/houses.test.ts`. Expected: FAIL. Implement. Expected: PASS.
- [ ] **Step 3:** Commit `feat: stamp houses with doors, windows, lamps and roofs`.

### Task 5: Pads, route, village and starter cottage

**Files:** Create `src/core/village.ts`, `tests/core/village.test.ts`. Modify `src/core/worldgen.ts` (call `buildVillage`).

**Interfaces:**
```ts
export interface VillageLayout {
  houses: HouseInfo[];                 // cottage first, then bakery, shop, farmhouse, granny
  route: Cell[];                       // ordered centre line, spawn -> village gate -> square; each step walkable
  routeCells: Set<number>;             // all PathStone-covered standing cells (3 wide), as world indices
  gate: Cell; square: Rect;
  farmPlot: Rect;                      // reserved, level, empty (step 2)
  quarry: Rect;
  stampedRects: Rect[];                // for tests and for the tree ring to avoid
}
export const GROUND_Y = 5;
export const VILLAGE_PLAN: { pad: Rect; square: Rect; farmPlot: Rect; quarry: Rect; waypoints: Array<[number, number]>; houses: HouseSpec[] };
/** Eases the ground to groundY inside rect; outside, height = clamp(natural, groundY - d, groundY + d) with d = Chebyshev distance to the rect, so neighbouring columns differ by at most 1. Clears Wood/Leaves/Water above, and whole trees that touch the rect (trunk column +-1). */
export function levelPad(world: World, rect: Rect, groundY: number): void;
/** Joins consecutive waypoints, 3 wide, PathStone on top, clears 2 blocks of headroom plus touching trees, and smooths heights so consecutive route cells differ by at most 1. Returns the ordered centre line. */
export function carveRoute(world: World, waypoints: Array<[number, number]>): Cell[];
export function buildVillage(world: World, spawn: { x: number; y: number; z: number }): VillageLayout;
```
The starter cottage uses `levelPad` at the spawn ground height with a 2-cell margin around its footprint, `stampHouse` (id `'cottage'`, wall Planks, door east) and a 2-wide PathStone link from `doorFront` to the spawn. The quarry is a 7×7 pit dug 3 below `GROUND_Y` with a 1-wide-step staircase down its west edge (walkable), Stone floor, a few loose Stone blocks. The square and the door strips (2 wide, from each `doorFront` to the square) are PathStone. The farm plot is levelled Dirt on top, otherwise empty, and exported for step 2.

- [ ] **Step 1:** Tests (use `generateWorld(2026)`):
  - `every door is reachable from spawn`: `findPath(world, spawnCell, doorFront, 40000)` is non-null for all 5 houses, and `doorInside` too.
  - `route is a chain of legal steps`: for consecutive `route` cells `canStep` holds, the first is the spawn cell, the last is in `square`, and its length is between 60 and 140 (a stroll, not a trek).
  - `route is 3 wide and PathStone`: for each route cell, the cell below is PathStone and at least one side neighbour is too; cells at feet and head height are Air (2 headroom).
  - `route goes over the hill`: the highest ground along `route` is at least 6 and at most 9, and the route never needs a step of more than 1.
  - `no half trees on the corridor`: no Leaves or Wood within the 5-wide corridor above the route (a cleared tree is cleared whole).
  - `pads are flat and skirts are gentle`: all ground inside `VILLAGE_PLAN.pad` is `GROUND_Y`; across the whole world no two cardinal-neighbour columns within the stamped rects plus 4 cells differ by more than 1.
  - `plan is tidy`: no two house footprints overlap and each is at least 2 cells from the others; all are inside the pad (or the cottage pad); the farm plot does not overlap any house; `quarry` is inside the pad.
  - `farm plot is reserved`: level, all Dirt on top, Air above, at least 12×9.
  - `quarry is walkable`: `findPath` from the shop's `doorFront` to the quarry floor centre succeeds.
  - `cottage is empty and near`: `cottage` interior has no non-Air cells, and its `doorFront` is within 12 cells of the spawn.
  - `final world differs from the meadow only at stamps` (from Task 3) now passes.
  - `no water inside any stamp`.
- [ ] **Step 2:** Run `npx vitest run tests/core/village.test.ts`. Expected: FAIL. Implement. Expected: PASS. If the numbers in `VILLAGE_PLAN` cause a failing test (a tree line or the hill's skirt in the way), nudge coordinates by a cell or two and keep the table in this plan updated in the same commit.
- [ ] **Step 3:** `npm test` and `npm run build`. Commit `feat: village, path and starter cottage in the generated world`.

### Task 6: Save v2 and migration

**Files:** Modify `src/core/save.ts`, `tests/core/save.test.ts`.

**Interfaces:**
```ts
export const SAVE_KEY = 'blockpals.save.v1';          // unchanged on purpose
export const BACKUP_KEY = 'blockpals.save.v1.backup'; // raw v1 JSON, written once before the first v2 write
export interface SaveData {
  version: 2; gen: number; seed: number;
  edits: Array<[number, number, number, number]>;
  inventory: Record<number, number>;
  player: { x: number; y: number; z: number };
  order?: number[];
  flags: { ledToVillage: boolean };
}
/** Accepts v1 and v2; always returns v2 (v1 migrated: gen 1, flags all false, everything else carried over untouched). */
export function parseSave(raw: string | null): SaveData | null;
export function migrateV1(v1: SaveDataV1): SaveData;
export function applySave(data: SaveData): { world: World; inventory: Inventory; spawn: Vec3; village: VillageLayout; flags: SaveData['flags'] };
```
Rules: edits are validated against the bounds of their version (v1: 48/16/48, v2: 96/20/96). `applySave` generates the world for `data.seed`, **then** replays edits, so his edits override stamps. Player position is kept if `isStandable`, otherwise the spawn. A v2 save with `gen` higher than `GEN_VERSION` still loads (edits replay) but is never overwritten by an older generator's version number. `storeSave` writes the backup first if there is no backup and the stored value parses as version 1.

- [ ] **Step 1:** Tests:
  - `migrates v1 to v2`: a v1 JSON with seed 2026, 40 edits, inventory, order and a player position returns `version: 2`, same seed, same edits array contents, same inventory and order, `flags.ledToVillage === false`.
  - `keeps every edit at its coordinates`: v1 edits at the corners (0,y,0), (47,y,47), a removed tree trunk at a v1 tree cell, and a placed block at (30,6,30) are all present at the same coordinates after `applySave`, with the same ids.
  - `edits win over stamps`: an edit that places Grass inside the cottage footprint and one that removes a PathStone cell survive replay (Grass is there, the PathStone is Air).
  - `keeps player position`: a v1 position on standable ground in the old meadow is kept exactly; a position inside a solid (made by stamps) falls back to the spawn.
  - `v1 edit outside 48 is rejected`: a v1 edit at x = 60 makes the save invalid (corrupt save starts fresh, as before).
  - `v2 edit up to 95/19/95 is valid`; 96 is not.
  - `accepts new block ids in edits and bag` (from Task 2).
  - `keeps a backup`: `storeSave` over a v1 value leaves `BACKUP_KEY` equal to that raw v1 string; a second write does not overwrite the backup; a full storage that throws on the backup still writes v2.
  - `replayed edits stay in later saves` (v1 behaviour kept).
  - `ignores corrupt save` (existing test) still passes.
  - `flags round-trip`: serialise then parse keeps `ledToVillage: true`.
- [ ] **Step 2:** Run `npx vitest run tests/core/save.test.ts`. Expected: new tests FAIL. Implement. `serialise(game, seed, flags)` gains the flag argument; `startAutosave` also saves when the flag changed (add it to its dirty snapshot). Expected: PASS.
- [ ] **Step 3:** `npm test`. Commit `feat: save version 2 with a safe migration from v1`.

### Task 7: Villager data, lines and greeting logic

**Files:** Create `src/content/villagers.ts`, `src/game/villagers.ts`, `tests/game/villagers.test.ts`. Modify `src/content/lines.ts`, `src/audio/voice.ts`, `tests/content/lines.test.ts`, `tests/audio/voice.test.ts`.

**Interfaces:**
```ts
export type VillagerId = 'bramble' | 'pebble' | 'fern' | 'willow';
export interface VillagerDef { id: VillagerId; name: string; house: HouseId; icon: string; feature: string; voice: { pitch: number; rate: number } }
export const VILLAGERS: VillagerDef[];             // 4 entries, house -> bakery, shop, farmhouse, granny
export const VILLAGER_LINES: Record<VillagerId, string[]>; // 2 to 3 short British lines each, at most 10 words
export class GreetTracker {
  constructor(now?: () => number);
  /** Call every frame. Returns the villager to greet, or null. */
  update(playerCell: Cell, houses: HouseInfo[], busy: boolean): VillagerId | null;
}
// Voice.say(text: string, style?: { pitch?: number; rate?: number }): void  (default pitch 1.1 rate 0.9 unchanged)
// New Pip LineKeys: 'letsMeetNeighbours', 'comeOn', 'thisWay', 'weAreHere', 'cosyHome' (his cottage), with icons 🏘️ 👋 ➡️ 🎉 🏠
```
Characters, each with one funny feature and one icon (original): **Bramble the Baker** 🍞 (jolly, round, white hat, flour puff on her nose; "Ooh, lovely! Welcome to my bakery!"), **Captain Pebble** ⛏️ (a moustache wider than his head, an orange helmet; "Ahoy, neighbour! Mind the shiny stones!"), **Fern the Farmer** 🥕 (a carrot tucked behind her ear, straw hat; "Hello, hello! My carrots say hi!"), **Granny Willow** 🧶 (a scarf so long it trails on the floor; "Hello, dear. What a lovely surprise!"). Lines promise nothing from steps 2 to 4 (no "buy", "quest", "bake you").

- [ ] **Step 1:** Tests:
  - `four villagers, one per house`: ids and houses are exactly those above; every `feature` is non-empty.
  - `lines are British, short and original`: every line passes the existing American-spelling check, has at most 10 words, ends with punctuation; none mentions a Minecraft term (reuse the banned list in `lines.test.ts`).
  - `every line key has an icon`.
  - `greets once on entering`: `update` with the player in the bakery's `greetRect` returns `'bramble'`, then `null` on the next calls while he stays.
  - `does not greet from outside`: the player 5 cells from the door gets `null`.
  - `cooldown 60 s`: leave and re-enter within 60 s (injected clock) gives `null`; after 60 s gives the id again.
  - `quiet while busy`: `busy: true` (a voice line playing, an overlay open) returns `null` and does not use up the greeting.
  - `one at a time`: standing on the border of two zones greets only one.
  - `Voice.say passes style`: a fake synth records `pitch` and `rate` for a styled call and defaults for an unstyled one.
- [ ] **Step 2:** Run `npx vitest run tests/game/villagers.test.ts tests/content tests/audio`. Expected: FAIL. Implement. Expected: PASS.
- [ ] **Step 3:** Commit `feat: villager data, hellos and greeting logic`.

### Task 8: Villager models and door emblems

**Files:** Modify `src/render/characters.ts`, `src/render/scene.ts` (an `addDecor` helper if needed). No unit test (rendering); a smoke assertion in e2e (Task 13) and the playtest.

**Interfaces:**
```ts
export function makeVillagerModel(id: VillagerId): THREE.Group;  // feet at y = 0, faces +z, about 1.8 blocks tall like the player; blocky; bright colours
export function makeEmblem(emoji: string): THREE.Sprite;         // canvas-drawn emoji, 1.2 blocks, always faces the camera, depthTest on
```
Each model is built from boxes in the same style as `makePlayerModel` (no new assets): Bramble pink-white apron, white chef hat, flour puff; Pebble broad, orange helmet with a lamp, huge grey moustache box; Fern green overalls, straw hat, orange carrot box behind the ear; Willow lilac shawl, grey bun, long scarf (a chain of 5 small boxes trailing on the floor). All use `MeshLambertMaterial`; a gentle idle bob (a sine, in the render loop only, no logic). Emblems float above each door: 🏠 cottage, 🍞 bakery, ⛏️ shop, 🥕 farmhouse, 🧶 granny. They are the "sign" so nobody has to read.

- [ ] **Step 1:** Implement the five models/emblems.
- [ ] **Step 2:** Manual check at `npm run dev -- --host` with `?debug` (a throwaway screenshot via Playwright MCP at each house door is enough). Each villager is distinguishable from 6 blocks away and nothing looks frightening (big friendly eyes, smiles).
- [ ] **Step 3:** `npm run build`. Commit `feat: villager models and picture signs`.

### Task 9: Pip leads him to the village

**Files:** Create `src/game/lead.ts`, `tests/game/lead.test.ts`. Modify `src/game/pal.ts`, `tests/game/pal.test.ts`.

**Interfaces:**
```ts
export const LEAD_SPEED = 3;              // blocks/s; the player walks at 3.5
export const LEAD_GAP_MIN = 3; export const LEAD_GAP_MAX = 8; // Pip stays this far ahead along the route
export const LEAD_OFFER_AFTER_ACTION = 8; export const LEAD_OFFER_AFTER_LOAD = 25; // seconds
export const LEAD_GIVE_UP = 90;           // seconds of waiting with no progress

export type LeadState = 'waiting' | 'leading' | 'arrived' | 'gaveUp' | 'done';
export class LeadToVillage {
  constructor(route: Cell[], square: Rect, flagSet: boolean);
  readonly state: LeadState;
  /** dt seconds; playerCell/playerActive from the game; paused while an overlay is open. */
  update(dt: number, playerCell: Cell, active: boolean, paused: boolean): LeadEvent | null;
  /** Where Pip should be heading now (or null when not leading). */
  target(): Cell | null;
  takeFlagSet(): boolean;   // true once, when state becomes 'arrived'
}
export type LeadEvent = 'start' | 'comeOn' | 'thisWay' | 'arrive' | 'giveUp';

// Pal
class Pal { setLead(route: Cell[] | null): void;  hush(ms: number): void; ... }
```
Behaviour: `flagSet` true means the state starts `done` and nothing ever happens. Otherwise after `LEAD_OFFER_AFTER_ACTION` s following his first action (or `LEAD_OFFER_AFTER_LOAD` s after load) it emits `'start'` (Pip says `letsMeetNeighbours`). If he is already inside the village pad the lead is skipped and the flag is set at once (`arrived` without speech). Pip then walks the route from the route cell nearest to the player, so an old save that starts anywhere still works. Pip never gets more than `LEAD_GAP_MAX` ahead: he waits; after 6 s of waiting he says `comeOn`; after 15 s `thisWay`; after `LEAD_GIVE_UP` s with no progress he emits `giveUp`, returns to normal following, and does not try again this session. If the player overtakes Pip, Pip speeds up to his follow speed rather than blocking. In `lead` mode `Pal.update` never teleports (the 10-block teleport is for following only), never enters a cell the player stands in, and uses the precomputed route cells (no A*). When the player is in the village square or Pip reaches the last route cell with the player within 8, it emits `arrive` (`weAreHere`), `takeFlagSet()` becomes true, Pip switches back to following.

- [ ] **Step 1:** Tests `tests/game/lead.test.ts` (a straight fake route of 60 cells):
  - `does nothing when the flag is set`.
  - `offers 8 s after the first action, or 25 s after load`.
  - `skips and sets the flag when he is already in the village`.
  - `starts from the nearest route cell`: a player at route[30] makes Pip's first target at or after index 30.
  - `waits when he is too far behind`: simulated player standing still; Pip's target stops advancing at `LEAD_GAP_MAX` and `comeOn` then `thisWay` are emitted at 6 s and 15 s.
  - `speeds up and never blocks when overtaken`: with the player 4 ahead of Pip, Pip's target index does not stay behind the player and Pip's cell is never the player's cell.
  - `gives up after 90 s and does not retry this session`; `flag stays false`.
  - `paused while an overlay is open`: no events, no progress, no timers.
  - `arrives`: the player walking along the route behind Pip reaches the square; `arrive` is emitted once and `takeFlagSet()` returns true exactly once.
  - `never moves the player`: the controller holds no reference to `Player` (type check) and `update` returns only events; assert by construction.
  Tests in `tests/game/pal.test.ts`:
  - `lead mode never teleports`: the player 30 cells away, Pip keeps walking the route.
  - `lead mode follows precomputed cells and stays on walkable ground` over a real generated route.
  - `follow resumes after setLead(null)` with the old behaviours (teleport at 10) unchanged.
  - `hush(ms) delays chatter` (Pip's own idle/collect lines wait; `always` lines like `breakTime` still go).
- [ ] **Step 2:** Run `npx vitest run tests/game`. Expected: new tests FAIL. Implement. Expected: PASS.
- [ ] **Step 3:** Commit `feat: Pip leads him to the village once`.

### Task 10: Camera in and around houses

**Files:** Create `tests/render/cameraVillage.test.ts`. Modify `src/render/cameraRig.ts` only if a test finds a real fault.

Uses `CameraRig`, `clampDistance`, `CLOSE_DISTANCE`, `PITCH_MIN`, `PITCH_MAX`, `lookDir`, `DRAG_RADIANS_PER_WIDTH` from PR #3, and `generateWorld(2026)`. The eye is the feet position plus 1.6 (check the constant in `scene.ts` and reuse it).

- [ ] **Step 1:** Tests:
  - `drag-to-turn works in close mode inside a house` (required): for each of the five houses, put the eye at the interior's centre, run `rig.update` until settled; assert `rig.close` is true or `rig.distance < MAX_DISTANCE`; then `rig.drag(+200, 0, 1000)` changes `yaw` by `200 * DRAG_RADIANS_PER_WIDTH / 1000` (within 1e-6), a vertical drag changes `pitch` and is clamped at `PITCH_MIN` and `PITCH_MAX`, and after each drag and `update` the `forward` vector has rotated accordingly (dot product with the old one less than 1) while the eye did not move.
  - `camera is never inside a block, inside any house`: for every `floor` cell of every house, 8 yaws (every 45°) × 3 pitches (`PITCH_MIN`, `DEFAULT_PITCH`, `PITCH_MAX`) after `update`, the block at the floor of `rig.position` is not solid and not Glass-blocking, and `rig.position` is inside the house's interior bounds when the eye is.
  - `camera never clips outside either`: for the 60 standable cells within 3 cells of each house's outer wall (including the door front and cells behind the house), the same check holds, so a roof or wall behind him pulls the camera in rather than letting it pass through.
  - `door-to-room transitions`: walk the eye in 0.25 steps from `doorFront` to `doorInside` to the middle with a fixed yaw towards the room, and check that the camera never ends inside a solid and `distance` never jumps up by more than the ease rate allows in one `update(world, eye, 1/30)`.
  - `roof does not trap the camera`: with the eye on the top roof layer (stand on a roof cell) the camera is above the roof, not inside it, at `DEFAULT_PITCH`.
  - `close mode is bright`: assert the interior has at least 2 lamps (reuse Task 4) so close mode never looks at a dark box (documents the rule).
- [ ] **Step 2:** Run `npx vitest run tests/render/cameraVillage.test.ts`. Expected: either PASS (the rig already handles it) or FAIL with a concrete cell, yaw and pitch. Fix `cameraRig.ts` only for a reproduced failure and keep the existing `tests/render/cameraRig.test.ts` green.
- [ ] **Step 3:** Commit `test: camera stays out of walls and roofs and turns inside houses`.

### Task 11: Render budget and chunk culling

**Files:** Create `src/render/chunkCull.ts`, `tests/render/budget.test.ts`, `tests/render/chunkCull.test.ts`. Modify `src/render/scene.ts`.

**Interfaces:**
```ts
export const CULL_RADIUS = 64; // fog far is 40; a chunk's farthest corner can be 23 away from its centre
/** Chunk keys whose centre is within radius + half a chunk diagonal of (x, z). */
export function visibleChunks(sizeX: number, sizeZ: number, x: number, z: number, radius?: number): Set<string>;
// GameScene: triangleCount() unchanged; new stats(): { chunks: number; visible: number; triangles: number; drawCalls: number }
```
`scene.ts`: do not create a `Mesh` for a geometry with 0 indices (most chunks have no transparent faces; this halves draw calls). Each frame (or when he moves chunk) set `mesh.visible` from `visibleChunks` around the camera. Camera `far` 80 to 64.

- [ ] **Step 1:** Tests:
  - `triangle budget` (`budget.test.ts`): for `generateWorld(2026)`, summing `buildChunkGeometry` over all 36 chunks gives **total at most 110,000 triangles** and **no chunk above 12,000** (an estimate of about 45,000 total; the budget leaves 2× headroom for what he builds). The test prints the real numbers.
  - `build time`: generating the world and meshing all chunks takes under 2.5 s in Vitest on the dev machine (a loose guard; the real check is on the tablet).
  - `mesh count`: the number of chunks that would create a transparent mesh is less than 36 (empty ones are skipped).
  - `visibleChunks`: near the middle returns the surrounding chunks; in a corner returns at most 9 of the 36; moving 16 cells changes the set by one row or column; an invalid or NaN position returns all chunks (fail open, never a blank world).
  - The existing mesher tests pass unchanged.
- [ ] **Step 2:** Run `npx vitest run tests/render`. Expected: new tests FAIL. Implement. Expected: PASS.
- [ ] **Step 3:** Commit `perf: skip empty meshes and cull far chunks`.

### Task 12: Wire it together

**Files:** Modify `src/main.ts`, `src/render/scene.ts` (add villagers/emblems), `src/ui/styles.css` only if the bubble needs it.

- [ ] **Step 1:** `main.ts`: `applySave`/`generateWorld` return `village` and `flags`. Add villager models at each house's `npcSpot` facing `doorInside` (cottage has none) and emblems above each door. Add a `GreetTracker`, called once per frame with `game.player.feetCell()`, `busy = hud.blockingOverlayOpen || voice is speaking` (use a short timer from the last `say`), that on a hit does `voice.say(line, villager.voice)`, `hud.showBubble(icon, 'Hi!')`, and `pal.hush(5000)`. Add `LeadToVillage(village.route, village.square, flags.ledToVillage)`; each frame call `update(dt, playerCell, gameActiveThisFrame, game.paused)`; map events to Pip's lines (`letsMeetNeighbours`, `comeOn`, `thisWay`, `weAreHere`), call `pal.setLead(route)` on `start` and `setLead(null)` on `arrive` and `giveUp`; when `takeFlagSet()` is true set `flags.ledToVillage = true` and force a save. Add the villagers' cells to `occupied()` so nothing is built on one. The cottage's first entry makes Pip say `cosyHome` once per session.
- [ ] **Step 2:** Debug hooks (dev and `?debug` only): `village()` (the layout as plain data), `flags()`, `saveNow()`, `teleport(x, y, z)` (sets the position to a standable cell, for e2e only), `stats()` (chunks, triangles, draw calls, fps), `worldSize()`.
- [ ] **Step 3:** Safety checks in code review: an overlay (craft, grown-ups) pauses the lead and the greeting; a hold or drag in progress never triggers a villager greeting to cancel it; no handler on the canvas is added or changed.
- [ ] **Step 4:** `npm test && npm run build`. Expected: all pass. Run `npm run dev` and look at it once with the Playwright MCP tool: spawn, cottage, path, village, one house. Commit `feat: bigger world, village, villagers and Pip's lead wired in`.

### Task 13: Browser story (e2e)

**Files:** Create `e2e/village.spec.ts`. Reuse the helpers from `e2e/smoke.spec.ts` (`ready`, `press`, `drag`, `nearbyGround`); move shared helpers to `e2e/helpers.ts` if both files need them.

The test uses real touch for the gestures it can and `__debug.game.applyIntent({ kind: 'walk', to })` for long walks (the same code path a tap produces), and checks positions with `__debug.playerPos()`.

- [ ] **Step 1:** Tests (each starts at `/block-pals/?debug` with a fresh `localStorage`, unless it injects one):
  - `new world is 96 wide and loads fast`: `worldSize()` is 96/20/96; time from navigation to `window.__debug` is under 8 s on the CI runner (loose); `stats().triangles` under 110,000; no console errors.
  - `walk the path to the village and home`: walk to each `route` waypoint in order with `walk` intents (waiting for arrival, 40 s cap each), reach the square, then walk back to the spawn cell. Assert both ends are reached and Y never jumps by more than 1.5 between samples.
  - `enter each house, turn the view, come out`: for each of the five houses: walk to `doorFront`, then to `doorInside`, then to the floor centre; assert the player is inside the interior rect; do a real touch drag of 400 px sideways on the world (starting over a block he cannot dig by accident, or use `drag` from smoke); assert `camera().yaw` changed by more than 0.8 rad, the player did not move, the bag did not change, and `camera().position` is not inside a solid block (`world.get` at its floor cell is non-solid); then a vertical drag changes `pitch` within bounds; then walk out to `doorFront`.
  - `a villager says hello`: entering the bakery shows the bubble (`.bubble` visible) with 🍞 within 2 s and no other bubble stays up for more than 4 s.
  - `Pip leads once`: with a fresh save, wait for the lead (`pal` target set / Pip's position moving along the route; shorten the timers with `?debug&fastlead` if the flags exist, or poll up to 40 s); follow by walking the route; on arrival `flags().ledToVillage` is true; reload: `flags()` still true and Pip does not lead again within 40 s.
  - `Pip's lead does not fight taps or drags`: during a lead, a tap-to-walk elsewhere still moves him, a drag turns the camera, and a hold on a block digs it; the player position is never changed by Pip.
  - `save and reload keeps position and edits`: inside the cottage give 5 planks, place one with a quick tap, call `saveNow()`, reload; the player position is within 0.01 of before, the placed block is still there, the bag has 4 planks left.
  - `an old v1 save loads`: use `page.addInitScript` to put a version 1 save in localStorage (seed 2026, edits including one at (47,6,47) and one at (30,6,30), a bag, a position at (24.5, 6, 24.5)); the page loads with `worldSize()` 96; the edits are at their coordinates; the position is the saved one; `localStorage` now holds a version 2 save and the backup key holds the v1 string.
  - `walled-in player can dig out`: place planks across a house's doorway from inside (give 4 planks, build at the two door cells in front), then press-and-hold dig one; he can walk out. (Collecting is always allowed.)
- [ ] **Step 2:** Run `npm run e2e`. Expected: all pass, including the v1 smoke tests.
- [ ] **Step 3:** Run the whole check: `npm test && npm run build && npm run e2e`. Commit `test: browser story for the bigger world`.

---

## Self-review against the spec

§7d step 1 "done when":
- *He can walk the path to the village and home*: Task 5 (route chain, doors reachable by A*, path 3 wide, steps at most 1) and Task 13 (walk there and back).
- *Walk into every house*: Task 4 (door 2×3, stick and A* fit, Pip fits), Task 5 (reachable), Task 13 (enter each).
- *Turn the view inside it*: Task 10 (the required close-mode drag test, no clipping through walls or roofs) and Task 13 (real drag in each house).
- *World still loads fast on the Tab A8 (30 fps target)*: Task 11 (triangle and chunk budget, culling, build time guard) plus the manual fps and load check below.
- *Saves/loads*: Task 6 (v2, migration, backup, edits win) and Task 13 (reload keeps position and edits; an old v1 save loads).
- Also in the step text: the meadow grows (Task 3), the village and path are generated (Task 5), houses with doors (Task 4), his starter cottage (Task 5), Pip leads him the first time (Task 9). "No new rules to learn yet" holds: nothing new to tap, no coins, no quests.

Anti-goals (§4): nothing scary, no darkness (lamps, windows, lighting rule, a test that rooms have lamps); no villager chases, moves or shouts; nothing hurt and nothing lost (old saves migrate with a backup, his edits override stamps, nothing is locked and he can dig out of any room); nothing needs reading (every line has a picture, each house has an emblem sign, and nothing needs a number); no frustration (2-wide doors, tap-to-walk through them, Pip gives up politely, no dead end); no ads, links, purchases or data; everything original; British English enforced by test.

Out of scope on purpose: fields, animals, food, coins, shops, hearts, quests and any villager visiting his cottage (steps 2 to 4); the Underground; a map or "home" button.

## Performance numbers

| | v1.2 | Step 1 |
|---|---|---|
| World | 48×16×48 | 96×20×96 |
| Chunks | 9 | 36 (6×6), of which about 9 to 16 are in view and fog |
| Triangles in the whole world (estimate / budget) | about 12,000 | about 45,000 / 110,000 |
| Draw calls worst case | 18 | 36 solid + a few transparent (empty meshes skipped), and far chunks hidden |
| Fog / camera far | 20..40 / 80 | 20..40 / 64 |
| Load | about instant | one-off world generation plus 36 chunk meshes, expected well under 1 s on a desktop; checked on the Tab |

Fallback if the tablet misses the numbers (decide from the checklist, do not build ahead): mesh chunks lazily (nearest first, one per frame) and shrink the camera `far`; do not lower the pixel ratio below the v1 cap without asking.

## Parent playtest checklist (Galaxy Tab A8, after deploying this step to GitHub Pages)

Use `?debug` once for the fps counter (top corner), then play without it.

1. **Speed.** Fresh page: the world appears in under 3 seconds. In the meadow, then on the path, then in the village square, then inside a house: the fps counter stays at 30 or above (write down the lowest you see). Turn the view around in the square, which is the worst case.
2. **Old save.** On the tablet that already has his world: open the new version before anything else. His blocks and position are all there; the cottage and path are new; nothing he built is missing.
3. **Starter cottage.** He can walk in, turn the view inside, and it is bright, with a lamp and windows.
4. **Pip leads.** On a fresh game, a few seconds after he starts, Pip says "Let's go and meet the neighbours!" and walks off along the path. He can follow, wander off, tap, dig, or turn the view and nothing breaks. If he ignores Pip, Pip gives up quietly after a minute and nothing is nagging him.
5. **The path.** He can walk the path to the village and back with taps alone, with no steps that stop him.
6. **Each house.** Bakery, block shop, farmhouse, Granny's cottage: he walks in through the door (also with the pad), the neighbour stands inside and says hello in their own voice with a picture bubble; he can drag to turn the view inside and the camera never goes through a wall or roof.
7. **Voice.** All four hellos and Pip's lines are British, clear and not too long.
8. **Looks.** Nothing looks dark, odd or scary; each neighbour is funny, not frightening; he can say which house is which from the picture signs.
9. **Build in a house.** In the cottage, place and dig blocks; reload the page; they are still there.
10. **Controller.** Walk the path and enter a house with the pad stick; the camera follows as in v1.2.
11. **Batteries and heat.** After 10 minutes the tablet is not hot and the fps is the same as at the start.

## Questions for the parent

Most important first. Each has my answer built in, so none of them blocks the work.

1. **His existing world.** The new starter cottage and the path are built over the old meadow near the spawn. If he has built something on that exact spot, his blocks stay and the cottage is built around them (his blocks always win), so the cottage may look a little broken there. Is that fine, or should I check the spot on his tablet before the first playtest and move the cottage if it is in use? *(My call: leave it, and tell you where the cottage is.)*
2. **World size.** 96 × 96, four times the old area, with the village at the far east. Do you want it bigger or smaller, or is the 30 fps check on the tablet the only judge? *(My call: 96 × 96, and shrink it only if the tablet struggles.)*
3. **Hellos.** The neighbours say hello on their own when he walks into their house. That means a voice he did not ask for. Would you rather the neighbour only speaks when he taps them? *(My call: hello once on entering, and no repeat for a minute.)*
4. **If he ignores Pip.** Pip leads once, gives up after a minute and tries again next time he plays until he has arrived once. Is that right, or should Pip ask only one time, ever? *(My call: asks once per play session until he has reached the village.)*
5. **Walking through people.** Neighbours have no collision (he and Pip can walk through them, as through Pip today). Is that all right for now, or should they be solid? *(My call: not solid, placed away from the doorway.)*
