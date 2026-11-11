import { describe, expect, it, vi } from 'vitest';
import { BLOCKS, BlockId } from '../../src/core/blocks';
import { WORLD } from '../../src/core/bounds';
import { findPath, isStandable, type Cell } from '../../src/core/pathfind';
import { stampTower, TOWER_GROUND_Y, TOWER_PLAN, type TowerInfo } from '../../src/core/tower';
import { World } from '../../src/core/world';

const G = TOWER_GROUND_Y;

/** A flat world the size of the real one: ground at `ground` (Grass on Dirt), lower under part of the footprint. */
function flat(ground = G): World {
  const world = new World(WORLD.x, WORLD.y, WORLD.z);
  for (let x = 0; x < WORLD.x; x++) {
    for (let z = 0; z < WORLD.z; z++) {
      // A dip under the tower's south-west corner, so the stamp has to fill Dirt under its floor.
      const h = x <= 35 && z >= 82 ? ground - 3 : ground;
      world.set(x, 0, z, BlockId.Bedrock);
      for (let y = 1; y <= h; y++) world.set(x, y, z, y === h ? BlockId.Grass : BlockId.Dirt);
    }
  }
  return world;
}

function snapshot(world: World): Uint8Array {
  const out = new Uint8Array(world.sizeX * world.sizeY * world.sizeZ);
  let i = 0;
  for (let y = 0; y < world.sizeY; y++) for (let z = 0; z < world.sizeZ; z++) for (let x = 0; x < world.sizeX; x++) out[i++] = world.get(x, y, z);
  return out;
}

const r = TOWER_PLAN.footprint;
const inFootprint = (x: number, z: number): boolean => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
const solid = (w: World, x: number, y: number, z: number): boolean => BLOCKS[w.get(x, y, z)].solid;
const same = (a: Cell, b: Cell): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

function build(): { world: World; info: TowerInfo } {
  const world = flat();
  return { world, info: stampTower(world) };
}

describe('stampTower', () => {
  const { world, info } = build();

  it('writes only inside the footprint, and never at or above the top of the world', () => {
    const before = flat();
    const sets: Array<[number, number, number]> = [];
    const spy = vi.spyOn(before, 'set');
    spy.mockImplementation(function (this: World, x: number, y: number, z: number, id: BlockId) {
      sets.push([x, y, z]);
      return World.prototype.set.call(this, x, y, z, id);
    });
    stampTower(before);
    spy.mockRestore();
    expect(sets.length).toBeGreaterThan(100);
    for (const [x, y, z] of sets) {
      expect(inFootprint(x, z), `${x},${y},${z}`).toBe(true);
      expect(y).toBeGreaterThanOrEqual(1);
      expect(y).toBeLessThan(WORLD.y);
    }
    const a = snapshot(flat());
    const b = snapshot(world);
    let i = 0;
    for (let y = 0; y < WORLD.y; y++) for (let z = 0; z < WORLD.z; z++) for (let x = 0; x < WORLD.x; x++, i++) {
      if (a[i] !== b[i]) expect(inFootprint(x, z), `${x},${y},${z}`).toBe(true);
    }
  });

  it('is 11 blocks tall from its floor, with a Lamp as the very top block', () => {
    let top = -1;
    for (let x = r.x0; x <= r.x1; x++) for (let z = r.z0; z <= r.z1; z++) {
      for (let y = WORLD.y - 1; y >= 0; y--) if (world.get(x, y, z) !== BlockId.Air) { top = Math.max(top, y); break; }
    }
    expect(world.get(r.x0 + 3, G, r.z0 + 3)).toBe(BlockId.Planks);
    expect(top - G + 1).toBe(11);
    expect(top).toBe(WORLD.y - 1);
    expect(info.topLamp[1]).toBe(top);
    expect(world.get(...info.topLamp)).toBe(BlockId.Lamp);
    // The lamp is the only block on the top layer's centre column above the roof.
    expect(world.get(info.topLamp[0], top - 1, info.topLamp[2])).toBe(BlockId.RoofTile);
  });

  it('fills Dirt under the floor and clears everything above it', () => {
    for (let x = r.x0; x <= r.x1; x++) for (let z = r.z0; z <= r.z1; z++) {
      for (let y = 1; y < G; y++) expect(solid(world, x, y, z), `${x},${y},${z}`).toBe(true);
    }
    const tall = flat(G);
    for (let x = r.x0; x <= r.x1; x++) for (let z = r.z0; z <= r.z1; z++) for (let y = G + 1; y < WORLD.y; y++) tall.set(x, y, z, BlockId.Leaves);
    const again = stampTower(tall);
    for (const floor of again.floors) {
      for (const [x, y, z] of floor.cells) {
        expect(tall.get(x, y, z)).toBe(BlockId.Air);
        expect(tall.get(x, y + 1, z)).toBe(BlockId.Air);
      }
    }
    for (let x = r.x0; x <= r.x1; x++) for (let z = r.z0; z <= r.z1; z++) for (let y = 0; y < WORLD.y; y++) {
      expect(tall.get(x, y, z)).not.toBe(BlockId.Leaves);
    }
  });

  it('has two rooms, each at least 3 high, whose floor cells have 2 air above', () => {
    expect(info.floors).toHaveLength(2);
    const [ground, star] = info.floors;
    expect(ground.y).toBe(G + 1);
    expect(star.y).toBeGreaterThan(ground.y);
    for (const floor of info.floors) {
      expect(floor.ceilingY - floor.y).toBeGreaterThanOrEqual(3);
      expect(floor.cells.length).toBeGreaterThanOrEqual(20);
      for (const cell of floor.cells) {
        expect(cell[1]).toBe(floor.y);
        expect(isStandable(world, cell), cell.join()).toBe(true);
        for (let y = floor.y; y < floor.ceilingY; y++) expect(world.get(cell[0], y, cell[2])).toBe(BlockId.Air);
        expect(solid(world, cell[0], floor.ceilingY, cell[2]), `ceiling over ${cell.join()}`).toBe(true);
      }
    }
  });

  it('door gap is 2 wide and 3 high on the north wall, with DoorFrame jambs and lintel', () => {
    expect(TOWER_PLAN.facing).toBe('north');
    expect(info.doorCells).toHaveLength(2);
    for (const [x, y, z] of info.doorCells) {
      expect(z).toBe(r.z0);
      expect(y).toBe(G + 1);
      for (let dy = 0; dy < 3; dy++) expect(world.get(x, y + dy, z)).toBe(BlockId.Air);
      expect(world.get(x, y + 3, z)).toBe(BlockId.DoorFrame);
    }
    const xs = info.doorCells.map(c => c[0]).sort((a, b) => a - b);
    expect(xs[1] - xs[0]).toBe(1);
    for (const jx of [xs[0] - 1, xs[1] + 1]) {
      for (let y = G + 1; y <= G + 4; y++) expect(world.get(jx, y, r.z0)).toBe(BlockId.DoorFrame);
    }
    expect(info.doorFront).toEqual([xs[0], G + 1, r.z0 - 1]);
    expect(info.doorInside).toEqual([xs[0], G + 1, r.z0 + 1]);
    expect(isStandable(world, info.doorFront)).toBe(true);
    expect(isStandable(world, info.doorInside)).toBe(true);
  });

  it('windows are Glass: 2×2 on the east and west walls downstairs, on all four walls upstairs', () => {
    for (const [x, y, z] of info.windowCells) expect(world.get(x, y, z)).toBe(BlockId.Glass);
    const [ground, star] = info.floors;
    const wallsOf = (y0: number, y1: number): Set<string> => {
      const walls = new Set<string>();
      for (const [x, y, z] of info.windowCells) {
        if (y < y0 || y > y1) continue;
        walls.add(x === r.x0 ? 'west' : x === r.x1 ? 'east' : z === r.z0 ? 'north' : z === r.z1 ? 'south' : 'none');
      }
      return walls;
    };
    expect([...wallsOf(ground.y, ground.ceilingY - 1)].sort()).toEqual(['east', 'west']);
    expect([...wallsOf(star.y, star.ceilingY - 1)].sort()).toEqual(['east', 'north', 'south', 'west']);
    expect(info.windowCells).toHaveLength(2 * 4 + 4 * 4);
  });

  it('is never dark inside: at least 2 Lamps light each room', () => {
    for (const floor of info.floors) {
      const lamps = info.lampCells.filter(([x, y, z]) => y === floor.ceilingY && world.get(x, y, z) === BlockId.Lamp
        && x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1);
      expect(lamps.length, `room at ${floor.y}`).toBeGreaterThanOrEqual(2);
    }
  });

  it('the stair is single-block steps: A* from the door reaches every star-room cell and back', () => {
    expect(info.stairCells).toHaveLength(4);
    for (let i = 1; i < info.stairCells.length; i++) {
      expect(info.stairCells[i][1] - info.stairCells[i - 1][1]).toBe(1);
      expect(isStandable(world, info.stairCells[i])).toBe(true);
    }
    const [ground, star] = info.floors;
    for (const cell of [...ground.cells, ...star.cells]) {
      expect(findPath(world, info.doorInside, cell, 20000), `up to ${cell.join()}`).not.toBeNull();
      expect(findPath(world, cell, info.doorFront, 20000), `back from ${cell.join()}`).not.toBeNull();
    }
  });

  it('no standable cell inside has less than 2 air above it', () => {
    for (let x = r.x0 + 1; x < r.x1; x++) for (let z = r.z0 + 1; z < r.z1; z++) {
      for (let y = G + 1; y < WORLD.y; y++) {
        if (!solid(world, x, y - 1, z) || solid(world, x, y, z)) continue;
        // Any air cell with a floor under it inside the walls is a place to stand: it must fit him.
        expect(solid(world, x, y + 1, z), `${x},${y},${z}`).toBe(false);
      }
    }
  });

  it('the wizard spot is a ground-floor cell off the door line and off the stair', () => {
    const ground = info.floors[0];
    expect(ground.cells.some(c => same(c, info.wizardSpot))).toBe(true);
    const doorXs = info.doorCells.map(c => c[0]);
    expect(doorXs).not.toContain(info.wizardSpot[0]);
    for (const s of info.stairCells) expect([s[0], s[2]]).not.toEqual([info.wizardSpot[0], info.wizardSpot[2]]);
    expect(isStandable(world, info.wizardSpot)).toBe(true);
  });

  it('greetRect covers the footprint plus 3 cells in front of the door', () => {
    expect(info.greetRect).toEqual({ x0: r.x0, z0: r.z0 - 3, x1: r.x1, z1: r.z1 });
    expect(info.rect).toEqual(r);
    expect(info.interior).toEqual({ x0: r.x0 + 1, z0: r.z0 + 1, x1: r.x1 - 1, z1: r.z1 - 1 });
    expect(info.groundY).toBe(G);
  });

  it('the beacon sits above the middle of the roof, above the world', () => {
    expect(info.beacon.x).toBeCloseTo((r.x0 + r.x1 + 1) / 2);
    expect(info.beacon.z).toBeCloseTo((r.z0 + r.z1 + 1) / 2);
    expect(info.beacon.y).toBeGreaterThan(WORLD.y);
  });

  it('is deterministic: stamping twice gives byte-identical worlds', () => {
    const again = build();
    expect(snapshot(again.world)).toEqual(snapshot(world));
    expect(again.info).toEqual(info);
    const twice = flat();
    stampTower(twice);
    stampTower(twice);
    expect(snapshot(twice)).toEqual(snapshot(world));
  });

  it('writes no Water and no block outside the friendly set', () => {
    const allowed = new Set([BlockId.Air, BlockId.Planks, BlockId.Stone, BlockId.Glass, BlockId.DoorFrame, BlockId.RoofTile, BlockId.Lamp, BlockId.Dirt, BlockId.Grass, BlockId.Bedrock]);
    for (let x = r.x0; x <= r.x1; x++) for (let z = r.z0; z <= r.z1; z++) for (let y = 0; y < WORLD.y; y++) {
      const id = world.get(x, y, z);
      expect(allowed.has(id), `${x},${y},${z}: ${id}`).toBe(true);
    }
  });
});
