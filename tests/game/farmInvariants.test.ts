// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { cropOf } from '../../src/core/crops';
import { GrowthClock, OFFLINE_CAP_MS, STAGE_MS } from '../../src/core/growth';
import { MAX_STACK } from '../../src/core/inventory';
import { ItemId, isItemId, type StackId } from '../../src/core/items';
import type { Cell } from '../../src/core/pathfind';
import { mulberry32 } from '../../src/core/rng';
import { applySave, parseSave, serialise } from '../../src/core/save';
import { GROUND_Y } from '../../src/core/village';
import { generateWorld } from '../../src/core/worldgen';
import { Game } from '../../src/game/game';

/** The part of the world the stream plays in: the farm plot and a margin. */
const WIN = { x0: 70, x1: 84, z0: 33, z1: 46, y0: GROUND_Y, y1: GROUND_Y + 8 };
const SEEDS = [ItemId.WheatSeed, ItemId.CarrotSeed, ItemId.PotatoSeed, ItemId.AppleSapling];
const WEEK = 7 * 24 * 3600_000;

const key = (c: Cell): string => c.join(',');

function plantsIn(game: Game): Map<string, number> {
  const out = new Map<string, number>();
  for (let x = WIN.x0; x <= WIN.x1; x++) {
    for (let z = WIN.z0; z <= WIN.z1; z++) {
      for (let y = WIN.y0; y <= WIN.y1; y++) {
        const info = cropOf(game.world.get(x, y, z));
        if (info) out.set(`${x},${y},${z}`, info.stage);
      }
    }
  }
  return out;
}

function bag(game: Game): Map<StackId, number> {
  return new Map(game.inventory.slots().map(id => [id, game.inventory.count(id)]));
}

function reload(game: Game, now: number): Game {
  const data = parseSave(JSON.stringify(serialise(game, 2026, { ledToVillage: false }, now)))!;
  const applied = applySave(data, now);
  const next = new Game({ world: applied.world, spawn: applied.spawn, inventory: applied.inventory });
  next.farm.restore(applied.farm.crops, applied.farm.trees);
  next.farm.advance(applied.offlineMs);
  return next;
}

function run(seed: number, steps: number): number {
  const rand = mulberry32(seed);
  const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length)];
  let game = new Game(generateWorld(2026));
  for (const id of SEEDS) game.inventory.add(id, 3);
  game.inventory.add(BlockId.Planks, 40);
  let now = 1_800_000_000_000;
  let clock = new GrowthClock(now);
  const stages = new Map<string, number>();
  const treeStage = new Map<string, number>();
  let applesPicked = 0;
  const picked = new Set<string>();
  const aisles = [37, 40, 43];
  const at = (x: number, z: number): Cell => [x, GROUND_Y + 1, z];
  const stand = (x: number, z: number): void => {
    const az = aisles.reduce((a, b) => (Math.abs(b - z) < Math.abs(a - z) ? b : a));
    game.player.pos = { x: x + 0.5, y: GROUND_Y + 1, z: az + 0.5 };
    game.player.setPath(null);
  };
  const isTreeCell = (c: Cell): boolean => game.farm.records().trees.some(t => Math.abs(t.x - c[0]) <= 1 && Math.abs(t.z - c[2]) <= 1 && c[1] >= t.y && c[1] <= t.y + 5);

  for (let step = 0; step < steps; step++) {
    const before = bag(game);
    const plantsBefore = plantsIn(game);
    const dug = new Set<string>();
    let allowDecrease: StackId | null = null;
    const x = 72 + Math.floor(rand() * 8);
    const z = 35 + Math.floor(rand() * 8);
    const r = rand();
    const cell = at(x, z);

    if (r < 0.25) {
      stand(x, z);
      const seedId = pick(SEEDS);
      game.selected = seedId;
      allowDecrease = seedId;
      game.applyIntent({ kind: 'plant', cell });
    } else if (r < 0.45) {
      stand(x, z);
      game.applyIntent({ kind: 'help', cell });
    } else if (r < 0.62) {
      // hold on a plant (or a random cell)
      const plants = [...plantsBefore.keys()].map(k => k.split(',').map(Number) as Cell);
      const ripe = game.farm.records().trees.filter(t => t.stage === 3);
      const ripeRing = ripe.flatMap(t => ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).map(([dx, dz]) => [t.x + dx, t.y + 4, t.z + dz] as Cell))
        .filter(c => game.world.get(...c) === BlockId.AppleLeaves);
      const target = ripeRing.length > 0 && rand() < 0.6 ? pick(ripeRing)
        : plants.length > 0 && rand() < 0.8 ? pick(plants) : isTreeCell(cell) ? at(x, 34) : cell;
      stand(target[0], target[2]);
      if (plantsBefore.has(key(target))) dug.add(key(target));
      // Picking ripe apples is the one thing that sends a tree back a stage: it regrows (counted below).
      if (game.world.get(...target) === BlockId.AppleLeaves) {
        const apples = game.inventory.count(ItemId.Apple);
        game.applyIntent({ kind: 'dig', cell: target });
        if (game.inventory.count(ItemId.Apple) === apples + 2) {
          applesPicked++;
          picked.add(game.farm.records().trees.map(t => `${t.x},${t.y},${t.z}`).join('|'));
          for (const t of game.farm.records().trees) treeStage.set(`${t.x},${t.y},${t.z}`, 0); // may re-ripen later
        }
      } else {
        game.applyIntent({ kind: 'dig', cell: target });
      }
    } else if (r < 0.68) {
      // dig the soil or anything else, but not a tree (digging his own tree is allowed, and tested elsewhere)
      const target: Cell = [x, GROUND_Y + (rand() < 0.5 ? 0 : 1), z];
      if (!isTreeCell(target)) {
        stand(x, z);
        if (plantsBefore.has(key(target))) dug.add(key(target));
        game.applyIntent({ kind: 'dig', cell: target });
      }
    } else if (r < 0.75) {
      stand(x, z);
      game.selected = BlockId.Planks;
      allowDecrease = BlockId.Planks;
      game.applyIntent({ kind: 'place', cell: at(x, z) });
      expect(plantsBefore.has(key(at(x, z))) ? plantsIn(game).has(key(at(x, z))) : true).toBe(true);
    } else if (r < 0.8) {
      game.applyIntent({ kind: 'walk', to: at(x, z) });
      for (let i = 0; i < 5; i++) game.update(0.2);
    } else if (r < 0.95) {
      const pickD = rand();
      const delta = pickD < 0.15 ? -pick([1000, 60_000, WEEK]) : pickD < 0.3 ? WEEK : pickD < 0.4 ? NaN : rand() * 2 * STAGE_MS;
      now = Number.isNaN(delta) ? now : now + delta;
      const add = clock.step(Number.isNaN(delta) ? NaN : now);
      expect(add).toBeGreaterThanOrEqual(0);
      expect(add).toBeLessThanOrEqual(OFFLINE_CAP_MS);
      game.farm.advance(add);
      for (let i = 0; i < 3; i++) game.farm.update(0.03);
    } else {
      // save and reload at any point keeps every stage and the bag
      const expectedBag = bag(game);
      const expectedRecords = game.farm.records();
      const expectedPlants = plantsIn(game);
      game = reload(game, now);
      clock = new GrowthClock(now);
      expect(bag(game)).toEqual(expectedBag);
      expect(plantsIn(game)).toEqual(expectedPlants);
      expect(game.farm.records()).toEqual(expectedRecords);
    }

    // Nothing is lost: only planting a seed or building a block ever lowers a stack, by exactly one.
    const after = bag(game);
    for (const [id, n] of before) {
      const now_ = after.get(id) ?? 0;
      if (id === allowDecrease) expect(now_).toBeGreaterThanOrEqual(n - 1);
      else expect(now_, `step ${step} id ${id}`).toBeGreaterThanOrEqual(n);
    }
    for (const [id, n] of after) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(MAX_STACK);
      expect(isItemId(id) || (id as number) < 100).toBe(true);
    }
    const { seeds, growing } = game.farm.seedsAndGrowing();
    expect(seeds + growing, `step ${step}`).toBeGreaterThanOrEqual(1);

    // Nothing wilts: stages only rise; a plant block only disappears where the stream dug it.
    const plantsAfter = plantsIn(game);
    for (const [k, stage] of plantsBefore) {
      const now_ = plantsAfter.get(k);
      if (now_ === undefined) {
        // A young tree grows from a sapling into a trunk: that is the same plant moving on, not a loss.
        const [px, py, pz] = k.split(',').map(Number);
        const grewUp = game.world.get(px, py, pz) === BlockId.Wood;
        expect(dug.has(k) || grewUp, `step ${step} lost plant at ${k} (stage ${stage})`).toBe(true);
      } else if (!dug.has(k)) {
        expect(now_, `step ${step} ${k}`).toBeGreaterThanOrEqual(stage);
      }
      if (now_ !== undefined) stages.set(k, Math.max(stages.get(k) ?? 0, now_));
    }
    for (const t of game.farm.records().trees) {
      const k = `${t.x},${t.y},${t.z}`;
      expect(t.stage, `tree ${k}`).toBeGreaterThanOrEqual(treeStage.get(k) ?? 0);
      treeStage.set(k, t.stage);
    }
    for (const k of [...treeStage.keys()]) {
      if (!game.farm.records().trees.some(t => `${t.x},${t.y},${t.z}` === k)) treeStage.delete(k); // picked as a sapling
    }
    // No plant block is in the bag.
    expect(game.inventory.slots().every(id => isItemId(id) || !cropOf(id as BlockId))).toBe(true);
  }
  // The stream really played: plants were grown, some all the way to ripe.
  expect(stages.size).toBeGreaterThan(5);
  expect([...stages.values()].some(s => s === 3)).toBe(true);
  return applesPicked;
}

let totalApples = 0;

describe('farm invariants over random action streams (real generated world)', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    it(`seed ${seed}: nothing wilts, nothing is lost, nothing throws, reloads are exact`, () => {
      totalApples += run(seed, 700);
    });
  }
  it('apples were picked (and the trees regrew without anything breaking) inside the streams', () => {
    expect(totalApples).toBeGreaterThan(0);
  });
});
