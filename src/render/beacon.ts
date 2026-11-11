import * as THREE from 'three';
import { CAMERA_FAR } from './depthPolicy';

/**
 * The tower's far light (spec §7g): one fog-free sprite, a soft pale-blue and cream star, above
 * the tower's roof. It must read from across the meadow without moving the camera's far plane, so
 * when it is farther than BEACON_CLAMP it rides the same line of sight at that distance, scaled so
 * its apparent size never changes. A slow 4 s pulse, never a flash. Hidden up close (the real lamp
 * on the roof is there to see). Nothing here reads or writes the world.
 */

/** Hidden closer than this (blocks). */
export const BEACON_NEAR_HIDE = 10;
/** Farther than this the sprite sits on the line of sight at this distance (inside the far plane, read not copied). */
export const BEACON_CLAMP = CAMERA_FAR - 2;
/** Size of the star in blocks at its real distance. */
export const BEACON_SIZE = 3;
export const BEACON_PULSE_SECONDS = 4;
export const BEACON_OPACITY_MIN = 0.8;
export const BEACON_OPACITY_MAX = 1;
export const BEACON_SIZE_SWING = 0.04;
export const BEACON_TEXTURE_SIZE = 64;

type Vec3 = { x: number; y: number; z: number };

/** The star picture: 64×64 RGBA, made once from numbers (no canvas needed). Soft glow, four gentle rays, cream heart. */
export function beaconPixels(size = BEACON_TEXTURE_SIZE): Uint8Array {
  const px = new Uint8Array(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - c) / c, dy = (y - c) / c;
      const r = Math.hypot(dx, dy);
      const glow = Math.max(0, 1 - r) ** 2;
      const ray = Math.max(0, 1 - r) * (Math.exp(-Math.abs(dx) * 14) + Math.exp(-Math.abs(dy) * 14)) * 0.8;
      const a = Math.min(1, glow + ray);
      const heart = Math.max(0, 1 - r * 3); // cream in the middle, pale blue outside
      const i = (y * size + x) * 4;
      px[i] = Math.round(205 + 50 * heart);
      px[i + 1] = Math.round(228 + 20 * heart);
      px[i + 2] = Math.round(255 - 40 * heart);
      px[i + 3] = Math.round(a * 255);
    }
  }
  return px;
}

/** The pulse at a moment: opacity 0.8..1.0 and size 1 ± 4%, on a 4 s sine. */
export function beaconPulse(timeSeconds: number): { opacity: number; scale: number } {
  const t = Number.isFinite(timeSeconds) ? timeSeconds : 0;
  const s = Math.sin((t / BEACON_PULSE_SECONDS) * Math.PI * 2);
  return {
    opacity: (BEACON_OPACITY_MIN + BEACON_OPACITY_MAX) / 2 + ((BEACON_OPACITY_MAX - BEACON_OPACITY_MIN) / 2) * s,
    scale: 1 + BEACON_SIZE_SWING * s,
  };
}

export class Beacon {
  readonly sprite: THREE.Sprite;
  private readonly at: THREE.Vector3;
  private readonly cam = new THREE.Vector3();

  constructor(scene: THREE.Scene, at: Vec3) {
    this.at = new THREE.Vector3(at.x, at.y, at.z);
    const tex = new THREE.DataTexture(beaconPixels(), BEACON_TEXTURE_SIZE, BEACON_TEXTURE_SIZE, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, fog: false, depthWrite: false, transparent: true, toneMapped: false,
    }));
    this.sprite.renderOrder = 4;
    this.sprite.position.copy(this.at);
    this.sprite.scale.setScalar(BEACON_SIZE);
    scene.add(this.sprite);
  }

  /** Distance from the camera to the real beacon. */
  distanceFrom(camera: THREE.Camera): number {
    camera.getWorldPosition(this.cam);
    return this.cam.distanceTo(this.at);
  }

  update(camera: THREE.Camera, timeSeconds: number): void {
    camera.getWorldPosition(this.cam);
    const d = this.cam.distanceTo(this.at);
    const s = this.sprite;
    if (d < BEACON_NEAR_HIDE) { s.visible = false; return; }
    s.visible = true;
    const pulse = beaconPulse(timeSeconds);
    (s.material as THREE.SpriteMaterial).opacity = pulse.opacity;
    if (d > BEACON_CLAMP) {
      const k = BEACON_CLAMP / d;
      s.position.set(this.cam.x + (this.at.x - this.cam.x) * k, this.cam.y + (this.at.y - this.cam.y) * k, this.cam.z + (this.at.z - this.cam.z) * k);
      s.scale.setScalar(BEACON_SIZE * k * pulse.scale);
    } else {
      s.position.copy(this.at);
      s.scale.setScalar(BEACON_SIZE * pulse.scale);
    }
  }

  dispose(): void {
    this.sprite.removeFromParent();
    (this.sprite.material as THREE.SpriteMaterial).map?.dispose();
    (this.sprite.material as THREE.Material).dispose();
  }
}

/** Space kept round the screen edge for the marker's centre: 40 px at the sides and top, clear of the hotbar below. */
export const MARKER_EDGE = 40;
/** The marker keeps its bottom 100 px above the bottom edge (the hotbar), so its centre sits at least this high. */
export const MARKER_BOTTOM = 100 + 32;

export interface BeaconScreen { onScreen: boolean; x: number; y: number; angle: number; distance: number }

const tmp = new THREE.Vector3();

/**
 * Where the beacon is on a w×h screen. On screen: its pixel. Off screen (or behind the camera): the
 * point on the inset screen edge in its direction, and the angle (radians, screen axes, 0 = right,
 * π/2 = down) the marker's arrow points.
 */
export function beaconScreen(camera: THREE.Camera, at: Vec3, w: number, h: number): BeaconScreen {
  camera.updateMatrixWorld();
  camera.getWorldPosition(tmp);
  const distance = tmp.distanceTo(at as THREE.Vector3);
  // Camera space: x right, y up, looking down -z.
  const p = tmp.set(at.x, at.y, at.z).applyMatrix4(camera.matrixWorldInverse);
  if (p.z < 0) {
    const ndc = tmp.set(at.x, at.y, at.z).project(camera);
    if (Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1) {
      return { onScreen: true, x: ((ndc.x + 1) / 2) * w, y: ((1 - ndc.y) / 2) * h, angle: 0, distance };
    }
    return edge(w, h, (ndc.x * w) / 2, (-ndc.y * h) / 2, distance);
  }
  // Behind: the camera-space direction still says left/right/up/down; straight behind points down.
  let dx = p.x, dy = -p.y;
  if (Math.hypot(dx, dy) < 1e-6) { dx = 0; dy = 1; }
  return edge(w, h, dx, dy, distance);
}

function edge(w: number, h: number, dx: number, dy: number, distance: number): BeaconScreen {
  const cx = w / 2, cy = h / 2;
  const angle = Math.atan2(dy, dx);
  const left = MARKER_EDGE, right = Math.max(left, w - MARKER_EDGE);
  const top = MARKER_EDGE, bottom = Math.max(top, h - MARKER_BOTTOM);
  // Scale the direction until it meets the inset rectangle.
  const kx = dx > 0 ? (right - cx) / dx : dx < 0 ? (left - cx) / dx : Infinity;
  const ky = dy > 0 ? (bottom - cy) / dy : dy < 0 ? (top - cy) / dy : Infinity;
  const k = Math.max(0, Math.min(kx, ky));
  const x = Math.min(right, Math.max(left, cx + dx * k));
  const y = Math.min(bottom, Math.max(top, cy + dy * k));
  return { onScreen: false, x, y, angle, distance };
}

/** The star marker shows only while the beacon is off screen, more than 20 blocks away, never visited, no overlay open. */
export function markerShown(s: { onScreen: boolean; distance: number }, visited: boolean, overlayOpen: boolean): boolean {
  return !s.onScreen && s.distance > 20 && !visited && !overlayOpen;
}
