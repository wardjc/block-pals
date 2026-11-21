import { describe, expect, test } from 'vitest';
import { BLOCKS, BlockId } from '../../src/core/blocks';
import { isStandable, settleCell, type Cell } from '../../src/core/pathfind';
import { applySave, type SaveData } from '../../src/core/save';
import type { World } from '../../src/core/world';
import { generateWorld } from '../../src/core/worldgen';

/**
 * Review finding 5: after his edits replay, every body (him, Pip, Orlo, the villagers) must stand
 * in a free cell of the REAL replayed world: never buried, never in the void, never inside a block.
 */
const gen = generateWorld(2026);
const base = (patch: Partial<SaveData> = {}): SaveData => ({
  version: 3, gen: 4, origin: [48, 48, 48], seed: 2026, edits: [], inventory: {},
  player: { x: gen.spawn.x + 0.5, y: gen.spawn.y, z: gen.spawn.z + 0.5 }, flags: { ledToVillage: true }, ...patch,
});
const solid = (w: World, [x, y, z]: Cell): boolean => BLOCKS[w.get(x, y, z)].solid;
const free = (w: World, c: Cell): void => {
  expect(isStandable(w, c), c.join()).toBe(true);
  expect(solid(w, c) || solid(w, [c[0], c[1] + 1, c[2]]), c.join()).toBe(false);
};
const fill = (c: Cell, h = 2): Array<[number, number, number, number]> =>
  Array.from({ length: h }, (_, k) => [c[0], c[1] + k, c[2], BlockId.Bricks] as [number, number, number, number]);
const cellOf = (p: { x: number; y: number; z: number }): Cell => [Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)];

describe('settleCell', () => {
  test('a free standing cell is left as it is', () => {
    const c = cellOf(gen.spawn);
    expect(settleCell(gen.world, c)).toEqual(c);
  });
});

describe('bodies after his edits replay', () => {
  const s = cellOf(gen.spawn);

  test('a saved spot inside the tower falls back to the spawn, and a spawn filled with Bricks is lifted to a free cell above', () => {
    const [wx, wy, wz] = gen.tower.wizardSpot;
    const a = applySave(base({ edits: fill(s), player: { x: wx + 1.5, y: wy, z: wz + 0.5 } }));
    const at = cellOf(a.spawn);
    free(a.world, at);
    expect([at[0], at[2]]).toEqual([s[0], s[2]]);
    expect(at[1]).toBe(s[1] + 2);
  });

  test('a block in his own saved cell never leaves him inside it', () => {
    const p: Cell = [s[0] + 3, gen.world.topSolidY(s[0] + 3, s[2]) + 1, s[2]];
    const a = applySave(base({ edits: fill(p, 1), player: { x: p[0] + 0.5, y: p[1], z: p[2] + 0.5 } }));
    free(a.world, cellOf(a.spawn));
  });

  test('a spawn whose ground was dug away is never in the void', () => {
    const dig: Array<[number, number, number, number]> = [1, 2, 3].map(k => [s[0], s[1] - k, s[2], BlockId.Air]);
    const a = applySave(base({ edits: dig, player: { x: 300, y: 300, z: 300 } }));
    free(a.world, cellOf(a.spawn));
  });

  test('a block at the wizard\'s standing spot never buries Orlo', () => {
    const w = gen.tower.wizardSpot;
    const a = applySave(base({ edits: fill(w) }));
    free(a.world, a.tower.wizardSpot);
    expect(a.world.get(...w)).toBe(BlockId.Bricks); // his edit still wins
  });

  test('a block at a villager\'s spot never buries the villager', () => {
    for (const house of gen.village.houses) {
      const a = applySave(base({ edits: fill(house.npcSpot) }));
      const h = a.village.houses.find(x => x.id === house.id)!;
      free(a.world, h.npcSpot);
    }
  });

  test('Pip\'s start beside him is checked the same way (settleCell on a filled cell)', () => {
    const pip: Cell = [s[0] + 1, s[1], s[2] + 1];
    const a = applySave(base({ edits: fill(pip) }));
    free(a.world, settleCell(a.world, pip));
  });
});
