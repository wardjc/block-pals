# Grumps and friendly weapons: chunk A, reconciled with main (2026-11-25)

Chunk A is tasks 1 to 3 of `2026-11-08-grumps-and-friendly-weapons.md`. The plan predates the caves update and the wizard. The spec and the plan's Global Constraints stay binding; where the plan's numbers are stale, these rulings apply to chunk A and to later chunks.

| Plan said | Main has | Ruling |
|---|---|---|
| World about 120 x 64 x 80, farm zone numbers from the meadow | 192 x 68 x 192, layout in world coordinates (+48) | Never hard-code zone numbers. The zone (task 4) is computed from the layout. Not touched in chunk A. |
| Save `blockpals.save.v2`, version 2 | Key `blockpals.save.v3` | New save fields (task 10) stay additive and optional on v3. The key and migration logic are untouched by chunk A; weapon entries ride the existing `items` validation, which accepts any registered `ItemId`. |
| Item ids 120 to 123 new | `Gem = 123` exists (caves) | Chunk A adds only 120 to 122 (`BubbleBlaster`, `MagicWand`, `WaterSquirter`). 111 to 119 stay reserved for baked foods. |
| Mythical and cave block ids not mentioned | Mythical 40 to 55 (48 to 55 free), caves 56 to 64, 65 to 71 reserved | The weapons are items, not blocks: no block id is used. Weapon recipes use existing blocks (Glass, Planks, Stone, Yellow and Blue wool). |
| `ItemDef.kind` is seed, food or gift | same | Adds `'tool'` and an optional `weapon` kind. Weapons are not edible, not feed, not seeds. |
| Recipes list ends at the wool recipes | same, 7 recipes | Three recipes are appended (`bubble-blaster`, `magic-wand`, `water-squirter`), each `once: true`. An owned weapon cannot be made again; the craft row shows a tick, no digits, no dots, no make button. |
| Wander core extracted from step 2's `Herd` | `Herd` in `src/game/animals.ts` (hand-tuned state machine) | `src/game/wander.ts` holds the shared primitives lifted out unchanged: `pickTarget`, `moveToward`, `bestNeighbour`, `nearestFree`, `rescue`, plus `stepWander` (the greedy loop grumps will use). `Herd` calls the primitives in the same order with the same random draws. The herd's own states (come, graze, happy, pen check) stay in `animals.ts`. `tests/game/animals*.test.ts` are untouched. |
| Pip lines per the lines policy | Lines policy plus `speechPolicy.ts` (`HELD_KEYS`) and the wizard's speech rules (Orlo has his own voice and lines) | Chunk A adds no lines. Later chunks: Pip's grump lines follow the existing policy tests and decide per key whether it joins `HELD_KEYS`; Orlo's lines and voice are never reused or changed for grumps. A grump never appears in the tower or caves (surface farm only; invariant test in task 4). |
| Gems are a grump reward | Gem is also dug in caves, in chests, and traded to the wizard | One shared stack. Nothing about it changes in chunk A. |

## Existing pins updated (additive only)

These tests pinned lists that the plan deliberately extends. Only the pinned list changed; no behaviour assertion was weakened.

- `tests/core/items.test.ts`: the id list gains 120 to 122.
- `tests/core/caveBlocks.test.ts`: "111..122 stay free" becomes "111..119 stay free".
- `tests/ui/craft.test.ts` and `tests/ui/smallscreen.test.ts`: the recipe list and row count (7) become 10.

## Gate notes

Generation-timing tests (`worldInvariants`, `caves`, `caveLights`, `pathScale`) are load-sensitive; run them alone if the machine is busy.

## Chunk B rulings (tasks 4 to 7, 9, 10, 11; no graphics, no `game.ts` wiring)

- **Zone** (`src/core/farmZone.ts`): plot grown 3 west, north and east, ending 2 cells before the pasture fence, in world coordinates, computed from the layout. `plannedFarmZone()` gives the same rectangle from the fixed village plan so the save can check positions without generating a world (a test pins that they agree). Avoided cells are within 2 of any door, house rectangle, the plot-to-gate path or the village route.
- **Entities** (`src/game/grumps.ts`): grumps and friends share one id counter (a friend keeps the id of the grump it was), so `hit(friendId)` is ignored. They use the shared wander core. Personal space is a `WanderRules.allow` veto plus a rescue that never lifts a grump closer to him; friends use the same veto with no 4-block floor.
- **Plant pause**: `Farm.advance(ms, paused?)` skips the time for a paused record and changes nothing else. `pauseFor(step, pauses)` returns undefined for any step over 5 s, so time away is never paused. `plantCells()` and `growingNear()` are new read-only helpers.
- **Save**: `grumps`, `friends` and `grumpStats` are additive optional fields on v3 only (v1 and v2 payloads ignore them). Positions are tenths of a block. A bad grump is dropped, a friend is never dropped (a bad place becomes the zone centre and the game lifts it to a free cell on restore). Timers are restored as saved, never counted down offline. `serialise` takes a new last parameter and `applySave` returns `grumps`; `main.ts` wiring is chunk C. Five hint names are added to `HINT_NAMES`.
- **Rewards**: a roll that does not fit falls through to the next fitting gift; a friend always brings one Gem if it fits.
