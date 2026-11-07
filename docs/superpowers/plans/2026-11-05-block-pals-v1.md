# Block Pals v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A first playable Block Pals on the Galaxy Tab A8. He can explore a small, always-daytime, classic-looking 3D block world in third person, collect blocks, craft a new block from a picture recipe, and be followed and cheered by one talking pal. It is fully voiced in British English, works with touch and a generic Bluetooth pad, saves locally, has a grown-up area with usage time and break reminders, and installs offline from GitHub Pages.

**Architecture:** Pure, DOM-free game logic in `src/core/` (blocks, world, generation, inventory, crafting, pathfinding, save, usage, gate) is unit-tested with Vitest. Rendering in `src/render/` uses Three.js, with one merged, face-culled mesh per 16×16 chunk and a procedurally drawn texture atlas. `src/game/` wires the logic, input, rendering and audio into a fixed loop. `src/ui/` is plain DOM overlays (HUD, craft screen, grown-up area) above the canvas.

**Tech Stack:** TypeScript 5 (strict), Vite 8, Three.js 0.187, Vitest 5, vite-plugin-pwa 2, Playwright 1.65 (smoke test), Web Speech API (voice), Web Audio API (sound effects), Gamepad API, GitHub Pages and GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-05-block-pals-design.md`

## Global Constraints

- British English in every string and voice line: colour, favourite, grey, mum, maths. A test enforces this (Task 9).
- No reading needed: every UI action is an icon. Every spoken line is also shown as a picture or short simple word. Digits only up to 20.
- Always daytime. No darkness, no scary sounds, nothing that hurts the player, nothing lost.
- No network calls at runtime: no analytics, ads, links, accounts or CDN assets. Everything is bundled and works offline after first load.
- Target device: Galaxy Tab A8 (1920×1200, Unisoc T618), landscape, Chrome. A steady ≥30 fps. Renderer pixel ratio capped at 1.5. No real-time shadows. Fog hides the world edge.
- Touch targets ≥ 88 CSS px. No gestures beyond a single tap.
- Controller: a generic Bluetooth pad that may not use the standard layout, so every button comes from a stored mapping. Only 4 actions: move (left stick or d-pad), collect, place, next slot. Craft opens from the HUD button or the mapped "place" button held for 1 s.
- World: 48 × 48 columns, height 16, default seed `2026`. It's bounded: a soft invisible wall 1 block inside the edge, with a ring of trees near the edge.
- Inventory counts are capped at 20 per item, so the numbers stay readable.
- Interaction reach is 3 blocks (Chebyshev distance from the player's feet cell).
- Collecting is instant (a pop and a sound), with no hold-to-mine.
- Original assets only. No Minecraft or manga names, textures or sounds.

## Review Focus

- **Button-mashing:** rapid repeated taps or presses, and taps while a speech bubble or menu is open, never double-collect, double-craft or crash. Each action is processed at most once per 150 ms per input source (Task 7 test `debounces repeated taps`). Taps on overlays don't reach the world (Task 8).
- **No British voice installed or speech unavailable offline:** fall back to any `en-*` voice, then to silent with the picture shown. The game never waits on speech (Task 9 test `falls back when no en-GB voice`).
- **Boxing himself in or getting stuck:** placing a block into the player's or pal's cell is refused. Collecting is always allowed, so a walled-in player can dig out. If no path is found, the pal says a hint line, not nothing (Task 5 test `refuses placing into occupied cell`, Task 6 test `no path returns null and never targets water`).
- **Bad or missing save:** garbage JSON, an older version, a full localStorage or storage blocked must start a fresh world and keep playing (Task 12 test `ignores corrupt save`).
- **Sleeping tablet or backgrounded app:** usage time isn't counted while hidden. A single tick adds at most 5 s, so a wake from sleep adds no hours. Minutes roll over to the new local date at midnight (Task 13 tests `caps delta`, `rolls over at midnight`).

## Who builds what

The executor sends each task to the agent named. Every task is reviewed by the *other* agent before it's merged. Ruflo, if its MCP server is connected, tracks the tasks and stores the review notes. If it isn't connected, the plan's checkboxes are the source of truth.

| Task | Builder | Reviewer |
|---|---|---|
| 1 Scaffold | Claude | Codex |
| 2 Blocks & world | Codex | Claude |
| 3 World generation | Codex | Claude |
| 4 Rendering | Claude | Codex |
| 5 Inventory & crafting | Codex | Claude |
| 6 Pathfinding & movement | Codex | Claude |
| 7 Input | Codex | Claude |
| 8 Game wiring & HUD | Claude | Codex |
| 9 Voice, sound & lines | Claude | Codex |
| 10 Pal | Claude | Codex |
| 11 Craft screen | Claude | Codex |
| 12 Save | Codex | Claude |
| 13 Usage, reminders, grown-ups | Codex (logic) + Claude (UI) | each other |
| 14 Offline, deploy, smoke | Claude | Codex |

Codex is invoked with `codex exec --full-auto "<task text from this plan + spec path>"` in the repo. Its diff is then reviewed before commit.

## File Structure

```
index.html                 canvas + overlay root, landscape meta
vite.config.ts             base '/block-pals/', PWA plugin
src/main.ts                bootstrap: load save → build game → start loop
src/core/blocks.ts         BlockId enum + BLOCKS table
src/core/world.ts          World voxel store
src/core/worldgen.ts       generateWorld(seed)
src/core/rng.ts            seeded RNG + value noise
src/core/inventory.ts      Inventory (capped counts, hotbar order)
src/core/recipes.ts        RECIPES table
src/core/crafting.ts       canCraft / craft
src/core/placement.ts      canPlace / canCollect rules
src/core/pathfind.ts       A* over walkable columns
src/core/save.ts           serialise / load / store
src/core/usage.ts          UsageTracker + reminder scheduling
src/core/gate.ts           grown-up sum gate
src/render/atlas.ts        procedural 16×16 textures → CanvasTexture
src/render/mesher.ts       buildChunkGeometry (pure data)
src/render/scene.ts        renderer, lights, fog, chunk meshes, camera follow
src/render/characters.ts   blocky player + pal models
src/game/game.ts           Game: state, update(dt), actions
src/game/player.ts         Player movement along path / stick
src/game/pal.ts            Pal follow + talk triggers
src/input/tap.ts           screen tap → world target (raycast) + debounce
src/input/gamepad.ts       mapped gamepad polling
src/input/mapping.ts       ButtonMapping type + defaults + storage
src/audio/voice.ts         speak(line) via speechSynthesis
src/audio/sfx.ts           Web Audio synth effects
src/content/lines.ts       every spoken line (British English)
src/ui/hud.ts              hotbar, craft button, bubble
src/ui/craft.ts            picture crafting screen
src/ui/grownups.ts         gate + usage + reminder + reset + controller setup
src/ui/styles.css
tests/core/*.test.ts, tests/render/mesher.test.ts, tests/input/*.test.ts,
tests/audio/voice.test.ts, tests/content/lines.test.ts
e2e/smoke.spec.ts
.github/workflows/deploy.yml
```

---

### Task 1: Scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.ts`, `src/ui/styles.css`, `tests/sanity.test.ts`, `public/icons/icon-192.png`, `public/icons/icon-512.png`

**Interfaces:**
- Produces: `npm run dev`, `npm test` (vitest run), `npm run build`, `npm run e2e`. The DOM has `#game` (canvas host) and `#ui` (overlay root).

- [ ] **Step 1:** `npm init -y`, then `npm i three@0.187` and `npm i -D typescript vite@8 vitest@5 @types/three vite-plugin-pwa@2 @playwright/test@1.65 jsdom`. Set the scripts above. In `tsconfig`, set `strict: true` and `"lib": ["ES2022","DOM"]`.
- [ ] **Step 2:** Write `tests/sanity.test.ts`: `expect(1 + 1).toBe(2)`. Run `npm test`. Expected: 1 passed.
- [ ] **Step 3:** `index.html`: `lang="en-GB"`, a viewport with `user-scalable=no`, `<div id="game">` and `<div id="ui">`. CSS: full-screen, `touch-action: none`, no text selection, and a sky-blue background `#78c6ff`. `vite.config.ts`: `base: '/block-pals/'`, with the PWA plugin added in Task 14. `main.ts`: logs "Block Pals" for now.
- [ ] **Step 4:** Make the icons: a 192 and a 512 PNG of a green grass block, drawn by a small node script with canvas, or by hand. They must be original art.
- [ ] **Step 5:** Run `npm run build`. Expected: `dist/` is created with no errors.
- [ ] **Step 6:** Commit with `chore: scaffold Vite + TS + Three project`.

### Task 2: Blocks and World

**Files:** Create `src/core/blocks.ts`, `src/core/world.ts`. Test `tests/core/world.test.ts`.

**Interfaces:**
- Produces:
  ```ts
  export enum BlockId { Air=0, Grass, Dirt, Stone, Wood, Leaves, Sand, Water, Planks, Glass, Bricks, Bedrock }
  export interface BlockDef { id: BlockId; name: string /* simple word, e.g. 'grass' */; solid: boolean; collectable: boolean; transparent: boolean; icon: string /* atlas tile key */ }
  export const BLOCKS: Record<BlockId, BlockDef>;
  export class World {
    constructor(sizeX: number, sizeY: number, sizeZ: number);
    readonly sizeX: number; readonly sizeY: number; readonly sizeZ: number;
    get(x: number, y: number, z: number): BlockId;   // out of bounds → Air below y<0? no: out of bounds → Bedrock if y<0, else Air
    set(x: number, y: number, z: number, id: BlockId): void; // out of bounds → no-op
    inBounds(x: number, y: number, z: number): boolean;
    topSolidY(x: number, z: number): number;          // highest solid y in column, -1 if none
    onChange(cb: (x:number,y:number,z:number)=>void): void;
    edits(): Array<[number, number, number, BlockId]>; // cells changed since markClean()
    markClean(): void;
  }
  ```
  Storage is a `Uint8Array` indexed `x + sizeX*(z + sizeZ*y)`. Water is `solid:false, collectable:false, transparent:true`. Bedrock is not collectable. Leaves and glass are `transparent:true`.

- [ ] **Step 1:** Write the failing tests:
  - `get returns Air for a new world`
  - `set then get round-trips`
  - `out-of-bounds set is a no-op and get above returns Air, below returns Bedrock`
  - `topSolidY ignores water and air`
  - `edits records changed cells and markClean clears them`
  - `onChange fires with coordinates`
- [ ] **Step 2:** Run `npm test -- world`. Expected: FAIL (module not found).
- [ ] **Step 3:** Implement both files.
- [ ] **Step 4:** Run `npm test -- world`. Expected: PASS.
- [ ] **Step 5:** Commit with `feat: block table and voxel world`.

### Task 3: World Generation

**Files:** Create `src/core/rng.ts`, `src/core/worldgen.ts`. Test `tests/core/worldgen.test.ts`.

**Interfaces:**
- Consumes: `World`, `BlockId`.
- Produces: `export function mulberry32(seed: number): () => number`, `export function valueNoise2D(seed: number): (x: number, z: number) => number /* 0..1 */`, `export function generateWorld(seed?: number /* default 2026 */): { world: World; spawn: { x: number; y: number; z: number } }`.

The generated world uses these values:
- Size 48×16×48. Bedrock at y=0. Base height 5, plus noise up to +4. One hill with a peak of about 11 near (34, 12).
- A pond: Water at y ≤ 5 in a radius-5 circle around (14, 32), ringed with Sand.
- Stone below 2 blocks of Dirt, under the Grass top.
- 10–16 trees: a Wood trunk of height 4 and a 3×3×2 Leaves cap. Never within 3 of spawn. A denser ring sits 2–4 blocks from the edge.
- Spawn is at the centre (24, ·, 24) on the top grass, plus 1.

- [ ] **Step 1:** Write the failing tests:
  - `is deterministic for the same seed` (compare `edits()` or a hash of the array)
  - `different seeds differ`
  - `bedrock at y=0 everywhere`
  - `spawn stands on solid grass with 2 air above`
  - `contains at least one water cell and sand next to it`
  - `contains at least 10 wood cells in trunks`
  - `no tree within 3 columns of spawn`
  - `every land column at the spawn plateau is reachable` (use `findPath` once Task 6 lands, so mark it `it.todo` until then)
- [ ] **Step 2:** Run, and expect FAIL. **Step 3:** Implement. **Step 4:** Run, and expect PASS.
- [ ] **Step 5:** Commit with `feat: seeded meadow world generator`.

### Task 4: Rendering

**Files:** Create `src/render/atlas.ts`, `src/render/mesher.ts`, `src/render/scene.ts`, `src/render/characters.ts`. Test `tests/render/mesher.test.ts`.

**Interfaces:**
- Consumes: `World`, `BLOCKS`.
- Produces:
  ```ts
  // mesher.ts (pure, no three import)
  export interface ChunkGeometry { positions: Float32Array; normals: Float32Array; uvs: Float32Array; indices: Uint32Array; transparent: { positions: Float32Array; normals: Float32Array; uvs: Float32Array; indices: Uint32Array } }
  export function buildChunkGeometry(world: World, cx: number, cz: number, uvFor: (id: BlockId, face: Face) => [u0:number, v0:number, u1:number, v1:number]): ChunkGeometry;
  export type Face = 'top'|'bottom'|'north'|'south'|'east'|'west';
  // atlas.ts
  export function createAtlas(): { texture: THREE.CanvasTexture; uvFor: (id: BlockId, face: Face) => [number,number,number,number]; iconDataUrl: (id: BlockId) => string };
  // scene.ts
  export class GameScene {
    constructor(host: HTMLElement, world: World);
    readonly camera: THREE.PerspectiveCamera; readonly renderer: THREE.WebGLRenderer;
    rebuildChunkAt(x: number, z: number): void;   // rebuilds the chunk containing the cell (+ neighbour if on edge)
    followTarget(pos: THREE.Vector3, heading: number, dt: number): void;
    pick(clientX: number, clientY: number): { cell: [number,number,number]; normal: [number,number,number] } | null;
    add(obj: THREE.Object3D): void;
    render(): void;
  }
  // characters.ts
  export function makePlayerModel(): THREE.Group; export function makePalModel(): THREE.Group;
  ```

Rendering details:
- Chunks are 16×16 columns. A face is emitted only when its neighbour is Air, or when it's transparent and differs from this block. Water and leaves and glass go into the transparent geometry.
- The atlas has 16×16 px tiles drawn with canvas, in a classic palette: grass top `#5aa83a`, grass side with a green top band over dirt, dirt `#8b5a2b`, stone `#9a9a9a` speckled, wood bark plus rings, leaves `#2f8f2f` with gaps, sand `#e6d690`, water `#3f8fe0` at α 0.7, planks `#b8874a` with lines, glass pale blue edges, bricks `#a8452f` with mortar, and bedrock dark grey. Use `NearestFilter`.
- Lighting is `HemisphereLight(0xffffff, 0x88aa66, 1.0)` plus a `DirectionalLight` at 0.6 with no shadows. Fog is `Fog(0x78c6ff, 20, 40)`. Pixel ratio is `Math.min(devicePixelRatio, 1.5)`.
- The camera sits about 6 behind and 4.5 above the target, looking at target + 1. Position and heading are smoothed with an exponential lerp (k = 4/s).
- `pick` uses a voxel DDA raycast from the camera ray up to 12 blocks, ignoring Water and Air, and returns the hit cell and face normal.
- The player is a blocky kid figure in original colours. The pal is a blocky orange fox-like creature called **Pip**, with big eyes. Both are made of `BoxGeometry` pieces.

- [ ] **Step 1:** Write the failing mesher tests:
  - `single block in empty world has 6 faces` (24 positions, 36 indices)
  - `two adjacent blocks hide the shared faces` (10 faces)
  - `water goes into transparent geometry`
  - `glass next to glass emits no shared face`
- [ ] **Step 2:** Run, and expect FAIL. **Step 3:** Implement the mesher. **Step 4:** Run, and expect PASS.
- [ ] **Step 5:** Implement the atlas, scene and characters. Temporarily wire `main.ts` to generate the world and render it with the camera on spawn.
- [ ] **Step 6:** Run `npm run dev`. Check on desktop that the meadow, pond, hill and trees show in a bright sky, with fog at the edges. Take a screenshot (Playwright MCP) for the reviewer.
- [ ] **Step 7:** Commit with `feat: chunk mesher, atlas and third-person scene`.

### Task 5: Inventory, Crafting and Placement Rules

**Files:** Create `src/core/inventory.ts`, `src/core/recipes.ts`, `src/core/crafting.ts`, `src/core/placement.ts`. Test `tests/core/crafting.test.ts`, `tests/core/placement.test.ts`.

**Interfaces:**
- Produces:
  ```ts
  export const MAX_STACK = 20;
  export class Inventory {
    count(id: BlockId): number;
    add(id: BlockId, n?: number): number;     // returns how many were actually added (cap 20)
    remove(id: BlockId, n?: number): boolean;  // false and no change if not enough
    hotbar(): BlockId[];                       // items with count>0, in first-collected order, max 6
    toJSON(): Record<number, number>; static fromJSON(o: unknown): Inventory; // invalid → empty
  }
  export interface Recipe { id: string; inputs: Array<{ id: BlockId; n: number }>; output: { id: BlockId; n: number }; word: string }
  export const RECIPES: Recipe[];
  export function canCraft(inv: Inventory, r: Recipe): boolean;   // also false if output already at 20
  export function craft(inv: Inventory, r: Recipe): boolean;      // atomic
  export function canPlace(world: World, cell: [number,number,number], occupied: Array<[number,number,number]>): boolean;
  export function canCollect(world: World, cell: [number,number,number]): boolean;
  export function withinReach(from: [number,number,number], cell: [number,number,number], reach?: number /* 3 */): boolean;
  ```
- `RECIPES` (exact):
  - `planks`: Wood ×1 → Planks ×2, word `"wood"`
  - `glass`: Sand ×3 → Glass ×1, word `"glass"`
  - `bricks`: Dirt ×2 + Stone ×2 → Bricks ×1, word `"brick"`
- `canPlace`: true only if the cell is in bounds, is Air or Water, and isn't any occupied cell (the player's feet and head, and the pal's cell). It also needs at least one solid face neighbour.
- `canCollect`: true if the block is collectable (not Air, Water or Bedrock).

- [ ] **Step 1:** Write the failing tests:
  - `add caps at 20 and returns amount added`
  - `remove fails without enough and changes nothing`
  - `craft planks turns 1 wood into 2 planks`
  - `craft is atomic when missing an input`
  - `cannot craft when output is full`
  - `fromJSON ignores garbage`
  - `refuses placing into occupied cell`
  - `refuses placing in mid-air with no neighbour`
  - `bedrock and water cannot be collected`
  - `withinReach uses Chebyshev distance 3`
- [ ] **Step 2:** Run, and expect FAIL. **Step 3:** Implement. **Step 4:** Run, and expect PASS.
- [ ] **Step 5:** Commit with `feat: inventory, recipes and placement rules`.

### Task 6: Pathfinding and Player Movement

**Files:** Create `src/core/pathfind.ts`, `src/game/player.ts`. Test `tests/core/pathfind.test.ts`, `tests/game/player.test.ts`.

**Interfaces:**
- Consumes: `World`.
- Produces:
  ```ts
  export type Cell = [number, number, number]; // feet cell
  export function isStandable(world: World, c: Cell): boolean; // solid below, feet+head not solid, feet not water
  export function findPath(world: World, from: Cell, to: Cell, maxNodes?: number /* 4000 */): Cell[] | null; // 4-neighbour, step up/down ≤1, excludes `from`
  export function nearestStandable(world: World, x: number, z: number): Cell | null; // stand on top of column
  export class Player {
    pos: { x: number; y: number; z: number }; heading: number; // radians
    constructor(spawn: { x: number; y: number; z: number });
    setPath(path: Cell[] | null): void;
    setStick(dx: number, dz: number): void;  // camera-relative already resolved; clears path when non-zero
    update(world: World, dt: number): void;  // speed 3.5 blocks/s, auto step-up 1, never enters non-standable cells, clamps to soft wall (1..46)
    feetCell(): Cell;
  }
  ```

- [ ] **Step 1:** Write the failing tests:
  - `straight path on flat ground`
  - `climbs a 1-block step but not 2`
  - `no path returns null and never targets water`
  - `respects maxNodes`
  - `player follows path to the end`
  - `stick movement auto-steps up 1 block`
  - `player cannot leave the soft wall`
  - `player is blocked by a 2-high wall`
- [ ] **Step 2:** Run, and expect FAIL. **Step 3:** Implement. **Step 4:** Run, and expect PASS. Then turn the Task 3 `it.todo` reachability test into a real test and make it pass.
- [ ] **Step 5:** Commit with `feat: A* pathfinding and player movement`.

### Task 7: Input — Tap and Gamepad

**Files:** Create `src/input/tap.ts`, `src/input/mapping.ts`, `src/input/gamepad.ts`. Test `tests/input/tap.test.ts`, `tests/input/gamepad.test.ts`.

**Interfaces:**
- Produces:
  ```ts
  export type Action = 'collect' | 'place' | 'nextSlot' | 'craft';
  export type TapIntent =
    | { kind: 'walk'; to: Cell }
    | { kind: 'collect'; cell: Cell }
    | { kind: 'place'; cell: Cell }
    | { kind: 'none' };
  export function resolveTap(hit: { cell: Cell; normal: Cell } | null, selected: BlockId | 'hand', playerFeet: Cell, world: World): TapIntent;
  export function createDebouncer(ms?: number /* 150 */): (key: string, now: number) => boolean; // true = allow
  export interface ButtonMapping { collect: number; place: number; nextSlot: number; axisX: number; axisY: number; invertY: boolean }
  export const DEFAULT_MAPPING: ButtonMapping; // collect:0, place:1, nextSlot:5, axisX:0, axisY:1, invertY:false
  export function loadMapping(storage: Storage | null): ButtonMapping; export function saveMapping(storage: Storage | null, m: ButtonMapping): void;
  export class GamepadInput {
    constructor(mapping: ButtonMapping, getPads?: () => (Gamepad | null)[]);
    poll(now: number): { stick: [number, number]; pressed: Action[] }; // dead-zone 0.25, d-pad buttons 12-15 also move, edge-triggered presses, 'place' held ≥1000ms → 'craft'
    captureNextButton(): Promise<number>; // for the setup screen
  }
  ```
- `resolveTap` rules:
  - With `'hand'` selected, a hit within reach that `canCollect` gives `collect`. A hit out of reach gives `walk` to the `nearestStandable` above the hit column.
  - With a block selected, a hit within reach places at `hit.cell + normal` if `canPlace` allows it. Otherwise it gives `walk` to the tapped column.
  - A miss (sky) gives `none`.

- [ ] **Step 1:** Write the failing tests:
  - `hand tap near collectable gives collect`
  - `hand tap far gives walk`
  - `block tap places on the hit face`
  - `block tap into player cell falls back to walk`
  - `sky tap gives none`
  - `debounces repeated taps` (two calls at 0 ms and 100 ms: the second is false; a call at 200 ms is true)
  - `gamepad presses are edge-triggered`
  - `dead-zone ignores small stick drift`
  - `d-pad moves when axes absent`
  - `holding place 1s emits craft once`
  - `loadMapping with null storage returns defaults`
  - `uses mapped button indices` (a fake pad)
- [ ] **Step 2:** Run, and expect FAIL. **Step 3:** Implement. **Step 4:** Run, and expect PASS.
- [ ] **Step 5:** Commit with `feat: tap intents, debounce and mapped gamepad`.

> **Superseded in v1.1:** the tap rules below are replaced by spec §7a (docs/superpowers/specs/2026-11-05-block-pals-design.md): a quick tap walks (or builds with a block selected) and never digs; press and hold for about ½ s digs. The bag holds 99 of each kind, not 20. Read §7a for the current behaviour; this note is kept as history.

**Amendment (final review):** the first tap rule ("collect anything collectable within reach 3") made most ground taps dig instead of walk, and the pick ray stopped 12 units from the camera (about 5 blocks ahead). New rule — *tap to go, tap next to you to dig*:
- The pick ray now reaches 40 units.
- With the hand selected, a hit is **collected** only when it is the top of a block right next to the player (Chebyshev ≤ 1 from the feet column, one level below the feet), a tree block (Wood or Leaves) within reach 3, or a side or bottom face within reach 3. Every other hit **walks**, including collectable blocks beyond reach.
- A walk goes to the cell in front of the tapped face (`hit.cell + normal`). The game runs one BFS from the player and walks to the reachable standable cell nearest that goal (Chebyshev x/z + |dy|; ties → fewest steps from the player), so trees, water and walls walk to a spot beside them. `noPath` only when the player cannot get any nearer; if he is in a small pit he is lifted out instead (Pip: "Up you come!").
- The block under the player's or Pip's feet is never collected.
- Each walk tap gives a soft sound and a brief ring on the ground at the destination.
- Placing with a block selected is unchanged.

### Task 8: Game Wiring and HUD

**Files:** Create `src/game/game.ts`, `src/ui/hud.ts`. Modify `src/main.ts`, `src/ui/styles.css`. Test `tests/game/game.test.ts`.

**Interfaces:**
- Consumes: everything from Tasks 2–7.
- Produces:
  ```ts
  export type GameEvent = { type: 'collected'; id: BlockId } | { type: 'placed'; id: BlockId } | { type: 'crafted'; recipe: string } | { type: 'full'; id: BlockId } | { type: 'noPath' } | { type: 'idle' };
  export class Game {
    constructor(opts: { world: World; spawn: {x:number;y:number;z:number}; inventory?: Inventory });
    readonly world: World; readonly inventory: Inventory; readonly player: Player;
    selected: BlockId | 'hand';
    on(cb: (e: GameEvent) => void): void;
    applyIntent(intent: TapIntent): void;
    selectNext(): void;            // cycles hand → hotbar items → hand
    tryCraft(recipeId: string): boolean;
    update(dt: number): void;      // player, idle timer (20s without action → 'idle')
  }
  export class Hud {
    constructor(root: HTMLElement, iconFor: (id: BlockId) => string, handlers: { onSelect(i: number): void; onCraft(): void; onGrownUps(): void });
    render(state: { hotbar: Array<{ id: BlockId; count: number }>; selected: number }): void;
    showBubble(picture: string, word?: string): void; hideBubble(): void;
    readonly blockingOverlayOpen: boolean;
  }
  ```

Game behaviour:
- Collecting removes the block, adds it to the inventory and emits `collected`. If the item is already at 20, the block stays and the game emits `full`.
- Placing removes one of the item and sets the block.
- After any world change, the game calls `scene.rebuildChunkAt`.

HUD layout:
- Bottom centre: a hotbar with a 🖐 hand slot plus up to 6 block icons. Each slot is 96 px, with its count as a large digit.
- Top right: a craft button (a crafting-table icon).
- Top left: an invisible 96 px grown-up hotspot.
- The speech bubble sits above the pal's area.
- Pointer events on the HUD call `stopPropagation`, so taps on it never reach the world.

`main.ts` connects `pointerup` on the canvas to `scene.pick`, then `resolveTap`, then the debouncer, then `game.applyIntent`. It polls the gamepad each frame, uses a `requestAnimationFrame` loop with `dt` clamped to 0.1 s, and updates the camera follow. With `?debug` in the URL, it shows a small fps counter at the top centre.

- [ ] **Step 1:** Write the failing tests:
  - `collect intent removes block and emits collected`
  - `collect at 20 emits full and keeps block`
  - `place intent uses one item`
  - `selectNext cycles hand and items`
  - `idle fires after 20s without actions`
- [ ] **Step 2:** Run, and expect FAIL. **Step 3:** Implement `Game`. **Step 4:** Run, and expect PASS.
- [ ] **Step 5:** Implement the HUD and the `main.ts` wiring. In `npm run dev`, check you can tap to walk, tap to collect, select a block, tap to place, and move with a USB or Bluetooth pad if one is available.
- [ ] **Step 6:** Commit with `feat: playable loop with HUD`.

### Task 9: Voice, Sound and British English Lines

**Files:** Create `src/audio/voice.ts`, `src/audio/sfx.ts`, `src/content/lines.ts`. Test `tests/audio/voice.test.ts`, `tests/content/lines.test.ts`.

**Interfaces:**
- Produces:
  ```ts
  export type LineKey = 'hello' | 'letsFindWood' | 'collectedFirst' | 'collectedMore' | 'full' | 'crafted' | 'placed' | 'noPath' | 'idleHint' | 'craftNeedMore' | 'breakTime' | 'welcomeBack';
  export const LINES: Record<LineKey, string[]>; // 1–3 variants each, picked at random
  export function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null; // prefer lang 'en-GB' && localService, then 'en-GB', then any 'en-*', else null
  export class Voice {
    constructor(synth?: SpeechSynthesis | null);
    say(text: string): void;   // cancels current utterance first, rate 0.9, pitch 1.1; never throws, never awaits
    readonly available: boolean;
  }
  export const sfx: { pop(): void; place(): void; craft(): void; cheer(): void; tap(): void; unlock(): void /* call on first user gesture */ };
  ```
- Lines must use short, warm sentences in British English. Exact first variants:
  - `hello`: "Hiya! I'm Pip. Let's go exploring!"
  - `letsFindWood`: "Let's find some wood. Look for a tree!"
  - `crafted`: "Brilliant! You made it!"
  - `full`: "Your bag is full of those!"
  - `noPath`: "Hmm, I can't get there. Let's try another way!"
  - `breakTime`: "Let's have a stretch! Wiggle your arms!"
  - `welcomeBack`: "You're back! I missed you!"
- Sound effects are synthesised with Web Audio (short sine or triangle blips, with no low rumbles and nothing harsh). Master gain is 0.5.

- [ ] **Step 1:** Write the failing tests:
  - `prefers local en-GB voice`
  - `falls back when no en-GB voice` (an en-US voice is returned; with no English voices, it returns null)
  - `say does nothing and does not throw when synth is null`
  - `every LineKey has at least one line`
  - `lines use British spelling`: no match for `/\b(color|favorite|gray|mom|math|center|theater|realize)\b/i`
  - `lines are short`: each is ≤ 12 words
- [ ] **Step 2:** Run, and expect FAIL. **Step 3:** Implement. **Step 4:** Run, and expect PASS.
- [ ] **Step 5:** Commit with `feat: British voice, sound effects and lines`.

### Task 10: Pip the Pal

**Files:** Create `src/game/pal.ts`. Test `tests/game/pal.test.ts`. Modify `src/main.ts`.

**Interfaces:**
- Consumes: `Game` events, `Player`, `findPath`, `LINES`, `Voice`, `Hud.showBubble`, `makePalModel`.
- Produces:
  ```ts
  export class Pal {
    pos: { x: number; y: number; z: number };
    constructor(start: { x:number;y:number;z:number }, say: (key: LineKey) => void);
    update(world: World, player: Player, dt: number): void; // keeps 2 blocks behind-ish; re-paths when >3 away; teleports beside player if >10 away or stuck 3s
    handle(e: GameEvent): void; // maps events → line keys, with ≥4s between lines (except 'crafted' and 'breakTime', which always speak)
    feetCell(): Cell;
  }
  ```
- Events map to lines like this:
  - The first `collected` gives `collectedFirst`. Every 5th gives `collectedMore`.
  - `crafted` gives `crafted` plus a little jump animation.
  - `full` gives `full`, `noPath` gives `noPath`, and `idle` gives `idleHint` (or `letsFindWood` if he has no wood).
  - On start, Pip says `hello` (or `welcomeBack` if there's a save).

- [ ] **Step 1:** Write the failing tests:
  - `stays within 3 blocks after updates`
  - `teleports beside the player when far`
  - `rate-limits chatter to 4s`
  - `crafted always speaks`
  - `idle with no wood says letsFindWood`
- [ ] **Step 2:** Run, and expect FAIL. **Step 3:** Implement and wire Pip into `main.ts`. Pip's cell goes into `canPlace` occupied cells, and the speech bubble shows the line's icon. **Step 4:** Run, and expect PASS. Then check in the browser that Pip follows and talks.
- [ ] **Step 5:** Commit with `feat: Pip the pal follows and cheers`.

### Task 11: Picture Crafting Screen

**Files:** Create `src/ui/craft.ts`. Modify `src/ui/styles.css`, `src/main.ts`.

**Interfaces:**
- Consumes: `RECIPES`, `canCraft`, `Game.tryCraft`, `iconDataUrl`, `Voice`.
- Produces: `export class CraftScreen { constructor(root: HTMLElement, deps: {...}); open(): void; close(): void; readonly isOpen: boolean }`.

Layout: a full-screen overlay with one big row per recipe: `[icon ×n] + [icon ×n] = [icon ×n]`. Each count is a large digit with that number of small dots under it. The "make" button is a big green ✔. A recipe he can't make yet is dimmed, and tapping it says `craftNeedMore` and pulses the missing input. Tapping any icon speaks its simple word. Close is a big ✖ at the top right. The gamepad can use left/right to choose, collect to make, and place to close. The game pauses player movement while the screen is open.

- [ ] **Step 1:** Implement it. Open it from the HUD button and the gamepad hold, and wire the success path to the `crafted` event (Pip cheers, `sfx.craft`).
- [ ] **Step 2:** Add a Playwright step in `e2e/smoke.spec.ts` (created in Task 14), or test it by hand now: give the inventory 1 Wood through `window.__debug`, available in dev builds only, then open craft, tap ✔ on planks, and expect Planks ×2 in the hotbar.
- [ ] **Step 3:** Commit with `feat: picture crafting screen`.

### Task 12: Save and Load

**Files:** Create `src/core/save.ts`. Test `tests/core/save.test.ts`. Modify `src/main.ts`.

**Interfaces:**
- Produces:
  ```ts
  export const SAVE_KEY = 'blockpals.save.v1';
  export interface SaveData { version: 1; seed: number; edits: Array<[number,number,number,number]>; inventory: Record<number, number>; player: { x:number;y:number;z:number } }
  export function serialise(game: Game, seed: number): SaveData;
  export function parseSave(raw: string | null): SaveData | null;        // null on garbage, wrong version, bad shapes
  export function applySave(data: SaveData): { world: World; inventory: Inventory; spawn: {x:number;y:number;z:number} }; // regenerate seed then replay edits; spawn falls back to generated spawn if saved pos not standable
  export function storeSave(storage: Storage | null, data: SaveData): boolean;  // catches quota/security errors → false
  export function readSave(storage: Storage | null): SaveData | null;
  ```

The game saves every 10 s when `world.edits()` or the inventory changed, and also on `visibilitychange` to hidden.

- [ ] **Step 1:** Write the failing tests:
  - `round-trips a game with edits and inventory`
  - `ignores corrupt save` (inputs `"{"`, `"null"`, `{version:2}` and edits with out-of-range ids)
  - `storeSave returns false when setItem throws`
  - `readSave with null storage returns null`
  - `unstandable saved position falls back to spawn`
- [ ] **Step 2:** Run, and expect FAIL. **Step 3:** Implement and wire it into `main.ts`. **Step 4:** Run, and expect PASS.
- [ ] **Step 5:** Commit with `feat: local save and load`.

### Task 13: Usage Time, Break Reminders and the Grown-Up Area

**Files:** Create `src/core/usage.ts`, `src/core/gate.ts`, `src/ui/grownups.ts`. Test `tests/core/usage.test.ts`, `tests/core/gate.test.ts`. Modify `src/main.ts`.

**Interfaces:**
- Produces:
  ```ts
  export const USAGE_KEY = 'blockpals.usage.v1';
  export const REMINDER_OPTIONS = [0, 10, 15, 20, 30, 45, 60] as const; // minutes, 0 = off; default 20
  export class UsageTracker {
    constructor(storage: Storage | null, now?: () => Date);
    tick(deltaMs: number, visible: boolean): { remind: boolean }; // counts only when visible; delta capped at 5000; remind once per interval of continuous session play
    minutesOn(dateKey: string): number;          // dateKey 'YYYY-MM-DD' local
    last7Days(): Array<{ date: string; minutes: number }>; // oldest → today
    reminderMinutes: number;                     // persisted
    resetSessionTimer(): void;                    // after a reminder is dismissed
    flush(): void;                                // persist (called every 15s and on hide)
  }
  export function makeSum(rng?: () => number): { a: number; b: number; answer: number }; // a,b in 3..9, answer 7..18 — a grown-up sum, not one he can do yet
  export function checkSum(s: { answer: number }, input: string): boolean;
  ```

How the tracker behaves:
- Data is kept for 30 days and older days are pruned.
- The reminder is gentle and can be dismissed. Pip says `breakTime`, the bubble shows 🤸 with a big ✔ to carry on, and the game is never locked.

The grown-up area works like this:
- **The gate:** he holds the invisible top-left hotspot for 3000 ms, a ring fills, and then a sum appears with a number pad. A wrong answer closes the gate quietly.
- **Inside**, in plain adult British English (small text is fine here):
  - Today's minutes, plus a 7-day bar list.
  - A reminder interval selector built from `REMINDER_OPTIONS`.
  - "Set up controller", which captures each action with `GamepadInput.captureNextButton` and then calls `saveMapping`.
  - "Reset progress", with a confirm step. It clears `SAVE_KEY` and reloads, and keeps usage history.

- [ ] **Step 1:** Write the failing tests:
  - `counts only while visible`
  - `caps delta at 5 seconds`
  - `rolls over at midnight` (fake clock 23:59:30 → 00:00:30 splits across two date keys)
  - `reminds once after the interval, then again after reset`
  - `reminder 0 never reminds`
  - `prunes days older than 30`
  - `survives null storage`
  - `makeSum answer in 7..18`
  - `checkSum trims and rejects non-numbers`
- [ ] **Step 2:** Run, and expect FAIL. **Step 3:** Implement the logic (Codex). **Step 4:** Run, and expect PASS.
- [ ] **Step 5:** Implement `grownups.ts` and wire it in (Claude). In the browser, check that the hold opens the gate, a wrong sum closes it, the settings save across a reload, and a 1-minute test interval triggers Pip's stretch line.
- [ ] **Step 6:** Commit with `feat: usage tracking, break reminders and grown-up area`.

### Task 14: Offline Install, Deploy and Smoke Test

**Files:** Modify `vite.config.ts`. Create `.github/workflows/deploy.yml`, `e2e/smoke.spec.ts`, `playwright.config.ts`, `README.md`.

**Interfaces:**
- Consumes: the whole app.

PWA settings:
- `VitePWA({ registerType: 'autoUpdate', workbox: { globPatterns: ['**/*.{js,css,html,png,svg}'] } })`.
- Manifest: name "Block Pals", short_name "Block Pals", `display: 'fullscreen'`, `orientation: 'landscape'`, theme `#5aa83a`, background `#78c6ff`, the icons from Task 1, `start_url: '/block-pals/'`, `lang: 'en-GB'`.

Deploy workflow: on push to `main`, run `npm ci`, `npm test` and `npm run build`, then `actions/upload-pages-artifact` from `dist` and `actions/deploy-pages`.

- [ ] **Step 1:** Write `e2e/smoke.spec.ts` against `npm run preview`, using a tablet landscape viewport of 1280×800 with `hasTouch`:
  - `loads with canvas and hotbar and no console errors`
  - `tap on ground moves the player` (compare `window.__debug.playerPos()` before and after)
  - `craft planks via debug inventory`
  - `works offline after first load` (`context.setOffline(true)`, then reload, then the canvas is still present)
- [ ] **Step 2:** Run `npm run build && npm run e2e`. Expected: all pass. Make sure `window.__debug` is stripped from the production build, or gated by `import.meta.env.DEV || location.search.includes('debug')`.
- [ ] **Step 3:** Add the PWA plugin and the workflow. Write the `README.md`, with how to run it, deploy it, and add it to the home screen on the Tab A8.
- [ ] **Step 4:** Commit with `feat: offline PWA, Pages deploy and smoke tests`.
- [ ] **Step 5: Ask the parent before pushing.** Create the GitHub repo `block-pals` on their account (`gh repo create block-pals --public --source . --push`, or private if they prefer, which needs a paid plan for Pages). Set Pages to "GitHub Actions" and confirm the site URL loads.
- [ ] **Step 6: Tablet playtest checklist** (the parent does this on the Tab A8 with the pad):
  - It installs to the home screen and opens full-screen in landscape.
  - It feels smooth (≥30 fps): open with `?debug` to show the fps counter.
  - Pip speaks in a British voice.
  - Tap-to-walk, collect, place and craft all work.
  - The controller setup works with the generic pad.
  - It works in aeroplane mode.
  - A break reminder appears at the set interval.

  Record the problems found as new tasks.
