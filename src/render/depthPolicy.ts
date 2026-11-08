import { CULL_MARGIN, FOG_FAR } from './chunkCull';

/** Nothing past the fog (plus the chunk-cull slack) is ever drawn, so the far plane sits just beyond it. */
export const CAMERA_FAR = FOG_FAR + CULL_MARGIN + 2.5;
/** Closest near plane: only for squeezing through a one-block tunnel (the camera keeps 0.12 off every wall). */
export const NEAR_MIN = 0.05;
/** Near plane in the open. Pushing it out is what keeps a mobile 16-bit depth buffer from flickering thin parts. */
export const NEAR_MAX = 0.2;
/** The near plane stays this fraction of the distance to the closest block, so it never slices one. */
const NEAR_CLEARANCE_FRACTION = 0.8;

/** Near plane for a camera that is `clearance` blocks from the nearest solid block (clearance is capped at 1). */
export function cameraNear(clearance: number): number {
  return Math.min(NEAR_MAX, Math.max(NEAR_MIN, clearance * NEAR_CLEARANCE_FRACTION));
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
