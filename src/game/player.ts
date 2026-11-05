import { canStep, isStandable, type Cell } from '../core/pathfind';
import type { World } from '../core/world';

const SPEED = 3.5;
const MAX_STEP = 0.2;
const EPSILON = 1e-8;

export class Player {
  // Feet position in world units. Cell centres are at x + 0.5 and z + 0.5.
  pos: { x: number; y: number; z: number };
  // Radians from +z towards +x, pointing in the direction of travel.
  heading = 0;
  private path: Cell[] = [];
  private waypoint = 0;
  private stick = { x: 0, z: 0 };

  constructor(spawn: { x: number; y: number; z: number }) {
    this.pos = { ...spawn };
  }

  feetCell(): Cell {
    return [Math.floor(this.pos.x), Math.floor(this.pos.y), Math.floor(this.pos.z)];
  }

  setPath(path: Cell[] | null): void {
    this.path = path?.map(cell => [...cell] as Cell) ?? [];
    this.waypoint = 0;
    this.stick = { x: 0, z: 0 };
  }

  setStick(dx: number, dz: number): void {
    if (!Number.isFinite(dx) || !Number.isFinite(dz)) return;
    const scale = Math.max(1, Math.hypot(dx, dz));
    this.stick = { x: dx / scale, z: dz / scale };
    if (dx !== 0 || dz !== 0) {
      this.path = [];
      this.waypoint = 0;
    }
  }

  update(world: World, dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0 || !isStandable(world, this.feetCell())) return;
    let remaining = SPEED * dt;
    if (this.stick.x !== 0 || this.stick.z !== 0) {
      const magnitude = Math.hypot(this.stick.x, this.stick.z);
      remaining *= magnitude;
      while (remaining > EPSILON) {
        const distance = Math.min(MAX_STEP, remaining);
        if (!this.move(world, this.stick.x / magnitude * distance, this.stick.z / magnitude * distance)) break;
        remaining -= distance;
      }
      return;
    }

    while (remaining > EPSILON && this.waypoint < this.path.length) {
      const target = this.path[this.waypoint];
      const current = this.feetCell();
      const sameCell = current.every((value, i) => value === target[i]);
      if (!this.insideWall(world, target)
        || (!sameCell && !canStep(world, current, target))) {
        this.path = [];
        break;
      }
      const dx = target[0] + 0.5 - this.pos.x;
      const dz = target[2] + 0.5 - this.pos.z;
      const distance = Math.hypot(dx, dz);
      if (distance < EPSILON) {
        this.waypoint++;
        continue;
      }
      const step = Math.min(MAX_STEP, remaining, distance);
      if (!this.move(world, dx / distance * step, dz / distance * step)) {
        this.path = [];
        break;
      }
      remaining -= step;
      if (step === distance) {
        this.pos.x = target[0] + 0.5;
        this.pos.z = target[2] + 0.5;
        this.waypoint++;
      }
    }
  }

  private insideWall(world: World, [x, , z]: Cell): boolean {
    return x >= 1 && x <= Math.min(46, world.sizeX - 2)
      && z >= 1 && z <= Math.min(46, world.sizeZ - 2);
  }

  /** Small horizontal sweeps prevent a long frame from tunnelling through a wall. */
  private move(world: World, dx: number, dz: number): boolean {
    const x = Math.max(1, Math.min(Math.min(47, world.sizeX - 1) - EPSILON, this.pos.x + dx));
    const z = Math.max(1, Math.min(Math.min(47, world.sizeZ - 1) - EPSILON, this.pos.z + dz));
    const from = this.feetCell();
    const nextX = Math.floor(x);
    const nextZ = Math.floor(z);
    let destination: Cell | undefined;
    if (from[0] === nextX && from[2] === nextZ) {
      destination = from;
    } else {
      for (const dy of [0, 1, -1]) {
        const to: Cell = [nextX, from[1] + dy, nextZ];
        if (this.canMove(world, from, to)) {
          destination = to;
          break;
        }
      }
    }
    if (!destination || !this.insideWall(world, destination) || !isStandable(world, destination)) return false;
    const travelledX = x - this.pos.x;
    const travelledZ = z - this.pos.z;
    if (Math.hypot(travelledX, travelledZ) < EPSILON) return false;
    this.pos = { x, y: destination[1], z };
    this.heading = Math.atan2(travelledX, travelledZ);
    return true;
  }

  private canMove(world: World, from: Cell, to: Cell): boolean {
    if (from[0] === to[0] || from[2] === to[2]) return canStep(world, from, to);
    if (!isStandable(world, to)) return false;
    // Diagonal motion must clear both adjoining columns, including their ceilings.
    return [[to[0], from[2]], [from[0], to[2]]].every(([x, z]) =>
      [0, 1, -1].some(dy => {
        const side: Cell = [x, from[1] + dy, z];
        return canStep(world, from, side) && canStep(world, side, to);
      }));
  }
}
