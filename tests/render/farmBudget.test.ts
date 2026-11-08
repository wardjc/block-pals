// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BlockId } from '../../src/core/blocks';
import { cropBlock } from '../../src/core/crops';
import { Inventory } from '../../src/core/inventory';
import { ItemId } from '../../src/core/items';
import { generateWorld } from '../../src/core/worldgen';
import { Farm } from '../../src/game/farm';
import { Herd } from '../../src/game/animals';
import { mulberry32 } from '../../src/core/rng';
import { ANIMAL_MAX_TRIANGLES, AnimalView } from '../../src/render/animals';
import { Sparkles } from '../../src/render/effects';
import { buildChunkGeometry, CHUNK_SIZE } from '../../src/render/mesher';

const uvFor = () => [0, 0, 1, 1] as [number, number, number, number];
const tris = (world: ReturnType<typeof generateWorld>['world']): number => {
  let t = 0;
  for (let z = 0; z < Math.ceil(world.sizeZ / CHUNK_SIZE); z++) for (let x = 0; x < Math.ceil(world.sizeX / CHUNK_SIZE); x++) {
    const g = buildChunkGeometry(world, x, z, uvFor);
    t += g.indices.length / 3 + g.transparent.indices.length / 3;
  }
  return t;
};

/** A field of ripe wheat: the three beds first, then open ground beside them. */
function plantField(world: ReturnType<typeof generateWorld>['world'], beds: Array<{ x0: number; z0: number; x1: number; z1: number }>, n: number, stage = 3): Array<[number, number, number]> {
  const cells: Array<[number, number, number]> = [];
  const seen = new Set<string>();
  const add = (x: number, z: number): void => {
    if (cells.length >= n || seen.has(`${x},${z}`)) return;
    seen.add(`${x},${z}`);
    const y = world.topSolidY(x, z) + 1;
    const below = world.get(x, y - 1, z);
    if (world.get(x, y, z) !== BlockId.Air || (below !== BlockId.Grass && below !== BlockId.Dirt && below !== BlockId.Farmland)) return;
    world.set(x, y, z, cropBlock('wheat', stage));
    cells.push([x, y, z]);
  };
  for (const b of beds) for (let z = b.z0; z <= b.z1; z++) for (let x = b.x0; x <= b.x1; x++) add(x, z);
  for (let z = 20; z < 45; z++) for (let x = 66; x < 88; x++) add(x, z);
  return cells;
}

describe('farm budgets', () => {
  const { world, village } = generateWorld(2026);
  const beds = village.farm.beds;
  const bare = tris(world);

  it('world triangle budget with the farm: at most 115,000 in all and 12,000 per chunk', () => {
    let max = 0;
    for (let z = 0; z < 6; z++) for (let x = 0; x < 6; x++) {
      const g = buildChunkGeometry(world, x, z, uvFor);
      max = Math.max(max, g.indices.length / 3 + g.transparent.indices.length / 3);
    }
    console.log(`farm budget: world ${bare} triangles, largest chunk ${max}`);
    expect(bare).toBeLessThanOrEqual(115_000);
    expect(max).toBeLessThanOrEqual(12_000);
  });

  it('150 planted crops add at most 1,300 triangles', () => {
    const cells = plantField(world, beds, 150);
    expect(cells.length).toBe(150);
    const withCrops = tris(world);
    const added = withCrops - bare;
    console.log(`farm budget: ${cells.length} crops add ${added} triangles`);
    expect(added).toBeLessThanOrEqual(1300);
    for (const c of cells) world.set(c[0], c[1], c[2], BlockId.Air);
  });

  it('a chunk rebuild after one stage change takes under 12 ms', () => {
    const [cell] = plantField(world, beds, 1, 1);
    buildChunkGeometry(world, Math.floor(cell[0] / CHUNK_SIZE), Math.floor(cell[2] / CHUNK_SIZE), uvFor); // warm up
    world.set(cell[0], cell[1], cell[2], cropBlock('wheat', 2));
    const t0 = performance.now();
    buildChunkGeometry(world, Math.floor(cell[0] / CHUNK_SIZE), Math.floor(cell[2] / CHUNK_SIZE), uvFor);
    const ms = performance.now() - t0;
    console.log(`farm budget: one chunk rebuild ${ms.toFixed(1)} ms (desktop)`);
    expect(ms).toBeLessThan(12);
    world.set(cell[0], cell[1], cell[2], BlockId.Air);
  });

  it('10 animals are 10 draw calls and under 1,300 triangles; the sparkles are one draw call', () => {
    const scene = new THREE.Scene();
    const herd = new Herd(mulberry32(1));
    herd.populate(village.farm.herdSpawns);
    expect(herd.animals).toHaveLength(10);
    const view = new AnimalView(scene);
    const spark = new Sparkles(scene);
    view.sync(herd.animals, () => true, 0);
    let meshes = 0; let points = 0; let t = 0;
    scene.traverse(o => {
      const m = o as THREE.Mesh;
      if ((o as THREE.Points).isPoints) points++;
      else if (m.isMesh) { meshes++; t += (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3; }
    });
    console.log(`farm budget: ${meshes} animal draw calls, ${t} triangles, ${points} sparkle draw call`);
    expect(meshes).toBe(10);
    expect(t).toBeLessThan(1300);
    expect(t / meshes).toBeLessThanOrEqual(ANIMAL_MAX_TRIANGLES);
    expect(points).toBe(1);
    spark.dispose();
    view.dispose();
  });

  // Draw calls with the village and farm in view (chunks + 14) are measured in the browser: e2e/farm.spec.ts.

  it('Farm.update with 400 crops costs under 0.2 ms per frame', () => {
    const w = generateWorld(2026).world;
    const inv = new Inventory();
    const farm = new Farm(w, inv);
    const crops = [];
    for (let x = 4; x < 44 && crops.length < 400; x++) for (let z = 4; z < 14 && crops.length < 400; z++) {
      const y = w.topSolidY(x, z) + 1;
      w.set(x, y, z, cropBlock('wheat', 0));
      crops.push([x, y, z, 0]);
    }
    farm.restore(crops, []);
    farm.advance(1000);
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) farm.update(1 / 30);
    const per = (performance.now() - t0) / 1000;
    console.log(`farm budget: Farm.update ${per.toFixed(4)} ms/frame with ${crops.length} crops`);
    expect(per).toBeLessThan(0.2);
  });

  it('Herd.update with 10 animals costs under 0.3 ms per frame', () => {
    const herd = new Herd(mulberry32(7));
    herd.populate(village.farm.herdSpawns);
    const p = village.farm.pasture;
    const roam = { x0: p.x0 + 1, z0: p.z0 + 1, x1: p.x1 - 1, z1: p.z1 - 1 };
    const player = { x: p.x0 + 6.5, y: world.topSolidY(p.x0 + 6, p.z0 + 6) + 1, z: p.z0 + 6.5 };
    for (let i = 0; i < 200; i++) herd.update({ world, roam, player, held: 'hand', occupied: [], dt: 1 / 30 }); // warm
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) herd.update({ world, roam, player, held: ItemId.Carrot, occupied: [], dt: 1 / 30 });
    const per = (performance.now() - t0) / 1000;
    console.log(`farm budget: Herd.update ${per.toFixed(4)} ms/frame`);
    expect(per).toBeLessThan(0.3);
  });

  it('a catch-up of 8 hours over 400 crops sets each crop block once and rebuilds no chunk before the first mesh', () => {
    const w = generateWorld(2026).world;
    const farm = new Farm(w, new Inventory());
    const recs: number[][] = [];
    for (let x = 4; x < 44 && recs.length < 400; x++) for (let z = 4; z < 14 && recs.length < 400; z++) {
      const y = w.topSolidY(x, z) + 1;
      w.set(x, y, z, cropBlock('wheat', 0));
      recs.push([x, y, z, 0]);
    }
    farm.restore(recs, []);
    let changes = 0;
    w.onChange(() => { changes++; });
    farm.advance(8 * 3600_000);
    expect(changes).toBe(0); // advancing only queues; nothing is set until shown
    farm.records(); // the save/first-mesh path brings every pending change into the world
    expect(changes).toBe(400);
    farm.records();
    expect(changes).toBe(400);
  });

  it('resume from sleep with 100 crops due: one stage change per frame, so at most 2 chunk rebuilds per frame', () => {
    const w = generateWorld(2026).world;
    const farm = new Farm(w, new Inventory());
    const recs: number[][] = [];
    for (let x = 4; x < 44 && recs.length < 100; x++) for (let z = 4; z < 14 && recs.length < 100; z++) {
      const y = w.topSolidY(x, z) + 1;
      w.set(x, y, z, cropBlock('wheat', 0));
      recs.push([x, y, z, 0]);
    }
    farm.restore(recs, []);
    const chunksThisFrame = new Set<string>();
    w.onChange((x, _y, z) => {
      // A block on a chunk edge also dirties its neighbour (rebuildChunkAt rebuilds the chunk and, on an edge, one more).
      chunksThisFrame.add(`${Math.floor(x / CHUNK_SIZE)},${Math.floor(z / CHUNK_SIZE)}`);
    });
    farm.advance(60 * 60_000);
    let worst = 0;
    let frames = 0;
    for (let i = 0; i < 150; i++) {
      chunksThisFrame.clear();
      farm.update(1 / 30);
      worst = Math.max(worst, chunksThisFrame.size);
      if (chunksThisFrame.size > 0) frames++;
    }
    expect(frames).toBe(100);
    expect(worst).toBeLessThanOrEqual(2);
  });
});
