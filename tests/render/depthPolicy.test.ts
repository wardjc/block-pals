import { describe, expect, it } from 'vitest';
import {
  CAMERA_FAR, CAMERA_FAR_MAX, CAMERA_FAR_MIN, NEAR_MAX, NEAR_MIN, cameraFar, cameraNear, currentCameraFar, depthResolution, easeNear,
  nearMaxFor, setCurrentCameraFar,
} from '../../src/render/depthPolicy';
import { CULL_MARGIN, FOG_FAR } from '../../src/render/chunkCull';
import { CAMERA_CLEARANCE } from '../../src/render/cameraRig';

describe('camera near/far policy', () => {
  it('far ends just beyond the fog, not at 64+', () => {
    expect(CAMERA_FAR).toBeGreaterThanOrEqual(FOG_FAR + CULL_MARGIN);
    expect(CAMERA_FAR).toBeLessThanOrEqual(FOG_FAR + 10);
  });
  it('near is large in the open and small only when a wall is close', () => {
    expect(cameraNear(1)).toBe(NEAR_MAX);
    expect(cameraNear(0)).toBe(NEAR_MIN);
    expect(cameraNear(CAMERA_CLEARANCE)).toBeLessThan(CAMERA_CLEARANCE); // never slices the nearest block
    expect(cameraNear(CAMERA_CLEARANCE)).toBeGreaterThanOrEqual(NEAR_MIN);
  });
  it('near/far ratio stays bounded', () => {
    expect(CAMERA_FAR / NEAR_MAX).toBeLessThan(250);
    expect(CAMERA_FAR / NEAR_MIN).toBeLessThan(1000);
  });
  it('near tightens at once and loosens smoothly', () => {
    expect(easeNear(0.2, 0.05, 0.016)).toBe(0.05);
    const n = easeNear(0.05, 0.2, 0.016);
    expect(n).toBeGreaterThan(0.05);
    expect(n).toBeLessThan(0.1);
  });
  it('a 16-bit depth buffer resolves 0.005 blocks at 7 blocks outdoors (thinnest part gap is 0.01)', () => {
    expect(depthResolution(7, NEAR_MAX, CAMERA_FAR, 16)).toBeLessThanOrEqual(0.005);
    expect(depthResolution(7, NEAR_MAX, CAMERA_FAR, 24)).toBeLessThan(0.0001);
  });
  it('the old 0.05 / 64 setup could not (documents why this matters)', () => {
    expect(depthResolution(7, 0.05, 64, 16)).toBeGreaterThan(0.01);
  });
});

describe('the far and near planes follow the view distance (Task 10b)', () => {
  it('cameraFar(40) is 44 and cameraFar(96) is 100; CAMERA_FAR_MIN is 44 (and CAMERA_FAR stays the minimum)', () => {
    expect(cameraFar(40)).toBe(44);
    expect(cameraFar(96)).toBe(100);
    expect(CAMERA_FAR_MIN).toBe(44);
    expect(CAMERA_FAR_MAX).toBe(100);
    expect(CAMERA_FAR).toBe(CAMERA_FAR_MIN);
  });
  it('nearMaxFor(40) and (64) are 0.2, (96) is 0.25, monotone between', () => {
    expect(nearMaxFor(40)).toBe(0.2);
    expect(nearMaxFor(64)).toBe(0.2);
    expect(nearMaxFor(96)).toBeCloseTo(0.25, 10);
    let prev = 0;
    for (let d = 40; d <= 96; d += 0.5) {
      expect(nearMaxFor(d)).toBeGreaterThanOrEqual(prev);
      prev = nearMaxFor(d);
    }
  });
  it('the plan table to three decimals', () => {
    expect(depthResolution(40, 0.2, 100, 16)).toBeCloseTo(0.122, 3);
    expect(depthResolution(60, 0.2, 100, 16)).toBeCloseTo(0.274, 3);
    expect(depthResolution(96, 0.2, 100, 16)).toBeCloseTo(0.702, 3);
    expect(depthResolution(96, 0.25, 100, 16)).toBeCloseTo(0.561, 3);
    expect(depthResolution(40, 0.2, 44, 16)).toBeCloseTo(0.122, 3); // the plan's table says 0.123: 0.1215 rounds to 0.122
  });
  it('a one-block gap is resolved out to depth 114 at near 0.2 and far 100', () => {
    expect(depthResolution(114, 0.2, 100, 16)).toBeLessThanOrEqual(1);
    expect(depthResolution(115, 0.2, 100, 16)).toBeGreaterThan(1);
  });
  it('far 44 against 100 changes the resolution at z = 40 by under 0.5 percent; at near 0.25 the gap at z = 58 is under 0.22', () => {
    const a = depthResolution(40, 0.2, 44, 16), b = depthResolution(40, 0.2, 100, 16);
    expect(Math.abs(a - b) / a).toBeLessThan(0.005);
    expect(depthResolution(58, 0.25, 100, 16)).toBeLessThan(0.22);
  });
  it('cameraNear is still 0.05 in a one-block tunnel and never above nearMaxFor', () => {
    for (const d of [40, 64, 80, 96]) {
      expect(cameraNear(0, nearMaxFor(d))).toBe(NEAR_MIN);
      expect(cameraNear(1, nearMaxFor(d))).toBe(nearMaxFor(d));
      expect(cameraNear(0.5, nearMaxFor(d))).toBeLessThanOrEqual(nearMaxFor(d));
    }
  });
  it('currentCameraFar never reads below CAMERA_FAR_MIN', () => {
    setCurrentCameraFar(100);
    expect(currentCameraFar()).toBe(100);
    setCurrentCameraFar(10);
    expect(currentCameraFar()).toBe(44);
    setCurrentCameraFar(NaN);
    expect(currentCameraFar()).toBe(44);
  });
});
