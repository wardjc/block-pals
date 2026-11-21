import { describe, expect, it } from 'vitest';
import { BLOCKS, BlockId } from '../../src/core/blocks';
import { EMPTY_CAVES } from '../../src/core/caves';
import { homeSpot, isDeep } from '../../src/core/home';
import { isStandable, type Cell } from '../../src/core/pathfind';
import { World } from '../../src/core/world';
import { Game } from '../../src/game/game';
import { Pal } from '../../src/game/pal';
import { Player } from '../../src/game/player';
import { visibleSections } from '../../src/render/chunkCull';

/** Grass at y 20 over stone, 40 x 40, 40 high (stand at 21). */
function meadow(): World {
  const w = new World(40, 40, 40);
  for (let x = 0; x < 40; x++) for (let z = 0; z < 40; z++) {
    for (let y = 0; y < 20; y++) w.set(x, y, z, BlockId.Stone);
    w.set(x, 20, z, BlockId.Grass);
  }
  w.clearEdits();
  return w;
}

describe('review of PR #32 (chunk B)', () => {
  it('1. from the floor of a 12-deep shaft the Home lift lands on open ground outside the shaft, not deep', () => {
    const w = meadow();
    for (let y = 9; y <= 20; y++) w.set(20, y, 20, BlockId.Air);
    const feet: Cell = [20, 9, 20];
    expect(isDeep(w, feet, false)).toBe(true);
    const spot = homeSpot(w, feet, EMPTY_CAVES, null, [5, 21, 5]);
    expect(spot[0] === 20 && spot[2] === 20).toBe(false);
    expect(isStandable(w, spot)).toBe(true);
    expect(isDeep(w, spot, true)).toBe(false);
    expect(Math.hypot(spot[0] - 20, spot[2] - 20)).toBeLessThanOrEqual(1.5);
    const game = new Game({ world: w, spawn: { x: 20.5, y: 9, z: 20.5 } });
    game.update(1 / 30);
    expect(game.isDeep()).toBe(true);
    game.goHome();
    expect(game.isDeep()).toBe(false);
  });

  it('2. during a glide the drawn body never moves sideways into rock (a 12-block drop beside a low tunnel)', () => {
    // A ledge at x 0..9 standing 12 above a floor; at the bottom a 2-high tunnel runs east from x 11.
    const w = new World(32, 30, 32);
    for (let x = 0; x < 32; x++) for (let z = 0; z < 32; z++) for (let y = 0; y < 26; y++) w.set(x, y, z, BlockId.Stone);
    for (let x = 0; x <= 9; x++) for (let z = 0; z < 32; z++) for (let y = 13; y < 26; y++) w.set(x, y, z, BlockId.Air);
    // The shaft at x 10 (clear from the ledge down to y 1), and the tunnel y 1..2 from x 10 east.
    for (let y = 1; y < 26; y++) w.set(10, y, 16, BlockId.Air);
    for (let x = 10; x < 30; x++) for (const y of [1, 2]) w.set(x, y, 16, BlockId.Air);
    const p = new Player({ x: 9.5, y: 13, z: 16.5 });
    p.setStick(1, 0);
    for (let i = 0; i < 120; i++) {
      p.update(w, 1 / 60);
      // Every cell the drawn body (feet and head at visualY) overlaps is clear.
      for (const dy of [0.05, 1, 1.75]) {
        const by = Math.floor(p.visualY + dy);
        for (const ox of [-0.29, 0.29]) {
          const id = w.get(Math.floor(p.pos.x + ox), by, Math.floor(p.pos.z));
          expect(BLOCKS[id].solid, `frame ${i}: body at ${p.pos.x.toFixed(2)},${p.visualY.toFixed(2)} in rock`).toBe(false);
        }
      }
    }
    expect(p.pos.y).toBe(1);
    expect(p.pos.x).toBeGreaterThan(11); // he walks on once the glide is over
  });

  it('4. Pip follows him into a one-cell shaft he glided down (never left at the rim)', () => {
    const w = meadow();
    for (let y = 11; y <= 20; y++) w.set(20, y, 20, BlockId.Air);
    const player = new Player({ x: 20.5, y: 11, z: 20.5 });
    const pal = new Pal({ x: 22.5, y: 21, z: 20.5 }, () => undefined, () => 0);
    for (let i = 0; i < 300; i++) pal.update(w, player, 1 / 30);
    expect(Math.abs(pal.pos.y - player.pos.y)).toBeLessThanOrEqual(4);
    expect(Math.hypot(pal.pos.x - player.pos.x, pal.pos.z - player.pos.z)).toBeLessThanOrEqual(3);
    const c = pal.feetCell();
    expect(BLOCKS[w.get(c[0], c[1], c[2])].solid || BLOCKS[w.get(c[0], c[1] + 1, c[2])].solid).toBe(false);
  });

  it('recheck 1: with no open top within 24, a deep mouth is refused and a buried spawn is settled, the result is still standable and not deep', () => {
    const w = new World(60, 40, 60);
    for (let x = 0; x < 60; x++) for (let z = 0; z < 60; z++) for (let y = 0; y < 20; y++) w.set(x, y, z, BlockId.Stone);
    // A RoofTile cap over the middle 50 x 50 (no open ground within 24 of the centre), grass outside it.
    for (let x = 0; x < 60; x++) for (let z = 0; z < 60; z++) w.set(x, 20, z, Math.max(Math.abs(x - 30), Math.abs(z - 30)) <= 25 ? BlockId.RoofTile : BlockId.Grass);
    for (let y = 8; y < 11; y++) w.set(30, y, 30, BlockId.Air);
    const spot = homeSpot(w, [30, 8, 30], { mouths: [[30, 8, 30]] }, null, [30, 10, 31]);
    expect(spot).not.toEqual([30, 8, 30]);
    expect(isStandable(w, spot)).toBe(true);
    expect(isDeep(w, spot, true)).toBe(false);
  });

  for (const depth of [2, 3, 4]) {
    it(`recheck 3: Pip joins him in a one-cell shaft ${depth} deep (never stuck at the rim)`, () => {
      const w = meadow();
      for (let y = 21 - depth; y <= 20; y++) w.set(20, y, 20, BlockId.Air);
      const player = new Player({ x: 20.5, y: 21 - depth, z: 20.5 });
      const pal = new Pal({ x: 22.5, y: 21, z: 20.5 }, () => undefined, () => 0);
      for (let i = 0; i < 600; i++) pal.update(w, player, 1 / 30);
      expect(Math.abs(pal.pos.y - player.pos.y)).toBeLessThanOrEqual(1);
      expect(Math.hypot(pal.pos.x - player.pos.x, pal.pos.z - player.pos.z)).toBeLessThanOrEqual(3);
    });
  }

  it('3. underground, a floor the camera looks straight down at inside the fog is kept, beyond the +-20 window', () => {
    // Camera at y 54.81 over the world centre looking straight down; the floor is at y 31 (section 1).
    const set = visibleSections(192, 68, 192, 96.5, 54.81, 96.5, 0, -1, 0, 'underground', 96.5, 96.5, 36);
    expect(set.has('6,1,6')).toBe(true);
    // A neighbouring column's floor 24 below, inside the 36 fog, is kept too.
    expect(set.has('7,1,6')).toBe(true);
  });
});
