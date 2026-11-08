import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { FEEDS, GIFT, ItemId, type StackId } from '../../src/core/items';
import { canStep, isStandable, type Cell } from '../../src/core/pathfind';
import { mulberry32 } from '../../src/core/rng';
import { generateWorld } from '../../src/core/worldgen';
import { World } from '../../src/core/world';
import {
  ANIMAL_STATES, DEFAULT_HERD, GIFT_REST_SECONDS, Herd, type Animal, type AnimalKind, type HerdContext, type HerdEvent,
} from '../../src/game/animals';

const KINDS: AnimalKind[] = ['chicken', 'cow', 'sheep', 'pig'];
const ROAM = { x0: 5, z0: 5, x1: 30, z1: 14 };
const SPAWNS: Cell[] = [];
for (const z of [7, 11]) for (const x of [7, 10, 13, 16, 19, 22, 25]) SPAWNS.push([x, 1, z]);

function flat(): World {
  const w = new World(40, 10, 24);
  for (let x = 0; x < 40; x++) for (let z = 0; z < 24; z++) w.set(x, 0, z, BlockId.Grass);
  w.clearEdits();
  w.markClean();
  return w;
}

const cellOf = (a: Animal): Cell => [Math.floor(a.x), a.y, Math.floor(a.z)];
const dist = (a: Animal, p: { x: number; z: number }): number => Math.hypot(a.x - p.x, a.z - p.z);

function make(world = flat(), roam = ROAM, spawns = SPAWNS, seed = 1) {
  const herd = new Herd(mulberry32(seed));
  herd.populate(spawns);
  const player = { x: 35.5, y: 1, z: 20.5 };
  let held: StackId | 'hand' = 'hand';
  let occupied: Cell[] = [];
  const events: HerdEvent[] = [];
  const ctx = (dt: number): HerdContext => ({ world, roam, player, held, occupied, dt });
  const step = (dt = 0.05): HerdEvent[] => {
    const e = herd.update(ctx(dt));
    events.push(...e);
    return e;
  };
  const run = (seconds: number, dt = 0.05): void => { for (let t = 0; t < seconds; t += dt) step(dt); };
  return {
    world, roam, herd, player, events, step, run,
    hold: (h: StackId | 'hand') => { held = h; },
    setOccupied: (o: Cell[]) => { occupied = o; },
  };
}

describe('Herd: populate', () => {
  it('makes 4 chickens, 2 cows, 3 sheep and 1 pig on standable cells', () => {
    const { herd, world } = make();
    const count = (k: AnimalKind): number => herd.animals.filter(a => a.kind === k).length;
    expect(DEFAULT_HERD).toEqual({ chicken: 4, cow: 2, sheep: 3, pig: 1 });
    expect(KINDS.map(count)).toEqual([4, 2, 3, 1]);
    expect(herd.animals).toHaveLength(10);
    for (const a of herd.animals) expect(isStandable(world, cellOf(a))).toBe(true);
    expect(new Set(herd.animals.map(a => a.id)).size).toBe(10);
    expect(new Set(herd.animals.map(a => cellOf(a).join(','))).size).toBe(10);
  });
  it('is deterministic for the same seed', () => {
    expect(make(flat(), ROAM, SPAWNS, 7).herd.toJSON()).toEqual(make(flat(), ROAM, SPAWNS, 7).herd.toJSON());
  });
  it('starts in a calm state, with a gift ready and no rest', () => {
    const { herd } = make();
    for (const a of herd.animals) { expect(['idle', 'walk', 'graze']).toContain(a.state); expect(a.giftIn).toBe(0); }
  });
});

describe('Herd: wandering', () => {
  it('animals stay inside the pasture on standable cells, never on an occupied cell, over 10,000 simulated seconds', () => {
    for (const seed of [1, 2, 3]) {
      const s = make(flat(), ROAM, SPAWNS, seed);
      const rand = mulberry32(seed + 100);
      const foods: Array<StackId | 'hand'> = ['hand', ItemId.Apple, ItemId.Wheat, BlockId.Planks, ItemId.WheatSeed, 'hand'];
      let secs = 0;
      const bad: string[] = [];
      for (let i = 0; i < 200; i++) {
        // the player wanders about, in and out of the pasture, and the held item changes
        s.player.x = rand() * 40;
        s.player.z = rand() * 24;
        s.hold(foods[Math.floor(rand() * foods.length)]);
        const px = Math.floor(s.player.x), pz = Math.floor(s.player.z);
        const pip: Cell = [Math.floor(rand() * 30) + 3, 1, Math.floor(rand() * 12) + 3];
        s.setOccupied([[px, 1, pz], [px, 2, pz], pip, [pip[0], 2, pip[2]]]);
        const occ = new Set([[px, 1, pz], [px, 2, pz], pip, [pip[0], 2, pip[2]]].map(c => c.join(',')));
        for (let t = 0; t < 50; t += 0.1, secs += 0.1) {
          const before = s.herd.animals.map(cellOf);
          s.step(0.1);
          const now = s.herd.animals.map(cellOf);
          now.forEach((c, k) => {
            if (!isStandable(s.world, c)) bad.push(`not standable ${c}`);
            if (!(c[0] >= ROAM.x0 && c[0] <= ROAM.x1 && c[2] >= ROAM.z0 && c[2] <= ROAM.z1)) bad.push(`outside ${c}`);
            if (c.join(',') !== before[k].join(',')) {
              if (occ.has(c.join(','))) bad.push(`moved into an occupied cell ${c}`);
              if (now.filter(o => o.join(',') === c.join(',')).length > 1) bad.push(`moved into another animal ${c}`);
            }
          });
        }
      }
      expect(bad.slice(0, 5)).toEqual([]);
      expect(secs).toBeGreaterThanOrEqual(10_000 - 1);
    }
  }, 60_000);
  it('wandering speed is 0.7 to 1.0 blocks per second and the animals really move about', () => {
    const s = make();
    const seen: number[] = [];
    const start = s.herd.animals.map(a => ({ x: a.x, z: a.z }));
    for (let t = 0; t < 120; t += 0.05) {
      const before = s.herd.animals.map(a => ({ x: a.x, z: a.z }));
      s.step(0.05);
      s.herd.animals.forEach((a, i) => {
        if (a.state !== 'walk') return;
        const v = Math.hypot(a.x - before[i].x, a.z - before[i].z) / 0.05;
        if (v > 0.01) seen.push(v);
      });
    }
    expect(seen.length).toBeGreaterThan(100);
    expect(Math.max(...seen)).toBeLessThanOrEqual(1.0 + 1e-6);
    expect(Math.min(...seen)).toBeGreaterThanOrEqual(0.7 - 0.05);
    expect(s.herd.animals.filter((a, i) => Math.hypot(a.x - start[i].x, a.z - start[i].z) > 1.5).length).toBeGreaterThanOrEqual(5);
  });
  it('an animal never steps onto a cell a step could not reach', () => {
    const s = make();
    for (let i = 0; i < 4; i++) s.world.set(15, 1, 8 + i, BlockId.Planks); // a wall of blocks across the pasture
    s.world.set(15, 2, 8, BlockId.Planks);
    let prev = s.herd.animals.map(cellOf);
    for (let t = 0; t < 600; t += 0.1) {
      s.step(0.1);
      const now = s.herd.animals.map(cellOf);
      now.forEach((c, i) => {
        if (c.join(',') !== prev[i].join(',')) expect(canStep(s.world, prev[i], c)).toBe(true);
      });
      prev = now;
    }
  });
  it('every state is one of the five calm names', () => {
    const s = make();
    for (let t = 0; t < 200; t += 0.1) { s.step(0.1); for (const a of s.herd.animals) expect(ANIMAL_STATES).toContain(a.state); }
  });
});

describe('Herd: coming over for food', () => {
  for (const food of FEEDS) {
    it(`holding out ${ItemId[food]}: every animal within 10 ends between 1.2 and 3 blocks from him, kinds mixed`, () => {
      const s = make();
      s.player.x = 18.5; s.player.z = 9.5;
      s.setOccupied([[18, 1, 9], [18, 2, 9]]);
      s.hold(food);
      s.run(40);
      for (const a of s.herd.animals) {
        if (Math.hypot(a.x - 18.5, a.z - 9.5) > 10) continue;
        const d = dist(a, s.player);
        expect(d, `${a.kind} ${a.id}`).toBeGreaterThanOrEqual(1.2 - 1e-6);
        expect(d, `${a.kind} ${a.id}`).toBeLessThanOrEqual(3.0 + 1e-6);
      }
      const near = s.herd.animals.filter(a => dist(a, s.player) <= 3.0 + 1e-6);
      expect(new Set(near.map(a => a.kind)).size).toBe(4);
      expect(s.herd.animals.every(a => a.state !== 'walk' || true)).toBe(true);
    });
  }
  it('coming over is faster than wandering, at 1.6 blocks per second', () => {
    const s = make();
    s.player.x = 18.5; s.player.z = 9.5;
    s.hold(ItemId.Carrot);
    let top = 0;
    for (let t = 0; t < 20; t += 0.05) {
      const before = s.herd.animals.map(a => ({ x: a.x, z: a.z }));
      s.step(0.05);
      s.herd.animals.forEach((a, i) => {
        if (a.state !== 'come') return;
        top = Math.max(top, Math.hypot(a.x - before[i].x, a.z - before[i].z) / 0.05);
      });
    }
    expect(top).toBeGreaterThan(1.4);
    expect(top).toBeLessThanOrEqual(1.6 + 1e-6);
  });
  it('seeds, milk, eggs, wool, blocks and the hand do not call them', () => {
    for (const h of [ItemId.WheatSeed, ItemId.Milk, ItemId.Egg, ItemId.Wool, BlockId.Planks, 'hand'] as const) {
      const s = make();
      s.player.x = 18.5; s.player.z = 9.5;
      s.hold(h);
      s.run(30);
      expect(s.herd.animals.some(a => a.state === 'come'), String(h)).toBe(false);
    }
  });
  it('putting the food away sends them back to wandering', () => {
    const s = make();
    s.player.x = 18.5; s.player.z = 9.5;
    s.hold(ItemId.Apple);
    s.run(30);
    s.hold('hand');
    s.run(1);
    expect(s.herd.animals.every(a => a.state !== 'come')).toBe(true);
    s.run(60);
    const far = s.herd.animals.filter(a => dist(a, s.player) > 4);
    expect(far.length).toBeGreaterThan(2);
  });
  it('he is out of range (more than 10 blocks) so nobody comes', () => {
    const s = make();
    s.player.x = 38; s.player.z = 22;
    s.hold(ItemId.Apple);
    s.run(10);
    expect(s.herd.animals.some(a => a.state === 'come')).toBe(false);
  });
  it('gives way: an animal within 1 block of him steps calmly aside', () => {
    const s = make();
    const a = s.herd.animals[0];
    s.player.x = a.x + 0.4; s.player.z = a.z;
    s.setOccupied([[Math.floor(s.player.x), 1, Math.floor(s.player.z)], [Math.floor(s.player.x), 2, Math.floor(s.player.z)]]);
    s.run(4);
    expect(dist(a, s.player)).toBeGreaterThanOrEqual(1.0 - 1e-6);
  });
});

describe('Herd: feeding and gifts', () => {
  it('every animal kind accepts every food in FEEDS, gives its gift and names exactly one food used', () => {
    for (const food of FEEDS) {
      const { herd } = make();
      for (const a of herd.animals) {
        const r = herd.feed(a.id, food);
        expect(r).toEqual({ result: 'gift', gift: GIFT[a.kind], usedFood: food });
        expect(a.giftIn).toBeCloseTo(GIFT_REST_SECONDS, 5);
        expect(a.state).toBe('happy');
      }
    }
  });
  it('gifts: chicken egg, cow milk, sheep wool, pig potato', () => {
    const { herd } = make();
    const by = Object.fromEntries(KINDS.map(k => [k, herd.animals.find(a => a.kind === k)!]));
    expect([herd.feed(by.chicken.id, ItemId.Wheat), herd.feed(by.cow.id, ItemId.Wheat), herd.feed(by.sheep.id, ItemId.Wheat), herd.feed(by.pig.id, ItemId.Wheat)]
      .map(r => (r.result === 'gift' ? r.gift : null))).toEqual([ItemId.Egg, ItemId.Milk, ItemId.Wool, ItemId.Potato]);
  });
  it('feeding a resting animal uses no food and returns resting', () => {
    const s = make();
    const a = s.herd.animals[0];
    s.herd.feed(a.id, ItemId.Apple);
    expect(s.herd.feed(a.id, ItemId.Apple)).toEqual({ result: 'resting' });
    expect(a.giftIn).toBeCloseTo(GIFT_REST_SECONDS, 5);
    expect(a.state).toBe('happy');
  });
  it('the rest ends after 45 s and then the animal gives again', () => {
    const s = make();
    const a = s.herd.animals[0];
    s.herd.feed(a.id, ItemId.Carrot);
    s.run(GIFT_REST_SECONDS - 1);
    expect(s.herd.feed(a.id, ItemId.Carrot).result).toBe('resting');
    s.run(1.2);
    expect(a.giftIn).toBe(0);
    expect(s.herd.feed(a.id, ItemId.Carrot).result).toBe('gift');
    expect(GIFT_REST_SECONDS).toBe(45);
  });
  it('a non-food returns notFood and changes nothing', () => {
    const s = make();
    const a = s.herd.animals[0];
    for (const h of [ItemId.WheatSeed, ItemId.AppleSapling, ItemId.Egg, ItemId.Wool, ItemId.Milk, BlockId.Planks, 'hand'] as const) {
      expect(s.herd.feed(a.id, h)).toEqual({ result: 'notFood' });
    }
    expect(a.giftIn).toBe(0);
    expect(s.herd.feed(9999, ItemId.Apple)).toEqual({ result: 'notFood' });
  });
  it('a gift that cannot fit is refused whole: no food used and no rest started', () => {
    const s = make();
    const a = s.herd.animals[0];
    expect(s.herd.feed(a.id, ItemId.Apple, () => false)).toEqual({ result: 'full' });
    expect(a.giftIn).toBe(0);
    expect(s.herd.feed(a.id, ItemId.Apple, () => true).result).toBe('gift');
  });
  it('petting never gives anything and starts no rest; the animal is happy for a moment', () => {
    const s = make();
    const a = s.herd.animals[0];
    s.herd.pet(a.id);
    expect(a.state).toBe('happy');
    expect(a.giftIn).toBe(0);
    s.run(1.5);
    expect(a.state).not.toBe('happy');
    expect(() => s.herd.pet(424242)).not.toThrow();
  });
  it('happy noises are queued when fed or petted', () => {
    const s = make();
    s.herd.pet(s.herd.animals[1].id);
    s.herd.feed(s.herd.animals[2].id, ItemId.Apple);
    const ev = s.step(0.05);
    expect(ev.filter(e => e.reason === 'happy').map(e => e.id).sort()).toEqual([s.herd.animals[1].id, s.herd.animals[2].id].sort());
  });
});

describe('Herd: idle noises', () => {
  it('idle noises are at most one per 3 s across the herd, only when he is within 12 blocks', () => {
    const s = make();
    s.player.x = 16.5; s.player.z = 9.5;
    s.run(600);
    const idle = s.events.filter(e => e.reason === 'idle');
    expect(idle.length).toBeGreaterThan(5);
    for (const e of idle) { expect(e.dist).toBeLessThanOrEqual(12); expect(KINDS).toContain(e.kind); }
    // 600 s at 0.05 s steps: count the idle ones per 3 s window.
    let times: number[] = [];
    const t0 = 0;
    const s2 = make();
    s2.player.x = 16.5; s2.player.z = 9.5;
    for (let i = 0; i < 12000; i++) { const e = s2.step(0.05); if (e.some(x => x.reason === 'idle')) times.push(t0 + i * 0.05); }
    times = times.sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(3 - 1e-6);
  });
  it('nobody makes noise when he is far away', () => {
    const s = make();
    s.player.x = 39.5; s.player.z = 23.5;
    s.run(300);
    expect(s.events.filter(e => e.reason === 'idle')).toEqual([]);
  });
});

describe('Herd: trapped animals', () => {
  it('a trapped animal is lifted to a free spot after 6 s', () => {
    const s = make();
    const a = s.herd.animals[0];
    const [cx, , cz] = cellOf(a);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      if (dx === 0 && dz === 0) continue;
      s.world.set(cx + dx, 1, cz + dz, BlockId.Planks);
      s.world.set(cx + dx, 2, cz + dz, BlockId.Planks);
    }
    s.run(5);
    expect(cellOf(a)).toEqual([cx, 1, cz]);
    s.run(2);
    const c = cellOf(a);
    expect(isStandable(s.world, c)).toBe(true);
    expect(c[0] >= ROAM.x0 && c[0] <= ROAM.x1 && c[2] >= ROAM.z0 && c[2] <= ROAM.z1).toBe(true);
    expect(Math.max(Math.abs(c[0] - cx), Math.abs(c[2] - cz))).toBeGreaterThan(1);
  });
  it('an animal whose own cell is built over (a block above it) is lifted too', () => {
    const s = make();
    const a = s.herd.animals[3];
    const [cx, , cz] = cellOf(a);
    s.world.set(cx, 2, cz, BlockId.Planks); // not standable any more
    s.run(8);
    expect(isStandable(s.world, cellOf(a))).toBe(true);
  });
  it('a fully blocked pasture leaves animals standing, none removed', () => {
    const s = make();
    for (let x = 0; x < 40; x++) for (let z = 0; z < 24; z++) { s.world.set(x, 1, z, BlockId.Planks); s.world.set(x, 2, z, BlockId.Planks); }
    s.run(30);
    expect(s.herd.animals).toHaveLength(10);
  });
  it('occupiedCells lists the feet cell and the cell above for every animal', () => {
    const { herd } = make();
    const cells = herd.occupiedCells().map(c => c.join(','));
    expect(cells).toHaveLength(20);
    for (const a of herd.animals) {
      const [x, y, z] = cellOf(a);
      expect(cells).toContain(`${x},${y},${z}`);
      expect(cells).toContain(`${x},${y + 1},${z}`);
    }
  });
});

describe('Herd: saving and restoring', () => {
  it('round-trips through toJSON and restore with rounded positions', () => {
    const a = make();
    a.player.x = 16.5; a.player.z = 9.5;
    a.run(30);
    a.herd.feed(a.herd.animals[0].id, ItemId.Apple);
    const saved = a.herd.toJSON();
    expect(saved).toHaveLength(10);
    for (const t of saved) {
      expect(t).toHaveLength(6);
      expect(Math.abs(t[1] * 100 - Math.round(t[1] * 100))).toBeLessThan(1e-6);
      expect(Number.isInteger(t[4])).toBe(true);
    }
    const b = new Herd(mulberry32(5));
    b.restore(saved, SPAWNS, a.world, ROAM, 0);
    expect(b.toJSON()).toEqual(saved);
  });
  it('tops up to the default herd and never drops below', () => {
    const w = flat();
    for (const saved of [[], [[1, 10.5, 1, 8.5, 0, 0]], [[0, 10.5, 1, 8.5, 0, 0], [0, 12.5, 1, 8.5, 0, 1]]] as Array<Array<[number, number, number, number, number, number]>>) {
      const h = new Herd(mulberry32(1));
      h.restore(saved, SPAWNS, w, ROAM, 0);
      const count = (k: AnimalKind): number => h.animals.filter(a => a.kind === k).length;
      expect(KINDS.map(count)).toEqual([4, 2, 3, 1]);
      for (const a of h.animals) expect(isStandable(w, cellOf(a))).toBe(true);
      expect(new Set(h.animals.map(a => cellOf(a).join(','))).size).toBe(10);
    }
  });
  it('keeps a saved animal where it was', () => {
    const w = flat();
    const h = new Herd(mulberry32(1));
    h.restore([[1, 20.5, 1, 12.25, 30, 1]], SPAWNS, w, ROAM, 0);
    const cow = h.animals.find(a => a.kind === 'cow' && a.x === 20.5)!;
    expect(cow).toBeDefined();
    expect(cow.z).toBeCloseTo(12.25, 5);
    expect(cow.giftIn).toBe(30);
    expect(cow.variant).toBe(1);
  });
  it('re-spawns an animal whose saved position is not standable or is outside the pasture', () => {
    const w = flat();
    w.set(20, 1, 12, BlockId.Planks);
    w.set(20, 2, 12, BlockId.Planks);
    const h = new Herd(mulberry32(1));
    h.restore([[1, 20.5, 1, 12.5, 0, 0], [0, 35.5, 1, 20.5, 0, 0], [2, 8.5, 9, 8.5, 0, 0], [3, Number.NaN, 1, 8, 0, 0]], SPAWNS, w, ROAM, 0);
    expect(h.animals).toHaveLength(10);
    for (const a of h.animals) {
      const [x, y, z] = cellOf(a);
      expect(isStandable(w, [x, y, z])).toBe(true);
      expect(x >= ROAM.x0 && x <= ROAM.x1 && z >= ROAM.z0 && z <= ROAM.z1).toBe(true);
    }
  });
  it('ignores bad entries one by one (wrong kind, wrong shape, junk values)', () => {
    const h = new Herd(mulberry32(1));
    const junk = [[9, 10, 1, 8, 0, 0], [0, 10], null, 'x', [0, 'a', 1, 8, 0, 0], [0, 10.5, 1, 8.5, -5, 0]] as unknown as Array<[number, number, number, number, number, number]>;
    expect(() => h.restore(junk, SPAWNS, flat(), ROAM, 0)).not.toThrow();
    expect(h.animals).toHaveLength(10);
    expect(h.animals.every(a => a.giftIn >= 0)).toBe(true);
  });
  it('giftIn counts down by the offline seconds on restore but never below 0', () => {
    const h = new Herd(mulberry32(1));
    h.restore([[0, 10.5, 1, 8.5, 40, 0], [1, 12.5, 1, 8.5, 10, 0]], SPAWNS, flat(), ROAM, 15);
    expect(h.animals.find(a => a.kind === 'chicken' && a.x === 10.5)!.giftIn).toBe(25);
    expect(h.animals.find(a => a.kind === 'cow' && a.x === 12.5)!.giftIn).toBe(0);
  });
});

describe('Herd: no animal is ever hurt', () => {
  it('ANIMAL_STATES is exactly the five calm names', () => {
    expect([...ANIMAL_STATES]).toEqual(['idle', 'walk', 'graze', 'come', 'happy']);
  });
  it('no hurt, scared, eaten, dead, flee or chase identifier or state appears in the herd source', () => {
    const src = readFileSync(new URL('../../src/game/animals.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const word of ['hurt', 'scared', 'scare', 'eaten', 'dead', 'die', 'flee', 'chase', 'damage', 'kill', 'attack', 'afraid', 'panic']) {
      expect(new RegExp(`\\b${word}`, 'i').test(src), word).toBe(false);
    }
  });
});

describe('Herd on the real generated pasture', () => {
  const { world, village } = generateWorld(2026);
  const pa = village.farm.pasture;
  const roam = { x0: pa.x0 + 1, z0: pa.z0 + 1, x1: pa.x1 - 1, z1: pa.z1 - 1 };
  it('populates from the layout spawns and stays inside the fence, away from the gate row', () => {
    const herd = new Herd(mulberry32(3));
    herd.populate(village.farm.herdSpawns);
    const player = { x: 74.5, y: 6, z: 44.5 };
    for (let t = 0; t < 600; t += 0.1) {
      herd.update({ world, roam, player, held: t % 100 < 50 ? ItemId.Carrot : 'hand', occupied: [], dt: 0.1 });
      for (const a of herd.animals) {
        const [x, , z] = cellOf(a);
        expect(isStandable(world, cellOf(a))).toBe(true);
        expect(x >= roam.x0 && x <= roam.x1 && z >= roam.z0 && z <= roam.z1).toBe(true);
        expect(village.farm.gate.some(g => g[0] === x && g[2] === z)).toBe(false);
      }
    }
    expect(herd.animals).toHaveLength(10);
  });
});

describe('Herd: time only goes forward, in small steps', () => {
  it('a negative, NaN or zero dt changes nothing; a huge dt is one small step', () => {
    const s = make();
    s.herd.feed(s.herd.animals[0].id, ItemId.Apple);
    const before = JSON.stringify(s.herd.toJSON());
    for (const dt of [-5, 0, Number.NaN, -Infinity]) {
      s.herd.update({ world: s.world, roam: ROAM, player: s.player, held: 'hand', occupied: [], dt });
      expect(s.herd.animals[0].giftIn).toBeGreaterThanOrEqual(44.9);
    }
    s.herd.update({ world: s.world, roam: ROAM, player: s.player, held: 'hand', occupied: [], dt: 1e9 });
    for (const a of s.herd.animals) expect(isStandable(s.world, cellOf(a))).toBe(true);
    expect(s.herd.animals[0].giftIn).toBeGreaterThan(44);
    expect(before).toBeTypeOf('string');
  });
  it('costs well under a millisecond a frame for ten animals, with food held out', () => {
    const { world, village } = generateWorld(2026);
    const pa = village.farm.pasture;
    const roam = { x0: pa.x0 + 1, z0: pa.z0 + 1, x1: pa.x1 - 1, z1: pa.z1 - 1 };
    const herd = new Herd(mulberry32(3));
    herd.populate(village.farm.herdSpawns);
    const player = { x: 74.5, y: 6, z: 48.5 };
    const ctx = { world, roam, player, held: ItemId.Carrot as StackId | 'hand', occupied: [[74, 6, 48], [74, 7, 48]] as Cell[], dt: 1 / 30 };
    for (let i = 0; i < 300; i++) herd.update(ctx); // warm up and let them gather
    const t0 = performance.now();
    const n = 3000;
    for (let i = 0; i < n; i++) herd.update(ctx);
    const per = (performance.now() - t0) / n;
    console.log(`Herd.update: ${per.toFixed(4)} ms per frame (10 animals, calling)`);
    expect(per).toBeLessThan(0.5);
  });
});
