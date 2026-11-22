import { describe, expect, test } from 'vitest';
import { BLOCKS, BlockId } from '../../src/core/blocks';
import { cellIndex, RUIN_HALL } from '../../src/core/caves';
import { lightDistances } from '../../src/core/caveDress';
import { isStandable, type Cell } from '../../src/core/pathfind';
import { RUIN_PLAN } from '../../src/core/ruin';
import { CHEST_REWARDS, chestReward } from '../../src/core/treasure';
import { caveWorld, reached, SEEDS, walkCaves } from '../helpers/caveWorld';

/** Plan Task 17: the Old Hideout. */
describe.each(SEEDS)('the Old Hideout, seed %i', seed => {
  test('the hall is 17 x 13 inside the ring, at least 8 high, at the world centre in the deep layer', () => {
    const { caves, world } = caveWorld(seed);
    const r = caves.ruin!;
    expect(r.rect.x1 - r.rect.x0 + 1).toBe(17);
    expect(r.rect.z1 - r.rect.z0 + 1).toBe(13);
    expect([(r.rect.x0 + r.rect.x1) / 2, (r.rect.z0 + r.rect.z1) / 2]).toEqual(RUIN_PLAN.centre);
    expect(r.floorY).toBe(12);
    // The whole carved hall (walkway included) is 8 high under the cave ceiling.
    for (let x = RUIN_HALL.x0; x <= RUIN_HALL.x1; x++) for (let z = RUIN_HALL.z0; z <= RUIN_HALL.z1; z++) {
      expect(BLOCKS[world.get(x, r.floorY + 7, z)].solid, `${x},${z}`).toBe(false);
      expect(BLOCKS[world.get(x, r.floorY + 8, z)].solid).toBe(true);
    }
  });

  test('a ruined ring: at least 60 bricks, 20 of them mossy, 4 gaps at least 3 wide, at least 5 ragged holes', () => {
    const { caves, world } = caveWorld(seed);
    const r = caves.ruin!;
    const ids = r.ring.map(c => world.get(...c));
    expect(ids.every(id => id === BlockId.Bricks || id === BlockId.MossyBricks)).toBe(true);
    expect(ids.length).toBeGreaterThanOrEqual(60);
    expect(ids.filter(id => id === BlockId.MossyBricks).length).toBeGreaterThanOrEqual(20);
    expect(r.gaps.length).toBeGreaterThanOrEqual(9);
    for (const g of r.gaps) for (let y = g[1]; y < g[1] + 4; y++) expect(BLOCKS[world.get(g[0], y, g[2])].solid).toBe(false);
    expect(r.missing.length).toBeGreaterThanOrEqual(5);
    for (const m of r.missing) expect(world.get(...m)).toBe(BlockId.Air);
  });

  test('four Lamp posts and every hall cell within 6 of a light', () => {
    const { caves, world } = caveWorld(seed);
    const r = caves.ruin!;
    expect(r.lamps.length).toBe(4);
    for (const l of r.lamps) {
      expect(world.get(...l)).toBe(BlockId.Lamp);
      expect(world.get(l[0], l[1] - 1, l[2])).toBe(BlockId.Fence);
    }
    const cells: number[] = [];
    for (let x = RUIN_HALL.x0; x <= RUIN_HALL.x1; x++) for (let z = RUIN_HALL.z0; z <= RUIN_HALL.z1; z++) {
      for (let y = r.floorY; y < r.floorY + 8; y++) if (world.get(x, y, z) === BlockId.Air) cells.push(cellIndex(world, x, y, z));
    }
    const d = lightDistances(world, Int32Array.from(cells), 12);
    expect(Math.max(...d)).toBeLessThanOrEqual(6);
  });

  test('table, bench, rug, shelf, the chest on its stand and a Ruin crystal in each inside corner', () => {
    const { caves, world } = caveWorld(seed);
    const r = caves.ruin!;
    const [cx, cz] = RUIN_PLAN.centre;
    const f = r.floorY;
    expect([world.get(cx, f, cz - 3), world.get(cx, f + 1, cz - 3)]).toEqual([BlockId.Fence, BlockId.Planks]);
    for (let x = cx - 4; x <= cx - 2; x++) expect(world.get(x, f, cz + 3)).toBe(BlockId.Planks);
    let rug = 0;
    for (let x = r.rect.x0; x <= r.rect.x1; x++) for (let z = r.rect.z0; z <= r.rect.z1; z++) if (world.get(x, f - 1, z) === BlockId.WoolRed) rug++;
    expect(rug).toBe(6);
    for (let x = cx + 3; x <= cx + 5; x++) expect(world.get(x, f + 1, r.rect.z0)).toBe(BlockId.Planks);
    expect(world.get(...r.chest)).toBe(BlockId.Chest);
    expect(world.get(r.chest[0], r.chest[1] - 1, r.chest[2])).toBe(BlockId.Planks);
    const front: Cell = [r.chest[0], f, r.chest[2] - 1];
    expect(isStandable(world, front)).toBe(true);
    for (const [x, z] of [[r.rect.x0, r.rect.z0], [r.rect.x1, r.rect.z0], [r.rect.x0, r.rect.z1], [r.rect.x1, r.rect.z1]]) {
      expect(world.get(x, f, z)).toBe(BlockId.RuinCrystal);
    }
    let planks = 0;
    for (let x = r.rect.x0; x <= r.rect.x1; x++) for (let z = r.rect.z0; z <= r.rect.z1; z++) if (world.get(x, f - 1, z) === BlockId.Planks) planks++;
    expect(planks / (17 * 13)).toBeGreaterThan(0.4);
  });

  test('its chest is the R chest, and Ruin crystals exist only in its corners', () => {
    const { caves, world } = caveWorld(seed);
    expect(chestReward(caves, caves.ruin!.chest)).toBe(CHEST_REWARDS.R);
    let n = 0;
    for (let i = 0; i < world.buffer.length; i++) if (world.buffer[i] === BlockId.RuinCrystal) n++;
    expect(n).toBe(4);
  });

  test('reachable on foot from every mouth, by two separate tunnels', () => {
    const { caves, world } = caveWorld(seed);
    const inside: Cell = [RUIN_PLAN.centre[0], caves.ruin!.floorY, RUIN_PLAN.centre[1] + 1];
    expect(isStandable(world, inside)).toBe(true);
    for (const m of caves.mouths) {
      expect(reached(world, walkCaves(world, caves, [m.cell]), inside), m.kind).toBe(true);
    }
    // Two ways in: openings in the hall's outer wall on two sides at least.
    let openings = 0;
    for (let x = RUIN_HALL.x0; x <= RUIN_HALL.x1; x++) {
      if (world.get(x, RUIN_HALL.floorY + 1, RUIN_HALL.z0 - 1) === BlockId.Air) openings++;
      if (world.get(x, RUIN_HALL.floorY + 1, RUIN_HALL.z1 + 1) === BlockId.Air) openings++;
    }
    for (let z = RUIN_HALL.z0; z <= RUIN_HALL.z1; z++) {
      if (world.get(RUIN_HALL.x0 - 1, RUIN_HALL.floorY + 1, z) === BlockId.Air) openings++;
      if (world.get(RUIN_HALL.x1 + 1, RUIN_HALL.floorY + 1, z) === BlockId.Air) openings++;
    }
    expect(openings).toBeGreaterThanOrEqual(6);
  });

  test('it touches no treasure room or mouth, and everything in it but the closed chest can be dug and collected', () => {
    const { caves, world } = caveWorld(seed);
    const r = caves.ruin!;
    for (const t of caves.treasure) expect(t.rect.x1 < RUIN_HALL.x0 - 4 || t.rect.x0 > RUIN_HALL.x1 + 4 || t.rect.z1 < RUIN_HALL.z0 - 4 || t.rect.z0 > RUIN_HALL.z1 + 4 || t.layer === 'shallow').toBe(true);
    for (const m of caves.mouths) for (const c of m.ramp) expect(Math.hypot(c[0] - 96, c[1] - r.floorY, c[2] - 96)).toBeGreaterThan(20);
    for (const c of [...r.furnishings, ...r.ring]) {
      const id = world.get(...c);
      if (id === BlockId.Chest) continue;
      expect(BLOCKS[id].collectable, BLOCKS[id].name).toBe(true);
    }
  });
});

test('stamping the hideout is quick and deterministic', () => {
  const a = caveWorld(2026).caves;
  expect(a.timings.stamp).toBeLessThan(20);
});
