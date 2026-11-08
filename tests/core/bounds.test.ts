import { describe, expect, test } from 'vitest';
import { clampToWall, insideWall } from '../../src/core/bounds';

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

  test('insideWall on 96 world', () => {
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
