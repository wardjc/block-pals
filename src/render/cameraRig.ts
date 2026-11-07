import type { World } from '../core/world';
import { blocksRay, castVoxelRay, type VoxelHit } from './voxelRay';

/**
 * The smart third-person camera (spec §7c). Pure maths, no Three.js, so it is unit-tested in Node.
 *
 * The camera orbits the player's eye at (yaw, pitch). Yaw uses the player's heading convention
 * (radians from +z towards +x); pitch is how far the view looks below the horizon. He turns it by
 * dragging (or with a pad's second stick) and it stays where he left it.
 *
 * Every frame a ray goes from the eye back towards where the camera wants to be. If a block is in
 * the way the camera snaps in front of it at once, then glides back out when the way is clear.
 * Below CLOSE_DISTANCE it eases to the eye (first person) and hides the player model until the
 * camera has glided beyond CLOSE_EXIT_DISTANCE.
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const MAX_DISTANCE = 7;
export const DEFAULT_PITCH = 0.5; // ≈ 29° down, close to the v1 view (6 back, 4.5 up)
export const PITCH_MIN = -0.15; // slightly above the horizon
export const PITCH_MAX = (70 * Math.PI) / 180;
export const CLOSE_DISTANCE = 1.2;
export const CLOSE_EXIT_DISTANCE = 1.6;
/**
 * The player model is hidden while the camera is within this distance of his head (a back-view of a
 * body 2 blocks in front fills the middle of the screen in a 5×5 room), and shown again beyond
 * MODEL_SHOW_DISTANCE so it never flickers at the edge.
 */
export const MODEL_HIDE_DISTANCE = 2.0;
export const MODEL_SHOW_DISTANCE = 2.4;
/** Pip is hidden when the camera is this close to him, or when he is this close and near the view's middle. */
export const PIP_HIDE_DISTANCE = 1.2;
export const PIP_SHOW_DISTANCE = 1.6;
export const PIP_CENTRE_DISTANCE = 3;
export const PIP_CENTRE_COS = 0.92; // about 23° from the view's centre line
export const PIP_CENTRE_COS_EXIT = 0.85;

/** Whether Pip should be drawn: false while he would fill the corner or the middle of the view. */
export function pipHiddenFor(cam: Vec3, forward: Vec3, pip: Vec3, wasHidden: boolean): boolean {
  const dx = pip.x - cam.x, dy = pip.y + 0.4 - cam.y, dz = pip.z - cam.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < (wasHidden ? PIP_SHOW_DISTANCE : PIP_HIDE_DISTANCE)) return true;
  if (dist < (wasHidden ? PIP_CENTRE_DISTANCE + 0.5 : PIP_CENTRE_DISTANCE)) {
    const cos = (dx * forward.x + dy * forward.y + dz * forward.z) / dist;
    if (cos > (wasHidden ? PIP_CENTRE_COS_EXIT : PIP_CENTRE_COS)) return true;
  }
  return false;
}
/** Gap kept between the camera and the first block behind it. */
export const CAMERA_MARGIN = 0.2;
/** The camera point keeps at least this far from any block face, so the near plane never cuts one. */
export const CAMERA_CLEARANCE = 0.12;
/** A drag across the whole screen width turns the view by 240°. */
export const DRAG_RADIANS_PER_WIDTH = (240 * Math.PI) / 180;
/** Pad second stick at full tilt, radians per second. */
export const PAD_YAW_RATE = 2.5;
export const PAD_PITCH_RATE = 1.5;
/** Glide-out time constant (s): about 95 % of the way back out in 0.36 s. */
export const EASE_OUT_SECONDS = 0.12;

const CLEARANCE_ITERATIONS = 8;

/** Unit look direction for (yaw, pitch), written into `out`. */
export function lookDir(yaw: number, pitch: number, out: Vec3): Vec3 {
  const c = Math.cos(pitch);
  out.x = Math.sin(yaw) * c;
  out.y = -Math.sin(pitch);
  out.z = Math.cos(yaw) * c;
  return out;
}

const hit: VoxelHit = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, t: 0 };

/** Distance from p to the nearest solid block among the 27 cells around it (capped at 1). */
function clearance(world: World, px: number, py: number, pz: number): number {
  const cx = Math.floor(px), cy = Math.floor(py), cz = Math.floor(pz);
  let best = 1;
  for (let y = cy - 1; y <= cy + 1; y++) for (let z = cz - 1; z <= cz + 1; z++) for (let x = cx - 1; x <= cx + 1; x++) {
    if (!world.inBounds(x, y, z) || !blocksRay(world.get(x, y, z))) continue;
    const ex = Math.max(x - px, 0, px - (x + 1));
    const ey = Math.max(y - py, 0, py - (y + 1));
    const ez = Math.max(z - pz, 0, pz - (z + 1));
    const d = Math.hypot(ex, ey, ez);
    if (d < best) best = d;
  }
  return best;
}

/**
 * How far back from `eye` (against the unit look direction `dir`) the camera may sit, up to
 * maxDist: in front of the first block behind, by CAMERA_MARGIN, and CAMERA_CLEARANCE from every
 * block face. 0 means "at the eye".
 */
export function clampDistance(world: World, eye: Vec3, dir: Vec3, maxDist: number): number {
  const bx = -dir.x, by = -dir.y, bz = -dir.z;
  let d = maxDist;
  if (castVoxelRay(world, eye.x, eye.y, eye.z, bx, by, bz, maxDist, false, hit)) {
    if (hit.t === 0) return 0; // the eye itself is in a block
    d = Math.min(d, hit.t - CAMERA_MARGIN);
  }
  if (d <= 0) return 0;
  if (clearance(world, eye.x + bx * d, eye.y + by * d, eye.z + bz * d) >= CAMERA_CLEARANCE) return d;

  // Keep a tested safe endpoint, with at most 7 / 256 blocks of search uncertainty.
  // The eye (close mode) skips clearance: player collision radius must be >= 0.12 blocks.
  let safe = 0;
  let blocked = d;
  for (let i = 0; i < CLEARANCE_ITERATIONS; i++) {
    const mid = (safe + blocked) / 2;
    if (clearance(world, eye.x + bx * mid, eye.y + by * mid, eye.z + bz * mid) >= CAMERA_CLEARANCE) {
      safe = mid;
    } else {
      blocked = mid;
    }
  }
  return safe;
}

export class CameraRig {
  yaw = 0;
  pitch = DEFAULT_PITCH;
  /** Drawn distance from the eye; eases to 0 in close mode. */
  distance = MAX_DISTANCE;
  /** Camera position and unit look direction after the last update (reused objects). */
  readonly position: Vec3 = { x: 0, y: 0, z: 0 };
  readonly forward: Vec3 = lookDir(0, DEFAULT_PITCH, { x: 0, y: 0, z: 0 });
  private started = false;
  private closeMode = false;
  private modelGone = false;

  /** Latched first-person state, including the glide away from the player's head. */
  get close(): boolean {
    return this.closeMode;
  }

  /** True while the player model should not be drawn (camera at or near his head). */
  get modelHidden(): boolean {
    return this.modelGone;
  }

  /** A finger drag of (dx, dy) CSS px on a screen widthPx wide. Right turns right, down looks down. */
  drag(dx: number, dy: number, widthPx: number): void {
    const k = DRAG_RADIANS_PER_WIDTH / Math.max(1, widthPx);
    this.setAngles(this.yaw - dx * k, this.pitch + dy * k);
  }

  /** A pad second stick (each axis -1..1, up is negative) held for dt seconds. */
  turn(lx: number, ly: number, dt: number): void {
    this.setAngles(this.yaw - lx * PAD_YAW_RATE * dt, this.pitch + ly * PAD_PITCH_RATE * dt);
  }

  private setAngles(yaw: number, pitch: number): void {
    if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return;
    this.yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    this.pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, pitch));
  }

  /** Places the camera for this frame around `eye` (the player's head). */
  update(world: World, eye: Vec3, dt: number): void {
    const f = lookDir(this.yaw, this.pitch, this.forward);
    const allowed = clampDistance(world, eye, f, MAX_DISTANCE);
    if (allowed < CLOSE_DISTANCE) this.closeMode = true;
    const target = this.closeMode && allowed <= CLOSE_EXIT_DISTANCE ? 0 : allowed;
    if (!this.started) {
      this.distance = target;
      this.started = true;
    } else {
      // Obstructions still pull in at once; the extra move to/from the eye is eased.
      this.distance = Math.min(this.distance, allowed);
      const a = 1 - Math.exp(-Math.max(0, dt) / EASE_OUT_SECONDS);
      this.distance += (target - this.distance) * a;
      if (Math.abs(target - this.distance) < 1e-3) this.distance = target;
    }
    // Keep the model hidden during the glide out, until the drawn camera is clear of it.
    if (this.distance > CLOSE_EXIT_DISTANCE) this.closeMode = false;
    const d = this.distance;
    this.modelGone = this.closeMode || d < (this.modelGone ? MODEL_SHOW_DISTANCE : MODEL_HIDE_DISTANCE);
    this.position.x = eye.x - f.x * d;
    this.position.y = eye.y - f.y * d;
    this.position.z = eye.z - f.z * d;
  }
}
