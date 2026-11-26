import { describe, expect, it } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { ItemId } from '../../src/core/items';
import type { Cell } from '../../src/core/pathfind';
import { World } from '../../src/core/world';
import { BODY_RADIUS, pickEntity, type ScreenEntity } from '../../src/input/entityPick';
import { GRUMP_APPROACH, approachCell, resolveHold, resolveTap } from '../../src/input/tap';

function world(): World {
  const w = new World(40, 8, 40);
  for (let x = 0; x < 40; x++) for (let z = 0; z < 40; z++) w.set(x, 0, z, BlockId.Grass);
  w.markClean();
  return w;
}
const feet: Cell = [5, 1, 5];
const occupied: Cell[] = [feet, [5, 2, 5]];
const up: Cell = [0, 1, 0];
const ground = (x: number, z: number) => ({ cell: [x, 0, z] as Cell, normal: up });
const near = { id: 7, dist: 4, cell: [9, 1, 5] as Cell };
const far = { id: 7, dist: 12, cell: [17, 1, 5] as Cell };
const WEAPONS = [ItemId.BubbleBlaster, ItemId.MagicWand, ItemId.WaterSquirter];

describe('resolveTap with grumps and friends', () => {
  it.each(WEAPONS)('weapon %s + tap on a grump within 8 fires', weapon => {
    expect(resolveTap(ground(9, 5), weapon, feet, world(), occupied, { grumpHit: near })).toEqual({ kind: 'fire', grump: 7 });
    expect(resolveTap(null, weapon, feet, world(), occupied, { grumpHit: { ...near, dist: 8 } })).toEqual({ kind: 'fire', grump: 7 });
  });

  it('weapon + a grump beyond 8 walks to a standable cell at least 6 from it, never fires', () => {
    const w = world();
    const intent = resolveTap(ground(17, 5), ItemId.MagicWand, feet, w, occupied, { grumpHit: far });
    expect(intent.kind).toBe('walk');
    if (intent.kind !== 'walk') return;
    expect(Math.hypot(intent.to[0] - far.cell[0], intent.to[2] - far.cell[2])).toBeGreaterThanOrEqual(GRUMP_APPROACH - 1e-9);
    expect(Math.hypot(intent.to[0] - far.cell[0], intent.to[2] - far.cell[2])).toBeLessThanOrEqual(8);
  });

  it('a hand, a block, a food and a seed tapped on a grump walk and never fire, place, feed or plant', () => {
    for (const sel of ['hand', BlockId.Stone, ItemId.Apple, ItemId.WheatSeed] as const) {
      const intent = resolveTap(ground(9, 5), sel, feet, world(), occupied, { grumpHit: near });
      expect(intent.kind, String(sel)).toBe('walk');
    }
  });

  it('any selection tapped on a friend pets it', () => {
    for (const sel of ['hand', BlockId.Stone, ItemId.Apple, ItemId.BubbleBlaster] as const) {
      expect(resolveTap(ground(9, 5), sel, feet, world(), occupied, { friendHit: { id: 3, dist: 20, cell: [30, 1, 5] } })).toEqual({ kind: 'petFriend', friend: 3 });
    }
  });

  it('a weapon tapped on empty ground, a block face, water or a path walks; it never places or fires', () => {
    const w = world();
    w.set(9, 1, 9, BlockId.Stone);
    w.set(12, 0, 12, BlockId.Water);
    w.set(13, 0, 13, BlockId.PathStone);
    for (const weapon of WEAPONS) {
      expect(resolveTap(ground(8, 8), weapon, feet, w, occupied).kind).toBe('walk');
      expect(resolveTap({ cell: [9, 1, 9], normal: [-1, 0, 0] }, weapon, feet, w, occupied)).toEqual({ kind: 'walk', to: [8, 1, 9] });
      expect(resolveTap(ground(12, 12), weapon, feet, w, occupied).kind).toBe('walk');
      expect(resolveTap(ground(13, 13), weapon, feet, w, occupied).kind).toBe('walk');
    }
  });

  it('a weapon on a plant in reach helps, and on an animal pets (not feeds)', () => {
    const w = world();
    w.set(6, 1, 5, BlockId.Wheat0);
    expect(resolveTap({ cell: [6, 1, 5], normal: up }, ItemId.MagicWand, feet, w, occupied)).toEqual({ kind: 'help', cell: [6, 1, 5] });
    expect(resolveTap(null, ItemId.MagicWand, feet, w, occupied, { animalHit: { id: 2, dist: 2 } })).toEqual({ kind: 'pet', animal: 2 });
  });

  it('the unchanged rules: hand walks, a block builds in reach, a weapon item is never placed', () => {
    const w = world();
    expect(resolveTap(ground(6, 5), 'hand', feet, w, occupied).kind).toBe('walk');
    expect(resolveTap(ground(6, 5), BlockId.Stone, feet, w, occupied)).toEqual({ kind: 'place', cell: [6, 1, 5] });
    expect(resolveTap(ground(6, 5), ItemId.BubbleBlaster, feet, w, occupied).kind).toBe('walk');
  });

  it('holding on a grump or a friend gives none and never digs the ground behind it', () => {
    const w = world();
    expect(resolveHold(ground(6, 5), feet, w, occupied, true)).toEqual({ kind: 'none' });
    expect(resolveHold(ground(6, 5), feet, w, occupied, false).kind).toBe('dig');
  });

  it('approachCell finds a standable cell at least 6 from the grump, nearest to him, or null', () => {
    const w = world();
    const c = approachCell(w, [20, 1, 5], [5, 1, 5])!;
    expect(Math.hypot(c[0] - 20, c[2] - 5)).toBeGreaterThanOrEqual(6 - 1e-9);
    expect(c[0]).toBeLessThan(20);
    const tiny = new World(3, 4, 3);
    expect(approachCell(tiny, [1, 1, 1], [0, 1, 0])).toBeNull();
  });
});

describe('pickEntity with grumps and friends', () => {
  const e = (type: ScreenEntity['type'], id: number, sx: number, sy: number, sz = 0.5): ScreenEntity => ({ type, id, sx, sy, sz });
  it('grumps, friends and animals compete in one list: nearest within the radius wins, ties go to the nearer camera', () => {
    expect(BODY_RADIUS).toBeGreaterThanOrEqual(56);
    expect(pickEntity({ x: 100, y: 100 }, [e('animal', 1, 140, 100), e('grump', 2, 110, 100), e('friend', 3, 180, 100)])).toEqual({ type: 'grump', id: 2 });
    expect(pickEntity({ x: 100, y: 100 }, [e('animal', 1, 120, 100, 0.8), e('grump', 2, 80, 100, 0.4)])).toEqual({ type: 'grump', id: 2 });
    expect(pickEntity({ x: 0, y: 0 }, [])).toBeNull();
    expect(pickEntity({ x: 0, y: 0 }, [e('grump', 1, 400, 400)])).toBeNull();
  });
});
