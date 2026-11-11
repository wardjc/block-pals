import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import {
  BEACON_CLAMP, BEACON_NEAR_HIDE, BEACON_OPACITY_MAX, BEACON_OPACITY_MIN, BEACON_SIZE, BEACON_SIZE_SWING, Beacon,
  MARKER_BOTTOM, beaconPixels, beaconPulse, beaconScreen, markerShown,
} from '../../src/render/beacon';
import { CAMERA_FAR } from '../../src/render/depthPolicy';
import { generateWorld } from '../../src/core/worldgen';

const { tower } = generateWorld(2026);
const at = tower.beacon;

function cam(x: number, y: number, z: number, lookX: number, lookY: number, lookZ: number, aspect = 1.6): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(60, aspect, 0.2, CAMERA_FAR);
  c.position.set(x, y, z);
  c.lookAt(lookX, lookY, lookZ);
  c.updateMatrixWorld();
  return c;
}

describe('the tower beacon', () => {
  it('is one fog-free sprite with depth writes off (1 draw call)', () => {
    const scene = new THREE.Scene();
    const b = new Beacon(scene, at);
    expect(scene.children.filter(o => (o as THREE.Sprite).isSprite)).toEqual([b.sprite]);
    const m = b.sprite.material as THREE.SpriteMaterial;
    expect(m.fog).toBe(false);
    expect(m.depthWrite).toBe(false);
  });

  it('BEACON_CLAMP is CAMERA_FAR - 2 (imported, never copied), and the clamped sprite is always inside the far plane', () => {
    expect(BEACON_CLAMP).toBe(CAMERA_FAR - 2);
    expect(readFileSync('src/render/beacon.ts', 'utf8')).toMatch(/BEACON_CLAMP = CAMERA_FAR - 2/);
    const b = new Beacon(new THREE.Scene(), at);
    for (const [x, z] of [[24, 24], [70, 20], [5, 90], [90, 90], [36, 40]]) {
      const c = cam(x, 8, z, at.x, at.y, at.z);
      b.update(c, 0);
      const d = c.position.distanceTo(b.sprite.position);
      expect(d).toBeLessThanOrEqual(CAMERA_FAR - 1.9);
    }
  });

  it('beyond the clamp it rides the line of sight with its apparent size kept', () => {
    const b = new Beacon(new THREE.Scene(), at);
    const c = cam(24, 8, 24, at.x, at.y, at.z); // the spawn, about 60 away
    b.update(c, 0); // pulse scale is 1 at t = 0
    const real = c.position.distanceTo(new THREE.Vector3(at.x, at.y, at.z));
    expect(real).toBeGreaterThan(BEACON_CLAMP);
    const p = b.sprite.position;
    expect(c.position.distanceTo(p)).toBeCloseTo(BEACON_CLAMP, 5);
    // On the same line.
    const dirA = new THREE.Vector3(at.x, at.y, at.z).sub(c.position).normalize();
    const dirB = p.clone().sub(c.position).normalize();
    expect(dirA.dot(dirB)).toBeCloseTo(1, 6);
    // Same angular size: scale / distance is constant.
    expect(b.sprite.scale.x / BEACON_CLAMP).toBeCloseTo(BEACON_SIZE / real, 6);
  });

  it('within the clamp it sits at the real place; within 10 blocks it hides', () => {
    const b = new Beacon(new THREE.Scene(), at);
    b.update(cam(at.x, at.y - 2, at.z - 25, at.x, at.y, at.z), 0);
    expect(b.sprite.visible).toBe(true);
    expect(b.sprite.position.toArray()).toEqual([at.x, at.y, at.z]);
    b.update(cam(at.x, at.y - 3, at.z - 6, at.x, at.y, at.z), 0);
    expect(b.sprite.visible).toBe(false);
    expect(BEACON_NEAR_HIDE).toBe(10);
  });

  it('the pulse is slow and gentle: opacity 0.8..1.0, size ±4%, period 4 s, never a jump', () => {
    let prev = beaconPulse(0);
    for (let t = 0; t <= 8; t += 1 / 60) {
      const p = beaconPulse(t);
      expect(p.opacity).toBeGreaterThanOrEqual(BEACON_OPACITY_MIN - 1e-9);
      expect(p.opacity).toBeLessThanOrEqual(BEACON_OPACITY_MAX + 1e-9);
      expect(Math.abs(p.scale - 1)).toBeLessThanOrEqual(BEACON_SIZE_SWING + 1e-9);
      expect(Math.abs(p.opacity - prev.opacity)).toBeLessThan(0.01); // no flash between frames
      prev = p;
    }
    expect(beaconPulse(1.3).opacity).toBeCloseTo(beaconPulse(5.3).opacity, 9);
    expect(beaconPulse(NaN).opacity).toBeCloseTo(0.9);
  });

  it('the star picture is soft and bright: no dark pixel where it shows', () => {
    const px = beaconPixels();
    expect(px.length).toBe(64 * 64 * 4);
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 20) continue;
      expect(Math.min(px[i], px[i + 1], px[i + 2])).toBeGreaterThan(180);
    }
    expect(px[(32 * 64 + 32) * 4 + 3]).toBeGreaterThan(200); // a bright middle
  });

  it('nothing in the beacon reads or writes the world', () => {
    const src = readFileSync('src/render/beacon.ts', 'utf8');
    expect(src).not.toMatch(/core\/world|\bWorld\b|world\.(get|set)/);
  });
});

describe('beaconScreen', () => {
  const W = 1280, H = 800;
  it('on screen: its pixel', () => {
    const s = beaconScreen(cam(36, 15, 50, at.x, at.y, at.z), at, W, H);
    expect(s.onScreen).toBe(true);
    expect(s.x).toBeCloseTo(W / 2, 0);
    expect(s.y).toBeCloseTo(H / 2, 0);
  });
  it('off to the left, right and top: clamped to that edge with the right angle', () => {
    // Looking east (+x) from north of the tower: the tower (south, +z) is to the right.
    const right = beaconScreen(cam(36, 15, 40, 60, 15, 40), at, W, H);
    expect(right.onScreen).toBe(false);
    expect(right.x).toBeGreaterThan(W - 60);
    expect(Math.abs(right.angle)).toBeLessThan(Math.PI / 2);
    const left = beaconScreen(cam(36, 15, 40, 10, 15, 40), at, W, H);
    expect(left.x).toBeLessThan(60);
    expect(Math.abs(left.angle)).toBeGreaterThan(Math.PI / 2);
    // Looking down hard: the high beacon is above the top edge.
    const up = beaconScreen(cam(36, 25, 70, 36, 0, 70.01), at, W, H);
    expect(up.onScreen).toBe(false);
    expect(up.y).toBeLessThan(60);
    expect(up.angle).toBeLessThan(0);
  });
  it('behind the camera: clamped to the nearest edge, never in the middle, never under the hotbar', () => {
    const s = beaconScreen(cam(36, 15, 40, 36.001, 15, 0), at, W, H);
    expect(s.onScreen).toBe(false);
    const toEdge = Math.min(s.x, W - s.x, s.y, H - s.y);
    expect(toEdge).toBeLessThanOrEqual(MARKER_BOTTOM + 1);
    expect(s.y).toBeLessThanOrEqual(H - MARKER_BOTTOM);
    expect(s.distance).toBeCloseTo(Math.hypot(0.5, at.y - 15, at.z - 40), 0);
  });
  it('markerShown: only off screen, more than 20 away, never visited and no overlay', () => {
    const off = { onScreen: false, distance: 50 };
    expect(markerShown(off, false, false)).toBe(true);
    expect(markerShown({ onScreen: true, distance: 50 }, false, false)).toBe(false);
    expect(markerShown({ onScreen: false, distance: 19 }, false, false)).toBe(false);
    expect(markerShown(off, true, false)).toBe(false);
    expect(markerShown(off, false, true)).toBe(false);
  });
});
