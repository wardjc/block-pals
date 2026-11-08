// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { MAX_STACK } from '../../src/core/inventory';
import { FEEDS, GIFT, ItemId, type StackId } from '../../src/core/items';
import { isStandable, type Cell } from '../../src/core/pathfind';
import { canPlace } from '../../src/core/placement';
import { mulberry32 } from '../../src/core/rng';
import { applySave, parseSave, serialise } from '../../src/core/save';
import { GROUND_Y } from '../../src/core/village';
import { generateWorld } from '../../src/core/worldgen';
import { DEFAULT_HERD, Herd } from '../../src/game/animals';
import { Game } from '../../src/game/game';

const FOODS = [...FEEDS];
const NOT_FOODS: Array<StackId | 'hand'> = [ItemId.WheatSeed, ItemId.Milk, ItemId.Egg, ItemId.Wool, BlockId.Planks, 'hand'];

function run(seed: number, steps: number): { gifts: number; refusedPlacements: number } {
  const rand = mulberry32(seed);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];
  const initial = generateWorld(2026);
  const { village, world } = initial;
  const pasture = village.farm.pasture;
  const roam = { x0: pasture.x0 + 1, z0: pasture.z0 + 1, x1: pasture.x1 - 1, z1: pasture.z1 - 1 };
  const game = new Game(initial);
  let herd = new Herd(mulberry32(seed + 7));
  herd.populate(village.farm.herdSpawns);
  game.herd = herd;
  const people = (): Cell[] => {
    const [x, y, z] = game.player.feetCell();
    return [[x, y, z], [x, y + 1, z]];
  };
  game.setOccupied(() => [...people(), ...herd.occupiedCells()]);
  for (const f of FOODS) game.inventory.add(f, 40);
  game.inventory.add(BlockId.Planks, 90);
  let now = 1_800_000_000_000;
  let gifts = 0;
  let refusedPlacements = 0;
  const bag = (): Map<StackId, number> => new Map(game.inventory.slots().map(id => [id, game.inventory.count(id)]));
  const standNear = (x: number, z: number): void => {
    const p: Cell = [Math.max(pasture.x0, Math.min(pasture.x1, Math.floor(x))), GROUND_Y + 1, Math.max(pasture.z0, Math.min(pasture.z1, Math.floor(z)))];
    game.player.pos = { x: p[0] + 0.5, y: p[1], z: p[2] + 0.5 };
    game.player.setPath(null);
  };

  for (let step = 0; step < steps; step++) {
    const before = bag();
    let foodUsed: StackId | null = null;
    const a = pick(herd.animals);
    const r = rand();
    if (r < 0.2) {
      // feed with any food or a non-food
      standNear(a.x + 1.5, a.z);
      const held = rand() < 0.75 ? pick(FOODS) : pick(NOT_FOODS);
      game.selected = held;
      foodUsed = held === 'hand' ? null : held;
      const wasResting = a.giftIn > 0;
      game.applyIntent({ kind: 'feed', animal: a.id });
      const used = before.get(held as StackId) ?? 0;
      const left = game.inventory.count(held as StackId);
      if (held !== 'hand' && !FOODS.includes(held as ItemId)) expect(left).toBe(used); // a non-food is never used
      if (FOODS.includes(held as ItemId) && !wasResting && used > 0) {
        // exactly one used (a pig's potato comes back, so the net can be zero)
        const gift = GIFT[a.kind];
        expect(game.inventory.count(gift)).toBeGreaterThan((before.get(gift) ?? 0) - (gift === held ? 1 : 0));
        gifts++;
      }
      if (wasResting) expect(left).toBe(used);
    } else if (r < 0.3) {
      standNear(a.x + 1.5, a.z);
      game.applyIntent({ kind: 'pet', animal: a.id });
    } else if (r < 0.5) {
      // build anywhere in or round the pasture, animals' cells included
      const x = pasture.x0 - 1 + Math.floor(rand() * (pasture.x1 - pasture.x0 + 3));
      const z = pasture.z0 - 1 + Math.floor(rand() * (pasture.z1 - pasture.z0 + 3));
      const onAnimal = rand() < 0.6;
      const cell: Cell = onAnimal ? [Math.floor(a.x), a.y + (rand() < 0.5 ? 0 : 1), Math.floor(a.z)] : [x, GROUND_Y + 1 + Math.floor(rand() * 2), z];
      standNear(cell[0], cell[2] + 2);
      game.selected = BlockId.Planks;
      const wasThere = herd.occupiedCells().some(c => c.join(',') === cell.join(','));
      const had = world.get(...cell);
      game.applyIntent({ kind: 'place', cell });
      if (wasThere) {
        expect(world.get(...cell), `placed into an animal at ${cell}`).toBe(had);
        refusedPlacements++;
      }
    } else if (r < 0.65) {
      // dig anything, the ground under an animal included
      const under = rand() < 0.5;
      const cell: Cell = under ? [Math.floor(a.x), a.y - 1, Math.floor(a.z)]
        : [roam.x0 + Math.floor(rand() * (roam.x1 - roam.x0 + 1)), GROUND_Y + Math.floor(rand() * 2), roam.z0 + Math.floor(rand() * (roam.z1 - roam.z0 + 1))];
      standNear(cell[0], cell[2] + 1);
      const blockBefore = world.get(...cell);
      game.applyIntent({ kind: 'dig', cell });
      if (under) expect(world.get(...cell), 'dug under an animal').toBe(blockBefore);
    } else if (r < 0.95) {
      const dt = [0.016, 0.033, 0.05, 0.1][Math.floor(rand() * 4)];
      const bad = rand() < 0.05 ? pick([-3, Number.NaN, 0, 1e6]) : dt;
      const held = rand() < 0.4 ? pick(FOODS) : pick(NOT_FOODS);
      if (rand() < 0.2) standNear(roam.x0 + rand() * (roam.x1 - roam.x0), roam.z0 + rand() * (roam.z1 - roam.z0));
      for (let i = 0; i < 20; i++) herd.update({ world, roam, player: game.player.pos, held, occupied: people(), dt: i === 0 ? bad : dt });
      now += 1000;
    } else {
      // save and reload at any point keeps every animal and the bag
      const expectedBag = bag();
      const expectedHerd = herd.toJSON();
      const data = parseSave(JSON.stringify(serialise(game, 2026, { ledToVillage: false }, now, herd.toJSON())))!;
      const applied = applySave(data, now);
      const next = new Herd(mulberry32(seed + step));
      next.restore(applied.animals, applied.village.farm.herdSpawns, applied.world, roam, applied.offlineMs / 1000);
      expect(next.toJSON()).toEqual(expectedHerd);
      expect(new Map(applied.inventory.slots().map(id => [id, applied.inventory.count(id)]))).toEqual(expectedBag);
      herd = next;
      game.herd = herd; // the world is the same one: the edits replayed to the same blocks
    }

    // No animal is ever removed, hurt or out of place.
    expect(herd.animals.length).toBeGreaterThanOrEqual(10);
    for (const k of Object.keys(DEFAULT_HERD) as Array<keyof typeof DEFAULT_HERD>) {
      expect(herd.animals.filter(o => o.kind === k).length).toBeGreaterThanOrEqual(DEFAULT_HERD[k]);
    }
    for (const o of herd.animals) {
      const c: Cell = [Math.floor(o.x), o.y, Math.floor(o.z)];
      expect(isStandable(world, c), `step ${step} ${o.kind} at ${c}`).toBe(true);
      expect(c[0] >= roam.x0 && c[0] <= roam.x1 && c[2] >= roam.z0 && c[2] <= roam.z1, `step ${step} ${o.kind} out at ${c}`).toBe(true);
      expect(o.giftIn).toBeGreaterThanOrEqual(0);
      expect(o.giftIn).toBeLessThanOrEqual(45);
    }
    // Nothing is lost: a food is the only thing a feed spends (one), gifts only ever add.
    const after = bag();
    for (const [id, n] of after) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(MAX_STACK);
      const was = before.get(id) ?? 0;
      if (id === BlockId.Planks) expect(n).toBeLessThanOrEqual(was);
      else if (id === foodUsed) expect(n).toBeGreaterThanOrEqual(was - 1);
    }
    for (const [id, n] of before) {
      if (id === BlockId.Planks || id === foodUsed) continue;
      expect(after.get(id) ?? 0, `step ${step} id ${id}`).toBeGreaterThanOrEqual(n);
    }
  }
  return { gifts, refusedPlacements };
}

describe('animal invariants over random action streams (real generated pasture)', () => {
  let gifts = 0;
  let refused = 0;
  for (const seed of [1, 2, 3, 4]) {
    it(`seed ${seed}: no animal is ever removed or hurt, placing into one is refused, nothing is lost, reloads are exact`, () => {
      const r = run(seed, 500);
      gifts += r.gifts;
      refused += r.refusedPlacements;
    }, 60_000);
  }
  it('the streams really fed animals and tried to build into them', () => {
    expect(gifts).toBeGreaterThan(20);
    expect(refused).toBeGreaterThan(20);
  });
});
