import { describe, expect, it, vi } from 'vitest';
import * as pathfinding from '../../src/core/pathfind';
import { BlockId } from '../../src/core/blocks';
import { World } from '../../src/core/world';
import type { LineKey } from '../../src/content/lines';
import { Pal } from '../../src/game/pal';
import { generateWorld } from '../../src/core/worldgen';
import { isStandable } from '../../src/core/pathfind';
import { Player } from '../../src/game/player';

function flatWorld(): World {
  const world = new World(48, 16, 48);
  for (let x = 0; x < 48; x++) for (let z = 0; z < 48; z++) world.set(x, 0, z, BlockId.Grass);
  world.clearEdits();
  return world;
}

function setup() {
  const world = flatWorld();
  const player = new Player({ x: 10.5, y: 1, z: 10.5 });
  const said: LineKey[] = [];
  let t = 0;
  const pal = new Pal({ x: 12.5, y: 1, z: 10.5 }, k => said.push(k), () => t);
  return { world, player, pal, said, time: (v: number) => { t = v; } };
}

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

describe('Pal', () => {
  it('stays within 3 blocks after updates', () => {
    const { world, player, pal } = setup();
    player.setPath([[11, 1, 10], [12, 1, 10], [13, 1, 10], [14, 1, 10], [15, 1, 10], [16, 1, 10], [17, 1, 10], [18, 1, 10], [19, 1, 10], [20, 1, 10]]);
    for (let i = 0; i < 300; i++) {
      player.update(world, 1 / 30);
      pal.update(world, player, 1 / 30);
    }
    expect(dist(pal.pos, player.pos)).toBeLessThanOrEqual(3);
    expect(dist(pal.pos, player.pos)).toBeGreaterThan(0.5);
  });

  it('teleports beside the player when far', () => {
    const { world, player, pal } = setup();
    pal.pos = { x: 40.5, y: 1, z: 40.5 };
    pal.update(world, player, 1 / 30);
    expect(dist(pal.pos, player.pos)).toBeLessThanOrEqual(2.5);
    expect(pal.feetCell()).not.toEqual(player.feetCell());
  });

  it('rate-limits chatter to 4s', () => {
    const { pal, said, time } = setup();
    pal.handle({ type: 'collected', id: BlockId.Wood });
    time(1000);
    pal.handle({ type: 'noPath' });
    expect(said).toEqual(['collectedFirst']);
    time(4100);
    pal.handle({ type: 'noPath' });
    expect(said).toEqual(['collectedFirst', 'noPath']);
  });

  it('says collectedMore on every 5th collect', () => {
    const { pal, said, time } = setup();
    for (let i = 1; i <= 5; i++) {
      time(i * 5000);
      pal.handle({ type: 'collected', id: BlockId.Wood });
    }
    expect(said).toEqual(['collectedFirst', 'collectedMore']);
  });

  it('crafted always speaks and hops', () => {
    const { pal, said, time } = setup();
    pal.handle({ type: 'noPath' });
    time(100);
    pal.handle({ type: 'crafted', recipe: 'x' });
    expect(said).toEqual(['noPath', 'crafted']);
    expect(pal.takeHop()).toBe(true);
    expect(pal.takeHop()).toBe(false);
  });

  it('idle with no wood says letsFindWood', () => {
    const { pal, said, time } = setup();
    pal.setHasWood(() => false);
    pal.handle({ type: 'idle' });
    time(5000);
    pal.setHasWood(() => true);
    pal.handle({ type: 'idle' });
    expect(said).toEqual(['letsFindWood', 'idleHint']);
  });

  it('greets with hello or welcomeBack', () => {
    const a = setup();
    a.pal.greet(false);
    const b = setup();
    b.pal.greet(true);
    expect(a.said).toEqual(['hello']);
    expect(b.said).toEqual(['welcomeBack']);
  });

  const solidAt = (world: World, pal: Pal) => {
    const [x, y, z] = pal.feetCell();
    return world.get(x, y, z) !== BlockId.Air || world.get(x, y + 1, z) !== BlockId.Air;
  };

  it('following a walking player on flat ground for 5 s never teleports', () => {
    const { world, player, pal } = setup();
    player.setPath(Array.from({ length: 25 }, (_, i) => [11 + i, 1, 10] as [number, number, number]));
    pal.pos = { x: 8.5, y: 1, z: 10.5 }; // behind the walker, so nothing forces a hop
    let prev = { ...pal.pos };
    for (let i = 0; i < 150; i++) {
      player.update(world, 1 / 30);
      pal.update(world, player, 1 / 30);
      expect(dist(pal.pos, prev)).toBeLessThan(0.5);
      prev = { ...pal.pos };
    }
  });

  function fenced() {
    const s = setup();
    for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
      if (ox === 0 && oz === 0) continue;
      s.world.set(20 + ox, 1, 20 + oz, BlockId.Wood);
      s.world.set(20 + ox, 2, 20 + oz, BlockId.Wood);
    }
    s.pal.pos = { x: 20.5, y: 1, z: 20.5 };
    s.player.pos = { x: 24.5, y: 1, z: 20.5 };
    return s;
  }

  it('teleports when genuinely stuck 3 s', () => {
    const { world, player, pal } = fenced();
    for (let i = 0; i < 80; i++) pal.update(world, player, 1 / 30);
    expect(dist(pal.pos, player.pos)).toBeGreaterThan(3);
    for (let i = 0; i < 30; i++) pal.update(world, player, 1 / 30);
    expect(dist(pal.pos, player.pos)).toBeLessThanOrEqual(3);
  });

  it('stays quiet when he cannot find a route himself (the stuck teleport handles it)', () => {
    const { world, player, pal, said } = fenced();
    for (let i = 0; i < 120; i++) pal.update(world, player, 1 / 30);
    expect(said).not.toContain('noPath');
    expect(dist(pal.pos, player.pos)).toBeLessThanOrEqual(3);
  });

  it('cheers the first placed block and every 5th after', () => {
    const { pal, said, time } = setup();
    for (let i = 1; i <= 10; i++) {
      time(i * 5000);
      pal.handle({ type: 'placed', id: BlockId.Planks });
    }
    expect(said).toEqual(['placed', 'placed', 'placed']);
  });

  it('says a cheerful line when the player is lifted out of a pit', () => {
    const { pal, said } = setup();
    pal.handle({ type: 'lifted' });
    expect(said).toEqual(['upYouCome']);
  });

  it('placing a block on Pip\'s next waypoint never puts him inside a solid', () => {
    const { world, player, pal } = setup();
    player.pos = { x: 16.5, y: 1, z: 10.5 };
    pal.update(world, player, 1 / 30);
    for (let x = 13; x <= 15; x++) world.set(x, 1, 10, BlockId.Wood);
    for (let i = 0; i < 90; i++) {
      pal.update(world, player, 1 / 30);
      expect(solidAt(world, pal)).toBe(false);
    }
  });

  it('stepping down never puts Pip inside a solid', () => {
    const { world, player, pal } = setup();
    for (let x = 10; x <= 13; x++) for (let z = 8; z <= 12; z++) world.set(x, 1, z, BlockId.Grass);
    pal.pos = { x: 12.5, y: 2, z: 10.5 };
    player.pos = { x: 18.5, y: 1, z: 10.5 };
    for (let i = 0; i < 90; i++) {
      pal.update(world, player, 1 / 30);
      expect(solidAt(world, pal)).toBe(false);
    }
    expect(pal.pos.y).toBe(1);
  });

  it('remindBreak speaks breakTime even inside the chatter gap', () => {
    const { pal, said, time } = setup();
    time(1000);
    pal.handle({ type: 'noPath' });
    time(1500);
    pal.remindBreak();
    expect(said).toEqual(['noPath', 'breakTime']);
  });
});


describe('natural following', () => {
  it('Pip follows with diagonals', () => {
    const { world, player, pal } = setup();
    pal.pos = { x: 5.5, y: 1, z: 5.5 };
    const before = { ...pal.pos };
    pal.update(world, player, 0.1);
    expect(pal.pos.x).toBeGreaterThan(before.x);
    expect(pal.pos.z).toBeGreaterThan(before.z);
    expect(dist(pal.pos, before)).toBeCloseTo(0.45);
    let previous = { ...pal.pos };
    for (let i = 0; i < 120; i++) {
      pal.update(world, player, 1 / 60);
      expect(dist(pal.pos, previous)).toBeLessThanOrEqual(4.5 / 60 + 1e-8);
      previous = { ...pal.pos };
    }
    expect(dist(pal.pos, player.pos)).toBeLessThanOrEqual(3);
  });

  it('recovers when support disappears even when already close to the player', () => {
    const { world, player, pal } = setup();
    world.set(12, 1, 10, BlockId.Stone);
    pal.pos.y = 2;
    world.set(12, 1, 10, BlockId.Air);
    pal.update(world, player, 0.02);
    expect(pal.pos.y).toBe(1);
  });
});

describe('blocked Pip', () => {
  it('does not repath every frame', () => {
    const { world, player, pal } = setup();
    pal.pos = { x: 5.5, y: 1, z: 5.5 };
    player.pos = { x: 5.5, y: 1, z: 11.5 };
    pal.update(world, player, 1 / 60); // takes a path
    // Wall him in from the next step on so every follow() is blocked.
    for (let x = 3; x <= 8; x++) for (let z = 3; z <= 8; z++) {
      if (x === 5 && z === 5) continue;
      for (const y of [1, 2]) world.set(x, y, z, BlockId.Stone);
    }
    // Every search offers a route whose first cell is solid, so each follow() is blocked.
    const search = vi.spyOn(pathfinding, 'findPath').mockReturnValue([[5, 1, 6]]);
    try {
      for (let i = 0; i < 30; i++) pal.update(world, player, 1 / 60);
      // One cooldown window (1 s) allows one repath, which stops at its first route.
      expect(search.mock.calls.length).toBeLessThanOrEqual(1);
    } finally {
      search.mockRestore();
    }
  });

  it('stays inside the soft wall at all four edges of the 96x96 world', () => {
    const spots: Array<[number, number]> = [[94.5, 40.5], [1.5, 40.5], [40.5, 94.5], [40.5, 1.5], [94.5, 94.5], [1.5, 1.5]];
    for (const [px, pz] of spots) {
      const world = new World(96, 20, 96);
      for (let x = 0; x < 96; x++) for (let z = 0; z < 96; z++) world.set(x, 0, z, BlockId.Grass);
      world.clearEdits();
      const player = new Player({ x: px, y: 1, z: pz });
      const pal = new Pal({ x: px, y: 1, z: pz }, () => undefined, () => 0);
      for (let i = 0; i < 240; i++) {
        pal.update(world, player, 1 / 30);
        expect(pal.pos.x, `${px},${pz}`).toBeGreaterThanOrEqual(1);
        expect(pal.pos.x).toBeLessThan(95);
        expect(pal.pos.z).toBeGreaterThanOrEqual(1);
        expect(pal.pos.z).toBeLessThan(95);
      }
      const [cx, , cz] = pal.feetCell();
      expect(cx >= 1 && cx <= 94 && cz >= 1 && cz <= 94).toBe(true);
    }
  });

  describe('lead mode', () => {
    const real = generateWorld(2026);
    const route = real.village.route;
    const startOf = (i: number) => ({ x: route[i][0] + 0.5, y: route[i][1], z: route[i][2] + 0.5 });

    it('never teleports and follows the real route over walkable ground, at a pace he can follow', () => {
      const player = new Player({ ...real.spawn });
      const t = 0;
      const pal = new Pal(startOf(0), () => undefined, () => t);
      let target = 0;
      pal.setLead(route, () => Math.floor(target));
      let previous = { ...pal.pos };
      let maxStep = 0;
      for (let i = 0; i < 30 * 200 && Math.floor(target) < route.length - 1; i++) {
        target = Math.min(route.length - 1, target + 3 / 30);
        pal.update(real.world, player, 1 / 30); // he stays 30+ blocks behind: following would teleport
        maxStep = Math.max(maxStep, Math.hypot(pal.pos.x - previous.x, pal.pos.z - previous.z));
        previous = { ...pal.pos };
        expect(isStandable(real.world, pal.feetCell())).toBe(true);
      }
      expect(maxStep).toBeLessThanOrEqual(4.5 / 30 + 0.01); // never a jump
      const end = route[route.length - 1];
      for (let i = 0; i < 90; i++) pal.update(real.world, player, 1 / 30);
      expect(Math.hypot(pal.pos.x - end[0] - 0.5, pal.pos.z - end[2] - 0.5)).toBeLessThan(1.5);
    });

    it('waits where it is when the controller says wait, and never enters his cell', () => {
      const world = flatWorld();
      const player = new Player({ x: 10.5, y: 1, z: 10.5 });
      const flat = Array.from({ length: 20 }, (_, i) => [10 + i, 1, 10] as [number, number, number]);
      const pal = new Pal({ x: 8.5, y: 1, z: 10.5 }, () => undefined, () => 0);
      pal.setLead(flat, () => -1);
      const start = { ...pal.pos };
      for (let i = 0; i < 60; i++) pal.update(world, player, 1 / 30);
      expect(pal.pos).toEqual(start);
      pal.setLead(flat, () => 12); // goal beyond him: Pip walks around his cell
      for (let i = 0; i < 300; i++) {
        pal.update(world, player, 1 / 30);
        expect(pal.feetCell()[0] === 10 && pal.feetCell()[2] === 10).toBe(false);
      }
      expect(dist(pal.pos, { x: 22.5, z: 10.5 })).toBeLessThan(1.5);
    });

    it('lead mode never teleports when he is 30 cells away', () => {
      const world = flatWorld();
      const player = new Player({ x: 2.5, y: 1, z: 2.5 });
      const pal = new Pal({ x: 40.5, y: 1, z: 40.5 }, () => undefined, () => 0);
      pal.setLead([[40, 1, 40], [41, 1, 40]], () => 1);
      for (let i = 0; i < 30; i++) pal.update(world, player, 1 / 30);
      expect(dist(pal.pos, { x: 41.5, z: 40.5 })).toBeLessThan(1.6);
    });

    it('following resumes after setLead(null), teleport included', () => {
      const world = flatWorld();
      const player = new Player({ x: 10.5, y: 1, z: 10.5 });
      const pal = new Pal({ x: 40.5, y: 1, z: 40.5 }, () => undefined, () => 0);
      pal.setLead([[40, 1, 40], [41, 1, 40]], () => 1);
      pal.update(world, player, 1 / 30);
      pal.setLead(null);
      expect(pal.leading).toBe(false);
      pal.update(world, player, 1 / 30);
      expect(dist(pal.pos, player.pos)).toBeLessThanOrEqual(2.5);
    });
  });

  it('hush(ms) delays chatter but not always-lines', () => {
    const { pal, said, time } = setup();
    time(1000);
    pal.hush(5000);
    pal.handle({ type: 'collected', id: BlockId.Wood });
    expect(said).toEqual([]);
    pal.handle({ type: 'crafted' } as never);
    expect(said).toEqual(['crafted']);
    time(7000);
    pal.handle({ type: 'noPath' });
    expect(said).toEqual(['crafted', 'noPath']);
  });
});
