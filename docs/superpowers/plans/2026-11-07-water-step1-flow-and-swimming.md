# Water Step 1: Flowing Channels and Swimming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ponds stay still until our player lets water out. Digging a gap in a pond bank makes water run gently downhill a few blocks, thin out and settle; plugging the gap with a block makes it drain away again. He can swim: tap to swim across the pond, drag to turn, slower in water, floating up by himself when he stops, never drowning, always able to climb out (including out of a flooded pit). Underwater the view has a soft blue tint, never dark, and the camera's close mode keeps working. Pip waits at the shore and cheers; villagers never enter water. The flow rules are built so that a walled channel can later carry water to a farm field. The bucket is **not** in this step (outline only, step 2).

**Architecture:** Same layering as v1. Water behaviour is **pure, DOM-free logic in `src/core/water.ts`** (a deterministic solver) and `src/core/waterSim.ts` (a bounded ticker that applies the solver's answer to the world a few cells at a time). Both are unit-tested with Vitest, including on the real generated pond. **Flowing water is derived state:** it is a pure function of the solid blocks and the water sources (the pond), so it is recomputed on load and never saved. The world gets `setDerived()` (writes a cell and notifies the renderer but is not recorded as an edit). Swimming is a new mode of `Player` plus swim-aware pathfinding; the camera rig needs no change because rays already ignore water. Rendering gains a separate water mesh per chunk (rebuilt alone, so flow ticks never rebuild the solid mesh), an animated water material and an underwater tint. `main.ts` only wires.

**Tech Stack:** TypeScript 5 (strict), Vite 8, Three.js 0.187, Vitest 5, Playwright 1.65, Web Audio API. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-05-block-pals-design.md` (§4 anti-goals, §5 constraints, §7a hold-to-dig, §7c smart camera, §7e water).

**Dependencies (must be merged to `main` first):**
- **Village step 1 (`docs/superpowers/plans/2026-11-07-village-step1-bigger-world.md`) must land first.** It brings the 96 × 20 × 96 world, `core/bounds.ts` (no more 46/47 literals in `player.ts`/`game.ts`), save version 2 with migration, and block ids 12 to 15. This plan appends its ids after them (16 to 18), and its tests use `generateWorld()` so they follow the world size. The pond stays at (14, 32), clear of every village stamp.
- Already on `main`: `cameraRig.ts` (§7c), hold-to-dig (§7a), 99-per-kind bag.
- If water must land before the village: use ids 12 to 14 and let the village renumber its four. This is safe because flowing water is never saved and the source block keeps its id 7.

## Global Constraints

Copied from the spec and the village plan, with what water adds marked **changed**.

- British English in every string and voice line. `tests/content/lines.test.ts` keeps enforcing it and covers the new Pip lines.
- No reading needed: every spoken line has a picture. Nothing in this step needs a number.
- Always daytime. **Nothing dark**: the underwater tint and fog are a bright blue (a test asserts a minimum brightness), the sky stays bright blue.
- Nothing scary, nothing hurt, nothing lost. **No drowning, no health, no timer, no air bar.** Water never removes a block he built. A block he places always stops water.
- **Never stuck:** from any water cell, including a flooded pit, he reaches dry land by walking, tapping, or the automatic rescue (Task 8). Rescue never takes things from him.
- No network calls at runtime, no analytics. Works offline.
- Target device: Galaxy Tab A8, landscape, Chrome, a steady 30 fps. Pixel ratio capped at 1.5. No real-time shadows. **The flow simulation is bounded: at most 24 cell changes per tick, 4 ticks per second, 400 flow cells in the whole world, and no cost at all while nothing is changing.**
- Touch targets at least 88 CSS px. **No new buttons in this step.** Quick tap walks (or swims), press and hold digs, drag turns (§7a, §7c); none of these may change.
- Saves keep working (**changed**): no new fields; an old save (v1 or v2) loads and the water settles on load. Block ids are append-only. A flow id never appears in a save.
- Water cannot be dug (§7a). Flowing water cannot be dug either; it is plugged by placing a block. Bedrock cannot be dug.
- Original assets only: the water look is drawn in code.

## Review Focus

- **Never stuck in or under water:** a flooded pit with walls, a pit where the water is more than one block below the rim, a one-wide channel, a pond edge with a 2-high bank, water placed on top of him by a plug removal. Each has a test that ends with him on dry land (Tasks 7 and 8).
- **Flood bound:** digging every bank block round the pond, digging a long trench downhill, removing a pond-bed block, and removing a plug repeatedly must all stay under 400 flow cells and settle. The solver is the only place that decides water, so the cap lives there (Tasks 3, 4, 5).
- **Order independence and determinism:** the same blocks give the same water, whatever order the edits came in. Reloading gives the same water as before the reload (Tasks 3 and 11).
- **Losing his builds or his bag:** flow ids must never reach `edits()`, the saved file or the inventory. A flow cell may never replace a solid block (Tasks 2, 4, 11).
- **Existing controls:** tap never digs, hold digs, drag turns, in water as on land. Hold on water still does nothing (no scooping before the bucket).
- **Camera:** the camera must never end up inside a block while swimming near a bank, and close mode must engage and release in a flooded pit (Task 10).
- **Tablet performance:** tick cost, water mesh rebuild count per frame and triangle budget are unit-tested; fps is checked by hand (checklist).
- **Pathfinding side effects:** `isStandable` changes meaning for deep water only. Pip, villagers and the pit lift all use it; none may place anything in deep water (Task 6).

## Decisions made in this plan

Marked **(my call)** where the spec leaves room. The open ones are at the end as "Questions for the parent".

| Topic | Decision |
|---|---|
| Water blocks | Existing `Water` (id 7) is a **source, level 4**, full height: the pond, unchanged in look and place. Append `WaterFlow3`, `WaterFlow2`, `WaterFlow1` as ids 16, 17, 18 (heights 0.75, 0.5, 0.25). None is collectable. Names in code: `isWater(id)` (any of the four), `waterLevel(id)` (0 for non-water). |
| What a source is | Every `Water` cell. Sources are never created or removed by the simulation. Ponds can never drain. A bucket (step 2) will create sources by pouring, which are ordinary edits. (my call) |
| Flow rule (the whole definition) | The target field `T` is the **least fixpoint** of: (a) every source has level 4; (b) a non-solid cell whose upper neighbour is water gets level 3 (water falls and renews itself); (c) a non-solid cell gets `level(n) - 1` from a horizontal neighbour `n` with `level(n) >= 2` that **cannot fall** (its lower neighbour is solid or a source); (d) **channel rule:** if the receiving cell has solid blocks on both of its sides perpendicular to the direction of travel, it gets `level(n)` (no thinning) as long as `level(n) >= 2`. Rules (a) to (d) only raise levels, so the answer is unique and independent of processing order. |
| Reach in the open | A source level 4 gives 3, 2, 1 in open ground: **3 cells** sideways, then it stops. Down a slope the water falls and renews to 3, so it runs "a few blocks" per step down, never uphill. (my call) |
| Channel reach | A trench walled on both sides keeps its level, so it can be as long as he digs it (bounded by the 400-cell cap). This is how a channel from the pond later reaches a field. At an open end the water thins out over 3 cells. (my call) |
| Cap | The solver visits cells in a canonical order (shortest step count from a source, then cell index) and stops adding cells at `MAX_FLOW_CELLS = 400`. (my call) |
| Digging opens a channel | He holds on a bank block next to the pond (existing hold-to-dig). The block becomes Air; the solver sees a non-solid cell beside a source and the water appears over the next ticks. The pond shore is sand at the pond's own surface height, so a one-block dig lets water out immediately. |
| Plug and drain | Placing any block (existing quick tap with a block selected) into a flow cell or the gap makes the solver remove everything that no longer connects to a source. The water **retreats from the far end first**, at most 24 cells per tick, so it drains in a second or two. Removing the plug lets it run again. There is no other drain tool in this step. (my call) |
| Applying the answer | `WaterSim` keeps the world's flow cells equal to `T` by changes at most 24 per tick, 4 ticks per second: growing nearest-the-source first, shrinking farthest-first. When equal and nothing has changed it does no work. |
| Solid blocks stop water | Water passes through non-solid blocks (Air; later plants). Leaves, glass and every solid block stop it. |
| Wet states | `shallow`: a flow cell with solid below and no water above (at most 0.75 tall). Walkable and slow ("wading"). `deep`: a source cell, or a flow cell with water above, or a flow cell with no solid below (a falling column or a flooded pit). **Swimming.** (my call) |
| Swimming speed | 55 % of walking speed (1.9 blocks/s). Wading 80 % (2.8). Controller stick the same factors. |
| Buoyancy | No input: he floats to the surface. Surface = top of the water column at his x, z (top of the highest wet cell). He floats with his feet 0.9 below the surface (eyes 0.7 above the water at EYE_HEIGHT 1.6). After he stops, he first sinks gently for up to 0.6 s (at most 0.5 block, 0.6 b/s) and then rises at 1.0 b/s, a little bob. No dive control in this step: underwater views come from the bob, flooded pits and deep ponds. (my call) |
| Climbing out | From a swim cell he steps to an adjacent dry standable cell whose floor is at most **1 block above the water surface** (so a bank one block higher than the pond works). Stepping in from the shore: any walkable neighbour whose feet cell is a wet cell at the same height or one lower. |
| Rescue | If he has been in deep water for 4 s without a way out (no swim route to a climb-out cell within 12 steps, found by the same bounded search the tap uses), or for 10 s in any case without moving, the game lifts him to the nearest dry standable cell (the existing pit lift, generalised) and Pip says "Up you come!". The lift uses the same search as the pit lift (radius 8, never a tree top, never deep water). Nothing is taken from him. |
| Pathfinding | `isStandable` is unchanged except it now also rejects deep water (it already rejected `Water`). New `isSwimmable`. A tap first searches the dry route (`pathTowards`, existing); only if that does not reach the tapped spot, or is longer than 20 steps, a swim-enabled search runs and the route with the lower cost wins (swim step cost 2, dry step cost 1). So he walks round a small pond but swims a big gap; a tap on the water swims there. Tapping submerged ground swims to the surface above it (never forces a dive). (my call) |
| Pip | Pip never swims in this step: he uses dry/wading routes, waits at the nearest shore cell to him and says one line the first time he enters the water. His teleport (existing) never puts him in deep water. (my call) |
| Villagers | Any path or placement for villagers uses `isDry(cell)` (no wet cell at feet or head). Villagers are still at this stage, so this is a rule plus a test for the farm and quest steps. |
| Rendering water | A separate `water` geometry per chunk, rebuilt on its own. Top faces are lowered by level (1.0, 0.75, 0.5, 0.25). Side faces are drawn only against non-water neighbours or a lower neighbour. Flowing cells use a streak texture oriented towards the lower neighbour; sources use the existing ripple. Two animation frames swapped by time on one material: no rebuild, no shader. The material is double sided so the surface shows from underneath. |
| Underwater look | When the camera point is in a wet cell: a full-screen overlay `rgba(70, 160, 255, 0.28)` fades in over 0.15 s and fog becomes a bright blue (`0x6fc3ff`) with near 3 and far 26. Out of water it fades back. Never darker than the sky. |
| Sounds | Short, quiet, in the existing `blip` style: `sfx.splash` on entering deep water (a falling pair of bubbly blips), `sfx.trickle` when water starts to flow from his dig (three tiny falling notes). No ambient loop. Throttled: splash at most once per 0.6 s, trickle at most once per 2 s. (my call) |
| Saving | **Not saved. Recomputed.** Justification: the water is a pure function of the blocks and the sources, both already saved (seed plus edits); so saving it too would be redundant data that could disagree with the blocks (a plug removed in an old save with water still saved). On load, edits replay and then `WaterSim.settleAll()` runs the solver and applies the whole answer at once, before the first frame. No version bump and no migration. A save written during a flow is the same as one written after it. (my call) |
| Bucket (step 2, outline only) | A craftable `Bucket` item that can be filled by tapping a source or deep flow cell, carried (shown in the hotbar with a full or empty picture), and poured onto a cell to make a new source. Pouring is an ordinary edit of id 7, so saving, solving and draining (plug) need no new rules. Scooping a source that feeds a channel dries it, which is the real drain tool. Details in its own plan. |

## Who builds what

Every task is reviewed by the other agent before merging. Codex is used only for small, pure-logic tasks with exact interfaces and tests; Claude builds anything that touches the render loop, `Player`, the camera, audio or wiring. Codex is invoked with `codex exec --full-auto "<task text from this plan + spec path>"`.

| Task | Builder | Reviewer |
|---|---|---|
| 1 Water block ids and helpers | Codex | Claude |
| 2 `World.setDerived` | Codex | Claude |
| 3 Flow solver (`core/water.ts`) | Codex | Claude |
| 4 Bounded simulation (`core/waterSim.ts`) | Codex | Claude |
| 5 Pond story: dig, flow, plug, drain (real world) | Claude | Codex |
| 6 Swim-aware pathfinding | Codex | Claude |
| 7 Swimming in `Player` | Claude | Codex |
| 8 Game: swim taps, rescue, Pip, villagers | Claude | Codex |
| 9 Water mesh | Claude | Codex |
| 10 Scene: material, dirty queue, underwater tint, camera | Claude | Codex |
| 11 Save and load | Codex | Claude |
| 12 Sounds and Pip lines | Claude | Codex |
| 13 Wire it together | Claude | Codex |
| 14 Browser story (e2e) | Claude | Codex |

## File Structure

New or changed. Everything else stays as on `main` after village step 1.

```
src/core/blocks.ts          CHG  append WaterFlow3/2/1 (16..18), isWater(), waterLevel(), isDeep helpers
src/core/world.ts           CHG  setDerived(), onWaterChange(); edits() never holds flow ids
src/core/water.ts           NEW  solveWater(): pure target field; constants
src/core/waterSim.ts        NEW  WaterSim: ticker, settleAll, stats
src/core/pathfind.ts        CHG  isDeepWater, isSwimmable, isDry, swim option for pathTowards/findPath
src/core/placement.ts       CHG  placing into flow cells allowed; canCollect refuses water
src/core/save.ts            CHG  applySave calls settleAll; serialise filters flow ids (defensive)
src/game/player.ts          CHG  swim state, speeds, buoyancy, climb out
src/game/game.ts            CHG  swim policy for taps, rescue timer, events 'splashed' 'rescued'
src/game/pal.ts             CHG  never in deep water; one water line
src/content/lines.ts        CHG  new Pip LineKeys (waterSplash, waterTrickle)
src/audio/sfx.ts            CHG  splash, trickle
src/render/atlas.ts         CHG  water textures (ripple frames A/B, streak frames A/B)
src/render/mesher.ts        CHG  water geometry split out of the transparent pass
src/render/scene.ts         CHG  water mesh per chunk, dirty-chunk queue, water material, underwater state
src/render/underwater.ts    NEW  UnderwaterState (pure): in-water test for camera point, fade value, fog numbers
src/main.ts                 CHG  WaterSim wiring, tick, overlay div, debug hooks
tests/core/{water,waterSim,pathfindSwim,pondStory,save}.test.ts
tests/game/{playerSwim,gameSwim,pal}.test.ts
tests/render/{mesherWater,underwater,cameraWater}.test.ts, tests/content/lines.test.ts
e2e/water.spec.ts
```

---

### Task 1: Water block ids and helpers

**Files:** Modify `src/core/blocks.ts`, `src/render/atlas.ts` (the tile mapping only: flow ids map to the water tile for now), `tests/core/world.test.ts` (one test).

**Interfaces:**
```ts
// appended after the last existing id (Lamp = 15 once village step 1 has landed). Existing ids MUST NOT change.
export enum BlockId { /* ... */ WaterFlow3 = 16, WaterFlow2 = 17, WaterFlow1 = 18 }
export function isWater(id: BlockId): boolean;      // Water or any flow id
export function waterLevel(id: BlockId): 0 | 1 | 2 | 3 | 4; // Water = 4, WaterFlow3 = 3, ... non-water = 0
export function flowId(level: 1 | 2 | 3): BlockId;
```
Flow blocks: `solid: false, collectable: false, transparent: true, icon: 'water'`.

- [ ] **Step 1:** Tests: ids 0 to 15 are unchanged (assert the numbers); `isWater` is true for 7, 16, 17, 18 and false for Air, Glass, Leaves; `waterLevel(Water) === 4`; `flowId(2) === WaterFlow2`; a flow id is not collectable and `Inventory.add` ignores it (the bag never holds water); `isBlockId` in `save.ts` accepts them (no throw) but `validInventory` rejects them.
- [ ] **Step 2:** Run `npx vitest run tests/core/world.test.ts`. Expected: FAIL. Implement. Re-run. Expected: PASS.
- [ ] **Step 3:** `npm test` and `npm run typecheck`. Commit `feat: water level blocks (derived, never collected)`.

### Task 2: World.setDerived

**Files:** Modify `src/core/world.ts`. Test `tests/core/world.test.ts`.

**Interfaces:**
```ts
class World {
  /** Writes a cell like set() and tells the listeners, but is NOT recorded in edits() and does not mark the world dirty. */
  setDerived(x: number, y: number, z: number, id: BlockId): void;
  /** Called after a derived write (and after set() when the old or new id is water). */
  onWaterChange(cb: (x: number, y: number, z: number) => void): void;
}
```
`setDerived` refuses (does nothing) unless the cell is currently Air or a flow id and the new id is Air or a flow id. This is the guard that stops water replacing a solid block, a source or anything he built. If a `set()` had earlier recorded a change at the same cell (an Air removal), the record stays.

- [ ] **Step 1:** Tests: `setDerived(Air to WaterFlow3)` changes `get` and not `edits()` or `isDirty()`; on a Stone cell it does nothing; on a `Water` cell it does nothing; `set()` of a solid block over a flow cell is recorded as an edit as usual; `onChange` listeners are not called for derived writes, `onWaterChange` listeners are, once per write; a derived write to the same id is silent.
- [ ] **Step 2:** Run `npx vitest run tests/core/world.test.ts`, FAIL; implement; PASS.
- [ ] **Step 3:** `npm test`. Commit `feat: derived world writes for water`.

### Task 3: The flow solver

**Files:** Create `src/core/water.ts`, `tests/core/water.test.ts`.

**Interfaces:**
```ts
export const SOURCE_LEVEL = 4;
export const FALL_LEVEL = 3;
export const MAX_FLOW_CELLS = 400;
export type Cell3 = [number, number, number];
export interface WaterTarget {
  /** Cell index (x + sizeX*(z + sizeZ*y)) to flow level 1..3, only for cells that are not sources. */
  flow: Map<number, 1 | 2 | 3>;
  /** True when the cap cut the answer short (for tests and the debug panel). */
  capped: boolean;
}
/** Pure. Reads only world.get/inBounds. `sources` are the cells holding id Water. */
export function solveWater(world: World, sources: Iterable<Cell3>, order?: 'canonical' | 'shuffled', rand?: () => number): WaterTarget;
export function findSources(world: World): Cell3[];   // a full scan, used at start and load
```
Algorithm: a wave search. Start with all sources at level 4 (step 0). Wave `k` expands every cell reached at step `k-1` in index order and offers its neighbours the levels from rules (b) to (d) of the decisions table; a cell keeps the maximum level offered; a cell whose level rises is re-queued. Stop when no cell changes or the cap is hit (cells are added in wave order, so the cut is deterministic). The `order: 'shuffled'` option shuffles neighbour and source iteration and exists only so a test can prove the answer does not depend on it (cap not reached in those tests).

- [ ] **Step 1:** Tests on small hand-built worlds (all use a helper `box(w, d, h)` with a Stone floor, a source pool and Air above):
  - `a still pond makes no flow`: a source pool fully walled gives an empty `flow`.
  - `one gap on flat ground gives levels 3, 2, 1 and stops`: pool, one Air cell beside it on the same floor: the cell is 3, the next 2, the next 1, the next none; total 3 cells in a straight line.
  - `open ground spreads in a diamond of limited size`: the gap opens onto a flat open floor; the total is at most 3 + 2 + 2... (assert the exact count for the layout, and that no cell is more than 3 steps from the source cell).
  - `water falls and renews`: a gap beside the pool at height h with a 3-high step down: each cell down has level 3 and the bottom spreads 3, 2, 1 on the lower floor.
  - `never runs uphill`: a gap leading to a floor one block higher than the pool floor, with a solid wall: no flow beyond the gap. (A floor cell at the same height as the gap continues.)
  - `only cells that cannot fall spread sideways`: a flow cell over Air does not leak sideways.
  - `walled channel keeps its level`: a trench 20 long, walls both sides, floor flat: every cell of the trench has level 3; the open end spreads 2, 1 and stops. A trench with one wall missing in the middle thins out there.
  - `plug stops it`: put Stone in the gap: `flow` empty.
  - `solids stop water`: Glass and Leaves in the way.
  - `the cap`: a pool beside a huge flat walled channel network (built with a 40 × 40 grid of trenches) returns `flow.size === 400` and `capped === true`, and the same cells on a second call.
  - `order independence`: for 50 random seeds, `solveWater(..., 'shuffled', mulberry32(seed))` deep-equals the canonical answer on five layouts (flat gap, stairs, trench, two pools sharing a gap, a pit).
  - `two sources meeting` do not exceed level 3 anywhere and equal the union rule.
  - `a flooded pit`: a 3×3 pit 4 deep beside the pool with a gap: the column cells that receive water have level 3 and the pit does **not** fill to the rim (water renews but does not rise).
- [ ] **Step 2:** Run `npx vitest run tests/core/water.test.ts`. Expected: FAIL (module not found). Implement. Expected: PASS.
- [ ] **Step 3:** Add a micro-benchmark test (skipped on CI, printed locally): the real pond with all 4 banks open: record visited cells and milliseconds in the commit message. `npm test`. Commit `feat: deterministic bounded water flow solver`.

### Task 4: The bounded simulation

**Files:** Create `src/core/waterSim.ts`, `tests/core/waterSim.test.ts`.

**Interfaces:**
```ts
export const TICK_SECONDS = 0.25;
export const MAX_CHANGES_PER_TICK = 24;
export interface WaterStats { flowCells: number; pending: number; lastTickChanges: number; lastSolveMs: number; capped: boolean }
export class WaterSim {
  constructor(world: World, now?: () => number);
  /** Call every frame with dt in seconds. Does nothing until TICK_SECONDS has built up. At most one tick per call. */
  update(dt: number): void;
  /** Apply the whole answer now, no animation. For load and tests. Returns the number of cells changed. */
  settleAll(): number;
  stats(): WaterStats;
  /** Fires with 'started' when the first flow cell appears after a quiet period (for the trickle sound) and 'drained' when the last one goes. */
  onEvent(cb: (e: 'started' | 'drained') => void): void;
}
```
Behaviour: the sim listens with `world.onChange` (any solid/air edit) and `world.onWaterChange` for source cells appearing or disappearing, and marks itself `needsSolve`. A tick with `needsSolve` or `pending > 0` solves once, then applies up to 24 differences: **additions sorted nearest-source-first** (step count then index), **removals farthest-first**; a removal of a flow cell that is no longer in the target and an addition are both `world.setDerived`. A tick with nothing pending and `needsSolve === false` returns immediately without touching the world (zero cost when settled). The set of flow cells is maintained incrementally (by listening), with `findSources` and a flow scan only at construction and `settleAll`.

- [ ] **Step 1:** Tests:
  - `settled world costs nothing`: after `settleAll`, 1000 `update(0.25)` calls make zero solver calls (spy on `solveWater` through an injectable function) and zero world writes.
  - `grows over ticks, nearest first`: open a one-cell gap; after one tick the first cell exists, after three ticks all three; never more than 24 changes in a tick; with a layout needing 100 cells, ticks needed is `ceil(100/24)`.
  - `plug retreats farthest first`: run to settled, put a Stone in the gap: after one tick the far end has gone first; all gone within `ceil(n/24)` ticks.
  - `never writes over solids`: build over a flow cell between ticks; the sim must not overwrite it and nothing throws.
  - `a flow cell replaced by his block is not restored`.
  - `edits() stays empty of flow ids` through a whole story (grow, plug, unplug, grow).
  - `dt handling`: `update(NaN)`, `update(-1)`, `update(100)` do at most one tick and never throw.
  - `events`: 'started' once when the first cell appears, 'drained' once when the last goes, not repeatedly.
  - `settleAll equals the ticked end state`: ticking until settled gives the same cells as `settleAll` from the same start (order independence in time).
  - `pending is bounded`: `stats().pending` never exceeds `MAX_FLOW_CELLS`.
- [ ] **Step 2:** Run `npx vitest run tests/core/waterSim.test.ts`, FAIL; implement; PASS.
- [ ] **Step 3:** `npm test`. Commit `feat: bounded water simulation with tick cap`.

### Task 5: The pond story on the real world

**Files:** Create `tests/core/pondStory.test.ts`. Modify `src/core/placement.ts` and `tests/core/placement.test.ts` only if the story shows a gap (placing a block into a flow cell must be allowed, collecting any water must not).

**Interfaces:** none new; uses `generateWorld`, `Game`, `WaterSim`.

- [ ] **Step 1:** Tests (real `generateWorld(2026)`, a real `Game` with a hand and `collect` intents; find the pond with a scan for `Water`, not hardcoded numbers):
  - `the pond is still`: `settleAll()` on a fresh world changes nothing (no flow cell exists).
  - `digging a shore block lets water out`: choose a shore sand cell at pond height next to a source, `game.applyIntent({kind:'dig'...})` (player placed next to it), tick until settled: 1 to 3 flow cells in a line or small fan, all within 3 steps of the dug cell, all levels 1 to 3, none above the pond surface.
  - `plug stops it and the water drains`: place Planks in the dug cell: after settling, zero flow cells and `edits()` contains exactly the dig and the plug.
  - `unplug lets it run again` and `repeat 20 times never grows past the first answer`.
  - `digging round the whole shore` (every shore cell, one after another): flow cells never exceed 400 and the world settles; the pond cells (sources) are all still Water.
  - `a long trench downhill`: dig a 2-wide, 12-long trench along the meadow slope away from the pond's lowest bank, the water stays within 400, and runs down no more than the terrain allows (never above a cell's source height).
  - `removing a pond bed block` makes water fall into the hole and the pond surface is unchanged; refilling the hole drains the fall.
  - `water cannot be dug or collected`: `canCollect` is false on `Water` and on every flow id; a hold on one does nothing (no inventory change).
  - `placing into water is allowed` on source and flow cells (`canPlace`), and the player cannot place a block inside his own body (existing rule).
  - `the bag is never given water`.
- [ ] **Step 2:** Run `npx vitest run tests/core/pondStory.test.ts`. Expected: FAIL only where a rule is missing; fix in `placement.ts`. PASS.
- [ ] **Step 3:** `npm test`. Commit `test: the pond story (dig, flow, plug, drain) on the real world`.

### Task 6: Swim-aware pathfinding

**Files:** Modify `src/core/pathfind.ts`. Test `tests/core/pathfindSwim.test.ts` (new). Existing `tests/core/pathfind.test.ts` must pass unchanged.

**Interfaces:**
```ts
/** Source, or a flow cell with water above it or without a solid below it. */
export function isDeepWater(world: World, cell: Cell): boolean;
/** Feet cell is water, head cell is not solid, and he cannot stand there (deep or unsupported). */
export function isSwimmable(world: World, cell: Cell): boolean;
/** No water at the feet or head cell. Used by villagers. */
export function isDry(world: World, cell: Cell): boolean;
/** Shallow puddles are standable; deep water is not. (Was: Water only.) */
export function isStandable(world: World, cell: Cell): boolean;
/** Swim or climb-out step: swim to swim cells (6 directions, dy -1..1 on cardinal steps), swim to a dry standable cell at most 1 above the water surface, or a dry cell into a swim cell at the same or one lower height. */
export function canSwimStep(world: World, from: Cell, to: Cell): boolean;
export interface SwimOptions { swim?: boolean; swimCost?: number }
export function findPath(world: World, from: Cell, to: Cell, maxNodes?: number, opts?: SwimOptions): Cell[] | null;
export function pathTowards(world: World, from: Cell, goal: Cell, allowed?: (c: Cell) => boolean, opts?: SwimOptions): Approach | null;
/** The tap policy: dry first; swim only if dry does not arrive or is longer than DRY_LONG = 20 steps, and the cheaper route wins. */
export function routeTowards(world: World, from: Cell, goal: Cell, allowed?: (c: Cell) => boolean): Approach | null;
```
Rules: `opts.swim` defaults to false, so every existing caller (Pip, `walk` for villagers) is unchanged. A goal cell that is a swim cell is valid in swim mode. A goal on submerged ground is replaced by the surface swim cell above it (feet 0.9 below the surface, so the swim cell is the topmost wet cell of the column). Cost: dry step 1, swim step `swimCost ?? 2`.

- [ ] **Step 1:** Tests (hand-built pond worlds):
  - `isStandable keeps its old answers on dry land and rejects deep water`; accepts a shallow flow cell with floor; rejects a flow cell over Air (falling column) and a flow cell with water above.
  - `isSwimmable` true in a source and in a falling column, false on dry land and in a shallow puddle; false if the head cell is solid (a 1-high water tunnel under a ceiling).
  - `isDry` rejects shallow puddles and deep water, accepts the shore.
  - `dry route preferred`: a 5-wide pond with the shore 8 steps round; a tap on the far side takes the dry route when the walk is under 20 steps (assert no swim cell in the path).
  - `swim when the dry route is long or missing`: a 12-wide lake with no way round: the path crosses water and ends on the far shore; with an island target it ends on the island.
  - `tap on water swims to the surface above it` (never down to the bed).
  - `climb out`: from a swim cell next to a bank one block above the surface the path continues onto the bank; for a bank two blocks above it does not (and `pathTowards` returns the nearest reachable).
  - `a flooded pit` with a 1-wide route out along the water exists in `swim` mode and the path ends on the dry rim.
  - `performance`: `routeTowards` across the real pond visits at most 4000 nodes (the same cap as today) and takes well under a few ms on desktop.
  - `villager rule`: with `allowed = c => isDry(world, c)` no path enters a puddle or the pond.
  - `Pip's default (no swim) never returns a path through deep water`.
- [ ] **Step 2:** Run `npx vitest run tests/core/pathfindSwim.test.ts tests/core/pathfind.test.ts`. Expected: new tests FAIL, old PASS. Implement. Expected: all PASS.
- [ ] **Step 3:** `npm test`. Commit `feat: swim-aware pathfinding with dry-first routes`.

### Task 7: Swimming in Player

**Files:** Modify `src/game/player.ts`. Test `tests/game/playerSwim.test.ts` (new). Existing `tests/game/player.test.ts` must pass unchanged.

**Interfaces:**
```ts
export const SWIM_FACTOR = 0.55;
export const WADE_FACTOR = 0.8;
export const FLOAT_DEPTH = 0.9;       // feet below the surface when floating
export type Mode = 'walk' | 'wade' | 'swim';
class Player {
  /** 'swim' when the feet cell is deep water (or unsupported water). */
  mode(world: World): Mode;
  /** Seconds in deep water since he last touched the ground or the bank (for the rescue rule). */
  wetSeconds: number;
  /** True for one update after he enters deep water (for the splash). */
  takeSplash(): boolean;
  /** Surface height (top of the highest wet cell above his x, z), or null. */
  surfaceY(world: World): number | null;
}
```
`pos.y` stays a whole number on land (unchanged) and becomes continuous while swimming. Rules inside `update`:
- Speed is multiplied by `SWIM_FACTOR` in swim mode and `WADE_FACTOR` in wade mode, for stick and path alike.
- In swim mode the path follows `canSwimStep`. A dry standable next cell at most 1 above the surface is the climb-out: he moves onto it and `pos.y` snaps to its integer floor; the transition is a short ease (≤ 0.2 s) so he does not teleport.
- Buoyancy: target `y = surface - FLOAT_DEPTH`; clamped to the column floor so he never sinks into the bed (min `floor + 0.05`) and never above the surface. With no input: 0.6 s of gentle sinking (at most 0.5 block), then rising at 1.0 b/s. While moving: rises/sinks to target at 1.5 b/s.
- Entering water from a bank or a jump-off lands at the surface target; he never falls through the world.
- `recover()` treats a swim cell as valid: a player in water is no longer "not standable, so search". Recover still runs if the feet cell is solid.
- No drowning: nothing in `Player` reads a timer except `wetSeconds`, which only the game's rescue uses.

- [ ] **Step 1:** Tests (hand-built 12 × 12 pond, 3 deep):
  - `walking into the pond starts swimming` after crossing the shore; `mode === 'swim'`, speed measured over 2 s is `3.5 * 0.55 ± 5 %`.
  - `wading in a puddle` is 80 % speed and `mode === 'wade'`.
  - `floats up on his own`: placed at the bed of the 3-deep pond, no input, after 3 s his feet are within 0.1 of `surface - 0.9`.
  - `the bob`: with no input from the surface, the lowest feet height in the next 2 s is between `surface - 0.9 - 0.5` and `surface - 0.9`; never below the bed + 0.05; and he is back at the float height after 1.5 s.
  - `never drowns`: simulate 10 minutes of dt = 1/30 in the middle of the pond: still in the world, still at the float height, no exception, `pos` finite.
  - `swims to a tapped surface spot` using a path from `routeTowards`; arrives within 0.2.
  - `climbs out` onto a same-height shore, a bank 1 above the surface, and does not enter a bank 2 above (he stays in the water, `wetSeconds` keeps counting).
  - `stick in water` moves at swim speed, slides along a wall, and cannot leave through a bank 2 high.
  - `splash flag` true once per entry.
  - `a flooded column` (3×3 pit, water falling in): he floats to the column top; from there a step out onto the rim at the same height works.
  - `y never NaN or below 1` over a random walk of 5000 steps across the pond and shore (a fuzz test with a fixed seed).
  - `legacy`: every test in `player.test.ts` passes unchanged.
- [ ] **Step 2:** Run `npx vitest run tests/game/playerSwim.test.ts tests/game/player.test.ts`. Expected: FAIL; implement; PASS.
- [ ] **Step 3:** `npm test`. Commit `feat: swimming, wading and floating in Player`.

### Task 8: Game: swim taps, rescue, Pip and villagers

**Files:** Modify `src/game/game.ts`, `src/game/pal.ts`. Tests `tests/game/gameSwim.test.ts` (new), `tests/game/pal.test.ts` (extend).

**Interfaces:**
```ts
export type GameEvent = /* ... */ | { type: 'splashed' } | { type: 'rescued' };
export const RESCUE_STUCK_SECONDS = 4;
export const RESCUE_ANY_SECONDS = 10;
```
- `Game.walk` uses `routeTowards` (Task 6) instead of the dry-only search. The result path is handed to `player.setPath` as today. `walkNear` (used by hold-to-dig on a block he must stand beside) keeps its dry preference.
- `Game.update`: `player.takeSplash()` emits `splashed`. If `player.wetSeconds >= RESCUE_STUCK_SECONDS` and no climb-out cell is reachable within 12 swim steps, or `>= RESCUE_ANY_SECONDS` with no input, run `liftOut` (generalised to skip deep-water cells) and emit `rescued`. `liftOut` is the existing pit lift; it also learns `isDeepWater`.
- `Pal`: a `rescued` event says `upYouCome`; the first `splashed` per session says a `waterSplash` line. Pip's own movement never targets deep water (default routing, as before). His teleport chooses a standable (not deep) cell. If the player is swimming, Pip's follow goal is the nearest dry standable cell to the player (pathTowards already returns the nearest reachable cell), so he waits at the shore.
- Villagers (later steps) pass `isDry` as the `allowed` filter of their path searches; `isDry` is exported from `src/core/pathfind.ts` (Task 6), so this task only adds the test that proves the rule.

- [ ] **Step 1:** Tests:
  - `tap on the pond swims there`: `applyIntent({kind:'walk', to: surfaceCellInPond})` ends with him at the cell, mode swim.
  - `tap across a lake swims, tap round a puddle walks`.
  - `tap on submerged ground does not dive`.
  - `rescue stuck`: a flooded 3×3 pit with the water 3 blocks below the rim and no climb-out: after 4 s (simulated) `rescued` is emitted once, he stands on dry land (`isStandable` and not deep), his inventory is unchanged, and Pip's line is `upYouCome`.
  - `rescue any`: in the middle of a big lake with no input for 10 s he is lifted to the nearest shore; with input he is not.
  - `no rescue when he can get out`: a pond he is swimming in with a bank at hand never triggers a rescue before 10 s.
  - `rescue is never into water, a tree top or a wall` (property test on the real pond and the real village, 200 random water cells).
  - `cannot be lifted into the sky`: the rescue target is within 8 cells and `y` within 4 of his old `y` when a nearer option exists.
  - `Pip never ends in deep water`: 60 s of simulated frames with the player swimming round the pond; Pip's feet cell is never deep; he stays within 12 cells of the player; when the player leaves the water Pip rejoins.
  - `Pip teleport` while the player floats mid-pond lands on the shore.
  - `villagers never enter water`: a path search with `isDry` from the village square to a house across the pond ends at the nearest dry cell.
- [ ] **Step 2:** Run `npx vitest run tests/game/`. Expected: new FAIL, old PASS. Implement. Expected: PASS.
- [ ] **Step 3:** `npm test`. Commit `feat: swim taps, water rescue, Pip and villagers keep out of deep water`.

### Task 9: The water mesh

**Files:** Modify `src/render/mesher.ts`, `src/render/atlas.ts`. Test `tests/render/mesherWater.test.ts` (new); `tests/render/mesher.test.ts` updated for the moved faces.

**Interfaces:**
```ts
export interface ChunkGeometry extends MeshArrays { transparent: MeshArrays; water: MeshArrays }
/** Only the water for one chunk. Scans y up to the highest wet cell + 1, not the whole column. */
export function buildWaterGeometry(world: World, cx: number, cz: number, uvForWater: WaterUv): MeshArrays;
export type WaterUv = (kind: 'still' | 'flow', face: Face, dir: 0 | 1 | 2 | 3) => [number, number, number, number];
```
Rules: water cells no longer go in `transparent`. A water top face is at `y + level/4`; side faces only against non-water, non-solid neighbours or a lower water neighbour (the visible part); no faces against a solid. Flow tiles use `dir` (0 to 3: towards +x, +z, -x, -z) = the horizontal neighbour with the lowest level or open floor edge. `buildChunkGeometry` returns an empty `water` (kept so old callers compile) and skips water; `scene` uses `buildWaterGeometry`.

- [ ] **Step 1:** Tests:
  - `solid chunk geometry contains no water faces` and `transparent contains none either` (glass and leaves still there).
  - `a pond top is one quad per surface cell at y + 1.0`; `a level-2 cell top is at y + 0.5`; a cell under water has no top face; two touching sources have no side faces between them; a source beside a lower flow cell has the visible side strip.
  - `faces against solids are not emitted`.
  - `triangles`: the real pond chunk water geometry has at most 400 triangles; a worst-case chunk with 400 flow cells has at most 3200.
  - `scan range`: `buildWaterGeometry` on a chunk with no water returns empty arrays and reads fewer than 16 × 16 × 2 cells (counting `world.get` calls through a spy).
  - `deterministic`: the same input gives identical arrays.
- [ ] **Step 2:** Run `npx vitest run tests/render/mesherWater.test.ts tests/render/mesher.test.ts`. FAIL; implement; PASS.
- [ ] **Step 3:** `npm test`. Commit `feat: separate water mesh with level heights`.

### Task 10: Scene: water material, dirty queue, underwater tint and camera

**Files:** Create `src/render/underwater.ts`. Modify `src/render/scene.ts`. Tests `tests/render/underwater.test.ts`, `tests/render/cameraWater.test.ts` (new).

**Interfaces:**
```ts
// underwater.ts (pure, no Three.js)
export const UNDERWATER_FOG = { color: 0x6fc3ff, near: 3, far: 26 } as const;
export const TINT = { r: 70, g: 160, b: 255, a: 0.28, fadeSeconds: 0.15 } as const;
export class UnderwaterState {
  /** Feed the camera point each frame. Returns the fade 0..1. */
  update(world: World, cam: { x: number; y: number; z: number }, dt: number): number;
  readonly fade: number;
}
// scene.ts
class Scene3D {
  /** Marks the chunk's water dirty; rebuilt at most MAX_WATER_REBUILDS_PER_FRAME = 2 per frame, nearest to the camera first. */
  markWaterDirty(x: number, z: number): void;
  setUnderwater(fade: number): void;     // fog colour/near/far lerp, called from main with UnderwaterState
  waterRebuildCount(): number;           // for tests/debug
}
```
Behaviour: `main` subscribes `world.onWaterChange` to `markWaterDirty` and `world.onChange` to `rebuildChunkAt` as today (solid) plus `markWaterDirty` when the changed cell or its neighbours were water. A chunk's water mesh and solid mesh are separate `THREE.Mesh` objects; a flow tick therefore only rebuilds water. The water material is double sided, transparent, `depthWrite: false`, `renderOrder = 1`; its `map` swaps between two frames every 0.4 s (no rebuild, no shader). The underwater overlay is an absolutely positioned `div` with `pointer-events: none` (never swallows a tap or drag) and `aria-hidden`. The fog values lerp with `fade`; the sky colour (background) stays the day blue.

- [ ] **Step 1:** Tests:
  - `UnderwaterState`: camera point in a source or flow cell gives fade 1 within 0.15 s; out of water 0 within 0.15 s; at the surface boundary it does not flicker (hysteresis of 0.1 block); NaN positions give 0.
  - `never dark`: `UNDERWATER_FOG.color` and `TINT` over white give a luminance above 0.5 (computed in the test) and the fog `far >= 20`.
  - `cameraWater`: with the real `CameraRig` and a world with a pond, for 500 random (yaw, pitch, eye) with the eye in water, `clampDistance` never returns a camera point inside a solid cell; a camera looking along the water surface is not pulled in by water (water does not block); in a flooded 3×3 pit close mode engages when the wall is closer than 1.2 and releases when he floats up out of it; no one-frame glitch where `distance` jumps by more than the existing ease allows.
  - `water rebuilds are bounded`: mark 40 chunks' water dirty in one frame (use the pure queue class exported for testing); at most 2 are rebuilt per frame; all are rebuilt within 20 frames; the same chunk marked 10 times is rebuilt once.
  - `a flow tick rebuilds no solid mesh` (spy on the solid builder; 0 calls during a pure flow tick).
- [ ] **Step 2:** Run the two files. FAIL; implement; PASS.
- [ ] **Step 3:** `npm test`. Commit `feat: water material, bounded water rebuilds and the underwater tint`.

### Task 11: Save and load

**Files:** Modify `src/core/save.ts`. Test `tests/core/save.test.ts` (extend).

**Interfaces:** none new. `serialise` filters edits whose id is a flow id; `applySave` runs `new WaterSim(world).settleAll()` after the edits replay and before returning (the game constructs its own `WaterSim` from the same world; `settleAll` is idempotent). `isSaveData` accepts a v1 or v2 save exactly as village step 1 left it.

- [ ] **Step 1:** Tests:
  - `a save never contains a flow id`: run the pond story (dig, flow, settle), `serialise`, scan `edits` and `JSON.stringify`: no id 16, 17, 18.
  - `reload gives the same water`: play the story, save, load into a fresh world, `settleAll`: the set of flow cells is identical (compare as sorted index arrays), and the pond is still.
  - `plug in the save`: save with the plug in; load: no water. Save without it: water.
  - `an old save (version 1 and 2) loads with the pond still` (use the legacy fixture and a v2 fixture).
  - `a save written mid-flow` (serialise at tick 1 of 5) loads to the same final water as the one that ran to the end.
  - `a hostile save` containing edits with flow ids is accepted without crashing, and the flow ids are treated as Air (never as saved water), or rejected as an invalid cell, whichever the existing `isSaveData` does with unknown ids; the test pins the choice.
  - `load time`: `applySave` on the 96 × 96 world with 5000 edits including an open bank stays within the existing load budget (print ms; assert the water part under 10 ms on desktop).
- [ ] **Step 2:** Run `npx vitest run tests/core/save.test.ts`. FAIL; implement; PASS.
- [ ] **Step 3:** `npm test`. Commit `feat: water is recomputed on load, never saved`.

### Task 12: Sounds and Pip lines

**Files:** Modify `src/audio/sfx.ts`, `src/content/lines.ts`. Tests `tests/content/lines.test.ts` (extend), `tests/audio/water.test.ts` (new).

**Interfaces:**
```ts
// sfx
splash: () => void;   // two soft falling bubbly blips, ~0.2 s, peak 0.2; throttled to once per 600 ms
trickle: () => void;  // three tiny falling notes ~0.25 s, peak 0.12; throttled to once per 2000 ms
// lines
type LineKey = /* ... */ | 'waterSplash' | 'waterTrickle';   // four variants each, short, British
```
Lines (examples, final wording in the PR): `waterSplash` icon 💦: "Splash! Look at you swim!", "Wheee, a swim!", "Paddle, paddle!", "You're swimming!". `waterTrickle` icon 💧: "Ooh, the water is running!", "Look, it's trickling out!", "A little river!", "Whoosh, there it goes!". Pip never speaks an empty line (existing rule).

- [ ] **Step 1:** Tests: lines are non-empty, British, no more than 8 words, four variants each, each has an icon; with a fake `AudioContext` the throttle holds (two `splash()` calls inside 600 ms make one sound); no sound plays without a context (silent, no throw); no looping oscillator remains after 3 s (nothing left running).
- [ ] **Step 2:** Run `npx vitest run tests/content/lines.test.ts tests/audio/water.test.ts`. FAIL; implement; PASS.
- [ ] **Step 3:** `npm test`. Commit `feat: splash and trickle sounds and Pip's water lines`.

### Task 13: Wire it together

**Files:** Modify `src/main.ts`; touch `src/ui/hud.ts` only if a debug readout is needed (it is not: use `?debug`).

**Interfaces:** debug hooks on `window.__debug` (only with `?debug`): `water(): WaterStats`, `waterAt(x,y,z): number`, `swimming(): Mode`, `underwaterFade(): number`, `waterRebuilds(): number`, `tickWater(n)` (advance n ticks for tests), `rescueCount(): number`.

Wiring: create `WaterSim` after `applySave`/`generateWorld`; call `waterSim.update(dt)` once per frame before `game.update`; `world.onChange` and `onWaterChange` feed the scene as in Task 10; `GameEvent` `splashed` calls `sfx.splash()` and Pip; `WaterSim.onEvent('started')` calls `sfx.trickle()` and Pip's `waterTrickle` (once per session); the overlay `div` is created in `main.ts` (not in the HUD) and driven by `UnderwaterState`; pausing the game (overlays) pauses the sim; the `visibilitychange` autosave path is untouched.

- [ ] **Step 1:** Write a Vitest test with a stub scene (as `main` is hard to test directly): the wiring helper `wireWater(world, game, scene, sfx, pal)` returns a disposer; it makes zero scene calls when nothing changes, calls `markWaterDirty` for each derived change, and stops when disposed.
- [ ] **Step 2:** Implement `wireWater` in `src/game/waterWiring.ts` and use it in `main.ts`. Run `npm test`, `npm run typecheck`, `npm run build`. Expected: all pass.
- [ ] **Step 3:** Manual smoke in `npm run dev -- --host`: dig the shore; watch it run and stop; plug; swim; reload. Commit `feat: wire water into the game`.

### Task 14: Browser story (e2e)

**Files:** Create `e2e/water.spec.ts`. Reuse helpers from `e2e/smoke.spec.ts` (move shared helpers to `e2e/helpers.ts` if both need them).

- [ ] **Step 1:** Write one story, using real pointer gestures wherever the hooks allow and `giveItem` for blocks:
  1. Load `/block-pals/?debug` (fresh storage). `__debug.water().flowCells === 0` (the pond is still).
  2. Walk beside a shore block next to the pond (tap), hold on it until it is dug. Wait for the condition `water().flowCells > 0` (poll, no fixed sleeps). Assert it settles (`pending === 0`), `1 <= flowCells <= 12`, and `trickle` was requested once.
  3. `giveItem` planks, select them, quick-tap the gap: assert `flowCells` returns to 0 and `world.get` of the gap is Planks.
  4. Dig the plug again; water runs again; leave it.
  5. Tap the middle of the pond: wait until `swimming() === 'swim'`; assert the player's speed is below walking speed (position delta over 1 s); `underwaterFade()` rises during the bob and returns to 0; assert the tint overlay has `pointer-events: none`.
  6. While swimming, drag to turn: `camera().yaw` changes; the player does not walk.
  7. Tap the far shore: he swims and climbs out (`swimming() === 'walk'`, feet on a standable cell).
  8. Dig a 3×3 pit beside the water, open it to the pond, tap into the pit water: wait up to 6 s: he is on dry land (rescue or climb-out), `rescueCount()` is 0 or 1, never more than one.
  9. Reload the page: same `flowCells` as before the reload (water recomputed), the plug state kept, no console errors.
  10. A frame-time check: during the water running, the median frame time from 120 `requestAnimationFrame` samples is below 33 ms (desktop headless, loose; the tablet is checked by hand).
  11. Offline: go offline and reload; the page still works (as in the existing offline story).
- [ ] **Step 2:** Run `npm run e2e -- e2e/water.spec.ts`. Expected: FAIL before wiring is complete, PASS after. Run the full `npm run e2e` and `npm test`. Commit `test: water browser story`.

---

## Self-review against the spec

- Ponds stay still; flow only after he digs a bank: Tasks 3 to 5 (`the pond is still`, `digging a shore block lets water out`).
- Limited spread, settles, never floods: level thinning, the 400-cell cap, tests in Tasks 3, 4, 5.
- Plug to stop, drain what he let out, nothing permanent: Tasks 4 and 5; ponds never drain by design.
- Bucket later: outlined in the decisions table only; no code.
- Swimming without drowning, slower, floating, tap to swim, drag to turn: Tasks 6, 7, 8, 14.
- Blue tint, never dark, close mode underwater: Task 10 and the e2e.
- Pip swims or waits (waits), villagers stay out: Task 8.
- Never stuck: climb-out rule (Task 7) plus the rescue (Task 8) with property tests.
- Saves: recomputed, tested including the old fixtures (Task 11).
- Farm irrigation: the channel rule (Task 3 `walled channel keeps its level`).
- Anti-goals: nothing scary or lost, no timers, no reading, no new buttons.

## Performance numbers

Targets (desktop figures are what the tests print; the tablet is judged by hand). The Tab A8 is roughly 5 to 8 times slower than a desktop for this kind of code.

| | Budget | Expected |
|---|---|---|
| Ticks | 4 per second, one per frame at most | 0 work when settled |
| Solver | at most 400 flow cells; about 6 reads each plus 160 source cells | 1,500 to 3,000 cell reads: under 0.3 ms desktop, about 2 ms on the tablet, only on a tick while water is changing |
| Changes per tick | 24 | 24 `setDerived` calls |
| Water chunk rebuilds | at most 2 per frame, only dirty chunks, water only | one scans 16 × 16 × (up to 8) cells: about 0.3 ms desktop, about 2 ms tablet |
| Solid chunk rebuilds | none from a flow tick | the existing 1 per dig or place |
| Triangles | pond about 400, flow at most 3,200 in the worst chunk | the pond plus a dug bank adds under 100 |
| Draw calls | +1 per chunk with water (normally 1 to 4) | the pond sits in 1 to 4 chunks, the rest are empty meshes and skipped |
| Memory | no per-cell objects: `Map<number, level>` of at most 400 entries and a `Set` of flow indices | a few KB |
| Overlay | 1 DOM div with an opacity change | no extra render pass |
| Animation | one texture swap per 0.4 s | no CPU per cell |

If the tablet misses 30 fps with water running (decide from the checklist, do not build ahead): drop to 2 ticks per second and 12 changes per tick; cap the water rebuilds to 1 per frame; then remove the double-sided material. Do not lower the pixel ratio without asking.

## Parent playtest checklist (Galaxy Tab A8, after deploying this step to GitHub Pages)

Use `?debug` once for the fps counter, then play without it. Write down the lowest fps you see.

1. **Still pond.** Walk to the pond. It looks as it always did and does not move. fps 30 or above.
2. **Let the water out.** Press and hold on a sand block at the pond edge. The block goes and water runs out a few blocks, gets thinner and stops. You hear a tiny trickle and Pip says a happy line. The fps stays at 30 or above while it runs.
3. **Stop it.** Put any block in the gap. The water drains away from the far end in a second or two. Dig the block again and it runs again. Do it five times; nothing breaks and nothing is left behind.
4. **Do not flood.** Dig out four or five blocks round the pond, then a long ditch away from it. The water stays near the pond, never fills the meadow and never spreads over the world. The tablet stays smooth.
5. **Ditch to a field.** Dig a straight narrow ditch with a block on each side of it, 10 blocks long, from the pond. The water runs all the way along it. Open the far end and it spreads a little and stops.
6. **Swim.** Tap in the middle of the pond. He swims there, slowly, with a little splash sound. Stop touching: he bobs and floats up. Tap the far bank: he swims across and climbs out. Try both a flat bank and a bank one block higher.
7. **Turn the view in the water.** Drag with one finger while swimming. The view turns; he does not walk. The picture is a soft bright blue under the water, never dark, and never goes through a block.
8. **Flooded pit.** Dig a pit beside the pond and let the water in. Walk into the water in the pit. He can get out by tapping the edge, or if not, he is lifted out after a few seconds and Pip says "Up you come!". He never feels stuck and nothing is lost from the bag.
9. **Pip.** Pip waits on the shore while he swims, then comes back. Pip never ends up in the water.
10. **Save.** Let some water out, leave the plug off, reload the page: the water is there again as before. Plug it, reload: no water. His blocks are all there.
11. **Controller.** Swim and climb out with the pad stick; the camera follows as before.
12. **Heat and battery.** After 10 minutes of playing with water the tablet is not hot and the fps is the same as at the start.

## Questions for the parent

Most important first. Each has my answer built in, so none of them blocks the work.

1. **A channel to a far field.** The pond is about 60 blocks from the farm field. Water thins out over 3 blocks in the open, but runs without thinning along a ditch that has a wall on each side, so a long ditch can reach a field (it is a lot of digging). Is that the right feel, or should the farm step also put a small irrigation pool by the field, with the bucket as the easy way to carry water there? *(My call: walled ditches carry water; the farm step adds a small pool by the field; the bucket comes in step 2.)*
2. **Undoing the water.** Until the bucket exists, the only way to stop or drain water he let out is to plug it with a block (everything downstream drains by itself). Holding on water does nothing. Is that enough for now? *(My call: yes, the bucket is the scoop.)*
3. **Pip in the water.** Pip waits on the shore and cheers rather than swimming alongside. Swimming Pip is more fun but needs his own float, path and animation, and is a risk to his reliability. Do you want him to swim in this step? *(My call: waits on the shore; swim later.)*
4. **Diving.** He bobs a little below the surface when he stops but there is no control to dive deeper. Underwater views come from the bob, deep ponds and flooded pits. Should there be a dive in this step, for example a hold on the water? *(My call: no dive yet.)*
5. **Wading.** Thin flowing water (up to a puddle) can be walked through slowly instead of swum, so ditches never block him. Do you want all flowing water to be "swim only"? *(My call: puddles can be waded.)*
