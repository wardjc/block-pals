import { describe, expect, test } from 'vitest';
import {
  CARVE_MAX_Y, LEGACY_WORLD, ORIGIN, SURFACE_BASE_Y, V2_WORLD, WORLD, clampToWall, fromWorld, insideWall, toWorld,
} from '../../src/core/bounds';

describe('world bounds', () => {
  test('insideWall matches v1 on a 48 world', () => {
    const world = { sizeX: 48, sizeZ: 48 };
    for (let x = 1; x <= 46; x++) {
      for (let z = 1; z <= 46; z++) {
        expect(insideWall(world, x, z)).toBe(true);
      }
      for (const edge of [0, 47]) {
        expect(insideWall(world, x, edge)).toBe(false);
        expect(insideWall(world, edge, x)).toBe(false);
      }
    }
  });

  test('old bounds helpers unchanged for the 96 world', () => {
    const world = { sizeX: 96, sizeZ: 96 };
    expect(insideWall(world, 94, 94)).toBe(true);
    expect(insideWall(world, 1, 1)).toBe(true);
    for (const edge of [0, 95]) {
      expect(insideWall(world, edge, 94)).toBe(false);
      expect(insideWall(world, 94, edge)).toBe(false);
    }
  });

  test('clampToWall keeps positions inside', () => {
    const world = { sizeX: 96, sizeZ: 96 };
    const position = clampToWall(world, 200, -3);
    expect(position.x).toBeLessThan(95);
    expect(position.x).toBe(95 - 1e-8);
    expect(position.z).toBe(1);
    expect(clampToWall(world, -3, 200)).toEqual({ x: 1, z: 95 - 1e-8 });
    expect(clampToWall(world, 24.5, 30.5)).toEqual({ x: 24.5, z: 30.5 });
  });
});

describe('the bigger, deeper world (192 x 68 x 192)', () => {
  test('WORLD is 192 x 68 x 192; the step 1/2 box and v1 box are kept', () => {
    expect(WORLD).toEqual({ x: 192, y: 68, z: 192 });
    expect(V2_WORLD).toEqual({ x: 96, y: 20, z: 96 });
    expect(LEGACY_WORLD).toEqual({ x: 48, y: 16, z: 48 });
    expect(ORIGIN).toEqual({ x: 48, y: 48, z: 48 });
    expect(SURFACE_BASE_Y).toBe(53);
    expect(CARVE_MAX_Y).toBe(48);
    // The old box sits exactly in the middle, and its roof is the new roof.
    expect(ORIGIN.x * 2 + V2_WORLD.x).toBe(WORLD.x);
    expect(ORIGIN.z * 2 + V2_WORLD.z).toBe(WORLD.z);
    expect(ORIGIN.y + V2_WORLD.y).toBe(WORLD.y);
  });

  test('insideWall on the 192 world: 1 and 190 in, 0 and 191 out', () => {
    const world = { sizeX: WORLD.x, sizeZ: WORLD.z };
    expect(insideWall(world, 1, 1)).toBe(true);
    expect(insideWall(world, 190, 190)).toBe(true);
    for (const edge of [0, 191]) {
      expect(insideWall(world, edge, 100)).toBe(false);
      expect(insideWall(world, 100, edge)).toBe(false);
    }
  });

  test('toWorld and fromWorld round-trip and move by exactly ORIGIN', () => {
    expect(toWorld([0, 0, 0])).toEqual([48, 48, 48]);
    expect(toWorld([95, 19, 95])).toEqual([143, 67, 143]);
    expect(fromWorld([48, 48, 48])).toEqual([0, 0, 0]);
    for (const c of [[0, 0, 0], [95, 19, 95], [24, 8, 24], [-3, 2, 200]] as Array<[number, number, number]>) {
      expect(fromWorld(toWorld(c))).toEqual(c);
      expect(toWorld(fromWorld(c))).toEqual(c);
    }
  });
});
