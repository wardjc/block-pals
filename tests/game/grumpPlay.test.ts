import { describe, expect, it } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { ItemId } from '../../src/core/items';
import type { Cell } from '../../src/core/pathfind';
import { mulberry32 } from '../../src/core/rng';
import { World } from '../../src/core/world';
import { Game } from '../../src/game/game';
import { GrumpPlay, type PlayEnv } from '../../src/game/grumpPlay';

const ZONE = { x0: 4, z0: 4, x1: 36, z1: 30 };

function setup(saved?: ConstructorParameters<typeof GrumpPlay>[0]['saved']) {
  const world = new World(48, 10, 40);
  for (let x = 0; x < 48; x++) for (let z = 0; z < 40; z++) world.set(x, 0, z, BlockId.Grass);
  world.clearEdits();
  world.markClean();
  const game = new Game({ world, spawn: { x: 20.5, y: 1, z: 12.5 } });
  const border: Cell[] = [];
  for (let x = ZONE.x0; x <= ZONE.x1; x++) border.push([x, 1, ZONE.z0], [x, 1, ZONE.z1]);
  const play = new GrumpPlay({ game, world, zone: ZONE, avoid: new Set(), border, rng: mulberry32(3), level: 1, saved });
  const player = { x: 5.5, y: 1, z: 5.5 };
  const env = (over: Partial<PlayEnv> = {}): PlayEnv => ({
    player, occupied: [], plantCells: [[20, 1, 15]], overlayOpen: false, paused: false, deep: false, ...over,
  });
  return { world, game, play, player, env };
}
const run = (t: ReturnType<typeof setup>, seconds: number, over: Partial<PlayEnv> = {}): void => {
  for (let s = 0; s < seconds; s += 0.5) t.play.update(0.5, t.env(over));
};

describe('GrumpPlay', () => {
  it('the first grump arrives after 45 s near the farm with a crop planted, 8 or more blocks from him', () => {
    const t = setup();
    t.player.x = 20.5; t.player.z = 28.5;
    run(t, 44);
    expect(t.play.system.grumps.length).toBe(0);
    run(t, 3);
    expect(t.play.system.grumps.length).toBe(1);
    const g = t.play.system.grumps[0];
    expect(Math.hypot(g.x - t.player.x, g.z - t.player.z)).toBeGreaterThanOrEqual(8);
  });

  it('no spawn with no planted crop, far from the farm, in the caves, or with a menu open or the game paused', () => {
    for (const over of [{ plantCells: [] }, { deep: true }, { overlayOpen: true }, { paused: true }] as Array<Partial<PlayEnv>>) {
      const t = setup();
      t.player.x = 20.5; t.player.z = 28.5;
      run(t, 600, over);
      expect(t.play.system.grumps.length, JSON.stringify(over)).toBe(0);
      expect(t.play.spawner.state().timer).toBe(0);
    }
    const far = setup();
    far.player.x = 20.5; far.player.z = 100;
    run(far, 600);
    expect(far.play.system.grumps.length).toBe(0);
  });

  it('a menu open pauses everything: grumps stand still, friend jobs and spawns wait', () => {
    const t = setup();
    t.player.x = 20.5; t.player.z = 28.5;
    run(t, 50);
    const g = t.play.system.grumps[0];
    const at = [g.x, g.z];
    run(t, 100, { overlayOpen: true });
    expect([g.x, g.z]).toEqual(at);
  });

  it('at most 1 grump without a weapon and 3 with one', () => {
    const t = setup();
    t.player.x = 20.5; t.player.z = 28.5;
    run(t, 1000);
    expect(t.play.system.grumps.length).toBe(1);
    t.game.inventory.add(ItemId.MagicWand, 1);
    run(t, 2000);
    expect(t.play.system.grumps.length).toBe(3);
  });

  it('save and restore keep grumps, friends, the counter and the spawner timer', () => {
    const t = setup();
    t.player.x = 20.5; t.player.z = 28.5;
    run(t, 50);
    t.game.cheered = 7;
    const f = t.play.system.makeFriend(t.play.system.grumps[0].id);
    run(t, 20);
    const saved = t.play.saved();
    expect(saved.stats[0]).toBe(7);
    expect(saved.friends.length).toBe(1);
    expect(saved.stats[3]).toBe(1); // the first grump has been met
    const u = setup(saved);
    expect(u.game.cheered).toBe(7);
    expect(u.play.system.friends.length).toBe(1);
    expect(u.play.system.friends[0].kind).toBe(f.kind);
    expect(u.play.spawner.state().first).toBe(false);
    expect(u.play.spawner.state().timer).toBe(saved.stats[1]);
  });

  it('friend jobs help a growing plant through Farm.help every 240 s of play time', () => {
    const t = setup();
    t.game.inventory.add(ItemId.WheatSeed, 1);
    expect(t.game.farm.plant([20, 1, 15], ItemId.WheatSeed, [])).toBe(true);
    t.play.system.makeFriend(t.play.system.spawn([20, 1, 14], 'jelly').id);
    t.player.x = 5.5; t.player.z = 5.5;
    const helped: string[] = [];
    t.game.farm.onEvent(e => { if (e.type === 'helped') helped.push(e.type); });
    run(t, 239);
    expect(helped.length).toBe(0);
    run(t, 3);
    expect(helped.length).toBe(1);
  });
});
