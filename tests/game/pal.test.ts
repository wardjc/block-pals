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
});
