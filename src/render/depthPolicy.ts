import { CULL_MARGIN, FOG_FAR } from './chunkCull';

/** Nothing past the fog (plus the section-cull slack) is ever drawn, so the far plane sits just beyond it. */
export const cameraFar = (fogEnd: number): number => fogEnd + CULL_MARGIN + 2.5;
/** The far plane at the shortest view (40): 44. Anything that must never be cut by the far plane reads this. */
export const CAMERA_FAR_MIN = cameraFar(FOG_FAR);
/** The far plane at the longest view (96): 100. */
export const CAMERA_FAR_MAX = cameraFar(96);
/** Kept for the step 2 and wizard code: the guaranteed far plane at any view distance (CAMERA_FAR_MIN). */
export const CAMERA_FAR = CAMERA_FAR_MIN;
/** Closest near plane: only for squeezing through a one-block tunnel (the camera keeps 0.12 off every wall). */
export const NEAR_MIN = 0.05;
/** Near plane in the open up to a 64-block view. Pushing it out is what keeps a mobile 16-bit depth buffer from flickering thin parts. */
export const NEAR_MAX = 0.2;
/** Near plane in the open at the longest view (96). */
export const NEAR_MAX_FAR = 0.25;
/** The near plane stays this fraction of the distance to the closest block, so it never slices one. */
const NEAR_CLEARANCE_FRACTION = 0.8;

/**
 * The open-air near plane for a fog end: 0.2 up to a 64-block view (today's look at Near and Medium),
 * rising linearly to 0.25 at 96, so thin parts in the far half of a long view do not z-fight.
 */
export function nearMaxFor(fogEnd: number): number {
  if (!Number.isFinite(fogEnd) || fogEnd <= 64) return NEAR_MAX;
  return NEAR_MAX + (NEAR_MAX_FAR - NEAR_MAX) * Math.min(1, (fogEnd - 64) / 32);
}

/** Near plane for a camera that is `clearance` blocks from the nearest solid block (clearance is capped at 1). */
export function cameraNear(clearance: number, nearMax: number = NEAR_MAX): number {
  return Math.min(nearMax, Math.max(NEAR_MIN, clearance * NEAR_CLEARANCE_FRACTION));
}

/** Tightening is immediate (never cut a wall); loosening eases (~0.3 s) so the view does not pop. */
export function easeNear(current: number, target: number, dt: number): number {
  if (target <= current) return target;
  return current + (target - current) * (1 - Math.exp(-dt / 0.3));
}

/**
 * Smallest world-space gap between two surfaces at view depth `z` that a depth buffer of `bits` can still tell
 * apart: dz = z^2 (1/n - 1/f) / 2^bits. Parts closer together than this flicker (z-fight).
 */
export function depthResolution(z: number, near: number, far: number, bits: number): number {
  return (z * z * (1 / near - 1 / far)) / 2 ** bits;
}

let liveCameraFar = CAMERA_FAR_MIN;

/** The far plane the scene is using now (follows the view distance); never below CAMERA_FAR_MIN. */
export function currentCameraFar(): number {
  return liveCameraFar;
}

/** Set by the scene whenever it moves the far plane. */
export function setCurrentCameraFar(far: number): void {
  liveCameraFar = Number.isFinite(far) ? Math.max(CAMERA_FAR_MIN, far) : CAMERA_FAR_MIN;
}
