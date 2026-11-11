import * as THREE from 'three';
import type { Cell } from '../core/pathfind';
import type { AnimalBox } from '../input/entityPick';

/**
 * Orlo the wizard (spec §7g): one merged, vertex-coloured box mesh plus Glim, his little glowing
 * orb, on its own unlit material. Two draw calls in all. Everything here is gentle and bright: a
 * periwinkle robe with gold stars, a gold belt with his long white beard tucked in, round gold
 * glasses, a rosy nose and a tall tilted hat. No skeleton: the idle is a few transforms a frame.
 */

/** Every colour the body uses (tests check none is dark or a harsh red). */
export const WIZARD_COLOURS = {
  robe: '#5b6fe0',
  robeLight: '#7487ec',
  gold: '#f2c84b',
  skin: '#f6cba8',
  beard: '#f4f4f8',
  nose: '#f29a94',
  eye: '#6b4a7a',
  hat: '#6a63dc',
  hatBand: '#f2c84b',
  staff: '#c79a64',
  staffBall: '#e8f4ff',
} as const;
export const WIZARD_PALETTE: readonly string[] = Object.values(WIZARD_COLOURS);

export const WIZARD_MAX_TRIANGLES = 280;
export const ORB_MAX_TRIANGLES = 24;
/** Beyond this distance from the camera he is not drawn (the fog hides him anyway). */
export const WIZARD_VIEW_RANGE = 44;
/** He turns to face the player within this many blocks. */
export const WIZARD_FACE_RANGE = 6;
/** Turning speed cap: 90 degrees a second. Never a spin. */
export const WIZARD_TURN_RATE = Math.PI / 2;
export const BREATH = 0.01;
export const GLIM_RADIUS = 0.5;
export const GLIM_PERIOD = 6;
export const HOP_HEIGHT = 0.3;
export const HOP_SECONDS = 0.5;
/** His height (feet to the star on his hat): the ground room is 3 blocks high, so he always fits. */
export const WIZARD_HEIGHT = 2.8;

/** [cx, cy, cz, w, h, d, colour, rotZ?] in blocks; feet at y = 0, facing +z. */
type Part = readonly [number, number, number, number, number, number, string, number?];
const C = WIZARD_COLOURS;

export const WIZARD_PARTS: readonly Part[] = [
  // Robe: three boxes widening to the floor.
  [0, 0.26, 0, 0.92, 0.52, 0.72, C.robe],
  [0, 0.76, 0, 0.78, 0.5, 0.6, C.robe],
  [0, 1.18, 0, 0.66, 0.42, 0.52, C.robeLight],
  // Gold stars on the robe.
  [-0.24, 0.36, 0.365, 0.1, 0.1, 0.02, C.gold],
  [0.26, 0.62, 0.305, 0.1, 0.1, 0.02, C.gold],
  // Gold belt.
  [0, 0.98, 0, 0.8, 0.1, 0.62, C.gold],
  // Sleeves and hands.
  [-0.42, 1.12, 0.04, 0.2, 0.42, 0.26, C.robe],
  [0.42, 1.12, 0.04, 0.2, 0.42, 0.26, C.robe],
  [-0.42, 0.86, 0.06, 0.14, 0.12, 0.14, C.skin],
  [0.42, 0.86, 0.06, 0.14, 0.12, 0.14, C.skin],
  // Head.
  [0, 1.62, 0, 0.46, 0.42, 0.44, C.skin],
  // The long white beard, tucked in his belt, with a fluffy lower part.
  [0, 1.36, 0.25, 0.42, 0.34, 0.1, C.beard],
  [0, 1.12, 0.3, 0.3, 0.26, 0.08, C.beard],
  // Bushy white eyebrows.
  [-0.11, 1.76, 0.225, 0.16, 0.05, 0.04, C.beard],
  [0.11, 1.76, 0.225, 0.16, 0.05, 0.04, C.beard],
  // Round gold glasses with kind eyes behind.
  [-0.11, 1.66, 0.225, 0.14, 0.12, 0.02, C.gold],
  [0.11, 1.66, 0.225, 0.14, 0.12, 0.02, C.gold],
  [-0.11, 1.66, 0.24, 0.06, 0.06, 0.02, C.eye],
  [0.11, 1.66, 0.24, 0.06, 0.06, 0.02, C.eye],
  // Rosy nose.
  [0, 1.58, 0.25, 0.08, 0.08, 0.08, C.nose],
  // Hat: a wide brim, a gold band, then three tiers leaning more and more (so tall the roof was built round it).
  [0, 1.86, 0, 0.78, 0.06, 0.78, C.hat],
  [0, 1.93, 0, 0.5, 0.08, 0.5, C.hatBand],
  [0.02, 2.1, 0, 0.46, 0.28, 0.46, C.hat, -0.08],
  [0.07, 2.36, 0, 0.32, 0.26, 0.32, C.hat, -0.18],
  [0.15, 2.58, 0, 0.18, 0.22, 0.18, C.hat, -0.3],
  // A gold star on the tip.
  [0.22, 2.7, 0, 0.13, 0.13, 0.06, C.gold, Math.PI / 4],
  // Staff with a pale ball (his right side, held by the hand).
  [0.58, 0.95, 0.1, 0.07, 1.9, 0.07, C.staff],
  [0.58, 1.95, 0.1, 0.16, 0.16, 0.16, C.staffBall],
];

/** Five faces per box (no bottom): 10 triangles. */
const FACES: Array<{ n: [number, number, number]; v: Array<[number, number, number]> }> = [
  { n: [0, 0, 1], v: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  { n: [0, 0, -1], v: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
  { n: [1, 0, 0], v: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
  { n: [-1, 0, 0], v: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
  { n: [0, 1, 0], v: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
];

function bodyGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array(WIZARD_PARTS.length * 5 * 4 * 3);
  const normals = new Float32Array(positions.length);
  const colours = new Float32Array(positions.length);
  const indices = new Uint16Array(WIZARD_PARTS.length * 5 * 6);
  const col = new THREE.Color();
  let v = 0;
  let i = 0;
  for (const [cx, cy, cz, w, h, d, colour, rotZ = 0] of WIZARD_PARTS) {
    col.set(colour);
    const cos = Math.cos(rotZ), sin = Math.sin(rotZ);
    for (const f of FACES) {
      const base = v / 3;
      for (const [sx, sy, sz] of f.v) {
        const lx = (sx * w) / 2, ly = (sy * h) / 2, lz = (sz * d) / 2;
        positions[v] = cx + lx * cos - ly * sin;
        positions[v + 1] = cy + lx * sin + ly * cos;
        positions[v + 2] = cz + lz;
        normals[v] = f.n[0] * cos - f.n[1] * sin;
        normals[v + 1] = f.n[0] * sin + f.n[1] * cos;
        normals[v + 2] = f.n[2];
        colours[v] = col.r; colours[v + 1] = col.g; colours[v + 2] = col.b;
        v += 3;
      }
      indices.set([base, base + 1, base + 2, base, base + 2, base + 3], i);
      i += 6;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  g.setIndex(new THREE.BufferAttribute(indices, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/** The body (one mesh), Glim (one mesh) and the group that holds both. Feet at y = 0, facing +z. */
export function makeWizardModel(): { body: THREE.Mesh; orb: THREE.Mesh; group: THREE.Group } {
  const body = new THREE.Mesh(bodyGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  const orb = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.14, 0),
    new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(0.55, 0.8, 0.8), transparent: true, opacity: 0.95 }),
  );
  const group = new THREE.Group();
  group.add(body, orb);
  orb.position.set(GLIM_RADIUS, 1.5, 0);
  return { body, orb, group };
}

/** The smallest signed angle from `a` to `b`, in (-π, π]. */
export function angleTo(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** Turns `from` towards `to` by at most `rate * dt` (never past it). */
export function turnTowards(from: number, to: number, rate: number, dt: number): number {
  const d = angleTo(from, to);
  const step = Math.max(0, rate * dt);
  return Math.abs(d) <= step ? to : from + Math.sign(d) * step;
}

/** Glim's pastel colour at a moment: a slow hue drift, lightness at least 0.7 (brighter while he speaks). */
export function glimColour(timeSeconds: number, speaking: boolean): { h: number; s: number; l: number } {
  const t = Number.isFinite(timeSeconds) ? timeSeconds : 0;
  const h = (((t / 20) % 1) + 1) % 1;
  return { h, s: 0.75, l: speaking ? 0.88 : 0.78 };
}

/** The wizard in the world: idles, faces him when he is near, and Glim circles his shoulder. */
export class WizardView {
  readonly body: THREE.Mesh;
  readonly orb: THREE.Mesh;
  readonly group: THREE.Group;
  private readonly restYaw: number;
  private hop = 0;
  private readonly v = new THREE.Vector3();

  constructor(private readonly scene: THREE.Scene, private readonly spot: { x: number; y: number; z: number }, facing?: { x: number; z: number }) {
    const m = makeWizardModel();
    this.body = m.body;
    this.orb = m.orb;
    this.group = m.group;
    this.group.position.set(spot.x + 0.5, spot.y, spot.z + 0.5);
    this.restYaw = facing ? Math.atan2(facing.x - (spot.x + 0.5), facing.z - (spot.z + 0.5)) : 0;
    this.group.rotation.y = this.restYaw;
    scene.add(this.group);
  }

  get yaw(): number {
    return this.group.rotation.y;
  }

  /**
   * Per frame: breathing, turning (to face the player within 6 blocks, back to the door otherwise),
   * Glim's orbit and colour, the hop. `viewFrom` (the camera) hides him beyond the fog.
   */
  update(dt: number, timeSeconds: number, playerPos: { x: number; z: number } | null, speaking: boolean, viewFrom?: { x: number; z: number }): void {
    const t = Number.isFinite(timeSeconds) ? timeSeconds : 0;
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.25) : 0;
    const gx = this.group.position.x, gz = this.group.position.z;
    if (viewFrom) {
      this.group.visible = Math.hypot(viewFrom.x - gx, viewFrom.z - gz) <= WIZARD_VIEW_RANGE;
      if (!this.group.visible) return;
    }
    let target = this.restYaw;
    if (playerPos && Math.hypot(playerPos.x - gx, playerPos.z - gz) <= WIZARD_FACE_RANGE
      && Math.hypot(playerPos.x - gx, playerPos.z - gz) > 0.2) {
      target = Math.atan2(playerPos.x - gx, playerPos.z - gz);
    }
    this.group.rotation.y = turnTowards(this.group.rotation.y, target, WIZARD_TURN_RATE, step);
    this.body.scale.y = 1 + Math.sin(t * 2) * BREATH;
    // A small hop when a puzzle is solved: one smooth arch, then back to rest.
    let y = 0;
    if (this.hop > 0) {
      this.hop += step;
      const p = this.hop / HOP_SECONDS;
      if (p >= 1) this.hop = 0;
      else y = Math.sin(p * Math.PI) * HOP_HEIGHT;
    }
    this.group.position.y = this.spot.y + y;
    const a = (t / GLIM_PERIOD) * Math.PI * 2;
    this.orb.position.set(Math.cos(a) * GLIM_RADIUS, 1.5 + Math.sin(t * 1.7) * 0.06, Math.sin(a) * GLIM_RADIUS);
    this.orb.rotation.y = t * 0.8;
    const c = glimColour(t, speaking);
    (this.orb.material as THREE.MeshBasicMaterial).color.setHSL(c.h, c.s, c.l);
    this.orb.scale.setScalar(speaking ? 1.2 : 1);
  }

  /** A small happy hop (a puzzle solved). */
  celebrate(): void {
    if (this.hop === 0) this.hop = 1e-4;
  }

  /** His feet cell and the cell above: nothing can be built into him and the floor under him is never dug. */
  cells(): Cell[] {
    const { x, y, z } = this.spot;
    return [[x, y, z], [x, y + 1, z]];
  }

  /** A generous box round him for the tap ray (the same picking as the animals). */
  box(): AnimalBox {
    const { x, y, z } = this.spot;
    return { id: -1, min: [x + 0.1, y, z + 0.1], max: [x + 0.9, y + WIZARD_HEIGHT - 0.3, z + 0.9] };
  }

  /** His middle on screen (CSS px within `rect`) and its depth, for the disc pick. */
  screenCentre(camera: THREE.Camera, rect: { left: number; top: number; width: number; height: number } = { left: 0, top: 0, width: 1, height: 1 }): { sx: number; sy: number; sz: number } {
    camera.updateMatrixWorld();
    this.v.set(this.spot.x + 0.5, this.spot.y + 1.2, this.spot.z + 0.5).project(camera);
    return { sx: rect.left + ((this.v.x + 1) / 2) * rect.width, sy: rect.top + ((1 - this.v.y) / 2) * rect.height, sz: this.v.z };
  }

  dispose(): void {
    this.scene.remove(this.group);
    for (const m of [this.body, this.orb]) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  }
}
