import * as THREE from 'three';
import type { Animal, AnimalKind } from '../game/animals';
import type { AnimalBox } from '../input/entityPick';

// Every animal is ONE mesh: a handful of boxes merged into a single geometry with vertex colours,
// feet at y = 0, facing +z (heading 0), exactly like the people. One material is shared by all of them.
// Bottom faces are left out (nobody sees them), so a box costs 10 triangles.

/** x, y, z of the centre, then w, h, d, then the colour. */
type Part = [number, number, number, number, number, number, number];

/** Animals further from the camera than this are hidden (the fog hides them anyway). */
export const ANIMAL_VIEW_RANGE = 44;
/** Triangles a single animal may cost. */
export const ANIMAL_MAX_TRIANGLES = 130;

const DARK = 0x2a2420;
const EYE = 0x1e1a18;

function chicken(variant: number): Part[] {
  const body = variant === 0 ? 0xfdf8ee : 0xa8653a;
  const wing = variant === 0 ? 0xede4d2 : 0x8c4f2b;
  const tail = variant === 0 ? 0xe6dcc8 : 0x7a4425;
  return [
    [0, 0.34, 0, 0.34, 0.3, 0.44, body],
    [0, 0.58, 0.2, 0.18, 0.2, 0.18, body],
    [0, 0.55, 0.32, 0.08, 0.05, 0.1, 0xf39a1c], // beak
    [0, 0.7, 0.2, 0.05, 0.08, 0.1, 0xe03a2e], // comb
    [0, 0.5, 0.28, 0.04, 0.06, 0.04, 0xe03a2e], // wattle
    [0, 0.5, -0.25, 0.1, 0.2, 0.1, tail],
    [-0.2, 0.36, -0.02, 0.06, 0.2, 0.3, wing],
    [0.2, 0.36, -0.02, 0.06, 0.2, 0.3, wing],
    [-0.08, 0.08, 0.02, 0.04, 0.16, 0.04, 0xf39a1c],
    [0.08, 0.08, 0.02, 0.04, 0.16, 0.04, 0xf39a1c],
    [-0.07, 0.62, 0.29, 0.04, 0.04, 0.02, EYE],
    [0.07, 0.62, 0.29, 0.04, 0.04, 0.02, EYE],
  ];
}

function cow(variant: number): Part[] {
  const white = 0xfbf7ef;
  const patch = variant === 0 ? 0x7a4a2a : 0x2e2a28;
  return [
    [0, 0.85, 0, 0.7, 0.6, 1.1, white],
    [0, 0.95, -0.12, 0.72, 0.32, 0.44, patch],
    [0, 1.05, 0.7, 0.45, 0.4, 0.4, white],
    [0, 0.95, 0.93, 0.32, 0.18, 0.12, 0xf4a7b4], // pink nose
    [-0.3, 1.2, 0.65, 0.12, 0.08, 0.1, patch],
    [0.3, 1.2, 0.65, 0.12, 0.08, 0.1, patch],
    [-0.22, 0.25, 0.4, 0.18, 0.5, 0.18, white],
    [0.22, 0.25, 0.4, 0.18, 0.5, 0.18, white],
    [-0.22, 0.25, -0.4, 0.18, 0.5, 0.18, white],
    [0.22, 0.25, -0.4, 0.18, 0.5, 0.18, white],
    [0, 0.8, -0.58, 0.06, 0.4, 0.06, patch],
    [-0.11, 1.12, 0.91, 0.06, 0.06, 0.03, EYE],
    [0.11, 1.12, 0.91, 0.06, 0.06, 0.03, EYE],
  ];
}

function sheep(variant: number): Part[] {
  const wool = variant === 0 ? 0xfdfbf5 : 0xf1e8d4;
  const face = variant === 0 ? 0x4a4040 : 0x7a5a42;
  return [
    [0, 0.8, 0, 0.7, 0.6, 0.8, wool],
    [0, 0.95, 0.5, 0.34, 0.34, 0.34, face],
    [0, 1.16, 0.46, 0.38, 0.12, 0.38, wool], // tuft
    [-0.22, 1.0, 0.48, 0.1, 0.06, 0.14, face],
    [0.22, 1.0, 0.48, 0.1, 0.06, 0.14, face],
    [-0.2, 0.2, 0.28, 0.14, 0.4, 0.14, face],
    [0.2, 0.2, 0.28, 0.14, 0.4, 0.14, face],
    [-0.2, 0.2, -0.28, 0.14, 0.4, 0.14, face],
    [0.2, 0.2, -0.28, 0.14, 0.4, 0.14, face],
    [0, 0.8, -0.46, 0.18, 0.18, 0.12, wool],
    [-0.09, 1.0, 0.68, 0.07, 0.07, 0.03, 0xffffff],
    [0.09, 1.0, 0.68, 0.07, 0.07, 0.03, 0xffffff],
  ];
}

function pig(variant: number): Part[] {
  const skin = variant === 0 ? 0xf7a8b8 : 0xf0bca4;
  const dark = variant === 0 ? 0xe58aa0 : 0xde9c84;
  return [
    [0, 0.55, 0, 0.6, 0.5, 0.9, skin],
    [0, 0.65, 0.6, 0.45, 0.4, 0.4, skin],
    [0, 0.58, 0.83, 0.26, 0.18, 0.1, dark], // snout
    [-0.17, 0.89, 0.55, 0.14, 0.12, 0.06, dark],
    [0.17, 0.89, 0.55, 0.14, 0.12, 0.06, dark],
    [-0.2, 0.15, 0.3, 0.16, 0.3, 0.16, dark],
    [0.2, 0.15, 0.3, 0.16, 0.3, 0.16, dark],
    [-0.2, 0.15, -0.3, 0.16, 0.3, 0.16, dark],
    [0.2, 0.15, -0.3, 0.16, 0.3, 0.16, dark],
    [0, 0.7, -0.5, 0.05, 0.05, 0.12, dark], // curly tail
    [0, 0.78, -0.58, 0.05, 0.1, 0.05, dark],
    [-0.12, 0.74, 0.81, 0.06, 0.06, 0.03, EYE],
    [0.12, 0.74, 0.81, 0.06, 0.06, 0.03, EYE],
  ];
}

const PARTS: Record<AnimalKind, (variant: number) => Part[]> = { chicken, cow, sheep, pig };
export const ANIMAL_KINDS: readonly AnimalKind[] = ['chicken', 'cow', 'sheep', 'pig'];

const material = new THREE.MeshLambertMaterial({ vertexColors: true });
const geometries = new Map<string, THREE.BufferGeometry>();
const c = new THREE.Color();

/** Five faces of a box (no bottom) as flat-shaded quads. */
const FACES: Array<{ n: [number, number, number]; v: Array<[number, number, number]> }> = [
  { n: [0, 0, 1], v: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  { n: [0, 0, -1], v: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
  { n: [1, 0, 0], v: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
  { n: [-1, 0, 0], v: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
  { n: [0, 1, 0], v: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
];

function mergeParts(parts: Part[]): THREE.BufferGeometry {
  const positions = new Float32Array(parts.length * 5 * 4 * 3);
  const normals = new Float32Array(positions.length);
  const colours = new Float32Array(positions.length);
  const indices = new Uint16Array(parts.length * 5 * 6);
  let v = 0;
  let i = 0;
  for (const [cx, cy, cz, w, h, d, colour] of parts) {
    c.set(colour);
    for (const f of FACES) {
      const base = v / 3;
      for (const [sx, sy, sz] of f.v) {
        positions[v] = cx + (sx * w) / 2; positions[v + 1] = cy + (sy * h) / 2; positions[v + 2] = cz + (sz * d) / 2;
        normals[v] = f.n[0]; normals[v + 1] = f.n[1]; normals[v + 2] = f.n[2];
        colours[v] = c.r; colours[v + 1] = c.g; colours[v + 2] = c.b;
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
  return g;
}

function geometryFor(kind: AnimalKind, variant: number): THREE.BufferGeometry {
  const key = `${kind}:${Math.abs(Math.floor(variant)) % 2}`;
  let g = geometries.get(key);
  if (!g) { g = mergeParts(PARTS[kind](Math.abs(Math.floor(variant)) % 2)); geometries.set(key, g); }
  return g;
}

/** One merged mesh (one draw call) inside a group; the group is what moves and turns. */
export function makeAnimalModel(kind: AnimalKind, variant: number): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geometryFor(kind, variant), material));
  return g;
}

/** Frees the shared geometries (tests, hot reload). The models are rebuilt on demand. */
export function disposeAnimalGeometry(): void {
  for (const g of geometries.values()) g.dispose();
  geometries.clear();
}

/** Draws the herd: one group per animal, created on first sight and moved every frame. */
export class AnimalView {
  private readonly groups = new Map<number, THREE.Group>();
  private readonly v = new THREE.Vector3();
  private readonly out: Array<{ id: number; sx: number; sy: number; sz: number }> = [];

  constructor(private readonly scene: THREE.Scene) {}

  get drawCalls(): number {
    let n = 0;
    for (const g of this.groups.values()) if (g.visible) n++;
    return n;
  }

  /** `visible` says whether a spot is worth drawing (inside the fog and a shown chunk). */
  sync(animals: readonly Animal[], visible: (x: number, z: number) => boolean, timeSeconds: number): void {
    for (const a of animals) {
      let g = this.groups.get(a.id);
      if (!g) {
        g = makeAnimalModel(a.kind, a.variant);
        this.groups.set(a.id, g);
        this.scene.add(g);
      }
      const show = visible(a.x, a.z);
      g.visible = show;
      if (!show) continue;
      const t = timeSeconds + a.id * 1.7;
      const moving = a.state === 'walk' || a.state === 'come';
      const mesh = g.children[0] as THREE.Mesh;
      // Idle motion moves the whole mesh: a bob, a gentle sway, a peck or a grazing dip. No skeleton.
      let bob = 0;
      let tilt = 0;
      let sway = Math.sin(t * 1.3) * 0.04;
      if (moving) { bob = Math.abs(Math.sin(t * 8)) * 0.05; sway = Math.sin(t * 8) * 0.06; }
      if (a.state === 'graze') tilt = a.kind === 'chicken' ? 0.55 * Math.max(0, Math.sin(t * 7)) : 0.3 + Math.sin(t * 2) * 0.04;
      if (a.state === 'idle' && a.kind === 'chicken') tilt = 0.35 * Math.max(0, Math.sin(t * 5)) * (Math.sin(t * 0.7) > 0.4 ? 1 : 0);
      if (a.state === 'happy') bob = Math.abs(Math.sin(t * 10)) * 0.25;
      g.position.set(a.x, a.y + bob, a.z);
      g.rotation.y = a.heading;
      mesh.rotation.x = tilt;
      mesh.rotation.z = sway;
    }
  }

  /** Where each shown animal is on screen (CSS px inside `rect`) and how deep, for tap picking. */
  screenPositions(
    camera: THREE.Camera, rect: { left: number; top: number; width: number; height: number },
  ): Array<{ id: number; sx: number; sy: number; sz: number }> {
    this.out.length = 0;
    camera.updateMatrixWorld();
    for (const [id, g] of this.groups) {
      if (!g.visible) continue;
      this.v.set(g.position.x, g.position.y + this.heightOf(g) * 0.5, g.position.z).project(camera);
      if (this.v.z < -1 || this.v.z > 1) continue;
      this.out.push({
        id,
        sx: rect.left + ((this.v.x + 1) / 2) * rect.width,
        sy: rect.top + ((1 - this.v.y) / 2) * rect.height,
        sz: this.v.z,
      });
    }
    return this.out;
  }

  /**
   * World-space boxes of the shown animals, for picking by ray. Turned animals are covered by
   * their widest reach (a square round the middle), so a box never misses a visible part.
   */
  boxes(): AnimalBox[] {
    const out: AnimalBox[] = [];
    for (const [id, g] of this.groups) {
      if (!g.visible) continue;
      const bb = (g.children[0] as THREE.Mesh).geometry.boundingBox ?? ((g.children[0] as THREE.Mesh).geometry.computeBoundingBox(), (g.children[0] as THREE.Mesh).geometry.boundingBox!);
      const r = Math.hypot(Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x)), Math.max(Math.abs(bb.min.z), Math.abs(bb.max.z)));
      const x = g.position.x, z = g.position.z, y = g.position.y;
      out.push({ id, min: [x - r, y + bb.min.y, z - r], max: [x + r, y + bb.max.y, z + r] });
    }
    return out;
  }

  private heightOf(g: THREE.Group): number {
    const box = (g.children[0] as THREE.Mesh).geometry.boundingSphere;
    return box ? box.center.y * 2 : 1;
  }

  dispose(): void {
    for (const g of this.groups.values()) this.scene.remove(g);
    this.groups.clear();
  }
}
