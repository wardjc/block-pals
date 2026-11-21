import { CAMERA_FAR_MIN } from './depthPolicy';

/**
 * The look underground: never darker, always a little brighter and softer (spec 7h, plan Task 11).
 * Pure: the scene eases depthFactor from 0 (outdoors) to 1 (deep) over about a second as the camera's
 * zone changes and lays this over the view's own fog.
 */
export interface CaveLook {
  fogColor: number;
  fogNear: number;
  fogFar: number;
  /** The hemisphere light's ground colour (the light from below). */
  groundColor: number;
  /** Hemisphere light intensity (before the scene's LIGHT_SCALE). */
  hemiIntensity: number;
  /** Always the fog colour, so a gap never shows anything but the soft haze. */
  background: number;
}

/** Today's outdoor look. */
export const OUTDOOR_LOOK: CaveLook = {
  fogColor: 0x78c6ff, fogNear: 20, fogFar: 40, groundColor: 0x88aa66, hemiIntensity: 1.0, background: 0x78c6ff,
};
/** Deep underground: a soft periwinkle haze (lighter than the sky), a close bright fog, a pale cool fill from below. */
export const DEEP_LOOK: CaveLook = {
  fogColor: 0xb9c7ff, fogNear: 14, fogFar: 36, groundColor: 0xc8d4ff, hemiIntensity: 1.15, background: 0xb9c7ff,
};
/** The deep haze is at least this light (luminance, 0..1). */
export const CAVE_LUMINANCE_FLOOR = 0.62;

/**
 * Brightness of a colour as the eye reads a screen: Rec. 709 weights on the sRGB values themselves
 * (luma, 0..1). The sky 0x78c6ff is 0.73, the deep haze 0xb9c7ff 0.78.
 */
export function luminance(hex: number): number {
  const r = ((hex >> 16) & 0xff) / 255, g = ((hex >> 8) & 0xff) / 255, b = (hex & 0xff) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function mixColour(a: number, b: number, t: number): number {
  let out = 0;
  for (const shift of [16, 8, 0]) {
    const ca = (a >> shift) & 0xff, cb = (b >> shift) & 0xff;
    out |= Math.round(ca + (cb - ca) * t) << shift;
  }
  return out;
}

/**
 * The look at depthFactor (0 outdoors, 1 deep), clamped and smooth (smoothstep). `view` is the fog the
 * view distance gives outdoors (default today's 20..40): the haze slides from it to the close cave
 * haze, which stays 14..36 whatever the view setting, inside CAMERA_FAR_MIN so the far plane never cuts it.
 */
export function caveLook(depthFactor: number, view: { near: number; far: number } = { near: OUTDOOR_LOOK.fogNear, far: OUTDOOR_LOOK.fogFar }): CaveLook {
  const raw = Number.isFinite(depthFactor) ? Math.max(0, Math.min(1, depthFactor)) : 0;
  const t = raw * raw * (3 - 2 * raw);
  const fogColor = mixColour(OUTDOOR_LOOK.fogColor, DEEP_LOOK.fogColor, t);
  return {
    fogColor,
    fogNear: view.near + (DEEP_LOOK.fogNear - view.near) * t,
    fogFar: view.far + (Math.min(DEEP_LOOK.fogFar, CAMERA_FAR_MIN) - view.far) * t,
    groundColor: mixColour(OUTDOOR_LOOK.groundColor, DEEP_LOOK.groundColor, t),
    hemiIntensity: OUTDOOR_LOOK.hemiIntensity + (DEEP_LOOK.hemiIntensity - OUTDOOR_LOOK.hemiIntensity) * t,
    background: fogColor,
  };
}
