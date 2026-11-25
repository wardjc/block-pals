import { describe, expect, it } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { isStandable, type Cell } from '../../src/core/pathfind';
import { mulberry32 } from '../../src/core/rng';
import { World } from '../../src/core/world';
import { rescue, stepWander, type Walker, type WanderRules } from '../../src/game/wander';

const ROAM = { x0: 4, z0: 4, x1: 20, z1: 14 };

function flat(): World {
  const w = new World(30, 10, 20);
  for (let x = 0; x < 30; x++) for (let z = 0; z < 20; z++) w.set(x, 0, z, BlockId.Grass);
  w.clearEdits();
  w.markClean();
  return w;
}

const walker = (x = 10.5, z = 8.5): Walker => ({ x, y: 1, z, heading: 0, stuckFor: 0 });
const rules = (over: Partial<WanderRules> = {}): WanderRules => ({
  roam: ROAM, speed: 0.8, hop: [1, 3], blocked: () => false, ...over,
});
const cellOf = (w: Walker): Cell => [Math.floor(w.x), w.y, Math.floor(w.z)];

function run(w: Walker, r: WanderRules, world: World, seed: number, seconds: number, dt = 0.05, each?: () => void) {
  const rng = mulberry32(seed);
  let target: { x: number; z: number } | null = null;
  for (let t = 0; t < seconds; t += dt) {
    target = stepWander(w, target, r, world, rng, dt).target;
    each?.();
  }
  return target;
}

describe('stepWander', () => {
  it('walks to a target and stops there', () => {
    const world = flat();
    const w = walker();
    const rng = mulberry32(3);
    let { target } = stepWander(w, null, rules(), world, rng, 0.05);
    expect(target).not.toBeNull();
    const goal = target!;
    for (let i = 0; i < 400 && target; i++) target = stepWander(w, target, rules(), world, rng, 0.05).target;
    expect(target).toBeNull();
    expect(Math.hypot(w.x - goal.x, w.z - goal.z)).toBeLessThan(0.1);
  });

  it('never steps onto a blocked cell, a non-standable cell or out of the roam rect', () => {
    const world = flat();
    for (let x = 8; x <= 12; x++) world.set(x, 1, 6, BlockId.Stone); // a wall of blocks the walker must not enter
    const blockedCell = (c: Cell) => c[0] === 11 && c[2] === 9;
    const w = walker();
    run(w, rules({ blocked: blockedCell }), world, 5, 600, 0.05, () => {
      const c = cellOf(w);
      expect(blockedCell(c)).toBe(false);
      expect(isStandable(world, c)).toBe(true);
      expect(c[0] >= ROAM.x0 && c[0] <= ROAM.x1 && c[2] >= ROAM.z0 && c[2] <= ROAM.z1).toBe(true);
    });
  });

  it('speed is respected within a frame', () => {
    const world = flat();
    const w = walker();
    const rng = mulberry32(8);
    let target: { x: number; z: number } | null = null;
    for (let i = 0; i < 2000; i++) {
      const px = w.x, pz = w.z;
      target = stepWander(w, target, rules({ speed: 0.5 }), world, rng, 0.1).target;
      expect(Math.hypot(w.x - px, w.z - pz)).toBeLessThanOrEqual(0.5 * 0.1 + 1e-9);
    }
  });

  it('the allow() veto stops a step and the walker never ends up past it', () => {
    const world = flat();
    const w = walker();
    const ban = { x: 10.5, z: 8.5 };
    const allow = (_from: { x: number; z: number }, to: { x: number; z: number }) => Math.hypot(to.x - ban.x, to.z - ban.z) <= 2;
    run(w, rules({ allow }), world, 11, 300, 0.05, () => {
      expect(Math.hypot(w.x - ban.x, w.z - ban.z)).toBeLessThanOrEqual(2 + 1e-9);
    });
  });

  it('stuck for 6 s is rescued to a free standable cell, else it stays', () => {
    const world = flat();
    const w = walker(10.5, 8.5);
    // Wall the walker in with placed blocks (its own cell stays open).
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) world.set(10 + dx, 1, 8 + dz, BlockId.Stone);
    const start = cellOf(w);
    let rescued = false;
    run(w, rules(), world, 2, 8, 0.05, () => { const c = cellOf(w); if (c[0] !== start[0] || c[2] !== start[2]) rescued = true; });
    expect(rescued).toBe(true);
    expect(isStandable(world, cellOf(w))).toBe(true);
    // Nowhere free at all: it stays.
    const tight = walker(10.5, 8.5);
    expect(rescue(tight, world, { x0: 10, z0: 8, x1: 10, z1: 8 }, () => false)).toBe(false);
    expect(cellOf(tight)).toEqual([10, 1, 8]);
  });

  it('same seed and inputs give the same path', () => {
    const trace = (seed: number): number[] => {
      const w = walker();
      const out: number[] = [];
      run(w, rules(), flat(), seed, 60, 0.05, () => out.push(w.x, w.z));
      return out;
    };
    expect(trace(21)).toEqual(trace(21));
    expect(trace(21)).not.toEqual(trace(22));
  });
});
