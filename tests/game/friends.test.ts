import { describe, expect, test } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { isStandable, type Cell } from '../../src/core/pathfind';
import { mulberry32 } from '../../src/core/rng';
import { World } from '../../src/core/world';
import { FRIEND_JOB_SECONDS, GrumpSystem, type GrumpContext, type PlayerPos } from '../../src/game/grumps';

const ZONE = { x0: 6, z0: 6, x1: 30, z1: 22 };
const Y = 1;

function flat(): World {
  const w = new World(40, 10, 30);
  for (let x = 0; x < 40; x++) for (let z = 0; z < 30; z++) w.set(x, 0, z, BlockId.Grass);
  w.clearEdits();
  w.markClean();
  return w;
}

function fakeFarm(growing: Cell[]) {
  const helped: Cell[] = [];
  return {
    helped, growing,
    growingNear: (c: Cell, r: number): Cell | null => {
      let best: Cell | null = null, bd = r * r;
      for (const g of growing) { const d = (g[0] - c[0]) ** 2 + (g[2] - c[2]) ** 2; if (d <= bd) { bd = d; best = g; } }
      return best;
    },
    help: (c: Cell) => { helped.push(c); growing.splice(growing.findIndex(g => g.join() === c.join()), 1); return null; },
  };
}

function setup(seed = 1, avoid: string[] = []) {
  const world = flat();
  const sys = new GrumpSystem(mulberry32(seed), ZONE, new Set(avoid));
  const player: PlayerPos = { x: 38.5, y: Y, z: 28.5 };
  const ctx = (dt: number): GrumpContext => ({ world, player, occupied: [], plantCells: [], dt });
  const friend = (x = 15, z = 15, kind: 'jelly' | 'cloud' = 'jelly') => sys.makeFriend(sys.spawn([x, Y, z], kind).id);
  return { world, sys, player, ctx, friend };
}

describe('friends', () => {
  test('converting keeps position and kind and gives variant 0, then 1, 2, 3, 4', () => {
    const t = setup();
    for (let i = 0; i < 5; i++) {
      const g = t.sys.spawn([10 + i * 2, Y, 10], i % 2 ? 'cloud' : 'jelly');
      const at = [g.x, g.y, g.z];
      const f = t.sys.makeFriend(g.id);
      expect([f.x, f.y, f.z]).toEqual(at);
      expect(f.kind).toBe(g.kind);
      expect(f.variant).toBe(i);
      expect(f.jobIn).toBe(FRIEND_JOB_SECONDS);
    }
    expect(t.sys.grumps.length).toBe(0);
    expect(t.sys.friends.length).toBe(5);
  });

  test('the variant wraps after 5 and nothing breaks', () => {
    const t = setup();
    for (let i = 0; i < 7; i++) t.friend(8 + i * 2, 10);
    expect(t.sys.friends.map(f => f.variant)).toEqual([0, 1, 2, 3, 4, 0, 1]);
  });

  test('the friend cap is never exceeded through tryMakeFriend', () => {
    const t = setup();
    let cheered = 0;
    for (let i = 0; i < 60; i++) {
      cheered++;
      const g = t.sys.spawn([8 + (i % 10) * 2, Y, 8 + Math.floor(i / 10) * 2], 'jelly');
      if (!t.sys.tryMakeFriend(g.id, cheered)) t.sys.grumps.length = 0;
      expect(t.sys.friends.length).toBeLessThanOrEqual(5);
    }
    expect(t.sys.friends.length).toBe(5);
  });

  test('a friend never leaves the zone, never stands on an avoided cell, never walks towards the player', () => {
    const avoid: string[] = [];
    for (let x = 12; x <= 18; x++) for (let z = 10; z <= 14; z++) avoid.push(`${x},${z}`);
    const t = setup(3, avoid);
    const f = t.friend(8, 12);
    const rng = mulberry32(5);
    for (let i = 0; i < 20000; i++) {
      if (i % 200 === 0) { t.player.x = ZONE.x0 + rng() * 25; t.player.z = ZONE.z0 + rng() * 17; }
      const before = Math.hypot(f.x - t.player.x, f.z - t.player.z);
      t.sys.update(t.ctx(0.1));
      const after = Math.hypot(f.x - t.player.x, f.z - t.player.z);
      if (before <= 12) expect(after).toBeGreaterThanOrEqual(before - 1e-9);
      const c = [Math.floor(f.x), Math.floor(f.z)];
      expect(c[0] >= ZONE.x0 && c[0] <= ZONE.x1 && c[1] >= ZONE.z0 && c[1] <= ZONE.z1).toBe(true);
      expect(avoid.includes(c.join(','))).toBe(false);
      expect(isStandable(t.world, [c[0], f.y, c[1]])).toBe(true);
    }
  });

  test('friends are not solid but placing into one is refused (occupiedCells)', () => {
    const t = setup();
    const f = t.friend();
    expect(t.sys.occupiedCells()).toEqual([[Math.floor(f.x), f.y, Math.floor(f.z)], [Math.floor(f.x), f.y + 1, Math.floor(f.z)]]);
  });

  test('a friend helps the nearest growing plant every 240 s of play time', () => {
    const t = setup();
    const f = t.friend(15, 15);
    const farm = fakeFarm([[16, Y, 15], [28, Y, 20], [7, Y, 7]]);
    let helpedAt: number[] = [];
    for (let s = 1; s <= 500; s++) {
      for (const e of t.sys.updateFriends({ ...t.ctx(1), farm })) if (e.type === 'helped') helpedAt.push(s);
    }
    expect(helpedAt).toEqual([240, 480]);
    expect(farm.helped[0]).toEqual([16, Y, 15]);
    expect(f.jobIn).toBeLessThanOrEqual(FRIEND_JOB_SECONDS);
  });

  test('no growing plant: it waits at zero without piling up jobs, then helps as soon as one appears', () => {
    const t = setup();
    const f = t.friend();
    const farm = fakeFarm([]);
    for (let s = 0; s < 1000; s++) t.sys.updateFriends({ ...t.ctx(1), farm });
    expect(f.jobIn).toBe(0);
    farm.growing.push([16, Y, 15]);
    const ev = t.sys.updateFriends({ ...t.ctx(1), farm });
    expect(ev.length).toBe(1);
    expect(farm.helped.length).toBe(1);
    expect(f.jobIn).toBe(FRIEND_JOB_SECONDS);
    farm.growing.push([16, Y, 15]);
    expect(t.sys.updateFriends({ ...t.ctx(1), farm })).toEqual([]); // no second job until 240 s more
  });

  test('a ripe plant is never helped (growingNear only offers growing ones)', () => {
    const t = setup();
    t.friend();
    const helped: Cell[] = [];
    const farm = { growingNear: () => null, help: (c: Cell) => { helped.push(c); return null; } };
    for (let s = 0; s < 600; s++) t.sys.updateFriends({ ...t.ctx(1), farm });
    expect(helped).toEqual([]);
  });

  test('dt 0 never advances a job; jobs ignore the pause (a sulky grump beside the plant changes nothing)', () => {
    const t = setup();
    const f = t.friend(15, 15);
    const farm = fakeFarm([[16, Y, 15]]);
    for (let i = 0; i < 100; i++) t.sys.updateFriends({ ...t.ctx(0), farm });
    expect(f.jobIn).toBe(FRIEND_JOB_SECONDS);
    t.sys.spawn([17, Y, 15], 'cloud'); // sulky: pauses cells within 3
    expect(t.sys.pausesCell([16, Y, 15])).toBe(true);
    for (let s = 0; s < 240; s++) t.sys.updateFriends({ ...t.ctx(1), farm });
    expect(farm.helped.length).toBe(1);
  });

  test('the job uses Farm.help only (the only thing it calls on the farm)', () => {
    const t = setup();
    t.friend();
    const calls: string[] = [];
    const farm = {
      growingNear: () => { calls.push('growingNear'); return [16, Y, 15] as Cell; },
      help: () => { calls.push('help'); return null; },
    };
    for (let s = 0; s < 240; s++) t.sys.updateFriends({ ...t.ctx(1), farm });
    expect(calls.filter(c => c === 'help').length).toBe(1);
    expect(new Set(calls)).toEqual(new Set(['growingNear', 'help']));
  });

  test('friends are never removed by any update (10,000 s random run) and cannot be hit', () => {
    const t = setup(9);
    const a = t.friend(10, 10), b = t.friend(20, 12, 'cloud');
    const farm = fakeFarm([[16, Y, 15]]);
    const rng = mulberry32(2);
    for (let i = 0; i < 100000; i++) {
      if (i % 500 === 0) { t.player.x = rng() * 38; t.player.z = rng() * 28; }
      t.sys.update(t.ctx(0.1));
      t.sys.updateFriends({ ...t.ctx(0.1), farm });
      if (i % 10000 === 0) t.sys.spawn([8 + (i / 10000), Y, 8], 'jelly');
    }
    expect(t.sys.friends.map(f => f.id)).toEqual([a.id, b.id]);
    expect(t.sys.hit(a.id).result).toBe('ignored');
    expect(t.sys.hit(b.id).result).toBe('ignored');
    expect(t.sys.friends.length).toBe(2);
  });

  test('friends save and restore, and a friend on a bad cell is re-placed, never dropped', () => {
    const t = setup(4);
    t.friend(15, 15);
    t.friend(20, 15, 'cloud');
    const saved = t.sys.toJSON();
    expect(saved.friends.length).toBe(2);
    const u = setup(5);
    u.world.set(15, Y, 15, BlockId.Stone); // a block now sits where the first friend stood
    u.sys.restore(saved, u.world, []);
    expect(u.sys.friends.length).toBe(2);
    expect(u.sys.friends.map(f => f.variant)).toEqual([0, 1]);
    for (const f of u.sys.friends) expect(isStandable(u.world, [Math.floor(f.x), f.y, Math.floor(f.z)])).toBe(true);
    expect(u.sys.friends.map(f => f.kind)).toEqual(['jelly', 'cloud']);
  });

  test('with a farm level, an underground grump is dropped and an underground friend is lifted to the farm level, never lost', () => {
    const world = flat();
    world.set(15, 5, 15, BlockId.Stone); // a ledge: standing at y 6 is standable but not on the farm level
    const sys = new GrumpSystem(mulberry32(1), ZONE, new Set(), Y);
    sys.restore({ grumps: [[0, 155, 6, 155, 0]], friends: [[0, 0, 155, 6, 155, 30]] }, world, []);
    expect(sys.grumps.length).toBe(0);
    expect(sys.friends.length).toBe(1);
    expect(Math.abs(sys.friends[0].y - Y)).toBeLessThanOrEqual(1);
  });

  test('a rescue with a farm level never lifts a walled-in grump to another level', () => {
    const world = flat();
    for (let x = 0; x < 40; x++) for (let z = 0; z < 30; z++) { world.set(x, 5, z, BlockId.Stone); } // a roof-level floor far above
    const sys = new GrumpSystem(mulberry32(2), ZONE, new Set(), Y);
    const player: PlayerPos = { x: 38.5, y: Y, z: 28.5 };
    const grump = sys.spawn([15, Y, 15], 'jelly');
    for (let i = 0; i < 20; i++) sys.update({ world, player, occupied: [], plantCells: [], dt: 0.1 });
    const [cx, , cz] = [Math.floor(grump.x), 0, Math.floor(grump.z)];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (dx || dz) world.set(cx + dx, Y, cz + dz, BlockId.Stone);
    for (let i = 0; i < 200; i++) sys.update({ world, player, occupied: [], plantCells: [], dt: 0.1 });
    expect(Math.abs(grump.y - Y)).toBeLessThanOrEqual(1);
  });
});
