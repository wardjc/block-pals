import { describe, expect, it } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import type { Cell } from '../../src/core/pathfind';
import { World } from '../../src/core/world';
import { createDebouncer, resolveHold, resolveTap } from '../../src/input/tap';

function flatWorld(): World {
  const world = new World(10, 8, 10);
  for (let x = 0; x < 10; x++) {
    for (let z = 0; z < 10; z++) world.set(x, 0, z, BlockId.Grass);
  }
  world.markClean();
  return world;
}

const feet: Cell = [2, 1, 2];
const occupied: Cell[] = [feet, [2, 2, 2], [3, 1, 2]];
const up: Cell = [0, 1, 0];

describe('resolveTap', () => {
  // Spec §7a: a quick tap with the hand walks; a tap never digs.
  const handCases: Array<[string, { cell: Cell; normal: Cell }, Cell, (w: World) => void]> = [
    ['ground right next to the player', { cell: [3, 0, 3], normal: up }, [3, 1, 3], () => {}],
    ['ground further away within reach', { cell: [4, 0, 2], normal: up }, [4, 1, 2], () => {}],
    ['ground far away', { cell: [8, 0, 8], normal: up }, [8, 1, 8], () => {}],
    ['a tree trunk within reach', { cell: [5, 1, 5], normal: up }, [5, 2, 5], w => w.set(5, 1, 5, BlockId.Wood)],
    ['leaves within reach', { cell: [5, 4, 5], normal: up }, [5, 5, 5], w => w.set(5, 4, 5, BlockId.Leaves)],
    ['the side of a block within reach', { cell: [5, 1, 2], normal: [-1, 0, 0] }, [4, 1, 2], w => w.set(5, 1, 2, BlockId.Stone)],
    ['the bottom of a block within reach', { cell: [4, 4, 4], normal: [0, -1, 0] }, [4, 3, 4], w => w.set(4, 4, 4, BlockId.Dirt)],
    ['the top of a block beside him (walks up onto it)', { cell: [3, 1, 2], normal: up }, [3, 2, 2], w => w.set(3, 1, 2, BlockId.Stone)],
    ['the block under his own feet', { cell: [2, 0, 2], normal: up }, [2, 1, 2], () => {}],
    ['a pond bed (the game finds the shore)', { cell: [8, 0, 8], normal: up }, [8, 1, 8], w => w.set(8, 1, 8, BlockId.Water)],
    ['bedrock next to him', { cell: [3, 0, 2], normal: up }, [3, 1, 2], w => w.set(3, 0, 2, BlockId.Bedrock)],
  ];

  it.each(handCases)('hand tap on %s walks to the cell in front of the face and digs nothing', (_name, hit, to, build) => {
    const world = flatWorld();
    build(world);
    world.markClean();
    expect(resolveTap(hit, 'hand', feet, world, occupied)).toEqual({ kind: 'walk', to });
    expect(world.isDirty()).toBe(false);
  });

  it.each<Cell>([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]])(
    'block tap places on the hit face (%s, %s, %s)', (dx, dy, dz) => {
      const world = flatWorld();
      world.set(4, 2, 4, BlockId.Stone);
      expect(resolveTap({ cell: [4, 2, 4], normal: [dx, dy, dz] }, BlockId.Wood, feet, world, occupied))
        .toEqual({ kind: 'place', cell: [4 + dx, 2 + dy, 4 + dz] });
      expect(world.get(4 + dx, 2 + dy, 4 + dz)).toBe(BlockId.Air);
    },
  );

  it.each(occupied)('block tap into player or pal cell (%s, %s, %s) falls back to walk', (x, y, z) => {
    const world = flatWorld();
    world.set(x, y, z - 1, BlockId.Stone);
    expect(resolveTap({ cell: [x, y, z - 1], normal: [0, 0, 1] }, BlockId.Wood, feet, world, occupied))
      .toEqual({ kind: 'walk', to: [x, y, z] });
  });

  it('passes the supplied occupancy through without adding cells', () => {
    expect(resolveTap({ cell: [2, 0, 2], normal: up }, BlockId.Wood, feet, flatWorld(), []))
      .toEqual({ kind: 'place', cell: feet });
  });

  it('walks when a block tap is far away or its placement cell is solid', () => {
    const world = flatWorld();
    expect(resolveTap({ cell: [8, 0, 8], normal: up }, BlockId.Wood, feet, world, occupied))
      .toEqual({ kind: 'walk', to: [8, 1, 8] });
    world.set(4, 1, 4, BlockId.Stone);
    expect(resolveTap({ cell: [4, 0, 4], normal: up }, BlockId.Wood, feet, world, occupied))
      .toEqual({ kind: 'walk', to: [4, 1, 4] });
  });

  it('a block tap on a pond bed walks (placing into water is for taps on a block beside it)', () => {
    const world = flatWorld();
    world.set(8, 1, 8, BlockId.Water);
    expect(resolveTap({ cell: [8, 0, 8], normal: up }, BlockId.Wood, feet, world, occupied))
      .toEqual({ kind: 'walk', to: [8, 1, 8] });
  });

  it('never gives anything but walk, place or none', () => {
    const world = flatWorld();
    world.set(3, 1, 3, BlockId.Wood);
    for (const selected of ['hand', BlockId.Planks] as const) {
      for (let x = 0; x < 10; x++) for (let z = 0; z < 10; z++) for (const normal of [up, [1, 0, 0] as Cell]) {
        const kind = resolveTap({ cell: [x, world.topSolidY(x, z), z], normal }, selected, feet, world, occupied).kind;
        expect(['walk', 'place', 'none']).toContain(kind);
      }
    }
  });

  it('sky tap gives none', () => {
    for (const selected of ['hand', BlockId.Wood] as const) {
      expect(resolveTap(null, selected, feet, flatWorld(), occupied)).toEqual({ kind: 'none' });
    }
  });
});

describe('resolveHold', () => {
  // Spec §7a: press and hold digs, whichever slot is selected; too far walks next to it.
  it.each([
    ['ground next to him', [3, 0, 3] as Cell, BlockId.Grass],
    ['ground at the edge of reach', [5, 0, 5] as Cell, BlockId.Grass],
    ['a tree trunk', [4, 1, 4] as Cell, BlockId.Wood],
    ['leaves', [4, 4, 4] as Cell, BlockId.Leaves],
    ['a stone wall', [5, 1, 2] as Cell, BlockId.Stone],
  ])('holding on %s within reach digs it', (_name, cell, id) => {
    const world = flatWorld();
    world.set(...cell, id);
    world.markClean();
    expect(resolveHold({ cell, normal: up }, feet, world, occupied)).toEqual({ kind: 'dig', cell });
    expect(world.isDirty()).toBe(false);
  });

  it('reach is 3 blocks (Chebyshev, feet cell), including up and down', () => {
    const world = flatWorld();
    world.set(2, 4, 2, BlockId.Dirt);
    world.set(2, 5, 3, BlockId.Dirt);
    expect(resolveHold({ cell: [2, 4, 2], normal: [0, -1, 0] }, feet, world, occupied)).toEqual({ kind: 'dig', cell: [2, 4, 2] });
    expect(resolveHold({ cell: [2, 5, 3], normal: [0, -1, 0] }, feet, world, occupied))
      .toEqual({ kind: 'walkNear', block: [2, 5, 3] });
  });

  it('holding on a block out of reach walks next to it instead', () => {
    const world = flatWorld();
    world.set(8, 1, 8, BlockId.Wood);
    expect(resolveHold({ cell: [8, 1, 8], normal: [-1, 0, 0] }, feet, world, occupied))
      .toEqual({ kind: 'walkNear', block: [8, 1, 8] });
    expect(resolveHold({ cell: [6, 0, 2], normal: up }, feet, world, occupied))
      .toEqual({ kind: 'walkNear', block: [6, 0, 2] });
  });

  it('never digs the block under his own feet', () => {
    expect(resolveHold({ cell: [2, 0, 2], normal: up }, feet, flatWorld(), occupied)).toEqual({ kind: 'none' });
  });

  it('never digs the block under Pip', () => {
    expect(resolveHold({ cell: [3, 0, 2], normal: up }, feet, flatWorld(), occupied)).toEqual({ kind: 'none' });
    // Not under anyone: the block beside Pip is fine.
    expect(resolveHold({ cell: [4, 0, 2], normal: up }, feet, flatWorld(), occupied)).toEqual({ kind: 'dig', cell: [4, 0, 2] });
  });

  it('never digs bedrock, near or far', () => {
    const world = flatWorld();
    world.set(3, 0, 3, BlockId.Bedrock);
    world.set(9, 0, 9, BlockId.Bedrock);
    expect(resolveHold({ cell: [3, 0, 3], normal: up }, feet, world, occupied)).toEqual({ kind: 'none' });
    expect(resolveHold({ cell: [9, 0, 9], normal: up }, feet, world, occupied)).toEqual({ kind: 'none' });
  });

  it('never digs water or air', () => {
    const world = flatWorld();
    world.set(3, 1, 3, BlockId.Water);
    expect(resolveHold({ cell: [3, 1, 3], normal: up }, feet, world, occupied)).toEqual({ kind: 'none' });
    expect(resolveHold({ cell: [4, 3, 4], normal: up }, feet, world, occupied)).toEqual({ kind: 'none' });
  });

  it('sky gives none', () => {
    expect(resolveHold(null, feet, flatWorld(), occupied)).toEqual({ kind: 'none' });
  });
});

describe('createDebouncer', () => {
  it('debounces repeated taps', () => {
    const allow = createDebouncer();
    expect(allow('collect', 0)).toBe(true);
    expect(allow('collect', 100)).toBe(false);
    expect(allow('collect', 200)).toBe(true);
  });

  it('keeps keys independent and measures from the last allowed action', () => {
    const allow = createDebouncer();
    expect(allow('collect', 0)).toBe(true);
    expect(allow('place', 10)).toBe(true);
    expect(allow('collect', 149)).toBe(false);
    expect(allow('collect', 150)).toBe(true);
    expect(allow('place', 159)).toBe(false);
    expect(allow('place', 160)).toBe(true);
  });

  it('accepts a custom interval', () => {
    const allow = createDebouncer(300);
    expect(allow('tap', 0)).toBe(true);
    expect(allow('tap', 200)).toBe(false);
    expect(allow('tap', 300)).toBe(true);
  });
});
