import { describe, expect, it } from 'vitest';
import { CAMERA_FAR, NEAR_MAX, NEAR_MIN, cameraNear, depthResolution, easeNear } from '../../src/render/depthPolicy';
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
