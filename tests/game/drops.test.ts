import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { isStandable } from '../../src/core/pathfind';
import { World } from '../../src/core/world';
import { Game, type GameEvent } from '../../src/game/game';
import { Pal } from '../../src/game/pal';
import { GLIDE_DOWN, Player } from '../../src/game/player';

/** A 32 x 32 floor at y 0 with a plateau x 0..9 standing `drop` blocks above it. */
function cliff(drop: number): World {
  const world = new World(32, drop + 10, 32);
  for (let x = 0; x < 32; x++) for (let z = 0; z < 32; z++) world.set(x, 0, z, BlockId.Stone);
  for (let x = 0; x <= 9; x++) for (let z = 0; z < 32; z++) for (let y = 1; y <= drop; y++) world.set(x, y, z, BlockId.Grass);
  world.clearEdits();
  return world;
}

/** Walks him east with the stick for `seconds`, returning every frame's feet y. */
function walkEast(world: World, player: Player, seconds: number, dt = 1 / 30): number[] {
  const ys: number[] = [];
  player.setStick(1, 0);
  for (let t = 0; t < seconds; t += dt) {
    player.update(world, dt);
    ys.push(player.pos.y);
  }
  player.setStick(0, 0);
  return ys;
}

describe('he walks off an edge and glides down', () => {
  it('walking off a ledge drops him up to 12 blocks, never more', () => {
    for (const drop of [2, 5, 12]) {
      const world = cliff(drop);
      const p = new Player({ x: 8.5, y: drop + 1, z: 16.5 });
      walkEast(world, p, 1.5);
      expect(p.pos.y, `drop ${drop}`).toBe(1);
      expect(p.pos.x).toBeGreaterThan(10);
    }
    const tall = cliff(13);
    const p = new Player({ x: 8.5, y: 14, z: 16.5 });
    walkEast(tall, p, 1.5);
    expect(p.pos.y).toBe(14); // he stops at the edge of a 13 block drop
    expect(p.pos.x).toBeLessThan(10);
    expect(isStandable(tall, p.feetCell())).toBe(true);
  });

  it('a 5-block drop takes about 0.55 s of visualY, never a snap', () => {
    const world = cliff(5);
    const p = new Player({ x: 9.5, y: 6, z: 16.5 });
    const dt = 1 / 60;
    p.setStick(1, 0);
    let t = 0;
    let dropAt = -1;
    let landedAt = -1;
    let prev = p.visualY;
    for (; t < 2; t += dt) {
      p.update(world, dt);
      if (dropAt < 0 && p.pos.y === 1) dropAt = t;
      // No frame moves the drawn height by more than the glide speed allows.
      expect(prev - p.visualY).toBeLessThanOrEqual(GLIDE_DOWN * dt + 1e-9);
      prev = p.visualY;
      if (dropAt >= 0 && landedAt < 0 && p.visualY === p.pos.y) landedAt = t;
    }
    expect(dropAt).toBeGreaterThanOrEqual(0);
    expect(landedAt - dropAt).toBeGreaterThan(0.45);
    expect(landedAt - dropAt).toBeLessThan(0.65);
  });

  it('a walk tap goes down the drop (the route search takes it)', () => {
    const world = cliff(6);
    const game = new Game({ world, spawn: { x: 5.5, y: 7, z: 16.5 } });
    const events: GameEvent[] = [];
    game.on(e => events.push(e));
    game.applyIntent({ kind: 'walk', to: [20, 1, 16] });
    expect(events.some(e => e.type === 'walking')).toBe(true);
    for (let i = 0; i < 300; i++) game.update(1 / 30);
    expect(game.player.feetCell()).toEqual([20, 1, 16]);
  });

  it('no damage field, no hurt event and no sound event on a drop (source scan of the new code)', () => {
    for (const file of ['src/core/pathfind.ts', 'src/game/player.ts', 'src/core/home.ts']) {
      const src = readFileSync(file, 'utf8');
      expect(src, file).not.toMatch(/damage|hurt|health/i);
      expect(src, file).not.toMatch(/sfx|sound/i);
    }
    const game = readFileSync('src/game/game.ts', 'utf8');
    expect(game).not.toMatch(/damage|hurt|health/i);
  });
});

describe('Pip follows him down a drop', () => {
  it('Pip walks down a 3-block drop after him without being lost', () => {
    const world = cliff(3);
    const player = new Player({ x: 13.5, y: 1, z: 16.5 });
    const pal = new Pal({ x: 7.5, y: 4, z: 16.5 }, () => undefined, () => 0);
    let minDist = Infinity;
    for (let i = 0; i < 300; i++) {
      pal.update(world, player, 1 / 30);
      expect(isStandable(world, pal.feetCell())).toBe(true);
      minDist = Math.min(minDist, Math.hypot(pal.pos.x - player.pos.x, pal.pos.z - player.pos.z));
    }
    expect(pal.pos.y).toBe(1);
    expect(minDist).toBeLessThan(3.5);
  });
});
