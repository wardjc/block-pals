import { describe, expect, test } from 'vitest';
import { BLOCKS, BlockId } from '../../src/core/blocks';
import { ORIGIN, V2_WORLD } from '../../src/core/bounds';
import { cellIndex, cellOf, inOld, roomCentre, TRAIL_LAMP_EVERY } from '../../src/core/caves';
import { routeHome } from '../../src/core/home';
import { canStep, findPath, isStandable, type Cell } from '../../src/core/pathfind';
import { caveWorld, reached, SEEDS, walkCaves } from '../helpers/caveWorld';

/** Plan Task 15: the six mouths, the stairs, the cobble trail and the way home. */

const inRect = (r: { x0: number; z0: number; x1: number; z1: number }, x: number, z: number, m = 0): boolean =>
  x >= r.x0 - m && x <= r.x1 + m && z >= r.z0 - m && z <= r.z1 + m;
const OLD = { x0: ORIGIN.x, z0: ORIGIN.z, x1: ORIGIN.x + V2_WORLD.x - 1, z1: ORIGIN.z + V2_WORLD.z - 1 };

describe.each(SEEDS)('mouths, stairs and the trail, seed %i', seed => {
  test('six mouths: hill (within 26 of spawn) and quarry stamped in the old region, one per side outside', () => {
    const { caves, spawn, village } = caveWorld(seed);
    expect(caves.mouths.map(m => m.kind).sort()).toEqual(['east', 'hill', 'north', 'quarry', 'south', 'west']);
    for (const m of caves.mouths) expect(m.stamped, m.kind).toBe(m.kind === 'hill' || m.kind === 'quarry');
    const hill = caves.mouths.find(m => m.kind === 'hill')!;
    const d = Math.hypot(hill.cell[0] - spawn.x, hill.cell[2] - spawn.z);
    expect(d).toBeGreaterThanOrEqual(14);
    expect(d).toBeLessThanOrEqual(26);
    expect(inRect(village.quarry, caves.mouths.find(m => m.kind === 'quarry')!.cell[0], caves.mouths.find(m => m.kind === 'quarry')!.cell[2])).toBe(true);
    const side = (k: string, x: number, z: number): boolean =>
      k === 'north' ? z < OLD.z0 : k === 'south' ? z > OLD.z1 : k === 'west' ? x < OLD.x0 : x > OLD.x1;
    for (const m of caves.mouths.filter(mm => !mm.stamped)) {
      expect(inOld(m.cell[0], m.cell[2]), m.kind).toBe(false);
      expect(side(m.kind, m.cell[0], m.cell[2]), m.kind).toBe(true);
    }
    for (const a of caves.mouths) for (const b of caves.mouths) {
      if (a !== b) expect(Math.hypot(a.cell[0] - b.cell[0], a.cell[2] - b.cell[2])).toBeGreaterThanOrEqual(30);
    }
  });

  test('every mouth cell is standable surface, reachable from spawn on foot (no drops)', () => {
    const { caves, spawn, world } = caveWorld(seed);
    const from: Cell = [Math.floor(spawn.x), Math.floor(spawn.y), Math.floor(spawn.z)];
    for (const m of caves.mouths) {
      expect(isStandable(world, m.cell), m.kind).toBe(true);
      // Open to the sky: nothing solid above the outer cell.
      expect(world.topSolidY(m.cell[0], m.cell[2])).toBe(m.cell[1] - 1);
      expect(findPath(world, from, m.cell, 400_000), m.kind).not.toBeNull();
    }
  });

  test('every mouth leads on foot to its room, and every ramp cell has 5 blocks of headroom', () => {
    const { caves, world } = caveWorld(seed);
    for (const m of caves.mouths) {
      const flood = walkCaves(world, caves, [m.cell]);
      expect(reached(world, flood, roomCentre(world, caves.rooms[m.room])), m.kind).toBe(true);
      for (const [x, y, z] of m.ramp) {
        // The floor may have been raised by at most 1 by the turn's square; the headroom is 5 from the real floor.
        let f = y;
        while (!BLOCKS[world.get(x, f - 1, z)].solid) f--;
        for (let h = 0; h < 5; h++) expect(BLOCKS[world.get(x, f + h, z)].solid, `${m.kind} ${x},${f + h},${z}`).toBe(false);
      }
    }
  });

  test('a mouth on flat ground starts as an open trench (sky over its first steps), never a closed hole', () => {
    const { caves, world } = caveWorld(seed);
    for (const m of caves.mouths) {
      const [x, , z] = m.ramp[1];
      let f = m.ramp[1][1];
      while (!BLOCKS[world.get(x, f - 1, z)].solid) f--;
      const roof = world.topSolidY(x, z);
      // Either open to the sky, or a doorway cut into rising ground.
      expect(roof < f || roof >= f + 5, m.kind).toBe(true);
    }
  });

  test('open mouth columns keep 6 from every house, the farm, the pasture and the village path', () => {
    const { caves, village, world } = caveWorld(seed);
    const keep = [...village.houses.map(h => h.rect), village.farmPlot, village.farm.pasture];
    const path = [...village.routeCells].map(k => [k % world.sizeX, Math.floor(k / world.sizeX) % world.sizeZ]);
    for (const m of caves.mouths) {
      const open: Array<[number, number]> = [[m.cell[0], m.cell[2]]];
      for (const [x, y, z] of m.ramp) if (world.topSolidY(x, z) < y) open.push([x, z]);
      for (const [x, z] of open) {
        for (const r of keep) expect(Math.max(r.x0 - x, 0, x - r.x1, r.z0 - z, 0, z - r.z1), `${m.kind} ${x},${z}`).toBeGreaterThanOrEqual(6);
        for (const [px, pz] of path) expect(Math.max(Math.abs(px - x), Math.abs(pz - z))).toBeGreaterThanOrEqual(6);
      }
    }
  });

  test('stairs: 3, joining a shallow room to a deep room, gentle (at most 1 per 2 cells), walkable both ways', () => {
    const { caves, world } = caveWorld(seed);
    expect(caves.stairs.length).toBe(3);
    for (const s of caves.stairs) {
      const a = caves.rooms[s.from], b = caves.rooms[s.to];
      expect([a.layer, b.layer]).toEqual(['shallow', 'deep']);
      for (let i = 1; i < s.cells.length; i++) {
        const d = Math.hypot(s.cells[i][0] - s.cells[0][0], s.cells[i][2] - s.cells[0][2]);
        expect(Math.abs(s.cells[i][1] - s.cells[i - 1][1])).toBeLessThanOrEqual(1);
        expect(s.cells[0][1] - s.cells[i][1]).toBeLessThanOrEqual(d / 2 + 1);
      }
      const down = walkCaves(world, caves, [roomCentre(world, a)]);
      expect(reached(world, down, roomCentre(world, b))).toBe(true);
      const up = walkCaves(world, caves, [roomCentre(world, b)]);
      expect(reached(world, up, roomCentre(world, a))).toBe(true);
    }
    // One near the world centre.
    expect(caves.stairs.some(s => Math.hypot(caves.rooms[s.to].cx - 96, caves.rooms[s.to].cz - 96) <= 32)).toBe(true);
  });

  test('from every room centre, following only trail cells reaches a mouth', () => {
    const { caves, world } = caveWorld(seed);
    const onTrail = (c: Cell): boolean => caves.trail.has(cellIndex(world, c[0], c[1] - 1, c[2]));
    const mouthKeys = new Set(caves.mouths.map(m => cellIndex(world, m.cell[0], m.cell[1], m.cell[2])));
    for (const r of caves.rooms) {
      const start = roomCentre(world, r);
      expect(onTrail(start), `room ${r.id}`).toBe(true);
      // BFS over trail cells only.
      const seen = new Set([cellIndex(world, ...start)]);
      const queue: Cell[] = [start];
      let found = false;
      for (let h = 0; h < queue.length && !found; h++) {
        const c = queue[h];
        if (mouthKeys.has(cellIndex(world, ...c))) { found = true; break; }
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const dy of [0, 1, -1]) {
          const n: Cell = [c[0] + dx, c[1] + dy, c[2] + dz];
          const k = cellIndex(world, ...n);
          if (seen.has(k) || !onTrail(n) || !canStep(world, c, n)) continue;
          seen.add(k);
          queue.push(n);
        }
      }
      expect(found, `room ${r.id} (${r.layer})`).toBe(true);
    }
  });

  test('the trail is PathStone, 3 wide, with a Lamp set in the floor beside it about every 6 cells', () => {
    const { caves, world } = caveWorld(seed);
    for (const k of caves.trail) expect(world.buffer[k]).toBe(BlockId.PathStone);
    // 3 wide: most trail cells have trail on both sides along one axis.
    let wide = 0;
    for (const k of caves.trail) {
      const [x, y, z] = cellOf(world, k);
      const t = (dx: number, dz: number): boolean => caves.trail.has(cellIndex(world, x + dx, y, z + dz));
      if ((t(1, 0) && t(-1, 0)) || (t(0, 1) && t(0, -1))) wide++;
    }
    expect(wide / caves.trail.size).toBeGreaterThan(0.6);
    // Lamps beside it.
    let lamps = 0;
    for (const k of caves.trail) {
      const [x, y, z] = cellOf(world, k);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (world.get(x + dx, y, z + dz) === BlockId.Lamp) { lamps++; break; }
    }
    expect(lamps).toBeGreaterThan(caves.trail.size / (TRAIL_LAMP_EVERY * 6));
  });

  test('routeHome from every room, treasure room and the Old Hideout ends at a mouth, on foot, in under 600 steps', () => {
    const { caves, world } = caveWorld(seed);
    const starts: Cell[] = [
      ...caves.rooms.map(r => roomCentre(world, r)),
      ...caves.treasure.map(t => [t.chest[0] - t.dir[0], t.floorY, t.chest[2] - t.dir[1]] as Cell),
      [96, caves.ruin!.floorY, 96 + 1],
    ];
    const mouthKeys = new Set(caves.mouths.map(m => m.cell.join(',')));
    let worst = 0, worstMs = 0;
    for (const s of starts) {
      expect(isStandable(world, s), s.join(',')).toBe(true);
      const t0 = performance.now();
      const route = routeHome(world, s, caves);
      worstMs = Math.max(worstMs, performance.now() - t0);
      expect(route, s.join(',')).not.toBeNull();
      expect(mouthKeys.has(route![route!.length - 1].join(','))).toBe(true);
      let prev = s;
      for (const c of route!) { expect(canStep(world, prev, c)).toBe(true); prev = c; }
      worst = Math.max(worst, route!.length);
      expect(route!.length).toBeLessThan(600);
    }
    console.log(`cavesRoutes ${seed}: longest way home ${worst} steps, slowest routeHome ${worstMs.toFixed(1)} ms`);
    expect(worstMs).toBeLessThan(250); // about 40 to 60 ms alone; the full suite runs many files at once
  });
});
