import { describe, expect, it } from 'vitest';
import { CAMERA_FAR_MIN, cameraFar } from '../../src/render/depthPolicy';
import { CAVE_LUMINANCE_FLOOR, caveLook, DEEP_LOOK, luminance, OUTDOOR_LOOK } from '../../src/render/caveLook';
import { viewFog } from '../../src/render/viewDistance';

describe('caveLook: lighter underground, never darker', () => {
  it('caveLook(0) equals the outdoor look (today: sky 0x78c6ff, fog 20..40, ground 0x88aa66, intensity 1)', () => {
    expect(caveLook(0)).toEqual(OUTDOOR_LOOK);
    expect(OUTDOOR_LOOK).toMatchObject({ fogColor: 0x78c6ff, fogNear: 20, fogFar: 40, groundColor: 0x88aa66, hemiIntensity: 1 });
  });

  it('caveLook(1) is the deep look: periwinkle 0xb9c7ff, fog 14..36, ground 0xc8d4ff, intensity 1.15', () => {
    expect(caveLook(1)).toEqual(DEEP_LOOK);
  });

  it('fog and background luminance at depth 1 is at least 0.62 and never below the outdoor value at any t (monotone over 100 steps)', () => {
    expect(luminance(caveLook(1).fogColor)).toBeGreaterThanOrEqual(CAVE_LUMINANCE_FLOOR);
    expect(CAVE_LUMINANCE_FLOOR).toBe(0.62);
    let prevFog = -1, prevGround = -1;
    for (let i = 0; i <= 100; i++) {
      const l = caveLook(i / 100);
      const fog = luminance(l.fogColor), ground = luminance(l.groundColor);
      expect(fog).toBeGreaterThanOrEqual(luminance(OUTDOOR_LOOK.fogColor) - 1e-9);
      expect(fog).toBeGreaterThanOrEqual(prevFog - 1e-9);
      expect(ground).toBeGreaterThanOrEqual(prevGround - 1e-9);
      expect(luminance(l.background)).toBeGreaterThanOrEqual(luminance(OUTDOOR_LOOK.background) - 1e-9);
      prevFog = fog;
      prevGround = ground;
    }
  });

  it('hemiIntensity is never below 1.0; background always equals the fog colour', () => {
    for (let i = 0; i <= 100; i++) {
      const l = caveLook(i / 100);
      expect(l.hemiIntensity).toBeGreaterThanOrEqual(1);
      expect(l.background).toBe(l.fogColor);
    }
  });

  it('the cave fog far is at least 34 and at most CAMERA_FAR_MIN (44) at every view distance, and the far plane never cuts the fog on the way', () => {
    for (const d of [40, 48, 64, 80, 96]) {
      const view = viewFog(d);
      const deep = caveLook(1, view);
      expect(deep.fogFar).toBeGreaterThanOrEqual(34);
      expect(deep.fogFar).toBeLessThanOrEqual(CAMERA_FAR_MIN);
      expect(deep.fogNear).toBe(14);
      for (let i = 0; i <= 100; i++) {
        const l = caveLook(i / 100, view);
        expect(l.fogFar).toBeLessThanOrEqual(cameraFar(d));
        expect(l.fogNear).toBeLessThan(l.fogFar);
      }
    }
  });

  it('bad numbers give the outdoor look (fails bright, never dark)', () => {
    expect(caveLook(NaN)).toEqual(OUTDOOR_LOOK);
    expect(caveLook(-3)).toEqual(OUTDOOR_LOOK);
    expect(caveLook(7)).toEqual(DEEP_LOOK);
  });

  it('luminance is the sRGB luma: white 1, the sky about 0.73, the deep haze about 0.78', () => {
    expect(luminance(0xffffff)).toBeCloseTo(1, 6);
    expect(luminance(0x78c6ff)).toBeCloseTo(0.727, 2);
    expect(luminance(0xb9c7ff)).toBeCloseTo(0.784, 2);
  });
});
