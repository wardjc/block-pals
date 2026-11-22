import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { canStep, findPath, GENTLE_DROP, isStandable, pathTowards, type Cell } from '../../src/core/pathfind';
import { World } from '../../src/core/world';

/**
 * A ledge: a 3 x 1 plateau at x 1..3 standing `drop` blocks above a floor at y 0; the floor is
 * open from x 4 on. Standing at (3, 1 + drop, 2), one step east lands on (4, 1, 2).
 */
function ledge(drop: number, size = 9): World {
  const world = new World(size, drop + 8, size);
  for (let x = 0; x < size; x++) for (let z = 0; z < size; z++) world.set(x, 0, z, BlockId.Stone);
  for (let x = 0; x <= 3; x++) for (let z = 0; z < size; z++) for (let y = 1; y <= drop; y++) world.set(x, y, z, BlockId.Stone);
  return world;
}

const top = (drop: number): Cell => [3, 1 + drop, 2];
const below: Cell = [4, 1, 2];

describe('gentle drops in canStep', () => {
  it('GENTLE_DROP is 12', () => {
    expect(GENTLE_DROP).toBe(12);
  });

  it('a 3, 8 and 12 block drop is one step; 13 is not', () => {
    for (const d of [3, 8, 12]) {
      const w = ledge(d);
      expect(isStandable(w, top(d))).toBe(true);
      expect(canStep(w, top(d), below, undefined, GENTLE_DROP), `drop ${d}`).toBe(true);
    }
    const w13 = ledge(13);
    expect(canStep(w13, top(13), below, undefined, GENTLE_DROP)).toBe(false);
  });

  it('a 2 block drop is a drop step too, and maxDrop limits it', () => {
    const w = ledge(2);
    expect(canStep(w, top(2), below, undefined, GENTLE_DROP)).toBe(true);
    expect(canStep(w, top(2), below, undefined, 1)).toBe(false);
    const w5 = ledge(5);
    expect(canStep(w5, top(5), below, undefined, 4)).toBe(false);
    expect(canStep(w5, top(5), below, undefined, 5)).toBe(true);
  });

  it('a drop needs a clear column and lands on the first floor below (never mid-air)', () => {
    const w = ledge(8);
    // A block in the column part way down: the landing is on it, not on the floor.
    w.set(4, 4, 2, BlockId.Stone);
    expect(canStep(w, top(8), below, undefined, GENTLE_DROP)).toBe(false);
    expect(canStep(w, top(8), [4, 5, 2], undefined, GENTLE_DROP)).toBe(true);
    // Stopping in the air is never a step.
    const open = ledge(8);
    expect(canStep(open, top(8), [4, 5, 2], undefined, GENTLE_DROP)).toBe(false);
  });

  it('no drop through a roof or into water', () => {
    const roofed = ledge(6);
    roofed.set(4, 1 + 6 + 1, 2, BlockId.Stone); // head height beside the ledge
    expect(canStep(roofed, top(6), below, undefined, GENTLE_DROP)).toBe(false);
    const wet = ledge(6);
    wet.set(4, 1, 2, BlockId.Water);
    expect(canStep(wet, top(6), below, undefined, GENTLE_DROP)).toBe(false);
    expect(canStep(wet, top(6), [4, 2, 2], undefined, GENTLE_DROP)).toBe(false);
    const pool = ledge(6);
    pool.set(4, 4, 2, BlockId.Water); // water part way down the column
    expect(canStep(pool, top(6), below, undefined, GENTLE_DROP)).toBe(false);
  });

  it('a drop is one way (no step back up)', () => {
    const w = ledge(5);
    expect(canStep(w, below, top(5), undefined, GENTLE_DROP)).toBe(false);
  });

  it('diagonal drops are refused', () => {
    const w = ledge(5);
    expect(canStep(w, top(5), [4, 1, 3], undefined, GENTLE_DROP)).toBe(false);
  });

  it('the allowed filter applies to the landing', () => {
    const w = ledge(5);
    expect(canStep(w, top(5), below, c => c[0] !== 4, GENTLE_DROP)).toBe(false);
  });

  it('maxDrop 1 is the default and behaves exactly as before', () => {
    const w = ledge(1);
    expect(canStep(w, top(1), below)).toBe(true);
    const w3 = ledge(3);
    expect(canStep(w3, top(3), below)).toBe(false);
  });
});

describe('gentle drops in findPath and pathTowards', () => {
  it('findPath can use a drop and its route is replayable step by step with canStep(..., GENTLE_DROP)', () => {
    const w = ledge(10);
    const goal: Cell = [7, 1, 2];
    expect(findPath(w, [1, 11, 2], goal)).toBeNull();
    const path = findPath(w, [1, 11, 2], goal, 4000, undefined, GENTLE_DROP)!;
    expect(path).not.toBeNull();
    expect(path[path.length - 1]).toEqual(goal);
    let prev: Cell = [1, 11, 2];
    for (const step of path) {
      expect(canStep(w, prev, step, undefined, GENTLE_DROP), `${prev} -> ${step}`).toBe(true);
      prev = step;
    }
  });

  it('pathTowards reaches the bottom with drops and not without', () => {
    const w = ledge(10);
    const goal: Cell = [7, 1, 2];
    const no = pathTowards(w, [1, 11, 2], goal)!;
    expect(no.distance).toBeGreaterThan(0);
    const yes = pathTowards(w, [1, 11, 2], goal, undefined, 8000, GENTLE_DROP)!;
    expect(yes.distance).toBe(0);
    let prev: Cell = [1, 11, 2];
    for (const step of yes.path) {
      expect(canStep(w, prev, step, undefined, GENTLE_DROP)).toBe(true);
      prev = step;
    }
    expect(yes.reached(goal)).toBe(true);
    // And never back up: from the floor the plateau is out of reach.
    const up = pathTowards(w, goal, [1, 11, 2], undefined, 8000, GENTLE_DROP)!;
    expect(up.reached([1, 11, 2])).toBe(false);
  });

  it("animals' and villagers' pathing never takes a drop (their call sites pass the default)", () => {
    for (const file of ['src/game/animals.ts', 'src/game/villagers.ts', 'src/game/lead.ts', 'src/game/leadTower.ts']) {
      const src = readFileSync(file, 'utf8');
      expect(src, file).not.toMatch(/GENTLE_DROP/);
    }
  });
});
