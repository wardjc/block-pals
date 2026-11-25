import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { isStandable, type Cell } from '../../src/core/pathfind';
import { mulberry32 } from '../../src/core/rng';
import { World } from '../../src/core/world';
import {
  GRUMP_STATES, GrumpSystem, PAUSE_RADIUS, PERSONAL_SPACE, type Grump, type GrumpContext, type PlayerPos,
} from '../../src/game/grumps';

const ZONE = { x0: 6, z0: 6, x1: 30, z1: 22 };
const Y = 1;

function flat(): World {
  const w = new World(40, 10, 30);
  for (let x = 0; x < 40; x++) for (let z = 0; z < 30; z++) w.set(x, 0, z, BlockId.Grass);
  w.clearEdits();
  w.markClean();
  return w;
}
const cellOf = (g: { x: number; y: number; z: number }): Cell => [Math.floor(g.x), g.y, Math.floor(g.z)];
const dist = (g: { x: number; z: number }, p: PlayerPos): number => Math.hypot(g.x - p.x, g.z - p.z);

function setup(seed = 1, avoid: string[] = []) {
  const world = flat();
  const sys = new GrumpSystem(mulberry32(seed), ZONE, new Set(avoid));
  const player: PlayerPos = { x: 38.5, y: Y, z: 28.5 };
  let occupied: Cell[] = [];
  let plantCells: Cell[] = [];
  const ctx = (dt: number): GrumpContext => ({ world, player, occupied, plantCells, dt });
  return {
    world, sys, player, ctx,
    setOccupied: (o: Cell[]) => { occupied = o; },
    setPlants: (p: Cell[]) => { plantCells = p; },
    run: (seconds: number, dt = 0.1, each?: () => void) => { for (let t = 0; t < seconds; t += dt) { sys.update(ctx(dt)); each?.(); } },
  };
}

describe('grump states and words', () => {
  test('GRUMP_STATES is exactly the five names', () => {
    expect([...GRUMP_STATES]).toEqual(['wobbleIn', 'settle', 'idle', 'hop', 'cheered']);
  });
  test('no hurtful or scary identifier appears in the grump source files', () => {
    const bad = /angry|chase|flee|attack|hurt|dead|scared|explode|teleport|kill|damage|health/i;
    for (const f of ['src/game/grumps.ts', 'src/core/grumpRules.ts', 'src/core/farmZone.ts']) {
      expect(readFileSync(f, 'utf8').match(bad)?.[0], f).toBeUndefined();
    }
  });
});

describe('GrumpSystem: moving', () => {
  test('grumps stay inside the zone, always standable, after 10,000 simulated seconds with the player walking through', () => {
    for (const seed of [1, 2]) {
      const t = setup(seed);
      t.sys.spawn([8, Y, 8], 'jelly');
      t.sys.spawn([28, Y, 20], 'cloud');
      let clock = 0;
      t.run(10000, 0.2, () => {
        clock += 0.2;
        t.player.x = 18 + Math.cos(clock / 5) * 14; t.player.z = 14 + Math.sin(clock / 7) * 10;
        for (const g of t.sys.grumps) {
          const c = cellOf(g);
          expect(c[0] >= ZONE.x0 && c[0] <= ZONE.x1 && c[2] >= ZONE.z0 && c[2] <= ZONE.z1).toBe(true);
          expect(isStandable(t.world, c)).toBe(true);
        }
      });
    }
  });

  test('a grump never moves into an occupied cell, nor onto a plant, nor into another grump', () => {
    const t = setup(3);
    const occ: Cell[] = [];
    for (let x = 12; x <= 16; x++) occ.push([x, Y, 12], [x, Y + 1, 12]);
    t.setOccupied(occ);
    const plants: Cell[] = [[20, Y, 14], [21, Y, 14], [20, Y, 15]];
    t.setPlants(plants);
    t.sys.spawn([13, Y, 14], 'jelly');
    t.sys.spawn([14, Y, 14], 'cloud');
    t.sys.spawn([15, Y, 14], 'jelly');
    t.run(2000, 0.1, () => {
      const seen = new Set<string>();
      for (const g of t.sys.grumps) {
        const k = cellOf(g).join(',');
        expect(seen.has(k)).toBe(false);
        seen.add(k);
        expect(occ.some(o => o[0] === cellOf(g)[0] && o[2] === cellOf(g)[2] && o[1] === Y)).toBe(false);
        expect(plants.some(p => p[0] === cellOf(g)[0] && p[2] === cellOf(g)[2])).toBe(false);
      }
    });
  });

  test('wander speed is 0.5 to 0.8 blocks/s and wobbling in is 0.8', () => {
    const t = setup(4);
    const g = t.sys.spawn([8, Y, 8], 'jelly');
    let px = g.x, pz = g.z, maxIn = 0, maxHop = 0;
    for (let i = 0; i < 6000; i++) {
      t.sys.update(t.ctx(0.1));
      const v = Math.hypot(g.x - px, g.z - pz) / 0.1;
      if (g.state === 'wobbleIn') maxIn = Math.max(maxIn, v); else maxHop = Math.max(maxHop, v);
      px = g.x; pz = g.z;
    }
    expect(maxIn).toBeLessThanOrEqual(0.8 + 1e-6);
    expect(maxHop).toBeLessThanOrEqual(0.8 + 1e-6);
    expect(maxHop).toBeGreaterThan(0.4);
  });

  test('personal space: its own move never takes it closer than 4 to the player, nor closer at all once inside 4, and never towards the player within 12', () => {
    const rng = mulberry32(77);
    for (let run = 0; run < 1500; run++) {
      const t = setup(run);
      const g = t.sys.spawn([8 + Math.floor(rng() * 20), Y, 8 + Math.floor(rng() * 12)], run % 2 ? 'jelly' : 'cloud');
      for (let i = 0; i < 30; i++) t.sys.update(t.ctx(0.1));
      const a = rng() * Math.PI * 2, r = 0.5 + rng() * 11;
      t.player.x = g.x + Math.cos(a) * r; t.player.z = g.z + Math.sin(a) * r;
      for (let i = 0; i < 60; i++) {
        const before = dist(g, t.player);
        t.sys.update(t.ctx(0.1));
        const after = dist(g, t.player);
        if (before <= 12) expect(after, `run ${run} step ${i}`).toBeGreaterThanOrEqual(before - 1e-9);
        expect(after >= PERSONAL_SPACE - 1e-9 || after >= before - 1e-9).toBe(true);
      }
    }
  });

  test('a grump with the player right beside it stays put and is not trapped', () => {
    const t = setup(5);
    const g = t.sys.spawn([15, Y, 15], 'jelly');
    for (let i = 0; i < 40; i++) t.sys.update(t.ctx(0.1));
    t.player.x = g.x + 1; t.player.z = g.z;
    const px = g.x, pz = g.z;
    for (let i = 0; i < 100; i++) t.sys.update(t.ctx(0.1));
    expect(dist(g, t.player)).toBeGreaterThanOrEqual(1 - 1e-9);
    expect(Math.hypot(g.x - px, g.z - pz)).toBeLessThan(4);
    // The player leaves: it wanders again.
    t.player.x = 38.5; t.player.z = 28.5;
    const before = [g.x, g.z];
    t.run(60);
    expect([g.x, g.z]).not.toEqual(before);
  });

  test('a grump never stands on an avoided cell', () => {
    const avoid: string[] = [];
    for (let x = 10; x <= 20; x++) for (let z = 10; z <= 14; z++) avoid.push(`${x},${z}`);
    const t = setup(6, avoid);
    t.sys.spawn([8, Y, 12], 'jelly');
    t.sys.spawn([22, Y, 12], 'cloud');
    t.run(3000, 0.1, () => {
      for (const g of t.sys.grumps) expect(avoid.includes(`${Math.floor(g.x)},${Math.floor(g.z)}`)).toBe(false);
    });
  });

  test('a grump walled in by placed blocks is lifted out after 6 s', () => {
    const t = setup(7);
    const g = t.sys.spawn([15, Y, 15], 'jelly');
    for (let i = 0; i < 30; i++) t.sys.update(t.ctx(0.1));
    const [cx, , cz] = cellOf(g);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (dx || dz) t.world.set(cx + dx, Y, cz + dz, BlockId.Stone);
    t.run(12);
    expect(cellOf(g)[0] !== cx || cellOf(g)[2] !== cz).toBe(true);
    expect(isStandable(t.world, cellOf(g))).toBe(true);
  });

  test('placing into a grump cell is refused: occupiedCells lists its feet cell and the cell above', () => {
    const t = setup(8);
    const g = t.sys.spawn([15, Y, 15], 'jelly');
    expect(t.sys.occupiedCells()).toEqual([[15, Y, 15], [15, Y + 1, 15]]);
    expect(g.id).toBe(t.sys.grumps[0].id);
  });

  test('settle: a new grump heads for a cell within 2 of a planted crop, else a zone cell', () => {
    const t = setup(9);
    t.setPlants([[24, Y, 18]]);
    for (let i = 0; i < 20; i++) {
      const g = t.sys.spawn([8, Y, 8 + i % 3], 'jelly');
      t.sys.update(t.ctx(0.1));
      expect(g.settle).not.toBeNull();
      expect(Math.max(Math.abs(g.settle![0] - 24), Math.abs(g.settle![2] - 18))).toBeLessThanOrEqual(2);
      t.sys.grumps.length = 0;
    }
    const t2 = setup(9);
    const g2 = t2.sys.spawn([8, Y, 8], 'cloud');
    t2.sys.update(t2.ctx(0.1));
    expect(g2.settle![0] >= ZONE.x0 && g2.settle![0] <= ZONE.x1 && g2.settle![2] >= ZONE.z0 && g2.settle![2] <= ZONE.z1).toBe(true);
  });

  test('settle re-picks when its crop is gone', () => {
    const t = setup(10);
    t.setPlants([[24, Y, 18]]);
    const g = t.sys.spawn([8, Y, 8], 'jelly');
    t.run(5);
    expect(Math.abs(g.settle![0] - 24)).toBeLessThanOrEqual(2);
    t.setPlants([[10, Y, 10]]);
    t.run(1);
    expect(Math.abs(g.settle![0] - 10)).toBeLessThanOrEqual(2);
    expect(Math.abs(g.settle![2] - 10)).toBeLessThanOrEqual(2);
  });

  test('a new grump announces its arrival once it has settled', () => {
    const t = setup(11);
    t.sys.spawn([8, Y, 8], 'jelly');
    const events: string[] = [];
    for (let i = 0; i < 2000; i++) for (const e of t.sys.update(t.ctx(0.1))) events.push(e.type);
    expect(events.filter(e => e === 'arrived').length).toBe(1);
  });
});

describe('GrumpSystem: moods and pausing', () => {
  test('hit 0 to 1 is unsure, hit 1 to cheered (the grump is gone), later hits are ignored', () => {
    const t = setup(12);
    const g = t.sys.spawn([15, Y, 15], 'jelly');
    expect(g.mood).toBe(0);
    expect(t.sys.hit(g.id).result).toBe('unsure');
    expect(g.mood).toBe(1);
    expect(t.sys.hit(g.id).result).toBe('cheered');
    expect(t.sys.grumps.length).toBe(0);
    expect(t.sys.hit(g.id).result).toBe('ignored');
    expect(t.sys.hit(9999).result).toBe('ignored');
  });

  test('pausesCell is true within 3 of a mood 0 grump and false for mood 1 and for friends', () => {
    const t = setup(13);
    const g = t.sys.spawn([15, Y, 15], 'jelly');
    expect(PAUSE_RADIUS).toBe(3);
    expect(t.sys.pausesCell([15, Y, 17])).toBe(true);
    expect(t.sys.pausesCell([15, Y, 19])).toBe(false);
    t.sys.hit(g.id);
    expect(t.sys.pausesCell([15, Y, 17])).toBe(false);
    const g2 = t.sys.spawn([20, Y, 15], 'cloud');
    t.sys.makeFriend(g2.id);
    expect(t.sys.pausesCell([20, Y, 15])).toBe(false);
  });

  test('pausedCells lists exactly the plants within 3 of sulky grumps', () => {
    const t = setup(14);
    t.sys.spawn([15, Y, 15], 'jelly');
    const plants: Cell[] = [[15, Y, 16], [17, Y, 15], [15, Y, 20], [25, Y, 25]];
    expect(t.sys.pausedCells(plants)).toEqual([[15, Y, 16], [17, Y, 15]]);
  });
});

describe('GrumpSystem: spots and saving', () => {
  test('a fake door spot keeps its grump 3 cells from the door and never within 1 of it', () => {
    const t = setup(15);
    const door: Cell = [20, Y, 10];
    t.sys.addSpot({ id: 'door-a', cell: door, kind: 'door' });
    const g = t.sys.spawn([20, Y, 20], 'jelly', 'door-a');
    t.run(5);
    expect(Math.max(Math.abs(g.settle![0] - door[0]), Math.abs(g.settle![2] - door[2]))).toBe(3);
    t.run(3000, 0.1, () => {
      expect(Math.max(Math.abs(Math.floor(g.x) - door[0]), Math.abs(Math.floor(g.z) - door[2]))).toBeGreaterThanOrEqual(2);
    });
  });

  test('toJSON writes fixed-point tuples and restore brings them back (bad cells are dropped for grumps)', () => {
    const t = setup(16);
    t.sys.spawn([15, Y, 15], 'cloud');
    const g = t.sys.spawn([20, Y, 15], 'jelly');
    t.sys.hit(g.id);
    t.run(3);
    const saved = t.sys.toJSON();
    expect(saved.grumps.length).toBe(2);
    for (const e of saved.grumps) { expect(e.length).toBe(5); expect([0, 1]).toContain(e[0]); expect([0, 1]).toContain(e[4]); }
    const u = setup(17);
    u.sys.restore(saved, u.world, []);
    expect(u.sys.grumps.map(x => [x.kind, x.mood])).toEqual(t.sys.grumps.map(x => [x.kind, x.mood]));
    const v = setup(18);
    v.world.set(15, Y, 15, BlockId.Stone);
    v.sys.restore({ grumps: [[1, 150, Y, 150, 0]], friends: [] }, v.world, []);
    expect(v.sys.grumps.length).toBe(0);
  });
});

describe('GrumpSystem: entity ids', () => {
  test('ids are unique across grumps and friends and picking returns the right one', () => {
    const t = setup(19);
    const a = t.sys.spawn([10, Y, 10], 'jelly');
    const b = t.sys.spawn([12, Y, 10], 'cloud');
    const f = t.sys.makeFriend(a.id);
    const ids = [...t.sys.grumps.map((g: Grump) => g.id), ...t.sys.friends.map(x => x.id)];
    expect(new Set(ids).size).toBe(ids.length);
    expect(b.id).not.toBe(f.id);
  });
});
