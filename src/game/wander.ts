import type { Rect } from '../core/houses';
import { canStep, isStandable, type Cell } from '../core/pathfind';
import type { World } from '../core/world';

/**
 * The wandering core shared by the farm animals (src/game/animals.ts) and the grumps and friends.
 * Extracted from the herd without changing its behaviour: the herd calls these pieces in the same
 * order with the same random draws. Pure and DOM-free.
 */
export interface Walker {
  x: number;
  y: number;
  z: number;
  heading: number;
  stuckFor: number;
}

export interface WanderRules {
  roam: Rect;
  /** Blocks per second. */
  speed: number;
  /** Target distance range in cells. */
  hop: [number, number];
  /** Cells other entities or avoided places occupy. */
  blocked(cell: Cell): boolean;
  /** Extra veto for a whole move (personal space): from and to are the walker's own position and the next one. */
  /** Cells a rescue may not lift the walker into (defaults to `blocked`). */
  rescueBlocked?(cell: Cell): boolean;
  /** Heights (feet level, inclusive) a rescue may lift the walker to: keeps it off low cave levels. */
  band?: { min: number; max: number };
  allow?(from: { x: number; z: number }, to: { x: number; z: number }): boolean;
}

export const HEIGHTS = [0, 1, -1] as const;
export const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
/** A walker stuck this long is lifted to a free standable cell (an instant, gentle hop). */
export const RESCUE_SECONDS = 6;

const from: Cell = [0, 0, 0];
const to: Cell = [0, 0, 0];

export const insideRect = (r: Rect, x: number, z: number): boolean => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;

/**
 * Choose a standable target 'minD' to 'maxD' blocks away (16 tries, same two random draws each as
 * the herd always used). Returns it as cell centres, or null.
 */
export function pickTarget(
  w: Walker, world: World, rng: () => number, allowed: (c: Cell) => boolean, minD: number, maxD: number,
): { x: number; z: number } | null {
  for (let i = 0; i < 16; i++) {
    const angle = rng() * Math.PI * 2;
    const distance = minD + rng() * (maxD - minD);
    const x = Math.floor(w.x + Math.cos(angle) * distance);
    const z = Math.floor(w.z + Math.sin(angle) * distance);
    const d = Math.hypot(x + 0.5 - w.x, z + 0.5 - w.z);
    if (d < minD || d > maxD) continue;
    for (const dy of HEIGHTS) {
      to[0] = x; to[1] = w.y + dy; to[2] = z;
      if (!allowed(to) || !isStandable(world, to)) continue;
      return { x: x + 0.5, z: z + 0.5 };
    }
  }
  return null;
}

/**
 * One constant-length move towards (tx, tz). Every crossed cell is checked before the whole move is
 * committed. `veto` may refuse a sample point (the herd uses it to keep clear of him).
 */
export function moveToward(
  w: Walker, world: World, allowed: (c: Cell) => boolean, tx: number, tz: number, speed: number, dt: number,
  veto?: (x: number, z: number) => boolean,
): 'moved' | 'arrived' | 'blocked' {
  const dx = tx - w.x, dz = tz - w.z;
  const distance = Math.hypot(dx, dz), step = speed * dt;
  if (distance < step || distance < 1e-8) return 'arrived';
  const nx = w.x + dx / distance * step, nz = w.z + dz / distance * step;
  const samples = Math.max(1, Math.ceil(step / 0.2));
  from[0] = Math.floor(w.x); from[1] = w.y; from[2] = Math.floor(w.z);
  for (let i = 1; i <= samples; i++) {
    const x = w.x + (nx - w.x) * i / samples, z = w.z + (nz - w.z) * i / samples;
    if (veto && veto(x, z)) return 'blocked';
    to[0] = Math.floor(x); to[2] = Math.floor(z);
    if (to[0] === from[0] && to[2] === from[2]) continue;
    let valid = false;
    for (const dy of HEIGHTS) {
      to[1] = from[1] + dy;
      if (canStep(world, from, to, allowed)) { valid = true; break; }
    }
    if (!valid) return 'blocked';
    from[0] = to[0]; from[1] = to[1]; from[2] = to[2];
  }
  w.x = nx; w.y = from[1]; w.z = nz;
  w.heading = Math.atan2(dx, dz);
  w.stuckFor = 0;
  return 'moved';
}

/** The neighbouring cell (8 around, same level, up a step or down a step) closest to the target, if any can be stepped to. */
export function bestNeighbour(
  w: Walker, world: World, allowed: (c: Cell) => boolean, tx: number, tz: number, skip?: (c: Cell) => boolean,
): Cell | null {
  from[0] = Math.floor(w.x); from[1] = w.y; from[2] = Math.floor(w.z);
  let best: Cell | null = null, score = Infinity;
  for (const [dx, dz] of NEIGHBOURS) for (const dy of HEIGHTS) {
    to[0] = from[0] + dx; to[1] = w.y + dy; to[2] = from[2] + dz;
    if (skip && skip(to)) continue;
    if (!canStep(world, from, to, allowed)) continue;
    const d = Number.isFinite(tx) ? Math.hypot(to[0] + 0.5 - tx, to[2] + 0.5 - tz) : 0;
    if (d < score) { best = [...to]; score = d; }
    break;
  }
  return best;
}

/** The nearest free standable cell in the roam rectangle, preferring the walker's own level; `free` says which cells are open. */
export function nearestFree(
  world: World, roam: Rect, free: (c: Cell) => boolean, x: number, y: number, z: number, self?: Walker, avoid?: Set<string> | null, band?: { min: number; max: number },
): Cell | null {
  const cx = Math.max(roam.x0, Math.min(roam.x1, Math.floor(x)));
  const cz = Math.max(roam.z0, Math.min(roam.z1, Math.floor(z)));
  const radius = Math.max(cx - roam.x0, roam.x1 - cx, cz - roam.z0, roam.z1 - cz);
  for (let level = 0; level <= world.sizeY; level++) {
    const cy = level === 0 ? Math.floor(y) : level;
    if (band && (cy < band.min || cy > band.max)) continue;
    if (level !== 0 && cy === Math.floor(y)) continue;
    for (let r = 0; r <= radius; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const c: Cell = [cx + dx, cy, cz + dz];
        if (self && c[0] === Math.floor(self.x) && c[1] === self.y && c[2] === Math.floor(self.z)) continue;
        if (avoid?.has(c.join(','))) continue;
        if (free(c) && isStandable(world, c)) return c;
      }
    }
  }
  return null;
}

/** Lift a stuck walker to the nearest free standable cell. False (and no change) when there is none. */
export function rescue(w: Walker, world: World, roam: Rect, blocked: (c: Cell) => boolean, band?: { min: number; max: number }): boolean {
  const c = nearestFree(world, roam, cell => insideRect(roam, cell[0], cell[2]) && !blocked(cell), w.x, w.y, w.z, w, null, band);
  if (!c) return false;
  w.x = c[0] + 0.5; w.y = c[1]; w.z = c[2] + 0.5;
  w.stuckFor = 0;
  return true;
}

/**
 * One greedy wander step: head for the target (choosing a new one when none), side-step when blocked,
 * rescue after RESCUE_SECONDS stuck. Deterministic for a given rng and inputs.
 */
export function stepWander(
  w: Walker, target: { x: number; z: number } | null, rules: WanderRules, world: World, rng: () => number, dt: number,
): { target: { x: number; z: number } | null; moved: boolean } {
  const allowed = (c: Cell): boolean => insideRect(rules.roam, c[0], c[2]) && !rules.blocked(c);
  let t = target;
  const [minD, maxD] = rules.hop;
  if (!t) t = pickTarget(w, world, rng, allowed, minD, maxD);
  let moved = false;
  if (t) {
    const veto = rules.allow ? (x: number, z: number): boolean => !rules.allow!(w, { x, z }) : undefined;
    const r = moveToward(w, world, allowed, t.x, t.z, rules.speed, dt, veto);
    if (r === 'moved') moved = true;
    else if (r === 'arrived') { t = null; w.stuckFor = 0; }
    else {
      t = null; // blocked: choose again next step
      const side = bestNeighbour(w, world, allowed, NaN, NaN);
      if (side) w.stuckFor = 0; else w.stuckFor += dt;
    }
  } else {
    w.stuckFor += dt;
  }
  if (w.stuckFor >= RESCUE_SECONDS && rescue(w, world, rules.roam, rules.rescueBlocked ?? rules.blocked, rules.band)) t = null;
  return { target: t, moved };
}
