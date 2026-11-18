// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { BlockId } from '../../src/core/blocks';
import { generateWorld } from '../../src/core/worldgen';
import { TOWER_PLAN } from '../../src/core/tower';
import { ATLAS_COLS, ATLAS_ROWS, createAtlas } from '../../src/render/atlas';
import { buildChunkGeometry, CHUNK_SIZE } from '../../src/render/mesher';
import { CAMERA_FAR } from '../../src/render/depthPolicy';
import { BEACON_CLAMP, Beacon } from '../../src/render/beacon';
import { WIZARD_MAX_TRIANGLES, WizardView, makeWizardModel } from '../../src/render/wizard';
import { PixelCanvas } from './pixelCanvas';

/**
 * The wizard step's numbers (plan Task 19, Tab A8): world triangles, the tower's own cost, the
 * wizard's and the beacon's draw calls, the per-frame CPU of the new views, the shimmer repaint and
 * the atlas size. Printed so the PR can quote them.
 */
const uvFor = () => [0, 0, 1, 1] as [number, number, number, number];

beforeAll(() => {
  const contexts = new WeakMap<HTMLCanvasElement, PixelCanvas>();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    let ctx = contexts.get(this);
    if (!ctx) { ctx = new PixelCanvas(this.width, this.height); contexts.set(this, ctx); }
    return ctx as unknown as CanvasRenderingContext2D;
  } as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,ZmFrZQ==');
});
afterAll(() => vi.restoreAllMocks());

const meshChunks = (world: ReturnType<typeof generateWorld>['world'], keys?: Set<string>) => {
  const per: number[] = [];
  const cx = Math.ceil(world.sizeX / CHUNK_SIZE), cz = Math.ceil(world.sizeZ / CHUNK_SIZE);
  for (let z = 0; z < cz; z++) for (let x = 0; x < cx; x++) {
    if (keys && !keys.has(`${x},${z}`)) continue;
    const g = buildChunkGeometry(world, x, z, uvFor);
    per.push((g.indices.length + g.transparent.indices.length) / 3);
  }
  return per;
};

describe('wizard step budgets (Tab A8)', () => {
  const t0 = performance.now();
  const { world, tower } = generateWorld(2026);
  const genMs = performance.now() - t0;
  const per = meshChunks(world);
  const total = per.reduce((a, b) => a + b, 0);

  it('world triangle budget: at most 118,000 in all and 12,000 per chunk; generate stays under the build-time guard', () => {
    console.log(`towerBudget: world ${total} triangles, max chunk ${Math.max(...per)}, generate ${genMs.toFixed(0)} ms`);
    expect(total).toBeLessThanOrEqual(118_000);
    expect(Math.max(...per)).toBeLessThanOrEqual(12_000);
    expect(genMs).toBeLessThan(2500);
  });

  it('the tower itself adds at most 2,500 triangles', () => {
    const r = TOWER_PLAN.footprint;
    const keys = new Set<string>();
    for (let x = r.x0; x <= r.x1; x++) for (let z = r.z0; z <= r.z1; z++) keys.add(`${Math.floor(x / CHUNK_SIZE)},${Math.floor(z / CHUNK_SIZE)}`);
    const withTower = meshChunks(world, keys).reduce((a, b) => a + b, 0);
    // The same chunks with the tower taken away (its floor left as plain ground).
    const bare = generateWorld(2026).world;
    for (let x = r.x0; x <= r.x1; x++) for (let z = r.z0; z <= r.z1; z++) {
      for (let y = tower.groundY + 1; y < bare.sizeY; y++) bare.set(x, y, z, BlockId.Air);
      bare.set(x, tower.groundY, z, BlockId.Grass);
    }
    const without = meshChunks(bare, keys).reduce((a, b) => a + b, 0);
    console.log(`towerBudget: the tower adds ${withTower - without} triangles`);
    expect(withTower - without).toBeLessThanOrEqual(2500);
  });

  it('the wizard is 2 draw calls and at most 300 triangles; the beacon is 1 draw call', () => {
    const m = makeWizardModel();
    let meshes = 0, tris = 0;
    m.group.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      meshes++;
      tris += (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3;
    });
    console.log(`towerBudget: wizard ${meshes} draw calls, ${tris} triangles`);
    expect(meshes).toBe(2);
    expect(tris).toBeLessThanOrEqual(300);
    expect(WIZARD_MAX_TRIANGLES).toBeLessThanOrEqual(280);
    const scene = new THREE.Scene();
    new Beacon(scene, tower.beacon);
    let drawables = 0;
    scene.traverse(o => { if ((o as THREE.Mesh).isMesh || (o as THREE.Sprite).isSprite) drawables++; });
    expect(drawables).toBe(1);
  });

  it('draw calls added by this step: wizard 2 + beacon 1 = 3 (chunks + 14 becomes chunks + 17)', () => {
    const scene = new THREE.Scene();
    new WizardView(scene, { x: 34, y: 10, z: 82 });
    new Beacon(scene, tower.beacon);
    let drawables = 0;
    scene.traverse(o => { if ((o as THREE.Mesh).isMesh || (o as THREE.Sprite).isSprite) drawables++; });
    expect(drawables).toBe(3);
  });

  it('WizardView.update costs under 0.05 ms and Beacon.update under 0.02 ms per frame', () => {
    const scene = new THREE.Scene();
    const v = new WizardView(scene, { x: 34, y: 10, z: 82 }, { x: 35.5, z: 78.5 });
    const b = new Beacon(scene, tower.beacon);
    const cam = new THREE.PerspectiveCamera(60, 1.6, 0.2, CAMERA_FAR);
    cam.position.set(24, 8, 24);
    cam.lookAt(tower.beacon.x, tower.beacon.y, tower.beacon.z);
    cam.updateMatrixWorld();
    const N = 5000;
    for (let i = 0; i < 500; i++) { v.update(1 / 60, i / 60, { x: 36, z: 80 }, false, cam.position); b.update(cam, i / 60); }
    let t = performance.now();
    for (let i = 0; i < N; i++) v.update(1 / 60, i / 60, { x: 36 + Math.sin(i), z: 80 }, i % 100 < 30, cam.position);
    const wizardMs = (performance.now() - t) / N;
    t = performance.now();
    for (let i = 0; i < N; i++) b.update(cam, i / 60);
    const beaconMs = (performance.now() - t) / N;
    console.log(`towerBudget: WizardView.update ${(wizardMs * 1000).toFixed(2)} µs, Beacon.update ${(beaconMs * 1000).toFixed(2)} µs per frame`);
    expect(wizardMs).toBeLessThan(0.05);
    expect(beaconMs).toBeLessThan(0.02);
  });

  it('shimmer repaint costs under 0.5 ms and runs at most 2.5 times a second; the atlas stays 64×192', () => {
    // A canvas that records nothing, so the time is our painting code (the browser's fillRect is native and fast).
    const noop = (): void => {};
    const quiet = { fillStyle: '', imageSmoothingEnabled: false, fillRect: noop, clearRect: noop, beginPath: noop, rect: noop, clip: noop, save: noop, restore: noop, translate: noop };
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => quiet) as never);
    const atlas = createAtlas();
    spy.mockRestore();
    expect(ATLAS_COLS * 16).toBe(64);
    expect(ATLAS_ROWS * 16).toBeLessThanOrEqual(192);
    for (let f = 0; f < 200; f++) atlas.shimmer(f * 0.4); // warm up (JIT)
    let repaints = 0;
    const times: number[] = [];
    for (let f = 0; f < 600; f++) { // 10 simulated seconds at 60 fps
      const t = performance.now();
      const did = atlas.shimmer(1000 + f / 60);
      const ms = performance.now() - t;
      if (did) { repaints++; times.push(ms); }
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)];
    console.log(`towerBudget: ${repaints} shimmer repaints in 10 s, median ${median.toFixed(3)} ms (painting code, no-op canvas), upload ${64 * ATLAS_ROWS * 16 * 4 / 1024} KB`);
    expect(repaints).toBeLessThanOrEqual(26);
    expect(median).toBeLessThan(0.5);
  });

  it('the camera far plane is unchanged: the beacon rides the line of sight instead', () => {
    expect(CAMERA_FAR).toBe(44);
    expect(BEACON_CLAMP).toBe(CAMERA_FAR - 2);
  });
});
