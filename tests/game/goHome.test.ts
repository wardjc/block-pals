import { describe, expect, it } from 'vitest';
import { BLOCKS, BlockId } from '../../src/core/blocks';
import { insideWall } from '../../src/core/bounds';
import { EMPTY_CAVES } from '../../src/core/caves';
import { DEEP_ENTER, DEEP_EXIT, depthBelowGround, homeSpot, isDeep, routeHome } from '../../src/core/home';
import { canStep, isStandable, type Cell } from '../../src/core/pathfind';
import { mulberry32 } from '../../src/core/rng';
import type { Rect } from '../../src/core/village';
import { World } from '../../src/core/world';
import { generateWorld, type GeneratedWorld } from '../../src/core/worldgen';
import { Game, type GameEvent } from '../../src/game/game';
import { Pal } from '../../src/game/pal';

const inRect = (r: Rect, x: number, z: number): boolean => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;

/** Flat grass at y 20 (stand at 21) over stone, 40 x 40, 32 high. */
function meadow(): World {
  const w = new World(40, 32, 40);
  for (let x = 0; x < 40; x++) for (let z = 0; z < 40; z++) {
    for (let y = 0; y < 20; y++) w.set(x, y, z, BlockId.Stone);
    w.set(x, 20, z, BlockId.Grass);
  }
  w.clearEdits();
  return w;
}

/** A hollow 3 x 3 x 3 room with its floor at feet y `y`, centred on (x, z). */
function room(w: { set(x: number, y: number, z: number, id: BlockId): void }, x: number, y: number, z: number): void {
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = 0; dy < 3; dy++) w.set(x + dx, y + dy, z + dz, BlockId.Air);
}

/** Open ground with sky above: nothing solid over the cell. */
function openToSky(world: World, [x, y, z]: Cell): boolean {
  for (let cy = y; cy < world.sizeY; cy++) if (BLOCKS[world.get(x, cy, z)].solid) return false;
  return true;
}

describe('isDeep (7 in, 5 out)', () => {
  it('has hysteresis: false at 6, true at 7, still true at 6, false at 5', () => {
    const w = meadow();
    const at = (depth: number): Cell => [20, 21 - depth, 20];
    for (const d of [5, 6, 7]) room(w, 20, 21 - d, 20);
    expect(DEEP_ENTER).toBe(7);
    expect(DEEP_EXIT).toBe(5);
    expect(depthBelowGround(w, at(6))).toBe(6);
    expect(isDeep(w, at(6), false)).toBe(false);
    expect(isDeep(w, at(7), false)).toBe(true);
    expect(isDeep(w, at(6), true)).toBe(true);
    expect(isDeep(w, at(5), true)).toBe(false);
  });

  it('the shaft he dug still counts: open sky above him, the meadow round him', () => {
    const w = meadow();
    for (let y = 12; y <= 20; y++) w.set(20, y, 20, BlockId.Air);
    expect(depthBelowGround(w, [20, 12, 20])).toBe(9);
    expect(isDeep(w, [20, 12, 20], false)).toBe(true);
  });

  it('a roof over him or a tower he stands in is not "below the ground"', () => {
    const w = meadow();
    for (let x = 18; x <= 22; x++) for (let z = 18; z <= 22; z++) w.set(x, 30, z, BlockId.Stone); // a high roof
    expect(isDeep(w, [20, 21, 20], false)).toBe(false);
    const big = generateWorld(2026);
    const t = big.tower.doorInside;
    expect(isDeep(big.world, t, false)).toBe(false);
  });
});

describe('homeSpot', () => {
  const seeds = [2026, 7, 99, 31337];
  const worlds: GeneratedWorld[] = seeds.map(s => generateWorld(s));

  it('from 60 sampled deep cells (4 seeds) is standable, open to the sky, dry, not in a house or farm bed, and within 24 of the column', () => {
    let n = 0;
    worlds.forEach((g, i) => {
      const random = mulberry32(seeds[i] ^ 0x40e);
      for (let k = 0; k < 15; k++) {
        const x = 8 + Math.floor(random() * (g.world.sizeX - 16));
        const z = 8 + Math.floor(random() * (g.world.sizeZ - 16));
        const y = 10 + Math.floor(random() * 30);
        room(g.world, x, y, z);
        const feet: Cell = [x, y, z];
        expect(isDeep(g.world, feet, false)).toBe(true);
        const spot = homeSpot(g.world, feet, EMPTY_CAVES, g.village, [Math.floor(g.spawn.x), g.spawn.y, Math.floor(g.spawn.z)], [g.tower.rect]);
        expect(isStandable(g.world, spot), `${seeds[i]} ${feet}`).toBe(true);
        expect(openToSky(g.world, spot)).toBe(true);
        expect(g.world.get(...spot)).not.toBe(BlockId.Water);
        const ground = g.world.get(spot[0], spot[1] - 1, spot[2]);
        expect([BlockId.Wood, BlockId.Leaves, BlockId.AppleLeaves, BlockId.RoofTile, BlockId.Water, BlockId.Farmland]).not.toContain(ground);
        for (const h of g.village.houses) expect(inRect(h.rect, spot[0], spot[2])).toBe(false);
        for (const b of g.village.farm.beds) expect(inRect(b, spot[0], spot[2])).toBe(false);
        expect(inRect(g.tower.rect, spot[0], spot[2])).toBe(false);
        expect(insideWall(g.world, spot[0], spot[2])).toBe(true);
        expect(Math.hypot(spot[0] - x, spot[2] - z)).toBeLessThanOrEqual(24);
        expect(isDeep(g.world, spot, true)).toBe(false);
        n++;
      }
    });
    expect(n).toBe(60);
  });

  it('never lands on a tree top or a roof: under a tree or a house it picks open ground beside it', () => {
    const g = worlds[0];
    const cottage = g.village.houses[0];
    const cx = Math.floor((cottage.rect.x0 + cottage.rect.x1) / 2);
    const cz = Math.floor((cottage.rect.z0 + cottage.rect.z1) / 2);
    room(g.world, cx, 30, cz);
    const spot = homeSpot(g.world, [cx, 30, cz], EMPTY_CAVES, g.village, [72, 60, 72]);
    expect(inRect(cottage.rect, spot[0], spot[2])).toBe(false);
    const ground = g.world.get(spot[0], spot[1] - 1, spot[2]);
    expect([BlockId.Wood, BlockId.Leaves, BlockId.RoofTile]).not.toContain(ground);
  });

  it('falls back to the nearest mouth, then to the spawn, when no open ground is near', () => {
    // A sealed box: every column within 24 is roofed with RoofTile.
    const w = new World(80, 30, 80);
    for (let x = 0; x < 80; x++) for (let z = 0; z < 80; z++) {
      for (let y = 0; y < 10; y++) w.set(x, y, z, BlockId.Stone);
      if (Math.max(Math.abs(x - 40), Math.abs(z - 40)) <= 30) w.set(x, 20, z, BlockId.RoofTile);
    }
    expect(homeSpot(w, [40, 10, 40], EMPTY_CAVES, null, [5, 10, 5])).toEqual([5, 10, 5]);
    const mouth: Cell = [75, 10, 40];
    expect(homeSpot(w, [40, 10, 40], { mouths: [{ cell: [2, 10, 2] }, { cell: mouth }] }, null, [5, 10, 5])).toEqual(mouth);
  });
});

describe('Game.goHome', () => {
  function deepGame(): { game: Game; g: GeneratedWorld; events: GameEvent[] } {
    const g = generateWorld(2026);
    const [x, , z] = [80, 0, 80];
    room(g.world, x, 30, z);
    const game = new Game({ ...g, spawn: { x: x + 0.5, y: 30, z: z + 0.5 } });
    const events: GameEvent[] = [];
    game.on(e => events.push(e));
    game.update(1 / 30);
    return { game, g, events };
  }

  it('lifts him to the surface and keeps the bag, the edits and the farm untouched (only his position changes)', () => {
    const { game, g, events } = deepGame();
    expect(game.isDeep()).toBe(true);
    game.inventory.add(BlockId.Planks, 7);
    const bag = JSON.stringify(game.inventory.toJSON());
    const edits = JSON.stringify(g.world.edits());
    const farm = JSON.stringify(game.farm.records());
    expect(game.goHome()).toBe(true);
    expect(events.at(-1)).toEqual({ type: 'homeLift' });
    const feet = game.player.feetCell();
    expect(isStandable(g.world, feet)).toBe(true);
    expect(openToSky(g.world, feet)).toBe(true);
    expect(game.isDeep()).toBe(false);
    expect(game.player.visualY).toBe(game.player.pos.y); // behind the fade: no sweep through the rock
    expect(JSON.stringify(game.inventory.toJSON())).toBe(bag);
    expect(JSON.stringify(g.world.edits())).toBe(edits);
    expect(JSON.stringify(game.farm.records())).toBe(farm);
  });

  it('goHome while paused does nothing', () => {
    const { game, events } = deepGame();
    const before = { ...game.player.pos };
    game.paused = true;
    expect(game.goHome()).toBe(false);
    expect(game.player.pos).toEqual(before);
    expect(events.some(e => e.type === 'homeLift')).toBe(false);
  });

  it('Pip teleports to him after goHome', () => {
    const { game, g } = deepGame();
    const pal = new Pal({ ...game.player.pos }, () => undefined, () => 0);
    game.on(e => pal.handle(e));
    game.goHome();
    pal.update(g.world, game.player, 1 / 30);
    expect(Math.hypot(pal.pos.x - game.player.pos.x, pal.pos.z - game.player.pos.z)).toBeLessThanOrEqual(3 * Math.SQRT2 + 0.01);
    expect(Math.abs(pal.pos.y - game.player.pos.y)).toBeLessThanOrEqual(1);
    expect(isStandable(g.world, pal.feetCell())).toBe(true);
  });

  it('a failed tap deep gives noPathDeep, a failed tap on the surface still gives noPath', () => {
    // A 7 x 7 sealed room (49 cells: too big for the pit lift) and a goal straight above: nowhere nearer.
    const g = generateWorld(2026);
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) for (let dy = 0; dy < 3; dy++) g.world.set(80 + dx, 30 + dy, 80 + dz, BlockId.Air);
    const game = new Game({ ...g, spawn: { x: 80.5, y: 30, z: 80.5 } });
    const events: GameEvent[] = [];
    game.on(e => events.push(e));
    game.update(1 / 30);
    expect(game.isDeep()).toBe(true);
    game.applyIntent({ kind: 'walk', to: [80, 50, 80] });
    expect(events.at(-1)).toEqual({ type: 'noPathDeep' });
    // The same on the surface: a 7 x 7 glass corral, a goal straight above.
    const flat = meadow();
    for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) === 4) for (const y of [21, 22, 23]) flat.set(20 + dx, y, 20 + dz, BlockId.Glass);
    }
    const surface = new Game({ world: flat, spawn: { x: 20.5, y: 21, z: 20.5 } });
    const got: GameEvent[] = [];
    surface.on(e => got.push(e));
    surface.update(1 / 30);
    surface.applyIntent({ kind: 'walk', to: [20, 28, 20] });
    expect(got.at(-1)).toEqual({ type: 'noPath' });
  });
});

describe('routeHome (no caves yet: the nearest mouth, ordinary steps only)', () => {
  it('returns null without mouths and a walkable route to a mouth when there is one', () => {
    const w = meadow();
    // A ramp down from the meadow to a little room 6 below, 1 block per 2 cells.
    for (let i = 0; i < 12; i++) {
      const floor = 21 - Math.floor(i / 2);
      for (let y = floor; y <= 22; y++) w.set(10 + i, y, 20, BlockId.Air);
    }
    const bottom: Cell = [21, 16, 20];
    expect(isStandable(w, bottom)).toBe(true);
    expect(routeHome(w, bottom, EMPTY_CAVES)).toBeNull();
    const mouth: Cell = [9, 21, 20];
    const route = routeHome(w, bottom, { mouths: [{ cell: mouth }] })!;
    expect(route).not.toBeNull();
    expect(route.at(-1)).toEqual(mouth);
    let prev = bottom;
    for (const step of route) {
      expect(canStep(w, prev, step)).toBe(true);
      prev = step;
    }
  });
});
