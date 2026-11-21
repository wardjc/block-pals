import { describe, expect, test } from 'vitest';
import { BlockId, isCarriable } from '../../src/core/blocks';
import { GLOWS } from '../../src/core/caveDress';
import { roomCentre } from '../../src/core/caves';
import { Inventory } from '../../src/core/inventory';
import { ItemId, isStackId } from '../../src/core/items';
import { isStandable, type Cell } from '../../src/core/pathfind';
import { applySave, serialise } from '../../src/core/save';
import { canOpen, CHEST_REWARDS, chestReward, openChest, STRAY_REWARD } from '../../src/core/treasure';
import { World } from '../../src/core/world';
import { generateWorld } from '../../src/core/worldgen';
import { Game } from '../../src/game/game';
import { caveWorld, reached, SEEDS, walkCaves } from '../helpers/caveWorld';

/** Plan Task 16: the three hidden treasure rooms and the chests. */

const front = (t: { chest: Cell; dir: [number, number]; floorY: number }): Cell => [t.chest[0] - t.dir[0], t.floorY, t.chest[2] - t.dir[1]];

describe.each(SEEDS)('treasure rooms, seed %i', seed => {
  test('three rooms: T0 and T1 shallow, T2 deep, each 7 x 7 inside and 5 high, off different main rooms', () => {
    const { caves, world } = caveWorld(seed);
    expect(caves.treasure.map(t => [t.id, t.layer])).toEqual([['T0', 'shallow'], ['T1', 'shallow'], ['T2', 'deep']]);
    expect(new Set(caves.treasure.map(t => t.host)).size).toBe(3);
    for (const t of caves.treasure) {
      expect(t.rect.x1 - t.rect.x0 + 1).toBe(7);
      expect(t.rect.z1 - t.rect.z0 + 1).toBe(7);
      // Every interior cell is open 5 high (except the furnishings).
      const furn = new Set(t.furnishings.map(c => c.join(',')));
      for (let x = t.rect.x0; x <= t.rect.x1; x++) for (let z = t.rect.z0; z <= t.rect.z1; z++) {
        for (let y = t.floorY; y < t.floorY + 5; y++) {
          if (!furn.has(`${x},${y},${z}`)) expect(world.get(x, y, z), `${t.id} ${x},${y},${z}`).toBe(BlockId.Air);
        }
        expect(world.get(x, t.floorY + 5, z)).not.toBe(BlockId.Air);
      }
    }
  });

  test('each room is reachable on foot from the cave network and from a mouth', () => {
    const { caves, world } = caveWorld(seed);
    const fromMouths = walkCaves(world, caves, caves.mouths.map(m => m.cell));
    for (const t of caves.treasure) {
      expect(reached(world, fromMouths, front(t)), t.id).toBe(true);
      const fromHost = walkCaves(world, caves, [roomCentre(world, caves.rooms[t.host])]);
      expect(reached(world, fromHost, front(t)), t.id).toBe(true);
    }
  });

  test('the entrance is lit (a light within 3 of the archway) and has DoorFrame jambs and a lintel', () => {
    const { caves, world } = caveWorld(seed);
    for (const t of caves.treasure) {
      const [ex, ey, ez] = t.entrance;
      let lit = false;
      for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) for (let dz = -3; dz <= 3; dz++) {
        if (Math.hypot(dx, dy, dz) <= 3 && GLOWS.has(world.get(ex + dx, ey + dy, ez + dz))) lit = true;
      }
      expect(lit, t.id).toBe(true);
      const lx = -t.dir[1], lz = t.dir[0];
      expect(world.get(ex + 2 * lx, ey, ez + 2 * lz)).toBe(BlockId.DoorFrame);
      expect(world.get(ex - 2 * lx, ey, ez - 2 * lz)).toBe(BlockId.DoorFrame);
      expect(world.get(ex, ey + 4, ez)).toBe(BlockId.DoorFrame);
      expect(isStandable(world, t.entrance)).toBe(true);
    }
  });

  test('the chest stands on a Planks table, with a clear standable cell in front of it; two glowing blocks inside', () => {
    const { caves, world } = caveWorld(seed);
    for (const t of caves.treasure) {
      expect(world.get(...t.chest)).toBe(BlockId.Chest);
      expect(world.get(t.chest[0], t.chest[1] - 1, t.chest[2])).toBe(BlockId.Planks);
      expect(isStandable(world, front(t))).toBe(true);
      let glow = 0;
      for (let x = t.rect.x0; x <= t.rect.x1; x++) for (let z = t.rect.z0; z <= t.rect.z1; z++) {
        if (GLOWS.has(world.get(x, t.floorY, z))) glow++;
      }
      expect(glow, t.id).toBeGreaterThanOrEqual(2);
    }
  });

  test('rooms keep 2 clear of other rooms, tunnels, mouths and each other; 20 from every mouth and each other', () => {
    const { caves, world } = caveWorld(seed);
    for (const t of caves.treasure) {
      const cx = (t.rect.x0 + t.rect.x1) / 2, cz = (t.rect.z0 + t.rect.z1) / 2;
      for (const m of caves.mouths) expect(Math.hypot(m.cell[0] - cx, m.cell[2] - cz)).toBeGreaterThanOrEqual(20);
      for (const u of caves.treasure) {
        if (u !== t) expect(Math.hypot((u.rect.x0 + u.rect.x1) / 2 - cx, (u.rect.z0 + u.rect.z1) / 2 - cz)).toBeGreaterThanOrEqual(20);
      }
      // A room of its own: the ring 1 and 2 cells round the interior is rock, except the side tunnel at the archway.
      const [ex, , ez] = t.entrance;
      for (let x = t.rect.x0 - 2; x <= t.rect.x1 + 2; x++) for (let z = t.rect.z0 - 2; z <= t.rect.z1 + 2; z++) {
        if (x >= t.rect.x0 && x <= t.rect.x1 && z >= t.rect.z0 && z <= t.rect.z1) continue;
        if (Math.max(Math.abs(x - ex), Math.abs(z - ez)) <= 2) continue;
        for (let y = t.floorY; y < t.floorY + 5; y++) expect(world.get(x, y, z), `${t.id} ${x},${y},${z}`).not.toBe(BlockId.Air);
      }
    }
  });
});

describe('chest rewards', () => {
  test('every count is at most 20 and every id is a registered block or item; no mythical block', () => {
    for (const list of Object.values(CHEST_REWARDS)) {
      for (const e of list) {
        expect(e.n).toBeGreaterThan(0);
        expect(e.n).toBeLessThanOrEqual(20);
        expect(isStackId(e.id), String(e.id)).toBe(true);
        expect(e.id >= 40 && e.id <= 55).toBe(false);
      }
    }
  });

  test('T1 has 3 Gems and 4 Lamps; R has 10 Gems, 6 Ruin crystals, 5 of each seed and 2 saplings, the most gems and seeds', () => {
    expect(CHEST_REWARDS.T1).toEqual([{ id: ItemId.Gem, n: 3 }, { id: BlockId.Lamp, n: 4 }]);
    const count = (list: readonly { id: number; n: number }[], ids: number[]): number => list.filter(e => ids.includes(e.id)).reduce((a, e) => a + e.n, 0);
    const R = CHEST_REWARDS.R;
    expect(count(R, [ItemId.Gem])).toBe(10);
    expect(count(R, [BlockId.RuinCrystal])).toBe(6);
    for (const s of [ItemId.WheatSeed, ItemId.CarrotSeed, ItemId.PotatoSeed]) expect(count(R, [s])).toBe(5);
    expect(count(R, [ItemId.AppleSapling])).toBe(2);
    const seeds = [ItemId.WheatSeed, ItemId.CarrotSeed, ItemId.PotatoSeed, ItemId.AppleSapling];
    for (const k of ['T0', 'T1', 'T2'] as const) {
      expect(count(R, [ItemId.Gem])).toBeGreaterThan(count(CHEST_REWARDS[k], [ItemId.Gem]));
      expect(count(R, seeds)).toBeGreaterThan(count(CHEST_REWARDS[k], seeds));
      expect(count(CHEST_REWARDS[k], [BlockId.RuinCrystal])).toBe(0);
    }
    // 17 gems in the chests.
    expect(Object.values(CHEST_REWARDS).reduce((a, l) => a + count(l, [ItemId.Gem]), 0)).toBe(17);
  });
});

function chestWorld(): { world: World; inv: Inventory; layout: { treasure: never[]; ruin: { chest: Cell } } } {
  const world = new World(16, 8, 16);
  world.set(5, 1, 5, BlockId.Chest);
  world.clearEdits();
  return { world, inv: new Inventory(), layout: { treasure: [], ruin: { chest: [5, 1, 5] } } };
}

describe('opening a chest', () => {
  test('R delivers everything in one go, turns the chest into ChestOpen and records one edit', () => {
    const { world, inv, layout } = chestWorld();
    const r = openChest(world, inv, layout as never, [5, 1, 5]);
    expect(r.ok).toBe(true);
    for (const e of CHEST_REWARDS.R) expect(inv.count(e.id)).toBe(e.n);
    expect(world.get(5, 1, 5)).toBe(BlockId.ChestOpen);
    expect(world.edits()).toEqual([[5, 1, 5, BlockId.ChestOpen]]);
  });

  test('twice pays once', () => {
    const { world, inv, layout } = chestWorld();
    openChest(world, inv, layout as never, [5, 1, 5]);
    const again = openChest(world, inv, layout as never, [5, 1, 5]);
    expect(again.ok).toBe(false);
    expect(inv.count(ItemId.Gem)).toBe(10);
  });

  test('one entry that cannot fit leaves the chest closed and the bag unchanged (all or nothing)', () => {
    const { world, inv, layout } = chestWorld();
    inv.add(BlockId.Planks, 95); // 95 + 10 > 99
    inv.add(ItemId.Gem, 3);
    expect(canOpen(inv, CHEST_REWARDS.R)).toBe(false);
    const r = openChest(world, inv, layout as never, [5, 1, 5]);
    expect(r.ok).toBe(false);
    expect(world.get(5, 1, 5)).toBe(BlockId.Chest);
    expect(inv.count(BlockId.Planks)).toBe(95);
    expect(inv.count(ItemId.Gem)).toBe(3);
    expect(inv.count(BlockId.RuinCrystal)).toBe(0);
  });

  test('a full Gem stack (99) leaves it closed', () => {
    const { world, inv, layout } = chestWorld();
    inv.add(ItemId.Gem, 99);
    expect(openChest(world, inv, layout as never, [5, 1, 5]).ok).toBe(false);
    expect(world.get(5, 1, 5)).toBe(BlockId.Chest);
  });

  test('an unknown chest cell opens for 2 Gems; an ordinary block does nothing', () => {
    const world = new World(16, 8, 16);
    world.set(2, 1, 2, BlockId.Chest);
    world.set(3, 1, 3, BlockId.Stone);
    const inv = new Inventory();
    const layout = { treasure: [], ruin: null };
    expect(chestReward(layout, [2, 1, 2])).toBe(STRAY_REWARD);
    expect(openChest(world, inv, layout, [2, 1, 2]).ok).toBe(true);
    expect(inv.count(ItemId.Gem)).toBe(2);
    expect(openChest(world, inv, layout, [3, 1, 3]).ok).toBe(false);
    expect(world.get(3, 1, 3)).toBe(BlockId.Stone);
  });

  test('an open chest survives a save and load, and a regenerate: reopening after reload pays nothing', () => {
    const g = generateWorld(2026);
    const t = g.caves.treasure[0];
    const game = new Game({ world: g.world, spawn: g.spawn, village: g.village, caves: g.caves });
    expect(openChest(g.world, game.inventory, g.caves, t.chest).ok).toBe(true);
    const seeds = game.inventory.count(ItemId.WheatSeed);
    const data = serialise(game, 2026);
    const back = applySave(data);
    expect(back.world.get(...t.chest)).toBe(BlockId.ChestOpen);
    const r = openChest(back.world, back.inventory, back.caves, t.chest);
    expect(r.ok).toBe(false);
    expect(back.inventory.count(ItemId.WheatSeed)).toBe(seeds);
  });

  test('the open chest is an ordinary carriable block; a closed one is not', () => {
    expect(isCarriable(BlockId.ChestOpen)).toBe(true);
    expect(isCarriable(BlockId.Chest)).toBe(false);
  });
});
