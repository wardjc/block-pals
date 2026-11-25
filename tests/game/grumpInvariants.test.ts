import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, test } from 'vitest';
import { WORLD } from '../../src/core/bounds';
import { ZONE_Y, avoidCells, farmZone, zoneBorder } from '../../src/core/farmZone';
import { Inventory } from '../../src/core/inventory';
import { isStandable } from '../../src/core/pathfind';
import { rewardFor } from '../../src/core/grumpRules';
import { mulberry32 } from '../../src/core/rng';
import { generateWorld, type GeneratedWorld } from '../../src/core/worldgen';
import { GrumpSpawner, GrumpSystem, type GrumpContext } from '../../src/game/grumps';

const FILES = ['src/game/grumps.ts', 'src/core/grumpRules.ts', 'src/core/farmZone.ts', 'src/core/grumpSave.ts', 'src/render/grumps.ts'];
const FORBIDDEN = /angry|chase|flee|attack|hurt|health|damage|\bkill|\bdie\b|dead|explode|teleport|scared|scary/i;

let g: GeneratedWorld;
beforeAll(() => { g = generateWorld(2026); });

describe('grumps never hurt, never frighten, never lose anything', () => {
  test('no hurt, health, damage, chase, flee, explode or teleport word in any grump source file', () => {
    for (const f of FILES.filter(existsSync)) expect(readFileSync(f, 'utf8').match(FORBIDDEN)?.[0], f).toBeUndefined();
  });

  test('in the real world, no grump or friend is ever below ground minus 3, off a standable cell or on an avoided cell', () => {
    const zone = farmZone(g.village), avoid = avoidCells(g.village);
    const sys = new GrumpSystem(mulberry32(5), zone, avoid, ZONE_Y);
    const border = zoneBorder(zone, g.world, avoid);
    const spawner = new GrumpSpawner(mulberry32(6));
    const player = { x: zone.x0 - 10, y: ZONE_Y, z: zone.z0 - 10 };
    const rng = mulberry32(7);
    let friends = 0;
    for (let t = 0; t < 4000; t++) {
      if (t % 400 === 0) { player.x = zone.x0 + rng() * 20; player.z = zone.z0 + rng() * 14; }
      const ctx: GrumpContext = { world: g.world, player, occupied: [], plantCells: [[zone.x0 + 6, ZONE_Y, zone.z0 + 5]], dt: 1 };
      const spawn = spawner.update({
        dt: 1, nearFarm: true, plantedCrops: 1, count: sys.grumps.length, hasWeapon: true, overlayOpen: false, paused: false,
        player, borderCells: border, occupied: sys.occupiedCells(),
      });
      if (spawn) sys.spawn(spawn.cell, spawn.kind);
      sys.update({ ...ctx, dt: 0.25 });
      if (t === 1500 && sys.grumps[0]) { sys.makeFriend(sys.grumps[0].id); friends++; }
      for (const e of [...sys.grumps, ...sys.friends]) {
        expect(e.y).toBeGreaterThanOrEqual(ZONE_Y - 3);
        expect(isStandable(g.world, [Math.floor(e.x), e.y, Math.floor(e.z)])).toBe(true);
        expect(avoid.has(`${Math.floor(e.x)},${Math.floor(e.z)}`)).toBe(false);
        expect(e.x).toBeGreaterThanOrEqual(zone.x0); expect(e.x).toBeLessThan(zone.x1 + 1);
        expect(e.z).toBeGreaterThanOrEqual(zone.z0); expect(e.z).toBeLessThan(zone.z1 + 1);
      }
      expect(sys.friends.length).toBe(friends);
      expect(sys.grumps.length).toBeLessThanOrEqual(3);
    }
    expect(WORLD.y).toBeGreaterThan(ZONE_Y);
  });

  test('a reward never takes a stack above 99 and never removes anything from the bag', () => {
    const inv = new Inventory();
    const before = inv.toJSON();
    for (let s = 0; s < 300; s++) rewardFor(mulberry32(s), inv, { friend: s % 2 === 0, atCap: s % 3 === 0 });
    expect(inv.toJSON()).toEqual(before); // the reward is only a list: adding it is the game's job
  });

  test('a restore never loses a friend, even into a world that has been rebuilt on top of them', () => {
    const zone = farmZone(g.village), avoid = avoidCells(g.village);
    const sys = new GrumpSystem(mulberry32(1), zone, avoid, ZONE_Y);
    const border = zoneBorder(zone, g.world, avoid);
    for (let i = 0; i < 5; i++) sys.makeFriend(sys.spawn(border[i], 'jelly').id);
    const saved = sys.toJSON();
    const again = new GrumpSystem(mulberry32(2), zone, avoid, ZONE_Y);
    again.restore(saved, g.world, []);
    expect(again.friends.length).toBe(5);
  });
});
