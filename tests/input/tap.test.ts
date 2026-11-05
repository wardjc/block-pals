import { describe, expect, it } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import type { Cell } from '../../src/core/pathfind';
import { World } from '../../src/core/world';
import { createDebouncer, resolveTap } from '../../src/input/tap';

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
  // "Tap to go, tap next to you to dig." (Task 7 amendment, final review)
  it('hand tap on the ground next to the player gives collect without changing the world', () => {
    const world = flatWorld();
    expect(resolveTap({ cell: [3, 0, 3], normal: up }, 'hand', feet, world, occupied))
      .toEqual({ kind: 'collect', cell: [3, 0, 3] });
    expect(world.get(3, 0, 3)).toBe(BlockId.Grass);
    expect(world.isDirty()).toBe(false);
  });

  it('hand tap on the ground beyond arm\'s length walks, even within reach', () => {
    const world = flatWorld();
    expect(resolveTap({ cell: [4, 0, 2], normal: up }, 'hand', feet, world, occupied))
      .toEqual({ kind: 'walk', to: [4, 1, 2] });
    expect(resolveTap({ cell: [5, 0, 5], normal: up }, 'hand', feet, world, occupied))
      .toEqual({ kind: 'walk', to: [5, 1, 5] });
  });

  it('hand tap far gives walk to the cell in front of the tapped face', () => {
    const world = flatWorld();
    expect(resolveTap({ cell: [8, 0, 8], normal: up }, 'hand', feet, world, occupied))
      .toEqual({ kind: 'walk', to: [8, 1, 8] });
  });

  it('hand top-face tap on an adjacent block at feet level walks up onto it', () => {
    const world = flatWorld();
    world.set(3, 1, 2, BlockId.Stone);
    expect(resolveTap({ cell: [3, 1, 2], normal: up }, 'hand', feet, world, occupied))
      .toEqual({ kind: 'walk', to: [3, 2, 2] });
  });

  it('hand tap on a side or bottom face within reach collects', () => {
    const world = flatWorld();
    world.set(5, 1, 2, BlockId.Stone);
    world.set(4, 4, 4, BlockId.Dirt);
    expect(resolveTap({ cell: [5, 1, 2], normal: [-1, 0, 0] }, 'hand', feet, world, occupied))
      .toEqual({ kind: 'collect', cell: [5, 1, 2] });
    expect(resolveTap({ cell: [4, 4, 4], normal: [0, -1, 0] }, 'hand', feet, world, occupied))
      .toEqual({ kind: 'collect', cell: [4, 4, 4] });
  });

  it('hand tap on a tree within reach collects whatever face is hit', () => {
    const world = flatWorld();
    world.set(5, 1, 5, BlockId.Wood);
    world.set(5, 4, 5, BlockId.Leaves);
    expect(resolveTap({ cell: [5, 1, 5], normal: up }, 'hand', feet, world, occupied))
      .toEqual({ kind: 'collect', cell: [5, 1, 5] });
    expect(resolveTap({ cell: [5, 4, 5], normal: up }, 'hand', feet, world, occupied))
      .toEqual({ kind: 'collect', cell: [5, 4, 5] });
  });

  it('hand tap on anything collectable beyond reach walks near it', () => {
    const world = flatWorld();
    world.set(8, 1, 8, BlockId.Wood);
    expect(resolveTap({ cell: [8, 1, 8], normal: [-1, 0, 0] }, 'hand', feet, world, occupied))
      .toEqual({ kind: 'walk', to: [7, 1, 8] });
    world.set(6, 1, 2, BlockId.Stone);
    expect(resolveTap({ cell: [6, 1, 2], normal: [-1, 0, 0] }, 'hand', feet, world, occupied))
      .toEqual({ kind: 'walk', to: [5, 1, 2] });
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

  it('does not collect bedrock next to the player and walks instead', () => {
    const world = flatWorld();
    world.set(3, 0, 2, BlockId.Bedrock);
    expect(resolveTap({ cell: [3, 0, 2], normal: up }, 'hand', feet, world, occupied))
      .toEqual({ kind: 'walk', to: [3, 1, 2] });
  });

  it('a tap on a pond bed walks to the water cell above it (the game finds the shore)', () => {
    const world = flatWorld();
    world.set(8, 1, 8, BlockId.Water);
    for (const selected of ['hand', BlockId.Wood] as const) {
      expect(resolveTap({ cell: [8, 0, 8], normal: up }, selected, feet, world, occupied))
        .toEqual({ kind: 'walk', to: [8, 1, 8] });
    }
  });

  it('sky tap gives none', () => {
    for (const selected of ['hand', BlockId.Wood] as const) {
      expect(resolveTap(null, selected, feet, flatWorld(), occupied)).toEqual({ kind: 'none' });
    }
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
