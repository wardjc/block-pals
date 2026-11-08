import { describe, expect, it } from 'vitest';
import { BLOCKS, BlockId } from '../../src/core/blocks';
import {
  DOOR_HEIGHT, DOOR_WIDTH, INTERIOR_HEIGHT, stampHouse,
  type Facing, type HouseInfo, type HouseSpec,
} from '../../src/core/houses';
import { findPath, isStandable, smoothPath, type Cell } from '../../src/core/pathfind';
import { World } from '../../src/core/world';
import { Player } from '../../src/game/player';

const G = 5;

function flat(): World {
  const world = new World(40, 20, 40);
  for (let x = 0; x < 40; x++) {
    for (let z = 0; z < 40; z++) {
      world.set(x, 0, z, BlockId.Bedrock);
      for (let y = 1; y <= G; y++) world.set(x, y, z, y === G ? BlockId.Grass : BlockId.Dirt);
    }
  }
  return world;
}

const SPECS: Array<[HouseSpec, [number, number]]> = [
  [{ id: 'bakery', rect: { x0: 10, z0: 10, x1: 18, z1: 17 }, facing: 'south', wall: BlockId.Bricks, chimney: { dx: 2, dz: 1 } }, [7, 6]],
  [{ id: 'shop', rect: { x0: 10, z0: 10, x1: 18, z1: 18 }, facing: 'south', wall: BlockId.Planks }, [7, 7]],
  [{ id: 'farmhouse', rect: { x0: 10, z0: 10, x1: 18, z1: 17 }, facing: 'north', wall: BlockId.Planks }, [7, 6]],
  [{ id: 'granny', rect: { x0: 10, z0: 10, x1: 17, z1: 17 }, facing: 'west', wall: BlockId.Planks, chimney: { dx: 2, dz: 2 } }, [6, 6]],
  [{ id: 'cottage', rect: { x0: 10, z0: 10, x1: 16, z1: 16 }, facing: 'east', wall: BlockId.Planks }, [5, 5]],
];

const FACINGS: Facing[] = ['north', 'south', 'east', 'west'];
const solid = (w: World, [x, y, z]: Cell): boolean => BLOCKS[w.get(x, y, z)].solid;

function build(spec: HouseSpec): { world: World; info: HouseInfo } {
  const world = flat();
  return { world, info: stampHouse(world, spec, G) };
}

const all: Array<[string, HouseSpec, [number, number]?]> = [
  ...SPECS.map(([s, size]): [string, HouseSpec, [number, number]] => [s.id, s, size]),
  ...FACINGS.map((facing): [string, HouseSpec] => [
    `7x7 ${facing}`, { id: 'cottage', rect: { x0: 10, z0: 10, x1: 16, z1: 16 }, facing, wall: BlockId.Planks },
  ]),
];

describe.each(all)('house %s', (_name, spec, size) => {
  const { world, info } = build(spec);
  const g = G;

  it('interior is empty and big enough', () => {
    const w = info.interior.x1 - info.interior.x0 + 1;
    const d = info.interior.z1 - info.interior.z0 + 1;
    expect(w).toBeGreaterThanOrEqual(5);
    expect(d).toBeGreaterThanOrEqual(5);
    if (size) expect([w, d]).toEqual(size);
    for (let x = info.interior.x0; x <= info.interior.x1; x++) {
      for (let z = info.interior.z0; z <= info.interior.z1; z++) {
        for (let y = g + 1; y <= g + INTERIOR_HEIGHT; y++) expect(world.get(x, y, z)).toBe(BlockId.Air);
      }
    }
  });

  it('door gap is 2 wide and 3 high with a frame', () => {
    expect(info.doorCells).toHaveLength(DOOR_WIDTH);
    const alongX = spec.facing === 'north' || spec.facing === 'south';
    for (const [x, y, z] of info.doorCells) {
      for (let dy = 0; dy < DOOR_HEIGHT; dy++) expect(world.get(x, y + dy, z)).toBe(BlockId.Air);
      expect(world.get(x, y + DOOR_HEIGHT, z)).toBe(BlockId.DoorFrame);
    }
    const [a, b] = info.doorCells;
    const step = alongX ? [1, 0] : [0, 1];
    const before: Cell = [a[0] - step[0], g + 1, a[2] - step[1]];
    const after: Cell = [b[0] + step[0], g + 1, b[2] + step[1]];
    for (const c of [before, after]) {
      for (let dy = 0; dy <= DOOR_HEIGHT; dy++) expect(world.get(c[0], c[1] + dy, c[2])).toBe(BlockId.DoorFrame);
    }
  });

  it('door fits player and Pip', () => {
    for (const cell of [...info.doorCells, info.doorFront, info.doorInside]) {
      expect(isStandable(world, cell)).toBe(true);
    }
    const path = findPath(world, info.doorFront, info.doorInside);
    expect(path).not.toBeNull();
    expect(path!.some(c => info.doorCells.some(d => d[0] === c[0] && d[2] === c[2]))).toBe(true);
    // The smoothed route Pip walks must keep its body radius clear of the jambs too.
    const smooth = smoothPath(world, path!, info.doorFront);
    expect(smooth.length).toBeGreaterThan(0);
    expect(smooth[smooth.length - 1]).toEqual(info.doorInside);
  });

  it('walks in with the stick from 8 headings', () => {
    const outward = [info.doorFront[0] - info.doorCells[0][0], info.doorFront[2] - info.doorCells[0][2]];
    for (let h = 0; h < 8; h++) {
      const angle = h * Math.PI / 4;
      const dir = [Math.round(Math.cos(angle)), Math.round(Math.sin(angle))];
      // Approach from outside only: the direction must not point into the house.
      if (dir[0] * outward[0] + dir[1] * outward[1] < 0) continue;
      const start: Cell = [info.doorFront[0] + dir[0] * 3, g + 1, info.doorFront[2] + dir[1] * 3];
      if (!isStandable(world, start)) continue;
      const player = new Player({ x: start[0] + 0.5, y: start[1], z: start[2] + 0.5 });
      for (let tick = 0; tick < 240; tick++) {
        // Aim at the door first (as a tap-walk would), then at the inside cell.
        const phase = tick < 120 ? info.doorFront : info.doorInside;
        const dx = phase[0] + 0.5 - player.pos.x;
        const dz = phase[2] + 0.5 - player.pos.z;
        if (Math.hypot(dx, dz) < 0.2) player.setStick(0, 0); else player.setStick(dx, dz);
        player.update(world, 1 / 60);
        expect(solid(world, player.feetCell())).toBe(false);
      }
      const [px, , pz] = player.feetCell();
      expect(px).toBeGreaterThanOrEqual(info.interior.x0);
      expect(px).toBeLessThanOrEqual(info.interior.x1);
      expect(pz).toBeGreaterThanOrEqual(info.interior.z0);
      expect(pz).toBeLessThanOrEqual(info.interior.z1);
    }
  });

  it('whole floor is connected', () => {
    for (const cell of info.floor) {
      expect(isStandable(world, cell)).toBe(true);
      expect(findPath(world, info.doorInside, cell)).not.toBeNull();
    }
  });

  it('is bright inside', () => {
    const lit = info.lampCells.filter(([x, y, z]) => world.get(x, y, z) === BlockId.Lamp && world.get(x, y - 1, z) === BlockId.Air);
    expect(lit.length).toBeGreaterThanOrEqual(2);
    expect(info.windowCells.filter(([x, y, z]) => world.get(x, y, z) === BlockId.Glass).length).toBeGreaterThanOrEqual(2);
    for (const [x, y, z] of info.lampCells) expect(isStandable(world, [x, y, z])).toBe(false);
  });

  it('roof does not overhang and the ceiling is closed', () => {
    const r = spec.rect;
    for (let x = 0; x < 40; x++) {
      for (let z = 0; z < 40; z++) {
        if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) continue;
        for (let y = g + 1; y < 20; y++) {
          expect(world.get(x, y, z)).toBe(BlockId.Air);
        }
      }
    }
    for (let x = info.interior.x0; x <= info.interior.x1; x++) {
      for (let z = info.interior.z0; z <= info.interior.z1; z++) expect(solid(world, [x, g + 5, z])).toBe(true);
    }
  });

  it('npc spot is standable, inside and off the door line', () => {
    expect(isStandable(world, info.npcSpot)).toBe(true);
    const [x, , z] = info.npcSpot;
    expect(x >= info.interior.x0 && x <= info.interior.x1 && z >= info.interior.z0 && z <= info.interior.z1).toBe(true);
    const onLine = info.doorCells.some(d => d[0] === x || d[2] === z);
    expect(onLine).toBe(false);
  });

  it('greet rect holds the interior and the door front', () => {
    const r = info.greetRect;
    const has = (x: number, z: number): boolean => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
    expect(has(info.interior.x0, info.interior.z0) && has(info.interior.x1, info.interior.z1)).toBe(true);
    expect(has(info.doorFront[0], info.doorFront[2])).toBe(true);
  });

  it('stays within g + 9', () => {
    let top = 0;
    for (let x = 0; x < 40; x++) for (let z = 0; z < 40; z++) for (let y = 0; y < 20; y++) {
      if (world.get(x, y, z) !== BlockId.Air && y > top) top = y;
    }
    expect(top).toBeLessThanOrEqual(g + 9);
  });
});

describe('stamp on uneven ground', () => {
  it('fills dirt under the floor and clears above', () => {
    const world = flat();
    world.set(12, G + 1, 12, BlockId.Wood);
    for (let y = 1; y < G; y++) world.set(11, y, 11, BlockId.Air);
    stampHouse(world, SPECS[4][0], G);
    expect(world.get(12, G + 1, 12)).toBe(BlockId.Air);
    for (let y = 1; y < G; y++) expect(world.get(11, y, 11)).toBe(BlockId.Dirt);
  });
});
