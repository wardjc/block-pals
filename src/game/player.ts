import { BLOCKS } from '../core/blocks';
import { canStep, isStandable, type Cell } from '../core/pathfind';
import type { World } from '../core/world';

const SPEED = 3.5;
const MAX_STEP = 0.2;
const EPSILON = 1e-8;

/** Turn along the shortest arc, bounded by the time available this frame. */
export function easeHeading(current: number, target: number, maxDelta: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  const next = current + Math.max(-maxDelta, Math.min(maxDelta, delta));
  return Math.atan2(Math.sin(next), Math.cos(next));
}

export class Player {
  // Feet position in world units. Cell centres are at x + 0.5 and z + 0.5.
  pos: { x: number; y: number; z: number };
  // Radians from +z towards +x, pointing in the direction of travel.
  heading = 0;
  private path: Cell[] = [];
  private waypoint = 0;
  private centring = false;
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
    this.centring = false;
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
    if (!Number.isFinite(dt) || dt <= 0) return;
    if (!isStandable(world, this.feetCell()) && !this.recover(world)) return;
    let remaining = SPEED * dt;
    if (this.stick.x !== 0 || this.stick.z !== 0) {
      const magnitude = Math.hypot(this.stick.x, this.stick.z);
      remaining *= magnitude;
      while (remaining > EPSILON) {
        const distance = Math.min(MAX_STEP, remaining);
        const dx = this.stick.x / magnitude * distance;
        const dz = this.stick.z / magnitude * distance;
        const stepTime = distance / (SPEED * magnitude);
        // Blocked on a diagonal? Slide along the wall: try x alone, then z alone.
        if (!this.move(world, dx, dz, stepTime)
          && !this.move(world, dx, 0, stepTime) && !this.move(world, 0, dz, stepTime)) break;
        remaining -= distance;
      }
      return;
    }

    while (remaining > EPSILON && this.waypoint < this.path.length) {
      const target = this.path[this.waypoint];
      if (!this.insideWall(world, target) || !isStandable(world, target)) {
        this.path = [];
        break;
      }
      const dx = target[0] + 0.5 - this.pos.x;
      const dz = target[2] + 0.5 - this.pos.z;
      const distance = Math.hypot(dx, dz);
      if (distance < EPSILON) {
        this.pos.x = target[0] + 0.5;
        this.pos.z = target[2] + 0.5;
        this.waypoint++;
        continue;
      }
      const step = Math.min(MAX_STEP, remaining, distance);
      const mx = dx / distance * step;
      const mz = dz / distance * step;
      const t = step / SPEED;
      // Blocked? Slide along the wall (x then z), as the stick does; failing that, step back
      // to the cell centre once so a sub-cell start cannot leave him stopped dead.
      if (!this.move(world, mx, mz, t) && !this.move(world, mx, 0, t) && !this.move(world, 0, mz, t)) {
        const here = this.feetCell();
        const cx = here[0] + 0.5;
        const cz = here[2] + 0.5;
        if (this.centring || Math.hypot(cx - this.pos.x, cz - this.pos.z) < 0.01) {
          this.path = [];
          break;
        }
        this.centring = true;
        this.path.splice(this.waypoint, 0, here);
        continue;
      }
      remaining -= step;
      if (step === distance) {
        this.pos.x = target[0] + 0.5;
        this.pos.z = target[2] + 0.5;
        this.waypoint++;
        this.centring = false;
      }
    }
  }

  /**
   * Called when the feet cell is no longer standable (support removed, or a
   * solid placed in feet/head). Search the same column upward, then downward,
   * then nearby columns (BFS radius <= 3). Never leaves the player in a solid.
   */
  private recover(world: World): boolean {
    const [cx, cy, cz] = this.feetCell();
    const feetSolid = BLOCKS[world.get(cx, cy, cz)].solid || BLOCKS[world.get(cx, cy + 1, cz)].solid;
    const column = (x: number, z: number, from: number, up: boolean): number | null => {
      for (let y = from; y >= 0 && y < world.sizeY; y += up ? 1 : -1) {
        if (isStandable(world, [x, y, z])) return y;
      }
      return null;
    };
    let target: Cell | null = null;
    const first = column(cx, cz, cy, feetSolid) ?? column(cx, cz, cy, !feetSolid);
    if (first !== null) target = [cx, first, cz];
    for (let r = 1; r <= 3 && !target; r++) {
      let best = Infinity;
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = cx + dx;
          const z = cz + dz;
          if (!this.insideWall(world, [x, 0, z])) continue;
          for (const y of [column(x, z, cy, true), column(x, z, cy, false)]) {
            if (y === null) continue;
            const d = dx * dx + dz * dz + Math.abs(y - cy) * 4;
            if (d < best) {
              best = d;
              target = [x, y, z];
            }
          }
        }
      }
    }
    if (!target) return false;
    const sameColumn = target[0] === cx && target[2] === cz;
    this.pos = sameColumn
      ? { x: this.pos.x, y: target[1], z: this.pos.z }
      : { x: target[0] + 0.5, y: target[1], z: target[2] + 0.5 };
    this.path = [];
    this.waypoint = 0;
    return true;
  }

  private insideWall(world: World, [x, , z]: Cell): boolean {
    return x >= 1 && x <= world.sizeX - 2
      && z >= 1 && z <= world.sizeZ - 2;
  }

  /** Small horizontal sweeps prevent a long frame from tunnelling through a wall. */
  private move(world: World, dx: number, dz: number, dt: number): boolean {
    const x = Math.max(1, Math.min(world.sizeX - 1 - EPSILON, this.pos.x + dx));
    const z = Math.max(1, Math.min(world.sizeZ - 1 - EPSILON, this.pos.z + dz));
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
    this.heading = easeHeading(this.heading, Math.atan2(travelledX, travelledZ), 10 * dt);
    return true;
  }

  private canMove(world: World, from: Cell, to: Cell): boolean {
    return canStep(world, from, to, cell => this.insideWall(world, cell));
  }
}
