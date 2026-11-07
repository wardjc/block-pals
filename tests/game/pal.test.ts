import { describe, expect, it } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { World } from '../../src/core/world';
import type { LineKey } from '../../src/content/lines';
import { Pal } from '../../src/game/pal';
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
