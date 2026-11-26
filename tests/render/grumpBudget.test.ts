// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BlockId } from '../../src/core/blocks';
import { Inventory } from '../../src/core/inventory';
import { ItemId } from '../../src/core/items';
import type { Cell } from '../../src/core/pathfind';
import { mulberry32 } from '../../src/core/rng';
import { World } from '../../src/core/world';
import { Farm } from '../../src/game/farm';
import { GrumpSpawner, GrumpSystem, type GrumpContext } from '../../src/game/grumps';
import { Projectile, SadMarks, Sparkles } from '../../src/render/effects';
import { GRUMP_MAX_TRIANGLES, GrumpView } from '../../src/render/grumps';

// Budgets (Galaxy Tab A8). The timing limits are three times the plan's, so a busy CI machine passes;
// a real regression (an allocation per frame, a loop per plant) is far bigger than that.
const ZONE = { x0: 2, z0: 2, x1: 37, z1: 37 };
function flat(): World {
  const w = new World(40, 12, 40);
  for (let x = 0; x < 40; x++) for (let z = 0; z < 40; z++) w.set(x, 0, z, BlockId.Grass);
  w.clearEdits();
  w.markClean();
  return w;
}
function full() {
  const world = flat();
  const sys = new GrumpSystem(mulberry32(1), ZONE, new Set());
  for (let i = 0; i < 3; i++) sys.spawn([8 + i * 3, 1, 8], i % 2 ? 'cloud' : 'jelly');
  for (let i = 0; i < 5; i++) sys.makeFriend(sys.spawn([8 + i * 3, 1, 20], i % 2 ? 'jelly' : 'cloud').id);
  return { world, sys };
}
const triangles = (m: THREE.Mesh): number => (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3;
const avgMs = (n: number, fn: () => void): number => {
  for (let i = 0; i < 50; i++) fn(); // warm up
  const t = performance.now();
  for (let i = 0; i < n; i++) fn();
  return (performance.now() - t) / n;
};

describe('grump budgets', () => {
  it('3 grumps and 5 friends are at most 8 draw calls and 1,050 triangles', () => {
    const { sys } = full();
    const scene = new THREE.Scene();
    const view = new GrumpView(scene);
    view.sync(sys, () => true, 0, () => 0);
    expect(view.drawCalls).toBe(8);
    const meshes = scene.children.flatMap(c => (c as THREE.Group).children as THREE.Mesh[]);
    expect(meshes.length).toBe(8);
    let total = 0;
    for (const m of meshes) { expect(triangles(m)).toBeLessThanOrEqual(GRUMP_MAX_TRIANGLES); total += triangles(m); }
    expect(total).toBeLessThanOrEqual(1050);
  });

  it('each effect pool is one draw call, and everything new together fits the plan\'s 12', () => {
    const scene = new THREE.Scene();
    const sparkles = new Sparkles(scene);
    const marks = new SadMarks(scene);
    const shot = new Projectile(scene);
    expect(sparkles.capacity).toBe(96);
    expect(marks.capacity).toBe(24);
    expect(scene.children.filter(c => (c as THREE.Points).isPoints).length).toBe(2);
    expect(scene.children.filter(c => (c as THREE.Mesh).isMesh).length).toBe(1);
    expect(shot.mesh.isMesh).toBe(true);
    expect(8 + scene.children.length).toBeLessThanOrEqual(12); // 8 bodies + sparkles + marks + projectile
  });

  it('GrumpView.sync allocates nothing after warm-up: same groups, same geometry', () => {
    const { sys } = full();
    const scene = new THREE.Scene();
    const view = new GrumpView(scene);
    view.sync(sys, () => true, 0, () => 0);
    const groups = [...scene.children];
    const geos = groups.map(g => ((g as THREE.Group).children[0] as THREE.Mesh).geometry);
    for (let i = 1; i < 300; i++) view.sync(sys, () => true, i * 0.016, () => 0);
    expect(scene.children).toEqual(groups);
    expect(groups.map(g => ((g as THREE.Group).children[0] as THREE.Mesh).geometry)).toEqual(geos);
  });

  it('GrumpSystem.update with 3 grumps and 5 friends is cheap per frame', () => {
    const { world, sys } = full();
    const player = { x: 30.5, y: 1, z: 30.5 };
    const ctx: GrumpContext = { world, player, occupied: [], plantCells: [[12, 1, 12], [14, 1, 12]], dt: 0.016 };
    expect(avgMs(2000, () => { sys.update(ctx); })).toBeLessThan(0.3);
  });

  it('the spawner update is cheap', () => {
    const sp = new GrumpSpawner(mulberry32(2));
    const border: Cell[] = Array.from({ length: 120 }, (_, i) => [i % 40, 1, Math.floor(i / 40)]);
    const ctx = { dt: 0.016, nearFarm: true, plantedCrops: 1, count: 3, hasWeapon: true, overlayOpen: false, paused: false, player: { x: 20, y: 1, z: 20 }, borderCells: border, occupied: [] as Cell[] };
    expect(avgMs(5000, () => { sp.update(ctx); })).toBeLessThan(0.1);
  });

  it('Farm.advance with a paused predicate over 400 crops and pausedCells over 400 plants are cheap', () => {
    const world = new World(40, 12, 40);
    for (let x = 0; x < 40; x++) for (let z = 0; z < 40; z++) world.set(x, 0, z, BlockId.Grass);
    world.clearEdits(); world.markClean();
    const inv = new Inventory();
    inv.add(ItemId.WheatSeed, 99);
    const farm = new Farm(world, inv);
    let planted = 0;
    for (let x = 1; x < 39 && planted < 400; x += 1) for (let z = 1; z < 39 && planted < 400; z += 2) {
      inv.add(ItemId.WheatSeed, 1);
      if (farm.plant([x, 1, z], ItemId.WheatSeed, [])) planted++;
    }
    expect(planted).toBe(400);
    const sys = new GrumpSystem(mulberry32(3), ZONE, new Set());
    for (let i = 0; i < 3; i++) sys.spawn([10 + i * 8, 1, 10 + i * 5], 'jelly');
    expect(avgMs(300, () => farm.advance(1000, (x, y, z) => sys.pausesCell([x, y, z])))).toBeLessThan(0.9);
    const plants = farm.plantCells();
    expect(avgMs(300, () => { sys.pausedCells(plants); })).toBeLessThan(0.3);
  });

  it('the world triangle budget is unchanged: nothing here writes to the world', () => {
    const { world, sys } = full();
    const before = world.edits().length;
    const player = { x: 30.5, y: 1, z: 30.5 };
    for (let i = 0; i < 500; i++) sys.update({ world, player, occupied: [], plantCells: [], dt: 0.1 });
    expect(world.edits().length).toBe(before);
  });
});
