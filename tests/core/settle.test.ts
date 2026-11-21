import { describe, expect, test } from 'vitest';
import { BLOCKS, BlockId } from '../../src/core/blocks';
import { isStandable, settleCell, type Cell } from '../../src/core/pathfind';
import { applySave, type SaveData } from '../../src/core/save';
import { World } from '../../src/core/world';
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

  test('a saved spot inside the tower falls back to the spawn, and a spawn filled with Bricks moves to the nearest free cell', () => {
    const [wx, wy, wz] = gen.tower.wizardSpot;
    const a = applySave(base({ edits: fill(s), player: { x: wx + 1.5, y: wy, z: wz + 0.5 } }));
    const at = cellOf(a.spawn);
    free(a.world, at);
    // The nearest free standing cell: beside his 2-high pillar on the same ground (1 sideways)
    // rather than on top of it (2 up).
    expect(Math.max(Math.abs(at[0] - s[0]), Math.abs(at[2] - s[2]))).toBe(1);
    expect(Math.abs(at[1] - s[1])).toBeLessThanOrEqual(1);
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

describe('settleCell is total (recheck findings 1 and 2)', () => {
  test('a neighbour standing cell at the ORIGINAL height is found (pillar to the ceiling beside a flat floor)', () => {
    const w = new World(9, 10, 9);
    for (let x = 0; x < 9; x++) for (let z = 0; z < 9; z++) { w.set(x, 0, z, BlockId.Bedrock); w.set(x, 1, z, BlockId.Stone); }
    for (let y = 2; y < 10; y++) w.set(4, y, 4, BlockId.Bricks);
    const c = settleCell(w, [4, 2, 4]);
    free(w, c);
    expect(c[1]).toBe(2);
    expect(Math.max(Math.abs(c[0] - 4), Math.abs(c[2] - 4))).toBe(1);
  });

  test('a flooded spawn area (every column round the spawn filled to the sky) still gives a free cell', () => {
    const s = cellOf(gen.spawn);
    const edits: Array<[number, number, number, number]> = [];
    for (let dx = -9; dx <= 9; dx++) for (let dz = -9; dz <= 9; dz++) {
      for (let y = 49; y < 68; y++) edits.push([s[0] + dx, y, s[2] + dz, BlockId.Bricks]);
    }
    const a = applySave(base({ edits, player: { x: s[0] + 0.5, y: s[1], z: s[2] + 0.5 } }));
    free(a.world, cellOf(a.spawn));
    free(a.world, settleCell(a.world, [s[0] + 1, s[1], s[2] + 1])); // Pip's start
  });

  test('a world with no free cell anywhere near returns a non-solid cell, never the buried input', () => {
    const w = new World(5, 6, 5);
    for (let x = 0; x < 5; x++) for (let z = 0; z < 5; z++) for (let y = 0; y < 6; y++) w.set(x, y, z, BlockId.Stone);
    const c = settleCell(w, [2, 2, 2]);
    expect(solid(w, c)).toBe(false);
    expect(solid(w, [c[0], c[1] + 1, c[2]])).toBe(false);
  });
});
