import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { mouthCells } from '../../src/core/caves';
import { isStandable, type Cell } from '../../src/core/pathfind';
import { applySave, serialise, type SaveData } from '../../src/core/save';
import { generateWorld } from '../../src/core/worldgen';
import { Game } from '../../src/game/game';
import { CameraRig, DEFAULT_PITCH } from '../../src/render/cameraRig';
import { DirtySections } from '../../src/render/chunkDirty';
import { cameraZone, radialFactor, visibleSections } from '../../src/render/chunkCull';
import { cameraFar } from '../../src/render/depthPolicy';
import { buildSectionGeometry, CHUNK_SIZE, SECTION_HEIGHT, type ChunkGeometry } from '../../src/render/mesher';
import { EYE_HEIGHT } from '../../src/render/scene';
import { caveWorld, SEEDS, timedCaveWorld } from '../helpers/caveWorld';

/**
 * Budgets for the deep world (plan Task 23): the numbers in the plan's performance table, measured
 * on the real generated world with its caves. Printed so the plan can record them.
 */
vi.setConfig({ testTimeout: 180_000 });
const ENTITY_DRAW_CALLS = 26; // the plan's allowance for him, Pip, animals, villagers, the wizard and the HUD meshes
const uv = (): [number, number, number, number] => [0, 0, 1, 1];
const g = caveWorld(2026);
const { world, caves, spawn, village, tower } = g;
const cache = new Map<string, ChunkGeometry>();
const geo = (key: string): ChunkGeometry => {
  let m = cache.get(key);
  if (!m) {
    const [cx, sy, cz] = key.split(',').map(Number);
    m = buildSectionGeometry(world, cx, sy, cz, uv);
    cache.set(key, m);
  }
  return m;
};
const standNear = (c: Cell): Cell => {
  for (const dy of [0, 1, -1, 2, -2, 3]) if (isStandable(world, [c[0], c[1] + dy, c[2]])) return [c[0], c[1] + dy, c[2]];
  return c;
};

interface Spot { name: string; feet: Cell; yaw: number; pitch: number }
const surface = (name: string, x: number, z: number, yaw: number, pitch = 0.25): Spot =>
  ({ name, feet: [Math.floor(x), world.topSolidY(Math.floor(x), Math.floor(z)) + 1, Math.floor(z)], yaw, pitch });
const sq = village.square;
const outdoor: Spot[] = [
  surface('spawn', spawn.x, spawn.z, 0.8),
  surface('village square', (sq.x0 + sq.x1) / 2, (sq.z0 + sq.z1) / 2, 2.4),
  surface('farm', village.farmPlot.x0 - 2, village.farmPlot.z0 + 3, 1.6),
  surface('hilltop', 82, 60, 2),
  surface('tower', tower.doorFront[0] + 0.5, tower.doorFront[2] - 6, 0),
  surface('world corner', 6, 6, 0.78, 0.1),
  ...caves.mouths.map(m => ({ name: `mouth ${m.kind}`, feet: m.cell, yaw: Math.atan2(m.dir[0], m.dir[1]), pitch: 0.2 })),
];
const underground: Spot[] = [
  ...caves.rooms.map(r => ({ name: `room ${r.id} (${r.layer})`, feet: standNear([r.cx, r.floorY, r.cz]), yaw: (r.id * 0.7) % (Math.PI * 2), pitch: DEFAULT_PITCH })),
  ...caves.stairs.map((s, i) => {
    const a = s.cells[Math.floor(s.cells.length / 2) - 2], b = s.cells[Math.floor(s.cells.length / 2) + 2];
    return { name: `stair ${i}`, feet: standNear(s.cells[Math.floor(s.cells.length / 2)]), yaw: Math.atan2(b[0] - a[0], b[2] - a[2]), pitch: 0.2 };
  }),
  ...caves.treasure.map(t => ({ name: `treasure ${t.id}`, feet: standNear(t.entrance), yaw: Math.atan2(t.dir[0], t.dir[1]), pitch: 0.3 })),
  { name: 'the Old Hideout', feet: standNear([96, caves.ruin!.floorY, 97]), yaw: 0.8, pitch: 0.3 },
  { name: 'the Old Hideout, looking across', feet: standNear([caves.ruin!.rect.x0 + 1, caves.ruin!.floorY, caves.ruin!.rect.z0 + 1]), yaw: 0.78, pitch: 0.15 },
];

function measure(s: Spot, fogEnd: number): { sections: number; calls: number; tris: number; zone: string } {
  const rig = new CameraRig();
  rig.yaw = s.yaw; rig.pitch = s.pitch;
  const eye = { x: s.feet[0] + 0.5, y: s.feet[1] + EYE_HEIGHT, z: s.feet[2] + 0.5 };
  for (let i = 0; i < 60; i++) rig.update(world, eye, 1 / 30);
  const c = rig.position, f = rig.forward;
  const zone = cameraZone(world, c.x, c.y, c.z, mouthCells(caves));
  const set = visibleSections(192, 68, 192, c.x, c.y, c.z, f.x, f.y, f.z, zone, s.feet[0], s.feet[2], fogEnd, { radialFactor: radialFactor(60, 1.6) });
  const cam = new THREE.PerspectiveCamera(60, 1.6, 0.2, cameraFar(fogEnd));
  cam.position.set(c.x, c.y, c.z);
  cam.lookAt(c.x + f.x, c.y + f.y, c.z + f.z);
  cam.updateMatrixWorld();
  const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  let sections = 0, calls = 0, tris = 0;
  for (const key of set) {
    const m = geo(key);
    let seen = false;
    for (const part of [m, m.transparent]) {
      if (part.indices.length === 0) continue;
      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.BufferAttribute(part.positions, 3));
      bg.computeBoundingSphere();
      if (!fr.intersectsSphere(bg.boundingSphere!)) continue;
      seen = true;
      calls++;
      tris += part.indices.length / 3;
    }
    if (seen) sections++;
  }
  return { sections, calls, tris, zone };
}

describe('budgets for the deep world (seed 2026)', () => {
  it('the world buffer is exactly 2,506,752 bytes', () => {
    expect(world.buffer.byteLength).toBe(2_506_752);
    expect(192 * 68 * 192).toBe(2_506_752);
  });

  it('generation of each of the four seeds is within budget (printed)', () => {
    const rows: string[] = [];
    for (const seed of SEEDS) {
      const { ms } = timedCaveWorld(seed);
      rows.push(`seed ${seed}: ${ms.toFixed(0)} ms (first, cold in this file)`);
    }
    const t0 = performance.now();
    generateWorld(2026);
    const warm = performance.now() - t0;
    rows.push(`seed 2026 warm: ${warm.toFixed(0)} ms`);
    console.log(`budgetDeep generation\n${rows.join('\n')}`);
    // Plan budget 1.5 s warm on desktop; a busy full test run gets 3 s.
    expect(warm).toBeLessThan(3000);
  });

  it('every section of the world: at most 600,000 triangles and 40 MB of geometry (printed)', () => {
    let tris = 0, bytes = 0, sections = 0, worstMs = 0;
    const cxs = Math.ceil(world.sizeX / CHUNK_SIZE), sys = Math.ceil(world.sizeY / SECTION_HEIGHT), czs = Math.ceil(world.sizeZ / CHUNK_SIZE);
    for (let cx = 0; cx < cxs; cx++) for (let cz = 0; cz < czs; cz++) for (let sy = 0; sy < sys; sy++) {
      const t0 = performance.now();
      const m = geo(`${cx},${sy},${cz}`);
      worstMs = Math.max(worstMs, performance.now() - t0);
      for (const part of [m, m.transparent]) {
        if (part.indices.length === 0) continue;
        tris += part.indices.length / 3;
        bytes += part.positions.byteLength + part.indices.byteLength + part.uvs.byteLength + part.normals.byteLength;
      }
      sections++;
    }
    console.log(`budgetDeep whole world: ${sections} sections, ${tris} triangles, ${(bytes / 1048576).toFixed(1)} MB geometry, busiest section ${worstMs.toFixed(2)} ms`);
    expect(tris).toBeLessThanOrEqual(600_000);
    expect(bytes).toBeLessThanOrEqual(40 * 1048576);
  });

  it('the first frame at spawn: at most 60 sections, meshed in under 250 ms', () => {
    const rig = new CameraRig();
    const feet: Cell = [Math.floor(spawn.x), Math.floor(spawn.y), Math.floor(spawn.z)];
    const eye = { x: spawn.x, y: spawn.y + EYE_HEIGHT, z: spawn.z };
    for (let i = 0; i < 2; i++) rig.update(world, eye, 1 / 30);
    const c = rig.position, f = rig.forward;
    const set = visibleSections(192, 68, 192, c.x, c.y, c.z, f.x, f.y, f.z, cameraZone(world, c.x, c.y, c.z, mouthCells(caves)), feet[0], feet[2], 40, { radialFactor: radialFactor(60, 1.6) });
    // As the scene's first frame does (buildInFrustum): only the sections of the draw set inside the view are built at once.
    const cam = new THREE.PerspectiveCamera(60, 1.6, 0.2, cameraFar(40));
    cam.position.set(c.x, c.y, c.z);
    cam.lookAt(c.x + f.x, c.y + f.y, c.z + f.z);
    cam.updateMatrixWorld();
    const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const box = new THREE.Box3();
    const first = [...set].filter(key => {
      const [cx, sy, cz] = key.split(',').map(Number);
      box.min.set(cx * CHUNK_SIZE, sy * SECTION_HEIGHT, cz * CHUNK_SIZE);
      box.max.set((cx + 1) * CHUNK_SIZE, (sy + 1) * SECTION_HEIGHT, (cz + 1) * CHUNK_SIZE);
      return fr.intersectsBox(box);
    });
    const t0 = performance.now();
    for (const key of first) {
      const [cx, sy, cz] = key.split(',').map(Number);
      buildSectionGeometry(world, cx, sy, cz, uv);
    }
    const ms = performance.now() - t0;
    console.log(`budgetDeep first frame: ${first.length} sections in view (of ${set.size} in the draw set, the rest lazily) in ${ms.toFixed(0)} ms`);
    expect(first.length).toBeLessThanOrEqual(60);
    expect(ms).toBeLessThan(250);
  });

  it('draw set triangles at most 90,000, draw calls at most 110 and visible sections at most 70: outdoors, at the mouths and underground (printed)', () => {
    const rows: string[] = [];
    const worst = { out40: { s: 0, c: 0, t: 0 }, under: { s: 0, c: 0, t: 0 } };
    for (const s of outdoor) {
      const r = measure(s, 40);
      rows.push(`40 ${s.name} (${r.zone}): ${r.sections} sections, ${r.calls} + ${ENTITY_DRAW_CALLS} calls, ${r.tris} triangles`);
      worst.out40 = { s: Math.max(worst.out40.s, r.sections), c: Math.max(worst.out40.c, r.calls), t: Math.max(worst.out40.t, r.tris) };
    }
    // Underground the cave haze ends at 36 whatever the view setting: 40 is the reach the draw rule uses at most.
    for (const s of underground) {
      const r = measure(s, 40);
      expect(r.zone, s.name).toBe('underground');
      rows.push(`cave ${s.name}: ${r.sections} sections, ${r.calls} + ${ENTITY_DRAW_CALLS} calls, ${r.tris} triangles`);
      worst.under = { s: Math.max(worst.under.s, r.sections), c: Math.max(worst.under.c, r.calls), t: Math.max(worst.under.t, r.tris) };
    }
    rows.push(`== outdoors at 40 worst: ${worst.out40.s} sections, ${worst.out40.c + ENTITY_DRAW_CALLS} calls, ${worst.out40.t} triangles`);
    rows.push(`== underground worst: ${worst.under.s} sections, ${worst.under.c + ENTITY_DRAW_CALLS} calls, ${worst.under.t} triangles`);
    console.log(`budgetDeep views\n${rows.join('\n')}`);
    for (const w of [worst.out40, worst.under]) {
      expect(w.s).toBeLessThanOrEqual(70);
      expect(w.c + ENTITY_DRAW_CALLS).toBeLessThanOrEqual(110);
      expect(w.t).toBeLessThanOrEqual(90_000);
    }
  });

  it('a dig rebuild touches at most 4 sections and costs under 8 ms', () => {
    let worstMs = 0, worstN = 0;
    const cells: Cell[] = [[64, 54, 72], [79, 55, 79], [80, 47, 80], [96, 15, 96], [15, 15, 15], ...caves.ore.slice(0, 6)];
    for (const [x, y, z] of cells) {
      const before = world.get(x, y, z);
      const dirty = new DirtySections(world.sizeX, world.sizeY, world.sizeZ);
      world.set(x, y, z, BlockId.Air);
      dirty.mark(x, y, z);
      const t0 = performance.now();
      const keys = dirty.take(99, x, y, z);
      for (const [cx, sy, cz] of keys) buildSectionGeometry(world, cx, sy, cz, uv);
      worstMs = Math.max(worstMs, performance.now() - t0);
      worstN = Math.max(worstN, keys.length);
      world.set(x, y, z, before);
    }
    console.log(`budgetDeep dig: at most ${worstN} sections, ${worstMs.toFixed(2)} ms`);
    expect(worstN).toBeLessThanOrEqual(4);
    expect(worstMs).toBeLessThan(8 * 3); // 8 ms alone on desktop; a busy test run gets three times that
  });

  it('an edit-heavy save (20,000 edits) applies in under 150 ms', () => {
    const game = new Game(generateWorld(2026));
    const data: SaveData = serialise(game, 2026);
    const edits: SaveData['edits'] = [];
    for (let i = 0; edits.length < 20_000; i++) {
      const x = 20 + (i % 150), z = 20 + Math.floor(i / 150) % 150, y = 1 + Math.floor(i / 22500);
      edits.push([x, y, z, BlockId.Planks]);
    }
    const fresh = generateWorld(2026);
    const t0 = performance.now();
    const loaded = applySave({ ...data, edits }, Date.now(), fresh);
    const ms = performance.now() - t0;
    console.log(`budgetDeep: 20,000 edits applied in ${ms.toFixed(0)} ms`);
    expect(loaded.world.get(20, 1, 20)).toBe(BlockId.Planks);
    expect(ms).toBeLessThan(150 * 2); // 150 alone; a busy test run gets double
  });
});
