import { describe, expect, it } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { Inventory, MAX_STACK } from '../../src/core/inventory';
import { ItemId } from '../../src/core/items';
import type { Cell } from '../../src/core/pathfind';
import { canPlace } from '../../src/core/placement';
import { mulberry32 } from '../../src/core/rng';
import { World } from '../../src/core/world';
import { Herd } from '../../src/game/animals';
import { Game, type GameEvent } from '../../src/game/game';
import { resolveHold, resolveTap } from '../../src/input/tap';

function flat(): World {
  const w = new World(48, 16, 48);
  for (let x = 0; x < 48; x++) for (let z = 0; z < 48; z++) w.set(x, 0, z, BlockId.Grass);
  w.clearEdits();
  return w;
}

function setup(bag: Array<[number, number]> = [[ItemId.Wheat, 5], [ItemId.Carrot, 5]]) {
  const world = flat();
  const inv = new Inventory();
  for (const [id, n] of bag) inv.add(id as never, n);
  const game = new Game({ world, spawn: { x: 5.5, y: 1, z: 5.5 }, inventory: inv });
  const herd = new Herd(mulberry32(1));
  const spawns: Cell[] = [];
  for (const z of [6, 9]) for (const x of [5, 8, 11, 14, 17, 20, 23]) spawns.push([x, 1, z]);
  herd.populate(spawns);
  game.herd = herd;
  game.setOccupied(() => {
    const [x, y, z] = game.player.feetCell();
    return [[x, y, z], [x, y + 1, z], ...herd.occupiedCells()];
  });
  const events: GameEvent[] = [];
  game.on(e => events.push(e));
  const by = (kind: string) => herd.animals.find(a => a.kind === kind)!;
  return { world, inv, game, herd, events, by };
}

describe('Game: feeding and petting animals', () => {
  it('any food feeds any animal: one food is used and the gift is in the bag', () => {
    for (const food of [ItemId.Wheat, ItemId.Carrot, ItemId.Apple, ItemId.Potato]) {
      for (const [kind, gift] of [['chicken', ItemId.Egg], ['cow', ItemId.Milk], ['sheep', ItemId.Wool], ['pig', ItemId.Potato]] as const) {
        const s = setup([[food, 3]]);
        s.game.selected = food;
        const a = s.by(kind);
        s.game.applyIntent({ kind: 'feed', animal: a.id });
        expect(s.inv.count(food)).toBe(3 - 1 + (food === gift ? 1 : 0)); // exactly one food used (a pig's potato comes back)
        expect(s.inv.count(gift)).toBe(food === gift ? 3 : 1);
        expect(s.events.some(e => e.type === 'fed' && e.gift === gift && e.kind === kind)).toBe(true);
      }
    }
  });
  it('a resting animal is only happy: no food used, no second gift', () => {
    const s = setup();
    s.game.selected = ItemId.Wheat;
    const a = s.by('cow');
    s.game.applyIntent({ kind: 'feed', animal: a.id });
    s.game.applyIntent({ kind: 'feed', animal: a.id });
    expect(s.inv.count(ItemId.Wheat)).toBe(4);
    expect(s.inv.count(ItemId.Milk)).toBe(1);
    expect(s.events.filter(e => e.type === 'resting')).toHaveLength(1);
  });
  it('the last food goes and the selection falls back to the hand', () => {
    const s = setup([[ItemId.Carrot, 1]]);
    s.game.selected = ItemId.Carrot;
    s.game.applyIntent({ kind: 'feed', animal: s.by('chicken').id });
    expect(s.inv.count(ItemId.Carrot)).toBe(0);
    expect(s.inv.count(ItemId.Egg)).toBe(1);
    expect(s.game.effectiveSelected()).toBe('hand');
  });
  it('a gift that would pass 99 is refused whole: nothing used, the animal is not resting', () => {
    const s = setup([[ItemId.Carrot, 5], [ItemId.Egg, MAX_STACK]]);
    s.game.selected = ItemId.Carrot;
    const hen = s.by('chicken');
    s.game.applyIntent({ kind: 'feed', animal: hen.id });
    expect(s.inv.count(ItemId.Carrot)).toBe(5);
    expect(s.inv.count(ItemId.Egg)).toBe(MAX_STACK);
    expect(hen.giftIn).toBe(0);
    expect(s.events.some(e => e.type === 'full')).toBe(true);
    // Another animal still takes the carrot.
    s.game.applyIntent({ kind: 'feed', animal: s.by('cow').id });
    expect(s.inv.count(ItemId.Carrot)).toBe(4);
  });
  it('a pet gives nothing and costs nothing', () => {
    const s = setup();
    s.game.applyIntent({ kind: 'pet', animal: s.by('sheep').id });
    expect(s.inv.count(ItemId.Wool)).toBe(0);
    expect(s.inv.count(ItemId.Wheat)).toBe(5);
    expect(s.events.some(e => e.type === 'petted')).toBe(true);
    expect(() => s.game.applyIntent({ kind: 'pet', animal: 9999 })).not.toThrow();
    expect(() => s.game.applyIntent({ kind: 'feed', animal: 9999 })).not.toThrow();
  });
  it('feeding with something that is not food (a seed) is only a pet', () => {
    const s = setup([[ItemId.WheatSeed, 4]]);
    s.game.selected = ItemId.WheatSeed;
    s.game.applyIntent({ kind: 'feed', animal: s.by('pig').id });
    expect(s.inv.count(ItemId.WheatSeed)).toBe(4);
    expect(s.inv.count(ItemId.Potato)).toBe(0);
  });
});

describe('Game: animals can never be hurt or trapped by him', () => {
  it('placing a block into an animal cell is refused (feet and head cells)', () => {
    const s = setup([[BlockId.Planks, 10]]);
    s.game.selected = BlockId.Planks;
    s.game.player.pos = { x: 5.5, y: 1, z: 7.5 };
    for (const a of s.herd.animals) {
      for (const c of s.herd.occupiedCells().filter(([x, , z]) => x === Math.floor(a.x) && z === Math.floor(a.z))) {
        if (Math.max(Math.abs(c[0] - 5), Math.abs(c[2] - 7)) <= 3) {
          s.game.applyIntent({ kind: 'place', cell: c });
          expect(s.world.get(...c), `${c}`).toBe(BlockId.Air);
          expect(canPlace(s.world, c, s.game.occupied(), BlockId.Planks)).toBe(false);
        }
      }
    }
    expect(s.inv.count(BlockId.Planks)).toBe(10);
  });
  it('the block under an animal cannot be dug', () => {
    const s = setup();
    const a = s.by('cow');
    s.game.player.pos = { x: a.x + 1.5, y: 1, z: a.z + 0.5 };
    const under: Cell = [Math.floor(a.x), 0, Math.floor(a.z)];
    s.game.applyIntent({ kind: 'dig', cell: under });
    expect(s.world.get(...under)).toBe(BlockId.Grass);
    expect(s.inv.count(BlockId.Grass)).toBe(0);
  });
  it('a hold on an animal does nothing, and a tap on one feeds or pets (never digs)', () => {
    const s = setup();
    const feet: Cell = [5, 1, 5];
    const hit = { cell: [10, 0, 6] as Cell, normal: [0, 1, 0] as Cell };
    expect(resolveHold(hit, feet, s.world, s.game.occupied(), true)).toEqual({ kind: 'none' });
    expect(resolveTap(hit, ItemId.Wheat, feet, s.world, s.game.occupied(), { animalHit: { id: 3, dist: 2 } })).toEqual({ kind: 'feed', animal: 3 });
    expect(resolveTap(hit, 'hand', feet, s.world, s.game.occupied(), { animalHit: { id: 3, dist: 2 } })).toEqual({ kind: 'pet', animal: 3 });
  });
  it('animals do not move when he walks through them, and no intent removes one', () => {
    const s = setup();
    const n = s.herd.animals.length;
    const first = s.herd.animals[0];
    s.game.applyIntent({ kind: 'walk', to: [Math.floor(first.x), 1, Math.floor(first.z)] });
    for (let i = 0; i < 100; i++) s.game.update(0.1);
    expect(s.herd.animals).toHaveLength(n);
  });
});
