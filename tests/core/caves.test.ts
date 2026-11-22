import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { BLOCKS, BlockId } from '../../src/core/blocks';
import { CARVE_MAX_Y } from '../../src/core/bounds';
import {
  CaveField, cellIndex, cellOf, EDGE_KEEP, LAYERS, repairFloors, roomCentre, RUIN_HALL, TUNNEL, tunnelLine, type Room,
} from '../../src/core/caves';
import { mulberry32 } from '../../src/core/rng';
import { airMask, caveWorld, floorIn, reached, SEEDS, walkCaves } from '../helpers/caveWorld';

/** Plan Task 13: rooms and tunnels, on the real generated world, four seeds. */

const inRect = (r: { x0: number; z0: number; x1: number; z1: number }, x: number, z: number, m = 0): boolean =>
  x >= r.x0 - m && x <= r.x1 + m && z >= r.z0 - m && z <= r.z1 + m;

describe.each(SEEDS)('caves, seed %i', seed => {
  test('24 shallow and 18 deep rooms (at least 20 and 15), within their layers', () => {
    const { caves } = caveWorld(seed);
    const shallow = caves.rooms.filter(r => r.layer === 'shallow');
    const deep = caves.rooms.filter(r => r.layer === 'deep');
    console.log(`caves ${seed}: ${shallow.length} shallow rooms, ${deep.length} deep rooms, ${caves.edges.length} tunnels`);
    expect(shallow.length).toBeGreaterThanOrEqual(20);
    expect(deep.length).toBeGreaterThanOrEqual(15);
    expect(shallow.length).toBeLessThanOrEqual(LAYERS[0].rooms);
    expect(deep.length).toBeLessThanOrEqual(LAYERS[1].rooms);
    for (const r of shallow) {
      expect(r.floorY).toBeGreaterThanOrEqual(LAYERS[0].floorMin);
      expect(r.floorY).toBeLessThanOrEqual(LAYERS[0].floorMax);
    }
    for (const r of deep) {
      expect(r.floorY).toBeGreaterThanOrEqual(LAYERS[1].floorMin);
      expect(r.floorY).toBeLessThanOrEqual(LAYERS[1].floorMax);
    }
    caves.rooms.forEach((r, i) => expect(r.id).toBe(i));
  });

  test('rooms are at least 16 apart in their layer and 12 from the edge (never touching the soft wall)', () => {
    const { caves, world } = caveWorld(seed);
    for (const a of caves.rooms) {
      const R = Math.max(a.rx, a.rz);
      expect(a.cx - R).toBeGreaterThanOrEqual(EDGE_KEEP);
      expect(a.cz - R).toBeGreaterThanOrEqual(EDGE_KEEP);
      expect(a.cx + R).toBeLessThan(world.sizeX - EDGE_KEEP);
      expect(a.cz + R).toBeLessThan(world.sizeZ - EDGE_KEEP);
      for (const b of caves.rooms) {
        if (a === b || a.layer !== b.layer) continue;
        expect(Math.hypot(a.cx - b.cx, a.cz - b.cz), `${a.id}/${b.id}`).toBeGreaterThanOrEqual(16);
      }
    }
  });

  test('nothing is carved above y 48 except a mouth, nothing at or below y 3, no room in the Old Hideout\'s hall', () => {
    const { caves, world } = caveWorld(seed);
    for (const i of caves.airCells) {
      const [x, y, z] = cellOf(world, i);
      expect(y).toBeGreaterThan(3);
      if (y > CARVE_MAX_Y) expect(caves.mouths.some(m => inRect(m.rect, x, z)), `${x},${y},${z}`).toBe(true);
      expect(x).toBeGreaterThanOrEqual(EDGE_KEEP - 6);
      expect(z).toBeGreaterThanOrEqual(EDGE_KEEP - 6);
    }
    for (const r of caves.rooms) {
      if (r.layer !== 'deep') continue;
      expect(Math.max(RUIN_HALL.x0 - r.cx, r.cx - RUIN_HALL.x1, RUIN_HALL.z0 - r.cz, r.cz - RUIN_HALL.z1)).toBeGreaterThan(Math.max(r.rx, r.rz));
    }
  });

  test('every layer is one network on foot (no drops): every room centre is reachable from the first room of its layer', () => {
    const { caves, world } = caveWorld(seed);
    for (const L of LAYERS) {
      const rooms = caves.rooms.filter(r => r.layer === L.id);
      const flood = walkCaves(world, caves, [roomCentre(world, rooms[0])]);
      const missing = rooms.filter(r => !reached(world, flood, roomCentre(world, r))).map(r => r.id);
      expect(missing, L.id).toEqual([]);
    }
  });

  test('every tunnel is at least 5 wide and 5 high along its centre line, outside the rooms', () => {
    const { caves, world } = caveWorld(seed);
    const air = airMask(world, caves);
    const inAnyRoom = (x: number, z: number): boolean => caves.rooms.some(r => ((x - r.cx) / (r.rx + 1)) ** 2 + ((z - r.cz) / (r.rz + 1)) ** 2 <= 1);
    let checked = 0;
    for (const t of caves.tunnels) {
      const room = caves.rooms[t.a];
      const band: [number, number] = room.layer === 'shallow' ? [36, 48] : [6, 27];
      for (const [x, , z] of t.line) {
        if (inAnyRoom(x, z)) continue;
        const f = floorIn(world, air, x, z, band[0], band[1]);
        expect(f, `${x},${z}`).toBeGreaterThan(0);
        for (let y = f; y < f + TUNNEL.height; y++) expect(air[cellIndex(world, x, y, z)], `${x},${y},${z} high`).toBe(1);
        // Standing room 5 across (the floor may differ by 1 across a slope): along x or along z.
        // Carved across the full width (on a slope the repair may have raised a side by a block or two).
        const stand = (cx: number, cz: number): boolean => [f - 2, f - 1, f, f + 1, f + 2].some(y => air[cellIndex(world, cx, y, cz)] === 1 && air[cellIndex(world, cx, y + 1, cz)] === 1);
        const run = (ax: number, az: number): number => {
          let n = 1;
          for (let k = 1; k <= 4 && stand(x + ax * k, z + az * k); k++) n++;
          for (let k = 1; k <= 4 && stand(x - ax * k, z - az * k); k++) n++;
          return n;
        };
        expect(Math.min(run(1, 0), run(0, 1)) >= 5 || Math.max(run(1, 0), run(0, 1)) >= 9, `${x},${z} wide`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(200);
  });

  test('no floor step larger than 1 between neighbouring cave floor cells (the repair guarantee)', () => {
    const { caves, world } = caveWorld(seed);
    const air = airMask(world, caves);
    const skip = (x: number, z: number): boolean =>
      caves.mouths.some(m => inRect(m.rect, x, z, 2))
      || caves.stairs.some(s => s.cells.some(c => Math.abs(c[0] - x) <= 4 && Math.abs(c[2] - z) <= 4))
      || caves.treasure.some(t => inRect(t.rect, x, z, 1))
      || inRect(RUIN_HALL, x, z, 1);
    for (const band of [[36, 48], [6, 27]] as Array<[number, number]>) {
      const F = new Int16Array(world.sizeX * world.sizeZ).fill(-1);
      for (let z = 0; z < world.sizeZ; z++) for (let x = 0; x < world.sizeX; x++) F[x + world.sizeX * z] = floorIn(world, air, x, z, band[0], band[1]);
      let bad = 0;
      const first: string[] = [];
      for (let z = 1; z < world.sizeZ - 1; z++) for (let x = 1; x < world.sizeX - 1; x++) {
        const f = F[x + world.sizeX * z];
        if (f < 0 || skip(x, z)) continue;
        for (const [nx, nz] of [[x + 1, z], [x, z + 1]]) {
          const g = F[nx + world.sizeX * nz];
          if (g < 0 || skip(nx, nz)) continue;
          if (Math.abs(f - g) > 1) { bad++; if (first.length < 5) first.push(`${x},${z}:${f} vs ${nx},${nz}:${g}`); }
        }
      }
      expect(first, `band ${band}`).toEqual([]);
      expect(bad).toBe(0);
    }
  });

  test('at least 3 loops per layer (tunnels minus rooms plus 1)', () => {
    const { caves } = caveWorld(seed);
    for (const L of LAYERS) {
      const rooms = caves.rooms.filter(r => r.layer === L.id).length;
      const edges = caves.edges.filter(([a]) => caves.rooms[a].layer === L.id).length;
      expect(edges - rooms + 1, L.id).toBeGreaterThanOrEqual(3);
    }
  });

  test('the caves are cheap: planning and carving each well under budget', () => {
    const { caves } = caveWorld(seed);
    console.log(`caves ${seed} timings: ${JSON.stringify(Object.fromEntries(Object.entries(caves.timings).map(([k, v]) => [k, Math.round(v)])))}`);
    expect(caves.timings.carve).toBeLessThan(80);
    expect(caves.timings.plan).toBeLessThan(1200); // about 200 to 600 ms alone; the whole world stays under 1.5 s warm (worldInvariants)
  });
});

describe('cave pieces', () => {
  test('carving is deterministic (same buffer hash twice)', async () => {
    const { generateWorld } = await import('../../src/core/worldgen');
    const h = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
    expect(h(generateWorld(7).world.buffer)).toBe(h(caveWorld(7).world.buffer));
  });

  test('a tunnel line keeps its floor gentle: at most 1 block per 2 cells, flat inside each room', () => {
    const a: Room = { id: 0, layer: 'deep', cx: 30, cz: 30, floorY: 8, rx: 6, rz: 7, h: 8 };
    const b: Room = { id: 1, layer: 'deep', cx: 70, cz: 40, floorY: 16, rx: 9, rz: 6, h: 9 };
    const line = tunnelLine(a, b, mulberry32(3));
    for (let i = 4; i < line.length; i++) {
      // Samples are every half cell: four samples span two cells.
      expect(Math.abs(line[i].f - line[i - 4].f)).toBeLessThanOrEqual(1);
    }
    expect(line[0].f).toBe(8);
    expect(line[line.length - 1].f).toBe(16);
  });

  test('repairFloors raises a deep step into a staircase and gives at least 3 of headroom, never lowering anything', () => {
    const f = new CaveField(64, 64, 48);
    for (let x = 10; x < 30; x++) for (let z = 20; z < 25; z++) f.add(x, z, x < 20 ? 30 : 36, x < 20 ? 34 : 38);
    const before = Int16Array.from(f.F);
    repairFloors(f);
    for (let k = 0; k < f.F.length; k++) if (before[k] >= 0) expect(f.F[k]).toBeGreaterThanOrEqual(before[k]);
    for (let x = 10; x < 29; x++) for (let z = 20; z < 25; z++) {
      expect(Math.abs(f.F[x + 64 * z] - f.F[x + 1 + 64 * z])).toBeLessThanOrEqual(1);
      expect(f.T[x + 64 * z] - f.F[x + 64 * z]).toBeGreaterThanOrEqual(2);
    }
  });

  test('nothing under the caves is carved: every carved cell has rock, Bedrock or a cave block somewhere below it', () => {
    const { world, caves } = caveWorld(2026);
    for (let n = 0; n < caves.airCells.length; n += 97) {
      const [x, y, z] = cellOf(world, caves.airCells[n]);
      let solid = false;
      for (let yy = y - 1; yy >= 0 && !solid; yy--) solid = BLOCKS[world.get(x, yy, z)].solid;
      expect(solid).toBe(true);
    }
    expect(world.get(96, 0, 96)).toBe(BlockId.Bedrock);
  });
});
