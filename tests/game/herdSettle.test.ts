import { describe, expect, test } from 'vitest';
import { BLOCKS, BlockId } from '../../src/core/blocks';
import { isStandable } from '../../src/core/pathfind';
import { mulberry32 } from '../../src/core/rng';
import { applySave, type SaveData } from '../../src/core/save';
import { generateWorld } from '../../src/core/worldgen';
import { DEFAULT_HERD, Herd } from '../../src/game/animals';

/** Recheck finding 4: with the pasture flooded by his edits, no animal is ever left inside a block, and none is lost. */
describe('herd restore when edits flood the pasture', () => {
  test('ten animals, every one standing in a free cell', () => {
    const gen = generateWorld(2026);
    const p = gen.village.farm.pasture;
    const edits: Array<[number, number, number, number]> = [];
    for (let x = p.x0 - 9; x <= p.x1 + 9; x++) for (let z = p.z0 - 9; z <= p.z1 + 9; z++) {
      // Bricks to the sky with a layer of water on top: no standing cell left in any pasture column.
      for (let y = 49; y < 67; y++) edits.push([x, y, z, BlockId.Bricks]);
      edits.push([x, 67, z, BlockId.Water]);
    }
    const data: SaveData = {
      version: 3, gen: 4, origin: [48, 48, 48], seed: 2026, edits, inventory: {},
      player: { x: gen.spawn.x + 0.5, y: gen.spawn.y, z: gen.spawn.z + 0.5 }, flags: { ledToVillage: true },
      animals: [[0, p.x0 + 2.5, 55, p.z0 + 2.5, 0, 0]],
    };
    const a = applySave(data);
    const roam = { x0: p.x0 + 1, z0: p.z0 + 1, x1: p.x1 - 1, z1: p.z1 - 1 };
    const herd = new Herd(mulberry32(1));
    herd.restore(a.animals, a.village.farm.herdSpawns, a.world, roam, 0);
    const total = Object.values(DEFAULT_HERD).reduce((s, n) => s + n, 0);
    expect(herd.animals.length).toBe(total);
    for (const o of herd.animals) {
      const c: [number, number, number] = [Math.floor(o.x), Math.floor(o.y), Math.floor(o.z)];
      expect(BLOCKS[a.world.get(...c)].solid, c.join()).toBe(false);
      expect(isStandable(a.world, c), c.join()).toBe(true);
    }
  }, 60_000);
});
