import { describe, expect, it } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { World } from '../../src/core/world';
import {
  CAMERA_MARGIN, CLOSE_DISTANCE, CameraRig, DEFAULT_PITCH, DRAG_RADIANS_PER_WIDTH, MAX_DISTANCE,
  PITCH_MAX, PITCH_MIN, clampDistance, lookDir,
} from '../../src/render/cameraRig';

const solidAt = (w: World, p: { x: number; y: number; z: number }): boolean => {
  const id = w.get(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
  return id !== BlockId.Air && id !== BlockId.Water;
};

/** A flat 32×16×32 world: stone up to y = 3, so feet stand at y = 4. */
function flat(): World {
  const w = new World(32, 16, 32);
  for (let x = 0; x < 32; x++) for (let z = 0; z < 32; z++) for (let y = 0; y <= 3; y++) w.set(x, y, z, BlockId.Stone);
  return w;
}
const EYE = { x: 16.5, y: 5.6, z: 16.5 };
/** A wall across z = 14 (behind a player at z 16.5 looking +z), y 4..9. */
function wallBehind(w: World, id = BlockId.Stone): void {
  for (let x = 0; x < 32; x++) for (let y = 4; y <= 9; y++) w.set(x, y, 14, id);
}
const step = (rig: CameraRig, w: World, seconds: number, eye = EYE): void => {
  for (let t = 0; t < seconds; t += 1 / 60) rig.update(w, eye, 1 / 60);
};

describe('lookDir', () => {
  it('yaw 0 looks along +z and pitch looks down', () => {
    const d = lookDir(0, 0, { x: 0, y: 0, z: 0 });
    expect(d.x).toBeCloseTo(0); expect(d.y).toBeCloseTo(0); expect(d.z).toBeCloseTo(1);
    const down = lookDir(Math.PI / 2, Math.PI / 4, { x: 0, y: 0, z: 0 });
    expect(down.x).toBeCloseTo(Math.SQRT1_2); expect(down.y).toBeCloseTo(-Math.SQRT1_2); expect(down.z).toBeCloseTo(0);
  });
});

describe('clampDistance', () => {
  it('open sky gives the full distance', () => {
    const w = flat();
    expect(clampDistance(w, EYE, lookDir(0, DEFAULT_PITCH, { x: 0, y: 0, z: 0 }), MAX_DISTANCE)).toBe(MAX_DISTANCE);
  });

  it('camera pulls in when a wall is behind the player', () => {
    const w = flat();
    wallBehind(w);
    const d = clampDistance(w, EYE, lookDir(0, 0, { x: 0, y: 0, z: 0 }), MAX_DISTANCE);
    // The wall face is at z = 15, 1.5 behind the eye.
    expect(d).toBeLessThanOrEqual(1.5 - CAMERA_MARGIN + 1e-9);
    expect(d).toBeGreaterThan(1);
  });

  it('leaves and glass block the camera too, water does not', () => {
    for (const id of [BlockId.Leaves, BlockId.Glass]) {
      const w = flat();
      wallBehind(w, id);
      expect(clampDistance(w, EYE, lookDir(0, 0, { x: 0, y: 0, z: 0 }), MAX_DISTANCE)).toBeLessThan(1.5);
    }
    const w = flat();
    wallBehind(w, BlockId.Water);
    expect(clampDistance(w, EYE, lookDir(0, 0, { x: 0, y: 0, z: 0 }), MAX_DISTANCE)).toBe(MAX_DISTANCE);
  });

  it('an eye inside a block gives 0', () => {
    const w = flat();
    expect(clampDistance(w, { x: 3.5, y: 2.5, z: 3.5 }, lookDir(0, 0.5, { x: 0, y: 0, z: 0 }), MAX_DISTANCE)).toBe(0);
  });

  it('camera never ends inside a solid block (many directions, tunnel and hills)', () => {
    const w = flat();
    // A 1×2 hole three deep: feet at y = 1 in cells (16,1..3,16) and (16,1..3,17).
    for (let y = 1; y <= 3; y++) { w.set(16, y, 16, BlockId.Air); w.set(16, y, 17, BlockId.Air); }
    // Some bumps.
    for (let i = 0; i < 40; i++) {
      const x = (i * 7) % 32, z = (i * 13) % 32;
      if (x !== 16 || (z !== 16 && z !== 17)) w.set(x, 4 + (i % 3), z, BlockId.Dirt); // not on his head
    }
    const eyes = [{ x: 16.5, y: 2.6, z: 16.5 }, { x: 16.2, y: 2.6, z: 17.8 }, EYE, { x: 5.1, y: 5.6, z: 9.9 }];
    const dir = { x: 0, y: 0, z: 0 };
    for (const eye of eyes) expect(solidAt(w, eye)).toBe(false);
    for (const eye of eyes) for (let yaw = 0; yaw < Math.PI * 2; yaw += 0.2) {
      for (let pitch = PITCH_MIN; pitch <= PITCH_MAX; pitch += 0.1) {
        lookDir(yaw, pitch, dir);
        const d = clampDistance(w, eye, dir, MAX_DISTANCE);
        const cam = { x: eye.x - dir.x * d, y: eye.y - dir.y * d, z: eye.z - dir.z * d };
        expect(solidAt(w, cam), `yaw ${yaw} pitch ${pitch} eye ${JSON.stringify(eye)}`).toBe(false);
      }
    }
  });
});

describe('CameraRig', () => {
  it('starts behind the player looking at him, a little down', () => {
    const rig = new CameraRig();
    expect(rig.yaw).toBe(0);
    expect(rig.pitch).toBe(DEFAULT_PITCH);
    rig.update(flat(), EYE, 1 / 60);
    expect(rig.distance).toBeCloseTo(MAX_DISTANCE);
    expect(rig.position.z).toBeLessThan(EYE.z);
    expect(rig.position.y).toBeGreaterThan(EYE.y);
    expect(rig.close).toBe(false);
  });

  it('pulls in at once when a wall comes behind, and never sits inside it', () => {
    const w = flat();
    const rig = new CameraRig();
    rig.pitch = 0;
    step(rig, w, 0.5);
    wallBehind(w);
    rig.update(w, EYE, 1 / 60);
    expect(rig.distance).toBeLessThanOrEqual(1.5 - CAMERA_MARGIN + 1e-9);
    expect(solidAt(w, rig.position)).toBe(false);
  });

  it('glides back out when the wall is removed, not in one jump', () => {
    const w = flat();
    const rig = new CameraRig();
    rig.pitch = 0;
    wallBehind(w);
    step(rig, w, 0.5);
    const near = rig.distance;
    for (let x = 0; x < 32; x++) for (let y = 4; y <= 9; y++) w.set(x, y, 14, BlockId.Air);
    rig.update(w, EYE, 1 / 60);
    expect(rig.distance).toBeGreaterThan(near);
    expect(rig.distance).toBeLessThan(near + 1);
    step(rig, w, 0.15);
    expect(rig.distance).toBeLessThan(MAX_DISTANCE - 0.5);
    step(rig, w, 0.5);
    expect(rig.distance).toBeGreaterThan(MAX_DISTANCE - 0.1);
  });

  it(`close mode below ${CLOSE_DISTANCE}: the camera sits at the head`, () => {
    const w = flat();
    for (let x = 0; x < 32; x++) for (let y = 4; y <= 9; y++) w.set(x, y, 15, BlockId.Stone); // wall 0.5 behind
    const rig = new CameraRig();
    rig.pitch = 0;
    rig.update(w, EYE, 1 / 60);
    expect(rig.close).toBe(true);
    expect(rig.distance).toBe(0);
    expect(rig.position).toEqual(EYE);
  });

  it('is not in close mode at a distance just above the limit', () => {
    const w = flat();
    for (let x = 0; x < 32; x++) for (let y = 4; y <= 9; y++) w.set(x, y, 13, BlockId.Stone); // face at z 14, 2.5 behind
    const rig = new CameraRig();
    rig.pitch = 0;
    step(rig, w, 1);
    expect(rig.distance).toBeGreaterThan(CLOSE_DISTANCE);
    expect(rig.close).toBe(false);
  });

  it('pitch is clamped and yaw wraps without flipping', () => {
    const rig = new CameraRig();
    rig.drag(0, 100000, 1000);
    expect(rig.pitch).toBe(PITCH_MAX);
    rig.drag(0, -100000, 1000);
    expect(rig.pitch).toBe(PITCH_MIN);
    expect(PITCH_MIN).toBeLessThan(0);
    expect(PITCH_MIN).toBeGreaterThan(-0.3);
    expect(PITCH_MAX).toBeCloseTo((70 * Math.PI) / 180);
    rig.drag(50000, 0, 1000);
    expect(Math.abs(rig.yaw)).toBeLessThanOrEqual(Math.PI);
  });

  it('drag maps to yaw/pitch: a full-width drag right turns the view right by about 240°', () => {
    const rig = new CameraRig();
    rig.pitch = 0;
    expect(DRAG_RADIANS_PER_WIDTH).toBeGreaterThanOrEqual(Math.PI);
    expect(DRAG_RADIANS_PER_WIDTH).toBeLessThanOrEqual((270 * Math.PI) / 180);
    rig.drag(100, 0, 1000); // a tenth of the width, to the right
    expect(rig.yaw).toBeCloseTo(-DRAG_RADIANS_PER_WIDTH / 10);
    // Turning right from looking +z means looking towards -x.
    const d = lookDir(rig.yaw, 0, { x: 0, y: 0, z: 0 });
    expect(d.x).toBeLessThan(0);
    rig.drag(0, 100, 1000); // finger down → look further down
    expect(rig.pitch).toBeCloseTo(DRAG_RADIANS_PER_WIDTH / 10);
  });

  it('a pad look stick turns the view at a steady rate', () => {
    const rig = new CameraRig();
    const pitch0 = rig.pitch;
    rig.turn(1, 0, 0.5);
    expect(rig.yaw).toBeLessThan(-0.5);
    rig.turn(0, -1, 0.1); // stick up → look up
    expect(rig.pitch).toBeLessThan(pitch0);
  });

  it('the camera does not swing back behind the player when he walks', () => {
    const w = flat();
    const rig = new CameraRig();
    rig.drag(250, 0, 1000);
    const yaw = rig.yaw;
    step(rig, w, 1, { x: 10.5, y: 5.6, z: 20.5 });
    expect(rig.yaw).toBe(yaw);
  });

  it('allocates nothing visible: position and forward are reused objects', () => {
    const rig = new CameraRig();
    const p = rig.position, f = rig.forward;
    rig.update(flat(), EYE, 1 / 60);
    expect(rig.position).toBe(p);
    expect(rig.forward).toBe(f);
  });
});
